// CODING BOT INSTRUCTIONS:
// This is the main entry point for the MPESA backend. It wires up the in-memory 
// pending payments store (see include/pending_payments.ts) and all payment-related routes. 
// Do NOT bypass or duplicate pending payments logic. 
// Related files: 
// include/pending_payments.ts, routes/initiate_payment.ts, 
// routes/mpesa_callback.ts, routes/payment_status.ts.

import * as dotenv from 'dotenv';
dotenv.config();
// console.log('DEBUG ENV:', {
//   MPESA_CONSUMER_KEY: process.env.MPESA_CONSUMER_KEY,
//   MPESA_CONSUMER_SECRET: process.env.MPESA_CONSUMER_SECRET,
//   ENV_PATH: process.env.PWD || process.cwd()
// }); 
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import token from './routes/token';
import initiatePaymentRoutes from './routes/initiate_payment';
import mpesaCallbackRoutes from './routes/mpesa_callback';
import queryTransactionRoutes from './routes/query_transaction';
import paymentsConfirmationRoutes from './routes/payments_confirmation';
import paymentStatusRoutes from './routes/payment_status';
import analytics from './include/payment_analytics';
import firestoreRoutes from './include/firestore_routes';
import { getPublicIp, registerMpesaConfirmationUrl } from './include/mpesa_utils';
import { tokenStorage, getValidAccessToken, fetchNewToken, isTokenExpired, getAccessTokenFromFirestore } from './services/token.service';
import logger from './include/logger';
import getMpesaConfig from './include/mpesa_config';
import { checkIfBlocked } from './include/middleware';
import adminRoutes from './routes/admin';
import type { Request, Response, NextFunction } from 'express';
// import morgan from 'morgan';

// --- Express App Setup ---
const app = express();
app.set('trust proxy', 1);
app.use(helmet());
// app.use(morgan('combined')); // or 'dev' for shorter logs

app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));


app.use(cors({
    origin: async (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
        // Allow localhost, server URL, ngrok, or undefined (like curl/postman)
        // how to securely allow unknown but expected clients like random phone app user? 
        const publicIp = await getPublicIp();
        if (!publicIp) {
            logger.warn('Could not determine public IP, skipping registration');

        }
        // const publicIpUrl = `https://${publicIp}`;
        const publicIpUrl = process.env.PUBLIC_URL || `http://${publicIp}`;
        const allowed = [
            `${publicIpUrl}:3000`,
            `${publicIpUrl}:3005`,
            "https://zalendoai.loca.lt//",
            "http://localhost:3000",
            "http://localhost:3005",
            "http://192.168.100.100",
            "http://192.168.100.100:3005",
            "http://192.168.100.4", 
            "http://192.168.100.4:3005", 
            "http://192.168.100.4:3000",
            getMpesaConfig().SERVER_URL,
            process.env.NGROK_URL,
        ].filter(Boolean);
        if (!origin || allowed.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error("Not allowed by CORS"));
        }
    },
    optionsSuccessStatus: 200,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
}));
// --- Middleware ---
app.use(express.json({ limit: '1mb' }));
app.use(checkIfBlocked);
// --- Essential Config Checks ---
if (!getMpesaConfig().CONSUMER_KEY || !getMpesaConfig().CONSUMER_SECRET || !getMpesaConfig().BASIC_AUTH) {
    logger.error(getMpesaConfig());
    logger.error("FATAL ERROR: M-Pesa Consumer Key or Secret is missing. Check your .env file and ensure dotenv is configured correctly.");
    process.exit(1);
}
if (!getMpesaConfig().SHORTCODE || !getMpesaConfig().PASSKEY) {
    logger.warn("WARNING: M-Pesa Shortcode or Passkey might be missing from .env. STK Push will likely fail.");
}
if (!getMpesaConfig().CALLBACK_URL) {
    logger.warn("WARNING: M-Pesa Callback URL is missing. You won't receive payment status updates from Safaricom.");
}



