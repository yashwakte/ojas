export const environment = {
  production: true,
  // Same-origin, proxied to the Render API by the rewrite in vercel.json.
  // A cookie set for a cross-site API domain is a third-party cookie, which
  // Incognito/private browsing (and, increasingly, regular browsing) blocks
  // outright — the auth cookie would get silently dropped and every request
  // right after login would look signed-out. Routing through our own origin
  // makes it a first-party cookie instead, so this isn't just a workaround
  // for a niche browser mode; it's what makes cookie auth actually reliable.
  apiUrl: '/api',
  // Real site key from the Cloudflare Turnstile dashboard - replace before going live. The
  // matching secret key lives in the API's config (Turnstile:SecretKey), never here.
  turnstileSiteKey: '0x4AAAAAAET1pPvaGYSRgVPd',
  // Must match the API's Cashfree:Environment (Render env var) - a payment_session_id created
  // against Cashfree's sandbox base URL only opens in the SDK's sandbox mode, and vice versa.
  // Flip this to 'production' only in the same change that flips Cashfree:Environment and swaps
  // in the live Client ID/Secret on Render - not before.
  cashfreeMode: 'sandbox' as 'sandbox' | 'production',
};
