import type { Request, Response, NextFunction } from 'express';
import { db } from './firebase';
import logger from './logger';

export function checkIfBlocked(req: Request, res: Response, next: NextFunction) {
    // Safely access req.body (may be undefined for GET requests)
    const body = req.body || {};
    const userId = body.userId || req.query.userId || res.locals.userId;
    if (!userId) return next();
    db.collection('blocked_users').doc(userId).get()
        .then(doc => {
            if (doc.exists) {
                logger.warn(`User ${userId} is blocked due to suspicious activity`);
                return res.status(403).json({ error: 'User is blocked due to suspicious activity' });
            }
            next();
        })
        .catch(() => {
            logger.error(`User check failed for userId: ${userId}`);
            console.error(`User check failed for userId: ${userId}`);
            return res.status(403).json({ error: 'User check failed' });
        });
}
