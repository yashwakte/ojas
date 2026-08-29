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
  // Fallback only. The checkout service asks the API which mode it is in
  // (GET /api/payments/cashfree/config) and uses that, because a payment_session_id created
  // against Cashfree's sandbox base URL only opens in the SDK's sandbox mode and vice versa -
  // keeping the two in step by hand across two separately deployed apps is how every payment on
  // the site breaks for however long the deploys are apart. This value is used only if that call
  // fails, so it matches what a deployed API defaults to.
  cashfreeMode: 'production' as 'sandbox' | 'production',
  // Phone login goes through MSG91's OTP Widget (client-side send + verify) rather than the raw
  // DLT-gated SendOTP API - its default channel configuration sends through MSG91's own
  // pre-registered template, so it does not wait on this business's own DLT approval. widgetId
  // and tokenAuth are both meant to be public here (same trust level as a Cashfree App ID or
  // Turnstile site key) - the real secret is Msg91:WidgetAuthKey, which lives only on the API.
  // msg91TokenAuth is the real value (from the widget's Tokens section, named "ojasProduction").
  // phoneLoginEnabled is on for a live production test - localhost can't complete this flow at
  // all (hCaptcha, which the widget uses internally, refuses to validate on "localhost"), so this
  // has to be verified against the real deployed site. Requires Msg91:WidgetAuthKey to also be
  // set on Render, or /phone-login/verify reports unavailable regardless of this flag.
  phoneLoginEnabled: true,
  msg91WidgetId: '3668436b4156363032343133',
  msg91TokenAuth: '562938TjibpKmLOJku6a92d768P1',
};
