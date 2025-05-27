import * as express from 'express';
import type { Request, Response } from 'express';
import { getFirestore } from 'firebase-admin/firestore';
import * as admin from 'firebase-admin';
import logger from '../include/logger';

const db = getFirestore();
const router = express.Router();

// Create Invoice
router.post('/invoice', (req: Request, res: Response) => {
    (async () => {
        const { userId, invoice } = req.body;
        if (!userId || !invoice || !invoice.id) {
            return res.status(400).json({ error: 'Missing userId or invoice.id' });
        }
        const invoiceId = invoice.id;
        const invoiceRef = db.collection('invoices').doc(invoiceId);

        try {
            const doc = await invoiceRef.get();
            if (doc.exists) {
                return res.status(409).json({ error: 'Invoice already exists' });
            }

            await invoiceRef.set({
                ...invoice,
                userId,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
            });

            const createdDoc = await invoiceRef.get();
            res.status(201).json({ id: invoiceRef.id, ...createdDoc.data() });
        } catch (error: any) {
            logger.error(error);
        }
    })();
});

// Fetch Invoice by ID
router.get('/invoice/:id', (req: Request, res: Response) => {
    (async () => {
        const { id } = req.params;
        if (!id) return res.status(400).json({ error: 'Missing invoice id' });

        try {
            const doc = await db.collection('invoices').doc(id).get();
            if (!doc.exists) return res.status(404).json({ error: 'Invoice not found' });
            res.json({ id: doc.id, ...doc.data() });
        } catch (error: any) {
            logger.error(error);
        }
    })();
});

// List all Invoices
router.get('/invoices', (req: Request, res: Response) => {
    (async () => {
        try {
            const snap = await db.collection('invoices').get();
            const invoices = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            res.json(invoices);
        } catch (error: any) {
            logger.error(error);
        }
    })();
});

// Cancel Payment
router.post('/payment/cancel', (req: Request, res: Response) => {
    (async () => {
        const { userId, cancellationReason } = req.body;
        if (!userId || !cancellationReason || !cancellationReason.id) {
            return res.status(400).json({ error: 'Missing userId or cancellationReason.id' });
        }
        const cancelId = cancellationReason.id;
        const cancelRef = db.collection('paymentCancellations').doc(cancelId);

        try {
            const doc = await cancelRef.get();
            if (doc.exists) {
                return res.status(409).json({ error: 'Cancellation already exists' });
            }

            await cancelRef.set({
                ...cancellationReason,
                userId,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
            });

            const createdDoc = await cancelRef.get();
            res.status(201).json({ id: cancelRef.id, ...createdDoc.data() });
        } catch (error: any) {
            logger.error(error);
        }
    })();
});

// Fetch Cancellation by ID
router.get('/payment-cancellation/:id', (req: Request, res: Response) => {
    (async () => {
        const { id } = req.params;
        if (!id) return res.status(400).json({ error: 'Missing cancellation id' });

        try {
            const doc = await db.collection('paymentCancellations').doc(id).get();
            if (!doc.exists) return res.status(404).json({ error: 'Cancellation not found' });
            res.json({ id: doc.id, ...doc.data() });
        } catch (error: any) {
            logger.error(error);
        }
    })();
});

// List all Cancellations
router.get('/payment-cancellations', (req: Request, res: Response) => {
    (async () => {
        try {
            const snap = await db.collection('paymentCancellations').get();
            const cancellations = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            res.json(cancellations);
        } catch (error: any) {
            logger.error(error);
        }
    })();
});

// Confirm Payment
router.post('/payment/confirm', (req: Request, res: Response) => {
    (async () => {
        const { userId, paymentTransaction } = req.body;
        if (!userId || !paymentTransaction || !paymentTransaction.id) {
            return res.status(400).json({ error: 'Missing userId or paymentTransaction.id' });
        }

        const paymentId = paymentTransaction.id;
        const paymentRef = db.collection('payments').doc(paymentId);

        try {
            const doc = await paymentRef.get();
            if (doc.exists) {
                return res.status(409).json({ error: 'Payment already confirmed' });
            }

            await paymentRef.set({
                ...paymentTransaction,
                userId,
                status: 'confirmed',
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
            });

            const confirmedDoc = await paymentRef.get();
            res.status(201).json({ id: paymentRef.id, ...confirmedDoc.data() });
        } catch (error: any) {
            logger.error(error);
        }
    })();
});

// Fetch Payment by ID
router.get('/payment/:id', (req: Request, res: Response) => {
    (async () => {
        const { id } = req.params;
        if (!id) return res.status(400).json({ error: 'Missing payment id' });

        try {
            const doc = await db.collection('payments').doc(id).get();
            if (!doc.exists) return res.status(404).json({ error: 'Payment not found' });
            res.json({ id: doc.id, ...doc.data() });
        } catch (error: any) {
            logger.error(error);
        }
    })();
});

// List all Payments
router.get('/payments', (req: Request, res: Response) => {
    (async () => {
        try {
            const snap = await db.collection('payments').get();
            const payments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            res.json(payments);
        } catch (error: any) {
            logger.error(error);
        }
    })();
});


export default router;