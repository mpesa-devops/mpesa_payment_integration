// TypeScript version of suspicious_activity.js with proper types and ES6 imports/exports

import { getFirestore } from 'firebase-admin/firestore';
const db = getFirestore();

export async function flagSuspiciousActivity({ userId, type, details, actionTaken = null }: { userId: string, type: string, details: any, actionTaken?: string | null }) {
    try {
        await db.collection('suspicious_activity').add({
            userId,
            type,
            details,
            timestamp: new Date().toISOString(),
            actionTaken
        });
    } catch (err: any) {
        console.error('Failed to log suspicious activity:', err.message);
    }
}

export async function incrementAttemptAndCheckLimit({ userId, type, maxAttempts = 5, windowMinutes = 15 }: { userId: string, type: string, maxAttempts?: number, windowMinutes?: number }) {
    const docRef = db.collection('suspicious_attempts').doc(`${userId}_${type}`);
    const now = Date.now();
    const windowMs = windowMinutes * 60 * 1000;
    const doc = await docRef.get();
    let attempts = 1;
    let firstAttempt = now;
    if (doc.exists) {
        const data = doc.data();
        attempts = (data?.attempts || 0) + 1;
        firstAttempt = data?.firstAttempt || now;
        // Reset if window expired
        if (now - firstAttempt > windowMs) {
            attempts = 1;
            firstAttempt = now;
        }
    }
    await docRef.set({ attempts, firstAttempt }, { merge: true });
    return attempts > maxAttempts;
}
