import type { Request, Response, NextFunction } from 'express';
import logger from '../include/logger';
import { db } from '../include/firebase';
import * as express from 'express';

const router = express.Router();

// GET /query-transaction?checkoutRequestId=...
router.get('/query-transaction', (req: Request, res: Response, next: NextFunction) => {
    (async (req: Request, res: Response, next: NextFunction) => {
        logger.info('Received query transaction request', { query: req.query });
        try {
            const { checkoutRequestId, paymentId } = req.query;
            const invalidPaymentId = (!paymentId || typeof paymentId !== 'string');
            const invalidCheckoutRequestId = (!checkoutRequestId || typeof checkoutRequestId !== 'string');
            if (invalidPaymentId && invalidCheckoutRequestId) {
                logger.error('Missing or invalidPaymentId || invalidCheckoutRequestId in query, ', invalidPaymentId, invalidCheckoutRequestId);
                logger.error("", req.query);
                return res.status(400).json({ error: 'Missing or invalid paymentId' });
            }

            // 
            const doc = await db.collection('payments').doc(paymentId as string).get();
            if (!doc.exists) {
                logger.info(`Transaction not found: ${checkoutRequestId}`, paymentId);
                return res.status(404).json({ error: 'Transaction not found' });
            }
            const docData = doc.data();
            logger.info('\nQuerying transaction', { paymentId, checkoutRequestId, ...docData });

            //
            const transaction = {
                checkoutRequestId: docData?.checkoutRequestId,
                statusData: { paymentId, checkoutRequestId, ...docData }
            };

            logger.info(`Transaction found: ${paymentId}`);
            return res.json({ transaction });
        } catch (err) {
            logger.error('Error querying transaction', err);
            next(err);
        }
    })(req, res, next);
});

export default router;
