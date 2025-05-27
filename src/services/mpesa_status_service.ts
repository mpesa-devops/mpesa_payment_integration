import axios from 'axios';
import { db } from '../include/firebase';
import logger from '../include/logger';
import { removeUndefined, sanitizePaymentForClient } from '../include/mpesa_utils';
import { setPaymentStatusFirestore } from '../include/payment_status_helpers';

const MPESA_API_URL = process.env.MPESA_TRANSACTION_STATUS_URL || 'https://sandbox.safaricom.co.ke/mpesa/transactionstatus/v1/query';
const INITIATOR = process.env.MPESA_INITIATOR || 'testapiuser';
const SECURITY_CREDENTIAL = process.env.MPESA_SECURITY_CREDENTIAL || '';
const PARTY_A = process.env.MPESA_PARTY_A || '600782';
const IDENTIFIER_TYPE = process.env.MPESA_IDENTIFIER_TYPE || '4';
const REMARKS = process.env.MPESA_REMARKS || 'OK';
const OCCASION = process.env.MPESA_OCCASION || 'OK';
const RESULT_URL = process.env.MPESA_RESULT_URL || 'http://myservice:8080/transactionstatus/result';
const TIMEOUT_URL = process.env.MPESA_TIMEOUT_URL || 'http://myservice:8080/timeout';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

export async function queryMpesaTransactionStatus({
  transactionId,
  originatorConversationId,
  accessToken
}: {
  transactionId: string;
  originatorConversationId: string;
  accessToken: string;
}): Promise<any> {
  let attempt = 0;
  while (attempt < MAX_RETRIES) {
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
          Authorization: `Bearer ${accessToken}`,
        },
        timeout: 10000,
      });
      logger.info('Mpesa Transaction Status API response', data);
      return data;
    } catch (err) {
      attempt++;
      logger.error(`Error querying Mpesa Transaction Status (attempt ${attempt})`, err);
      if (attempt >= MAX_RETRIES) throw err;
      await new Promise(res => setTimeout(res, RETRY_DELAY_MS * attempt));
    }
  }
}

export async function saveMpesaTransactionStatusToFirestore({
  checkoutRequestId,
  statusResult,
  confirmationReceived = false
}: {
  checkoutRequestId: string;
  statusResult: any;
  confirmationReceived?: boolean;
}) {
  logger.info(`Saving M-Pesa transaction status for checkoutRequestId: ${checkoutRequestId}`);
  try {
    // Find the paymentId using the checkoutRequestId field
    const txQuery = await db.collection('paymentTransactions')
      .where('checkoutRequestId', '==', checkoutRequestId)
      .limit(1).get();
    if (txQuery.empty) {
      logger.error(`No paymentTransaction found for CheckoutRequestID: ${checkoutRequestId}`);
      throw new Error('Transaction not found');
    }
    const txDoc = txQuery.docs[0];
    const paymentId = txDoc.id;
    const txData = txDoc.data();

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
    const userId = txData.userId || undefined;
    const completedAt = getParam('FinalisedTime');

    const internalUpdate = removeUndefined({
      ...txData,
      mpesaCallback: result,
      status,
      completedAt,
      mpesaReceiptNumber,
      amount,
      phoneNumber,
      resultCode,
      resultDesc,
      userId,
      confirmationReceived
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
    const batch = db.batch();
    batch.set(db.collection('paymentTransactions').doc(paymentId), internalUpdate, { merge: true });
    batch.set(db.collection('payments').doc(paymentId), clientUpdate, { merge: true });
    await batch.commit();
    logger.info(`Payment transaction status updated for paymentId: ${paymentId}`);
    await setPaymentStatusFirestore(paymentId, {
      status,
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

export async function processPendingMpesaTransactions() {
    // logger.info('Processing pending M-Pesa transactions...');
  // Find all pending transactions in Firestore older than 30 seconds and not confirmed by callback
  const cutoff = Date.now() - 16 * 1000; // 30 seconds
  const snapshot = await db.collection('paymentTransactions')
    .where('status', '==', 'pending')
    .where('createdAt', '<', new Date(cutoff).toISOString())
    .where('confirmationReceived', '!=', true)
    .get();
  for (const doc of snapshot.docs) {
    const tx = doc.data();
    try {
      const accessToken = process.env.MPESA_ACCESS_TOKEN || '';
      const statusResult = await queryMpesaTransactionStatus({
        transactionId: doc.id,
        originatorConversationId: tx.apiResponse?.OriginatorConversationID || doc.id,
        accessToken
      });
      logger.error(`Processing pending transaction ${doc.id}`, statusResult);

      await saveMpesaTransactionStatusToFirestore({
        checkoutRequestId: doc.id,
        statusResult,
        confirmationReceived: false
      });
      logger.info(`Processed pending transaction ${doc.id} successfully`);
    } catch (err) {
      logger.error(`Failed to process pending transaction ${doc.id}`, err);
    }
  }
}
