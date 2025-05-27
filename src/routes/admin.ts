// CODING BOT INSTRUCTIONS:
// This route exposes minimal admin endpoints for MPESA backend observability. Do NOT expose sensitive data. Show only aggregate stats and a sample of pending payments. Related files: include/pending_payments.ts, payment_analytics.ts, app.ts.

import * as express from 'express';
import { pendingPayments } from '../include/pending_payments';
import analytics from '../include/payment_analytics';

const router = express.Router();

// GET /admin/pending-payments - summary dashboard
router.get('/pending-payments', (req, res) => {
    const all = Array.from(pendingPayments.entries());
    const count = all.length;
    const sample = all.slice(0, 10).map(([paymentId, data]) => ({ paymentId, userId: data.userId, createdAt: data.createdAt, amount: data.amount, status: data.status }));
    res.json({
        count,
        sample,
        ttlMinutes: 15,
        message: count > 10 ? 'Showing first 10 pending payments.' : undefined
    });
});

// GET /admin/payment-analytics - real stats
router.get('/payment-analytics', async (req, res) => {
    try {
        // Count payment events in the last 24 hours
        const db = require('../include/firebase').db;
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const snap = await db.collection('payment_analytics')
            .where('timestamp', '>=', since.toISOString())
            .get();
        const count = snap.size;
        // Optionally, aggregate by event type
        const eventTypeCounts: Record<string, number> = {};
        snap.forEach((doc: FirebaseFirestore.QueryDocumentSnapshot) => {
            const event = doc.data().event;
            if (event) eventTypeCounts[event] = (eventTypeCounts[event] || 0) + 1;
        });
        res.json({
            count,
            eventTypeCounts,
            since: since.toISOString(),
            message: `Counted ${count} payment events in the last 24h.`
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch analytics', details: String(err) });
    }
});

export default router;
