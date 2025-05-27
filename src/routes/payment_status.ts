// CODING BOT INSTRUCTIONS:
// This route checks payment status and MUST use the in-memory pending payments store (see include/pending_payments.ts) for hot transactions. Do NOT read Firestore for pending state. Related files: include/pending_payments.ts, initiate_payment.ts, mpesa_callback.ts, app.ts.

import * as express from 'express';
import { getPaymentStatusFirestore, getCachedPaymentStatus, setCachedPaymentStatus } from '../include/payment_status_helpers';
import { getPendingPayment } from '../include/pending_payments';
import logger from '../include/logger';
import { enqueuePaymentEvent } from '../include/payment_analytics';
import { setPaymentStatusFirestore } from '../include/payment_status_helpers';

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

const router = express.Router();

// GET /payment-status?paymentId=... OR /payment-status?CheckoutRequestId=...
router.get('/payment-status', async (req: express.Request, res: express.Response) => {
    (async (req: express.Request, res: express.Response) => {
        try {
            const { paymentId, checkoutRequestId } = req.query;
            const id = (paymentId || checkoutRequestId) as string;
            if (!id) {
                return res.status(400).json({ error: 'Missing paymentId or CheckoutRequestId' });
            }
            // Check in-memory pending payments first for hot state
            const pending = getPendingPayment(id);
            if (pending) {
                logger.info('Payment is still pending (in-memory)', { id });
                // Log event: status checked (pending)
                logPaymentEventSafe('PaymentStatusCheckedPending', id, pending.userId, pending);
                return res.json({ status: 'pending', ...pending });
            }
            // Try cache first
            let status = getCachedPaymentStatus(checkoutRequestId as string);
            if (!status) {
                //
                status = await getPaymentStatusFirestore(checkoutRequestId as string);

                if (status) setCachedPaymentStatus(checkoutRequestId as string, status);
            }
            if (!status) {
                return res.status(404).json({ error: 'Payment status not found' });
            }
            res.json({ status });
        } catch (err: any) {
            logger.error('Error fetching payment status', err);
            res.status(500).json({ error: 'Internal server error', message: err.message });
        }

    });

});

export default router;


