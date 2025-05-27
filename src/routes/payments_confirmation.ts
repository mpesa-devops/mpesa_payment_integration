import * as express from 'express';
import { setPaymentStatusFirestore } from '../include/payment_status_helpers';
import analytics from '../include/payment_analytics';
import logger from '../include/logger';
import { extractAmountFromCallbackMetadata } from '../include/utils';
import { db } from '../include/firebase';
import { removeUndefined, sanitizePaymentForClient } from '../include/mpesa_utils';
// import { sendPushNotification } from '../include/notifications'; // Uncomment if notifications util exists

const router = express.Router();

// POST /payments-confirmation (Safaricom will POST here)
router.post('/payments/confirmation', async (req, res) => {
    logger.info('Received payments confirmation callback', { body: req.body });
    try {
        const { Body } = req.body;
        if (!Body || !Body.stkCallback) {
            logger.warn('Malformed callback payload');
            res.status(400).json({ error: 'Malformed callback payload' });
            return;
        }
        let userId = Body.userId;
        const callback = Body.stkCallback;
        const checkoutRequestId = callback.CheckoutRequestID;
        const resultCode = callback.ResultCode;
        const resultDesc = callback.ResultDesc;
        const metadata = callback.CallbackMetadata;
        const amount = extractAmountFromCallbackMetadata(metadata);
        let mpesaReceiptNumber: string | undefined = undefined;
        let phoneNumber: string | undefined = undefined;
        if (metadata && Array.isArray(metadata.Item)) {
            const receiptItem = metadata.Item.find((item: any) => item.Name === 'MpesaReceiptNumber');
            if (receiptItem) mpesaReceiptNumber = String(receiptItem.Value);
            const phoneItem = metadata.Item.find((item: any) => item.Name === 'PhoneNumber');
            if (phoneItem) phoneNumber = String(phoneItem.Value);
            const userIdItem = metadata.Item.find((item: any) => item.Name === 'UserId');
            if (!userId && userIdItem) userId = String(userIdItem.Value);
        }
        if (!checkoutRequestId) {
            logger.error('Missing - Safaricom did not send a CheckoutRequestID in Body.stkCallback');
            res.status(400).json({ error: 'Missing - Safaricom did not send a CheckoutRequestID in Body.stkCallback' });
            return;
        }
        // Find the original payment transaction by checkoutRequestId
        let txDoc, txData, paymentId;
        try {
            const txQuery = await db.collection('paymentStatus')
                .where('apiResponse.stkRequest.CheckoutRequestID', '==', checkoutRequestId) // no need for query as checkoutRequestId is the id
                .limit(1).get();
            if (txQuery.empty) {
                logger.error(`No paymentTransaction found for CheckoutRequestID: ${checkoutRequestId}`);
                res.status(404).json({ error: 'Transaction not found' });
                return;
            }
            txDoc = txQuery.docs[0];
            txData = txDoc.data();
            paymentId = txDoc.id;
            if (!userId && txData.userId) userId = txData.userId;
        } catch (findErr) {
            logger.error('Error finding paymentTransaction', findErr);
            res.status(500).json({ error: 'Internal error finding transaction' });
            return;
        }
        // Prepare full update for internal collection
        const internalUpdate = removeUndefined({
            ...txData,
            mpesaCallback: callback,
            status: resultCode === 0 ? 'completed' : 'failed',
            completedAt: resultCode === 0 ? new Date().toISOString() : undefined,
            mpesaReceiptNumber,
            amount,
            phoneNumber,
            resultCode,
            resultDesc,
            userId,
            confirmationReceived: true // Mark as confirmed by callback
        });
        // Prepare sanitized update for client-facing collection
        const clientUpdate = sanitizePaymentForClient({
            paymentId,
            userId,
            status: resultCode === 0 ? 'completed' : 'failed',
            completedAt: resultCode === 0 ? new Date().toISOString() : undefined,
            mpesaReceiptNumber,
            amount,
            phoneNumber,
            resultCode,
            resultDesc
        });
        // Write to Firestore (batch for atomicity and cost efficiency)
        try {
            const batch = db.batch();
            batch.set(db.collection('paymentTransactions').doc(paymentId), internalUpdate, { merge: true });
            batch.set(db.collection('payments').doc(paymentId), clientUpdate, { merge: true });
            await batch.commit();
            logger.info(`Payment transaction updated for paymentId: ${paymentId}`);
        } catch (writeErr) {
            logger.error('Error writing payment updates to Firestore', writeErr);
            res.status(500).json({ error: 'Failed to update payment records' });
            return;
        }
        // Update payment status collection (for status endpoint, analytics, etc)
        try {
            const statusData = {
                status: resultCode === 0 ? 'success' : 'failed',
                resultCode,
                resultDesc,
                amount,
                mpesaReceiptNumber,
                phoneNumber,
                userId,
                updatedAt: new Date().toISOString(),
            };
            await setPaymentStatusFirestore(paymentId, statusData);
        } catch (statusErr) {
            logger.error('Error updating payment status collection', statusErr);
        }
        // Analytics logging
        try {
            await analytics.logPaymentEvent({
                event: resultCode === 0 ? 'PaymentSuccess' : 'PaymentFailure',
                userId: userId || 'unknown',
                amount,
                paymentId: paymentId || checkoutRequestId,
                details: callback
            });
            if (resultCode === 0) {
                await analytics.logRevenue({ amount, userId: userId || 'unknown', paymentId: paymentId || checkoutRequestId });
            } else {
                await analytics.logPaymentFailure({ userId: userId || 'unknown', reason: resultDesc, details: callback });
            }
        } catch (analyticsErr) {
            logger.error('Error logging analytics', analyticsErr);
        }
        // Send push notification if payment completed
        if (resultCode === 0 && userId) {
            try {
                // await sendPushNotification({
                //     userId,
                //     title: 'Payment Successful',
                //     body: `Your payment of KES ${amount} was successful.`,
                //     data: {
                //         paymentId,
                //         status: 'completed',
                //         mpesaReceiptNumber,
                //         amount
                //     }
                // });
                logger.info(`[STUB] Push notification would be sent for paymentId: ${paymentId} to userId: ${userId}`);
            } catch (notifyErr) {
                logger.error('Failed to send push notification', notifyErr);
            }
        }
        logger.info('Processed payments confirmation', { checkoutRequestId, resultCode, resultDesc });
        res.status(200).json({ success: true });
    } catch (err: any) {
        logger.error('Error handling payments-confirmation', err);
        res.status(500).json({ error: 'Internal server error', message: err.message });
    }
});

export default router;