// --- Register Routers ---
app.use(token);
app.use(initiatePaymentRoutes);
app.use(mpesaCallbackRoutes);
app.use(queryTransactionRoutes);
app.use(paymentsConfirmationRoutes);
app.use(paymentStatusRoutes);
app.use(firestoreRoutes);
app.use('/admin', adminRoutes);
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', uptime: process.uptime(), timestamp: Date.now() });
});
// --- Error Handlers ---

app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    logger.error('------------------------------------');
    logger.error('Unhandled Server Error:', err.stack || err);
    logger.error((req as any).params);
    logger.error('------------------------------------');
    res.status(500).json({
        error: 'Internal server error',
        message: err.message,
        url: req.url,
        query: (req as any).query,
        params: (req as any).params,
        headers: req.headers,
    });
});

app.use((req, res) => {
    res.status(404).json({ message: 'Not found' });
});
// --- Start Server ---
const port = Number(getMpesaConfig().PORT);
console.log(`Starting M-Pesa server on port ${port}...`);

//
const server = app.listen(port, '0.0.0.0', async () => {
    logServerStatus();
    if (process.env.NODE_ENV !== 'production') {
        // the code below was originally here but the check limited 
        // the server to only run in production.
    }
    if (!getMpesaConfig().BASIC_AUTH) {
        logger.error('FATAL ERROR: MPESA_CONFIG.BASIC_AUTH is missing.');
        process.exit(1);
    }
    const mpesaConfigForToken = {
        BASE_URL: getMpesaConfig().BASE_URL,
        BASIC_AUTH: getMpesaConfig().BASIC_AUTH as string
    };
    await fetchNewToken({ mpesaConfig: mpesaConfigForToken, logger });
    const firestoreToken = await getAccessTokenFromFirestore();
    await registerMpesaConfirmationUrl(
        async () => fetchNewToken({ mpesaConfig: mpesaConfigForToken, logger }),
        isTokenExpired
    );
    analytics.ensureRootAdminProfile();
});
// --- Graceful Shutdown ---
process.on('SIGTERM', () => {
    logger.info('SIGTERM signal received: closing HTTP server');
    server.close(() => {
        logger.info('HTTP server closed');
        process.exit(0);
    });
});

function logServerStatus() {
    logger.info(`M-Pesa server running at http://0.0.0.0:${port}`);
    logger.info(`Local access: http://localhost:${port}`);
    logger.info('Make sure your .env file is loaded correctly.');
    logger.info('Essential M-Pesa Config Loaded:');
    logger.info(`  - Consumer Key: ${getMpesaConfig().CONSUMER_KEY ? 'OK' : 'MISSING!'}`);
    logger.info(`  - Consumer Secret: ${getMpesaConfig().CONSUMER_SECRET ? 'OK' : 'MISSING!'}`);
    logger.info(`  - Basic Auth: ${getMpesaConfig().BASIC_AUTH ? 'OK' : 'MISSING!'}`);
    logger.info(`  - Shortcode: ${getMpesaConfig().SHORTCODE ? 'OK' : 'MISSING!'}`);
    logger.info(`  - Passkey: ${getMpesaConfig().PASSKEY ? 'OK' : 'MISSING!'}`);
    logger.info(`  - Callback URL: ${getMpesaConfig().CALLBACK_URL ? getMpesaConfig().CALLBACK_URL : 'MISSING!'}`);
    logger.info('Available endpoints:');
    logger.info(`- GET /token`);
    logger.info(`- GET /health`);
    logger.info(`- POST /initiate-payment { paymentId, amount, phoneNumber, invoiceId }`);
    logger.info(`- POST /mpesa/callback (Called by Safaricom)`);
    logger.info(`- GET /payment-status?paymentId=<paymentId> OR /payment-status?checkoutRequestId=<checkoutRequestId>`);
}

// Only export what is needed for tests or other modules
export { tokenStorage, getValidAccessToken, fetchNewToken, isTokenExpired };
export { logger, getMpesaConfig };

