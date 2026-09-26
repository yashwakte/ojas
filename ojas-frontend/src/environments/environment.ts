export const environment = {
  production: false,
  apiUrl: 'https://localhost:7126/api',
  // Cloudflare's documented dummy site key - always passes, works on any domain including
  // localhost. Paired with the dummy secret key already set in the API's local config.
  turnstileSiteKey: '1x00000000000000000000AA',
  cashfreeMode: 'sandbox' as 'sandbox' | 'production',
  // Public by design - see the note in environment.prod.ts. Secret scanners flag the tokenAuth
  // as a high-entropy string; it is not a secret and moving it out of source would not make it
  // any less readable, since it is shipped to every browser that opens the register page.
  msg91WidgetId: '3668436b4156363032343133',
  msg91TokenAuth: '562938TjibpKmLOJku6a92d768P1',
  // MSG91's widget cannot send from localhost - its hCaptcha refuses to validate there - so on a
  // developer's machine no text is sent and this code always works. The API accepts the token it
  // produces only when running in Development; see Msg91WidgetVerifier.
  msg91DevBypassCode: '1234' as string | null,
};
