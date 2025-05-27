import { getFirestore, FieldValue } from 'firebase-admin/firestore';
const db = getFirestore();

// In-memory cache helpers (for hot reads)
const paymentStatusCache = new Map<string, { data: any, timestamp: number }>();
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

export function getCachedPaymentStatus(checkoutRequestId: string) {
    const entry = paymentStatusCache.get(checkoutRequestId);
    if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
        return entry.data;
    }
    return null;
}

export function setCachedPaymentStatus(checkoutRequestId: string, data: any) {
    paymentStatusCache.set(checkoutRequestId, { data, timestamp: Date.now() });
}

// Utility to remove undefined values from an object
function removeUndefined(obj: any) {
    if (!obj || typeof obj !== 'object') return obj;
    return Object.fromEntries(Object.entries(obj).filter(([_, v]) => v !== undefined));
}

// Save payment status using checkoutRequestId as doc ID
export async function setPaymentStatusFirestore(checkoutRequestId: string, statusData: any) {
    if (!checkoutRequestId || !statusData) return;
    try {
        const paymentRef = db.collection('paymentStatus').doc(checkoutRequestId);

        // Try cache first to avoid unnecessary DB reads
        const cached = getCachedPaymentStatus(checkoutRequestId);
        if (cached && cached.status === statusData.status) {
            // Already up-to-date, skip Firestore write
            return;
        }

        // Only fetch from Firestore if cache miss or status differs
        const doc = await paymentRef.get();
        if (doc.exists && doc.data()?.status === statusData.status) {
            setCachedPaymentStatus(checkoutRequestId, { ...doc.data(), _docId: doc.id });
            return;
        }

        // Always include userId if present in statusData
        const sanitizedData = removeUndefined({
            ...statusData,
            userId: statusData.userId,
            updatedAt: FieldValue.serverTimestamp(),
        });

        await paymentRef.set(
            sanitizedData,
            { merge: true }
        );

        // Update cache after write
        setCachedPaymentStatus(checkoutRequestId, { ...removeUndefined(statusData), userId: statusData.userId, updatedAt: new Date().toISOString(), _docId: checkoutRequestId });
    } catch (err: any) {
        console.error('Failed to write payment status to Firestore:', err.message);
    }
}

// Get payment status by checkoutRequestId
export async function getPaymentStatusFirestore(checkoutRequestId: string) {
    if (!checkoutRequestId) return null;

    // Try cache first
    const cached = getCachedPaymentStatus(checkoutRequestId);
    if (cached) return cached;

    try {
        const doc = await db.collection('paymentStatus').doc(checkoutRequestId).get();
        if (doc.exists) {
            const data = { ...doc.data(), _docId: doc.id };
            setCachedPaymentStatus(checkoutRequestId, data);
            return data;
        }
    } catch (err: any) {
        console.error('Failed to read payment status from Firestore:', err.message);
    }
    return null;
}

export async function updatePaymentStatus(paymentId: string, updateData: any) {
    if (!paymentId || !updateData) return;
    try {
        const paymentRef = db.collection('paymentStatus').doc(paymentId);
        const doc = await paymentRef.get();
        if (doc.exists) {
            const existingData = doc.data();
            const mergedData = { ...existingData, ...updateData };
            await paymentRef.set(mergedData, { merge: true });
        } else {
            await paymentRef.set(updateData);
        }
    } catch (error) {
        console.error('Error updating payment status:', error);
    }
}
