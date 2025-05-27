import * as admin from 'firebase-admin';
import getMpesaConfig from './mpesa_config';

export async function ensureRootAdminProfile() {
    const db = admin.firestore();
    const rootAdminRef = db.collection('admin_profiles').doc('root_admin');
    const doc = await rootAdminRef.get();
    if (!doc.exists) {
        await rootAdminRef.set({
            email: 'gachuinyambura@gmail.com',
            phone: '+254705173604',
            role: 'root',
            createdAt: new Date().toISOString()
        });
        console.log('Root admin profile created.');
    } else {
        console.log('Root admin profile already exists.');
    }
}

export async function logRevenue({ amount, userId, paymentId, method = 'mpesa' }: { amount: number, userId: string, paymentId: string, method?: string }) {
    const db = admin.firestore();
    const today = new Date().toISOString().slice(0, 10);
    await db.collection('revenue_stats').doc(today).set({
        total: admin.firestore.FieldValue.increment(amount),
        transactions: admin.firestore.FieldValue.increment(1),
        lastPaymentId: paymentId,
        lastUserId: userId,
        updatedAt: new Date().toISOString(),
        method
    }, { merge: true });
}

export async function logPaymentFailure({ userId, reason, details }: { userId: string, reason: string, details: any }) {
    const db = admin.firestore();
    await db.collection('payment_failures').add({
        userId,
        reason,
        details,
        timestamp: new Date().toISOString()
    });
}

export async function logPaymentEvent({ event, userId, amount, paymentId, details }: { event: string, userId: string, amount: number, paymentId: string, details: any }) {
    const db = admin.firestore();
    await db.collection('payment_analytics').add({
        event,
        userId,
        amount,
        paymentId,
        details,
        timestamp: new Date().toISOString()
    });
}

// CODING BOT INSTRUCTIONS:
// This file now includes a minimal in-memory batching queue for payment event logs. Do NOT block the main flow. If you change the batching logic, update all routes using logPaymentEventSafe. Related files: routes/initiate_payment.ts, mpesa_callback.ts, payment_status.ts, admin.ts.

const eventQueue: any[] = [];
const BATCH_SIZE = 10;
const FLUSH_INTERVAL_MS = 5000;

// Utility: Remove undefined fields from event before enqueueing
function cleanEventForFirestore(event: any) {
    const cleaned: Record<string, any> = {};
    for (const key in event) {
        if (key === 'amount') {
            cleaned.amount = (event.amount !== undefined ? event.amount : null);
            
        } else if (event[key] !== undefined) {
            cleaned[key] = event[key];
        }
    }
    return cleaned;
}

export async function enqueuePaymentEvent(event: any) {
    eventQueue.push(cleanEventForFirestore(event));
}

async function flushEventQueue() {
    if (eventQueue.length === 0) return;
    const batch = eventQueue.splice(0, BATCH_SIZE);
    try {
        for (const evt of batch) {
            // Only pass allowed fields to logPaymentEvent
            const { event, userId, amount, paymentId, details } = evt;
            await analytics.logPaymentEvent({ event, userId, amount, paymentId, details });
        }
        if (process.env.NODE_ENV !== 'production') {
            console.log(`[EventBatch] Flushed ${batch.length} payment events.`);
        }
    } catch (err) {
        eventQueue.unshift(...batch);
        console.warn('[EventBatch] Failed to flush events, will retry.', err);
    }
}
setInterval(flushEventQueue, FLUSH_INTERVAL_MS);

const analytics = {
    ensureRootAdminProfile,
    logRevenue,
    logPaymentFailure,
    logPaymentEvent
};
export default analytics;
