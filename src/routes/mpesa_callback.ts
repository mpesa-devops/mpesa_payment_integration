// CODING BOT INSTRUCTIONS:
// This route handles MPESA callbacks and MUST match callbacks to pending payments in the in-memory store (see include/pending_payments.ts). Do NOT fetch hot transaction state from Firestore. Related files: include/pending_payments.ts, initiate_payment.ts, payment_status.ts, app.ts.

// import express from 'express';
import e, { Request, Response, Router } from 'express';

import { setPaymentStatusFirestore } from '../include/payment_status_helpers';
import analytics, { enqueuePaymentEvent } from '../include/payment_analytics';
import logger from '../include/logger';
import { extractAmountFromCallbackMetadata } from '../include/utils';
import { db } from '../include/firebase'; // Import your database instance
import { getPendingPayment, removePendingPayment } from '../include/pending_payments';

// Utility: Minimal event logger for payment lifecycle (now batched)
async function logPaymentEventSafe(event: string, paymentId: string, userId: string, details: any) {
    // CODING BOT: Event logging must not block or throw. If batching or async queue is added, preserve this contract.
    try {
        await enqueuePaymentEvent({
            event,
            paymentId,
            userId,
            amount: details.amount,
            details,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        // Log locally for observability, but never throw
        console.warn('Non-blocking event log failure:', err);
    }
}

const router = Router();

// POST /mpesa/callback (Safaricom will POST here)
router.post('/mpesa/callback', async (req: Request, res: Response) => {
    logger.info('\n\n\Received M-Pesa callback', { body: req.body }, '\n\n');

    (async () => {
        try {
            const { Body } = req.body;
            if (!Body || !Body.stkCallback) {
                logger.warn('Malformed callback payload');
                return res.status(400).json({ error: 'Malformed callback payload' });
            }
            const callback = Body.stkCallback;
            const checkoutRequestId = callback.CheckoutRequestID;
            const resultCode = callback.ResultCode;
            const resultDesc = callback.ResultDesc;
            const metadata = callback.CallbackMetadata;
            const amount = extractAmountFromCallbackMetadata(metadata);

            // Try to match callback to pending payment in memory
            const pending = getPendingPayment(checkoutRequestId);
            let paymentId = pending ? pending.id : null;
            let userId = pending ? pending.userId : null;

            if (!pending) {
                logger.warn('No matching pending payment in memory for callback', { checkoutRequestId });
            } else {
                logger.info('Matched callback to pending payment', { checkoutRequestId, userId });
                removePendingPayment(checkoutRequestId);
            }

            if (!paymentId) {
                const txQuery = await db.collection('paymentStatus')
                    .where('checkoutRequestId', '==', checkoutRequestId)
                    .limit(1).get();

                if (txQuery.empty) {
                    logger.error(`No paymentStatus found for CheckoutRequestID: ${checkoutRequestId}`);
                    return res.status(404).json({ error: 'Transaction not found' });
                }
                
                const txDoc = txQuery.docs[0];
                const data = txQuery.docs[0].data();
                paymentId = txDoc.id;
                logger.info('\nSearching for payment status...', { data, paymentId });
            }

            const metadataItems = Array.isArray(metadata?.Item) ? metadata.Item.map((item: any) => ({
                name: item.Name || 'UnknownField',
                value: item.Value !== undefined && item.Value !== null ? item.Value : (typeof item.Name === 'string' ? item.Name : 0)
            })) : [];
            logger.info('Extracted metadata items', { metadataItems }, Body);

            // Update paymentStatus and paymentTransactions with callback details
            const status = resultCode === 0 ? 'pending' : 'failed';
            const statusUpdate = {
                status,
                resultCode: resultCode !== undefined && resultCode !== null ? resultCode : 0,
                resultDesc: resultDesc || 'No description available',
                amount: amount !== undefined && amount !== null ? amount : 0,
                metadata: { item: metadataItems },
                updatedAt: new Date().toISOString(),
                userId: userId || 'UnknownUser',
                checkoutRequestId: checkoutRequestId || 'UnknownCheckoutRequestId',
                paymentId: paymentId || 'UnknownPaymentId',
                apiResponse: {
                    stkCallback: callback || {}
                }
            };

            // Save to paymentStatus and paymentTransactions for consistency
            await db.collection('paymentStatus').doc(paymentId).set(statusUpdate, { merge: true });
            await db.collection('paymentTransactions').doc(paymentId).set(statusUpdate, { merge: true });

            // Save reduced version in payments
            const clientDoc = {
                paymentId: paymentId || 'UnknownPaymentId',
                checkoutRequestId: checkoutRequestId || 'UnknownCheckoutRequestId',
                status: statusUpdate.status,
                amount: amount !== undefined && amount !== null ? amount : 0,
                resultDesc: resultDesc || 'No description available',
                updatedAt: new Date().toISOString(),
                metadata: metadataItems
            };
            await db.collection('payments').doc(paymentId).set(clientDoc, { merge: true });

            // Log analytics events
            await analytics.logPaymentEvent({
                event: resultCode === 0 ? 'PaymentSuccess' : 'PaymentFailure',
                userId,
                amount,
                paymentId,
                details: callback
            });
            if (resultCode === 0) {
                await analytics.logRevenue({ amount, userId, paymentId });
            } else {
                await analytics.logPaymentFailure({ userId, reason: resultDesc, details: callback });
            }

            logger.info('Processed M-Pesa callback', { checkoutRequestId, resultCode, resultDesc });
            res.status(200).send();
        } catch (err: any) {
            logger.error('Error processing M-Pesa callback', err);
            res.status(500).json({ error: 'Internal server error', message: err.message });
        }
    })();
});

export default router;
