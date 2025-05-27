// CODING BOT INSTRUCTIONS:
// This file implements the in-memory pending payments hot store for MPESA backend. Do NOT change the core Map-based structure, TTL logic, or API (add/get/remove) without updating all related route handlers and documentation. This module is tightly coupled to: routes/initiate_payment.ts, routes/mpesa_callback.ts, routes/payment_status.ts, and app.ts. See those files for integration details. Do not add Firestore or external DB logic here.
// Related files: src/routes/initiate_payment.ts, src/routes/mpesa_callback.ts, src/routes/payment_status.ts, src/app.ts
// If extending to Redis, preserve the in-memory fallback and API shape.

import getMpesaConfig from './mpesa_config';
import axios from 'axios';
import { db } from './firebase';
import logger from './logger';
import { removeUndefined, sanitizePaymentForClient } from './mpesa_utils';
import { setPaymentStatusFirestore } from './payment_status_helpers';

const pendingPayments = new Map<string, any>();
const PENDING_TTL_MS = 15 * 60 * 1000;

function addPendingPayment(paymentId: string, data: any) {
    pendingPayments.set(paymentId, { ...data, createdAt: Date.now() });
    setTimeout(() => pendingPayments.delete(paymentId), PENDING_TTL_MS);
}

function getPendingPayment(paymentId: string) {
    const entry = pendingPayments.get(paymentId);
    if (entry && Date.now() - entry.createdAt < PENDING_TTL_MS) return entry;
    pendingPayments.delete(paymentId);
    return null;
}

function removePendingPayment(paymentId: string) {
    pendingPayments.delete(paymentId);
}

function updatePendingPayment(paymentId: string, data: any) {
    if (pendingPayments.has(paymentId)) {
        pendingPayments.set(paymentId, { ...pendingPayments.get(paymentId), ...data });
    }
}

setInterval(() => {
    const now = Date.now();
    for (const [paymentId, entry] of pendingPayments.entries()) {
        if (now - entry.createdAt > PENDING_TTL_MS) {
            pendingPayments.delete(paymentId);
        }
    }
}, 5 * 60 * 1000);

// --- MPESA TRANSACTION STATUS QUERY AND FIRESTORE UPDATE ---

// Replace with your actual credentials/config or use env vars
const MPESA_API_URL = 'https://sandbox.safaricom.co.ke/mpesa/transactionstatus/v1/query';
const INITIATOR = process.env.MPESA_INITIATOR || 'testapiuser';
const SECURITY_CREDENTIAL = process.env.MPESA_SECURITY_CREDENTIAL || '';
const PARTY_A = process.env.MPESA_PARTY_A || '600782';
const IDENTIFIER_TYPE = '4';
const REMARKS = 'OK';
const OCCASION = 'OK';
const RESULT_URL = process.env.MPESA_RESULT_URL || 'http://myservice:8080/transactionstatus/result';
const TIMEOUT_URL = process.env.MPESA_TIMEOUT_URL || 'http://myservice:8080/timeout';

export async function queryMpesaTransactionStatus({
  transactionId,
  originatorConversationId
}: {
  transactionId: string;
  originatorConversationId: string;
}) {
  try {
    const payload = {
      Initiator: INITIATOR,
      SecurityCredential: SECURITY_CREDENTIAL,
      CommandID: 'TransactionStatusQuery',
      TransactionID: transactionId,
      OriginatorConversationID: originatorConversationId,
      PartyA: PARTY_A,
      IdentifierType: IDENTIFIER_TYPE,
      ResultURL: RESULT_URL,
      QueueTimeOutURL: TIMEOUT_URL,
      Remarks: REMARKS,
      Occasion: OCCASION,
    };
    const { data } = await axios.post(MPESA_API_URL, payload, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.MPESA_ACCESS_TOKEN}`,
      },
    });
    logger.info('Mpesa Transaction Status API response', data);
    return data;
  } catch (err) {
    logger.error('Error querying Mpesa Transaction Status', err);
    throw err;
  }
}

export async function saveMpesaTransactionStatusToFirestore({
  checkoutRequestId,
  statusResult
}: {
  checkoutRequestId: string;
  statusResult: any;
}) {
  try {
    // Parse the result
    const result = statusResult?.Result;
    if (!result) throw new Error('No Result in status response');
    const resultParams = Array.isArray(result.ResultParameters?.ResultParameter)
      ? result.ResultParameters.ResultParameter
      : [];
    const getParam = (key: string) => {
      const found = resultParams.find((p: any) => p.Key === key);
      return found ? found.Value : undefined;
    };
    const status = getParam('TransactionStatus') || 'unknown';
    const amount = getParam('Amount');
    const mpesaReceiptNumber = getParam('ReceiptNo');
    const phoneNumber = getParam('DebitPartyName');
    const resultCode = result.ResultCode;
    const resultDesc = result.ResultDesc;
    const userId = undefined; // Not available from status API
    const paymentId = checkoutRequestId;
    const completedAt = getParam('FinalisedTime');

    // Prepare update
    const internalUpdate = removeUndefined({
      mpesaCallback: result,
      status,
      completedAt,
      mpesaReceiptNumber,
      amount,
      phoneNumber,
      resultCode,
      resultDesc,
      userId
    });
    const clientUpdate = sanitizePaymentForClient({
      paymentId,
      userId,
      status,
      completedAt,
      mpesaReceiptNumber,
      amount,
      phoneNumber,
      resultCode,
      resultDesc
    });
    // Write to Firestore
    const batch = db.batch();
    batch.set(db.collection('paymentTransactions').doc(checkoutRequestId), internalUpdate, { merge: true });
    batch.set(db.collection('payments').doc(paymentId), clientUpdate, { merge: true });
    await batch.commit();
    logger.info(`Payment transaction status updated for paymentId: ${paymentId}`);
    // Optionally update payment status collection
    await setPaymentStatusFirestore(checkoutRequestId, {
      status,
      resultCode,
      resultDesc,
      amount,
      mpesaReceiptNumber,
      phoneNumber,
      userId,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('Error saving Mpesa transaction status to Firestore', err);
    throw err;
  }
}

export { addPendingPayment, getPendingPayment, removePendingPayment, updatePendingPayment, pendingPayments };
