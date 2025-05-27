function getMpesaConfig() {
  const mpesaConsumerKey = process.env.MPESA_CONSUMER_KEY;
  const mpesaConsumerSecret = process.env.MPESA_CONSUMER_SECRET;
  const mpesaBasicAuth = (mpesaConsumerKey && mpesaConsumerSecret)
    ? Buffer.from(`${mpesaConsumerKey}:${mpesaConsumerSecret}`).toString('base64')
    : null;
  const ngrokUrl = process.env.NGROK_URL;
  const registeredUrl = process.env.CONFIRMATION_URL;
  return {
    BASE_URL: process.env.MPESA_BASE_URL || 'https://sandbox.safaricom.co.ke',
    CONSUMER_KEY: mpesaConsumerKey,
    CONSUMER_SECRET: mpesaConsumerSecret,
    BASIC_AUTH: mpesaBasicAuth,
    SHORTCODE: process.env.MPESA_BUSINESS_SHORTCODE || process.env.MPESA_SHORTCODE,
    PASSKEY: process.env.MPESA_PASSKEY,
    INITIATOR_NAME: process.env.MPESA_INITIATOR_NAME,
    INITIATOR_PASSWORD: process.env.MPESA_INITIATOR_PASSWORD,
    PARTY_A: process.env.MPESA_PARTY_A,
    PARTY_B: process.env.MPESA_PARTY_B || process.env.MPESA_BUSINESS_SHORTCODE,
    PHONE_NUMBER: process.env.MPESA_PHONE_NUMBER,
    CALLBACK_URL:`${ngrokUrl}/mpesa/callback`,
    SERVER_URL: ngrokUrl,
    PROCESS_REQUEST_URL: process.env.MPESA_PROCESS_REQUEST_URL,
    CONFIRMATION_URL: process.env.MPESA_CONFIRMATION_URL,
    VALIDATION_URL: process.env.MPESA_VALIDATION_URL,
    PORT: process.env.PORT || 3000,
    ENV: process.env.NODE_ENV || 'development'
  };
}

export default getMpesaConfig;
