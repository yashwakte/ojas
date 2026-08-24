export const environment = {
  production: false,
  apiUrl: 'https://localhost:7126/api',
  // Cloudflare's documented dummy site key - always passes, works on any domain including
  // localhost. Paired with the dummy secret key already set in the API's local config.
  turnstileSiteKey: '1x00000000000000000000AA',
  cashfreeMode: 'sandbox' as 'sandbox' | 'production',
};
