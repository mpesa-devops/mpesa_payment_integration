import axios from 'axios';
import { db } from '../include/firebase';
import winston from 'winston';

/**
 * Token storage interface for in-memory cache
 */
export interface TokenStorage {
  accessToken: string | null;
  expiresAt: number | null;
}

/**
 * Token service options
 */
export interface TokenServiceOptions {
  mpesaConfig: {
    BASE_URL: string;
    BASIC_AUTH: string;
  };
  logger: winston.Logger;
}

/**
 * In-memory token cache
 */
export const tokenStorage: TokenStorage = { accessToken: null, expiresAt: null };

/**
 * Checks if the in-memory token is expired
 */
export function isTokenExpired(): boolean {
  return !tokenStorage.accessToken || !tokenStorage.expiresAt || Date.now() >= tokenStorage.expiresAt;
}

/**
 * Fetches a new token from Safaricom and updates in-memory and Firestore
 */
export async function fetchNewToken(options: TokenServiceOptions): Promise<string> {
  const { mpesaConfig, logger } = options;
  try {
    logger.info('Fetching new M-Pesa access token...');
    const authHeader = `Basic ${mpesaConfig.BASIC_AUTH}`;
    const response = await axios.get(`${mpesaConfig.BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, { headers: { 'Authorization': authHeader } });
    const data = response.data as { access_token: string; expires_in: number };
    if (data.access_token) {
      logger.info('Successfully fetched new M-Pesa token.');
      tokenStorage.accessToken = data.access_token;
      tokenStorage.expiresAt = Date.now() + (data.expires_in * 1000);
      await saveAccessTokenToFirestore(tokenStorage.accessToken, tokenStorage.expiresAt);
      logger.info('Access token saved to Firestore.');
      return tokenStorage.accessToken;
    } else {
      throw new Error('Invalid token response from M-Pesa');
    }
  } catch (error: any) {
    logger.error(`Failed to fetch M-Pesa token: ${error.message}`);
    throw new Error(`Failed to fetch M-Pesa token: ${error.message}`);
  }
}

/**
 * Saves the access token to Firestore
 */
export async function saveAccessTokenToFirestore(token: string, expiresAt: number | null) {
  await db.collection('mpesa_tokens').doc('current').set({
    accessToken: token,
    expiresAt,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Gets the access token from Firestore
 */
export async function getAccessTokenFromFirestore(): Promise<{ accessToken: string; expiresAt: number } | null> {
  const doc = await db.collection('mpesa_tokens').doc('current').get();
  if (doc.exists && doc.data()?.accessToken) {
    return {
      accessToken: doc.data()!.accessToken as string,
      expiresAt: doc.data()!.expiresAt as number,
    };
  }
  return null;
}

/**
 * Gets a valid access token, checking memory, then Firestore, then Safaricom
 */
export async function getValidAccessToken(options: TokenServiceOptions): Promise<{ accessToken: string; expiresAt: number; source: string }> {
  const { logger } = options;
  // 1. In-memory
  if (tokenStorage.accessToken && tokenStorage.expiresAt && Date.now() < tokenStorage.expiresAt) {
    logger.info('Returning in-memory access token');
    return { accessToken: tokenStorage.accessToken, expiresAt: tokenStorage.expiresAt, source: 'memory' };
  }
  // 2. Firestore
  const firestoreToken = await getAccessTokenFromFirestore();
  if (firestoreToken && firestoreToken.accessToken && firestoreToken.expiresAt && Date.now() < firestoreToken.expiresAt) {
    tokenStorage.accessToken = firestoreToken.accessToken;
    tokenStorage.expiresAt = firestoreToken.expiresAt;
    logger.info('Returning Firestore access token');
    return { accessToken: firestoreToken.accessToken, expiresAt: firestoreToken.expiresAt, source: 'firestore' };
  }
  // 3. Safaricom
  const newToken = await fetchNewToken(options);
  logger.info('Returning new Safaricom access token');
  return { accessToken: newToken, expiresAt: tokenStorage.expiresAt!, source: 'safaricom' };
}
