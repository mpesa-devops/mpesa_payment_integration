// CODING BOT INSTRUCTIONS:
// This route initiates a payment and MUST register all new pending payments in 
// the in-memory store (see include/pending_payments.ts). 
// 
// Do NOT write directly to Firestore for hot transaction state. 
// Related files: include/pending_payments.ts, 
// mpesa_callback.ts, payment_status.ts, app.ts.

import * as express from 'express';
import { setPaymentStatusFirestore } from '../include/payment_status_helpers';
import { enqueuePaymentEvent } from '../include/payment_analytics';
import { flagSuspiciousActivity, incrementAttemptAndCheckLimit } from '../include/suspicious_activity';
import { initiateMpesaPayment } from '../include/mpesa_utils';
import { db } from '../include/firebase';
import { addPendingPayment } from '../include/pending_payments';
import { logger } from '../app';
const router = express.Router();

// Utility to remove undefined values from an object
function removeUndefined(obj: any) {
    if (!obj || typeof obj !== 'object') return obj;
    return Object.fromEntries(Object.entries(obj).filter(([_, v]) => v !== undefined));
}

// Utility to check for missing fields
function hasUndefined(obj: any, keys: string[]): string[] {
    return keys.filter(k => obj[k] === undefined);
}

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

// /initiate-payment POST handler
router.post('/initiate-payment', (req, res, next) => {
    (async () => {
        console.log("Received payment initiation request:", req.body);
        // Accept both 'phoneNumber' and 'customerPhoneNumber' for compatibility
        const { userId, invoiceId, paymentId, amount } = req.body;
        const phoneNumber = req.body.phoneNumber || req.body.customerPhoneNumber;
        const requiredFields = ['userId', 'invoiceId', 'paymentId', 'amount', 'phoneNumber'];
        const missing = hasUndefined({ userId, invoiceId, paymentId, amount, phoneNumber }, requiredFields);
        if (missing.length > 0) {
            console.error('Missing required fields in payment initiation:', missing, req.body);
            res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
            return;
        }

        // Cap attempts and prevent abuse
        const type = 'initiate-payment';
        if (await incrementAttemptAndCheckLimit({ userId, type, maxAttempts: 5, windowMinutes: 15 })) {
            await flagSuspiciousActivity({ userId, type, details: 'Too many payment attempts', actionTaken: 'blocked' });
            console.log(`User ${userId} has exceeded the maximum number of attempts for ${type}.`);
            return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
        }

        try {
            // Save to internal collection first (paymentTransactions)
            const internalDoc = removeUndefined({
                userId,
                invoiceId,
                paymentId,
                phoneNumber,
                amount: Number(amount),
                status: 'initiated',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            });
            await db.collection('paymentTransactions').doc(paymentId).set(internalDoc, { merge: true });
            console.log('Payment initiated and saved to internal collection:', internalDoc);

            // Register in-memory pending payment for hot state
            addPendingPayment(paymentId, {
                userId,
                invoiceId,
                paymentId,
                phoneNumber,
                amount: Number(amount),
                status: 'initiated',
                createdAt: new Date().toISOString()
            });

            // Log event: payment initiated
            console.log('Logging initiate payment event:', internalDoc);
            logPaymentEventSafe('PaymentInitiated', paymentId, userId, {
                invoiceId,
                phoneNumber,
                amount: Number(amount),
                status: 'initiated',
                createdAt: new Date().toISOString()
            });

            // Call M-Pesa API
            const response = await initiateMpesaPayment({
                userId,
                invoiceId,
                paymentId,
                phoneNumber,
                amount: Number(amount)
            });

            // Log event: payment API called (non-blocking)
            console.log('Logging initiate payment response event:', response);
            logPaymentEventSafe('MpesaApiCalled', paymentId, userId, {
                paymentId,
                invoiceId,
                phoneNumber,
                amount: Number(amount),
                status: 'initiated',
                createdAt: new Date().toISOString(),
                apiResponse: response,
                checkoutRequestId: response.stkRequest.CheckoutRequestID || null
            });

            // Update paymentStatus with stkResult and checkoutRequestId if present
            if (response.stkRequest.CheckoutRequestID) {
                const statusUpdate = {
                    checkoutRequestId: response.stkRequest.CheckoutRequestID,
                    paymentId: paymentId,
                    status: 'pending',
                    updatedAt: new Date().toISOString(),
                    stkRequest: response.stkRequest

                };
                await db.collection('paymentStatus').doc(paymentId).set(statusUpdate, { merge: true });

                res.status(200).json({
                    success: true,
                    paymentId,
                    checkoutRequestId: response.stkRequest.CheckoutRequestID,
                    message: 'Payment initiated successfully',
                    data: response
                });
            } else {
                const errorMessage = {
                    apiCalled: true,
                    paymentId,
                    message: 'No checkoutRequestId returned from M-Pesa API',
                    data: response
                };
                logger.error('No checkoutRequestId returned from M-Pesa API', { paymentId, response, errorMessage });
                res.status(500).json(errorMessage);
            }

        } catch (error: any) {
            console.error('Error initiating payment:', error);
            res.status(500).json({ success: false, message: 'Failed to initiate payment', error: error.message });
        }
    })().catch(next);
});

export default router;
