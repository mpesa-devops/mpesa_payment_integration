import { v4 as uuidv4 } from 'uuid';
import { db } from './firebase'; // Make sure you export db from your firebase.ts
import winston from 'winston';
import getMpesaConfig from './mpesa_config';
import { getValidAccessToken } from '../services/token.service';
import axios from 'axios';

// --- Winston Logger Setup ---
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
            return `${timestamp} [${level.toUpperCase()}] ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
        })
    ),
    transports: [
        new winston.transports.Console(),
        // Optionally add file logging:
        // new winston.transports.File({ filename: 'logs/mpesa-utils.log' })
    ]
});

function isUrlAllowed(url: string): boolean {
    if (!url) return false;
    const forbidden = [
        'mpesa', 'm-pesa', 'safaricom', 'exe', 'exec', 'cmd', 'sql', 'query',
        'mockbin', 'requestbin', 'ngrok'
    ];
    const lower = url.toLowerCase();
    return !forbidden.some(word => lower.includes(word));
}

export async function getPublicIp(): Promise<string | null> {
    try {
        const res = await axios.get('https://api.ipify.org?format=json');
        return (res.data as { ip: string }).ip;
    } catch (err: any) {
        logger.error('Failed to fetch public IP:', err.message);
        return null;
    }
}

function getTimestamp(): string {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    return (
        now.getFullYear().toString() +
        pad(now.getMonth() + 1) +
        pad(now.getDate()) +
        pad(now.getHours()) +
        pad(now.getMinutes()) +
        pad(now.getSeconds())
    );
}

function getPassword(shortcode: string, passkey: string, timestamp: string): string {
    return Buffer.from(shortcode + passkey + timestamp).toString('base64');
}

export async function registerMpesaConfirmationUrl(
    fetchNewToken?: () => Promise<string>,
    isTokenExpired?: () => boolean
): Promise<void> {
    const MPESA_CONFIG = getMpesaConfig();
    logger.info("registerMpesaConfirmationUrl()::........");
    if (!MPESA_CONFIG.SHORTCODE) {
        logger.warn('Cannot register confirmation URL: SHORTCODE missing');
        return;
    }
    // Use public IP for confirmation and validation URLs to avoid forbidden keywords (per M-Pesa API requirements)
    const publicIp = await getPublicIp();
    if (!publicIp) {
        logger.warn('Could not determine public IP, skipping registration');
        return;
    }
    const confirmationUrl = `https://jp-auckland-kenneth-hypothesis.trycloudflare.com/payments/confirmation`;
    const validationUrl = `https://${publicIp}:3000/payments/validation`;
    logger.info('Using public IP for confirmation and validation URLs:', { confirmationUrl, validationUrl });
    if (!isUrlAllowed(confirmationUrl) || !isUrlAllowed(validationUrl)) {
        logger.warn('Confirmation or Validation URL contains forbidden keywords. Registration skipped.');
        return;
    }
    // Register confirmation and validation URLs with Safaricom (per M-Pesa API docs)
    try {
        const { accessToken } = await getValidAccessToken({
            mpesaConfig: {
                BASE_URL: MPESA_CONFIG.BASE_URL,
                BASIC_AUTH: MPESA_CONFIG.BASIC_AUTH as string
            },
            logger
        });
        const url = `${MPESA_CONFIG.BASE_URL}/mpesa/c2b/v1/registerurl`;
        const payload = {
            ShortCode: MPESA_CONFIG.SHORTCODE,
            ResponseType: 'Completed',
            ConfirmationURL: confirmationUrl,
            ValidationURL: validationUrl
        };
        const response = await axios.post(url, payload, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });
        logger.info('Safaricom C2B registerurl response:', response.data);
    } catch (err: any) {
        logger.error('Failed to register confirmation/validation URLs with Safaricom:', err.message, err.response?.data);
    }
}
type InitiateMpesaPaymentParams = {
    userId: string;
    invoiceId: string;
    paymentId: string;
    phoneNumber: string;
    amount: number;
};

export async function initiateMpesaPayment(params: InitiateMpesaPaymentParams): Promise<any> {
    const { userId, invoiceId, paymentId, phoneNumber, amount } = params;
    const MPESA_CONFIG = getMpesaConfig();

    // Validate required config
    if (!MPESA_CONFIG.SHORTCODE || !MPESA_CONFIG.PASSKEY || !MPESA_CONFIG.CALLBACK_URL) {
        throw new Error('M-Pesa config missing required fields (SHORTCODE, PASSKEY, CALLBACK_URL)');
    }
    if (!userId || !invoiceId || !paymentId || !phoneNumber || !amount) {
        throw new Error('Missing required payment fields');
    }

    // Generate timestamp and password as per Safaricom docs
    const timestamp = getTimestamp();
    const password = getPassword(MPESA_CONFIG.SHORTCODE, MPESA_CONFIG.PASSKEY, timestamp);

    // --- Fetch access token from memory or Firestore ---
    const { accessToken } = await getValidAccessToken({
        mpesaConfig: {
            BASE_URL: MPESA_CONFIG.BASE_URL,
            BASIC_AUTH: MPESA_CONFIG.BASIC_AUTH as string
        },
        logger
    });

    // Prepare STK Push payload
    const payload = {
        BusinessShortCode: MPESA_CONFIG.SHORTCODE,
        Password: password,
        Timestamp: timestamp,
        TransactionType: "CustomerPayBillOnline",
        Amount: amount,
        PartyA: phoneNumber,
        PartyB: MPESA_CONFIG.SHORTCODE,
        PhoneNumber: phoneNumber,
        CallBackURL: MPESA_CONFIG.CALLBACK_URL,
        AccountReference: "CBC_CHATBOT_TUTOR_APP",
        TransactionDesc: "Tokens chatting with Homework ChatBot"
    };

    try {
        // Call Safaricom STK Push API
        const response = await axios.post(
            `${MPESA_CONFIG.BASE_URL}/mpesa/stkpush/v1/processrequest`,
            payload,
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        // Save payment request to Firestore
        const paymentDoc: Record<string, any> = {
            userId,
            invoiceId,
            paymentId,
            phoneNumber,
            amount,
            status: 'initiated',
            timestamp: new Date().toISOString(),
            stkRequest: response.data || null
        };

        // Remove undefined fields before saving
        Object.keys(paymentDoc).forEach(
            key => paymentDoc[key] === undefined && delete paymentDoc[key]
        );

        // await db.collection('payments').doc(paymentId).set(paymentDoc, { merge: true });
        await db.collection('paymentStatus').doc(paymentId).set(paymentDoc, { merge: true });

        return paymentDoc;
    } catch (error: any) {
        logger.error('Failed to initiate payment:', error.message, error.response?.data);
        throw new Error(`Failed to initiate payment: ${error.message}`);
    }
}

export function removeUndefined(obj: any) {
    if (!obj || typeof obj !== 'object') return obj;
    return Object.fromEntries(Object.entries(obj).filter(([_, v]) => v !== undefined));
}

export function sanitizePaymentForClient(payment: any) {
    // Only include fields that are safe and relevant for the client
    return {
        paymentId: payment.paymentId,
        userId: payment.userId,
        status: payment.status,
        completedAt: payment.completedAt,
        mpesaReceiptNumber: payment.mpesaReceiptNumber,
        amount: payment.amount,
        phoneNumber: payment.phoneNumber,
        resultCode: payment.resultCode,
        resultDesc: payment.resultDesc
    };
}