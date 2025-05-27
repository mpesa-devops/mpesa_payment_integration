import * as express from 'express';
import type { Request, Response, Router } from 'express';
import logger from '../include/logger';
import getMpesaConfig from '../include/mpesa_config';
import { getValidAccessToken } from '../services/token.service';

const router = express.Router();

// GET /token - Returns the current M-Pesa access token and expiry
router.get('/token', async (req: Request, res: Response) => {
    logger.info('GET /token called');
    try {
        const MPESA_CONFIG = getMpesaConfig();
        // logger.info('Loaded MPESA_CONFIG', MPESA_CONFIG);
        const mpesaConfigForToken = {
            BASE_URL: MPESA_CONFIG.BASE_URL,
            BASIC_AUTH: MPESA_CONFIG.BASIC_AUTH as string
        };
        // logger.info('mpesaConfigForToken', mpesaConfigForToken);
        const tokenResult = await getValidAccessToken({ mpesaConfig: mpesaConfigForToken, logger });
        logger.info('Token result', tokenResult);
        res.json({
            accessToken: tokenResult.accessToken,
            expiresAt: tokenResult.expiresAt,
            expiresInSeconds: tokenResult.expiresAt ? Math.floor((tokenResult.expiresAt - Date.now()) / 1000) : null,
            source: tokenResult.source
        });
    } catch (error: any) {
        logger.error('GET /token - Error:', error.message, error);
        res.status(500).json({ error: 'Failed to get access token', message: error.message });
    }
});

export default router;
