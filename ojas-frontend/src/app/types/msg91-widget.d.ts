/** MSG91's OTP Widget loads as a plain script (otp-provider.js) and exposes everything on
 * `window` - there is no npm package or bundled types. Covers only the surface Ojas actually
 * calls (Custom UI / exposeMethods mode).
 *
 * Field names on the success/failure payloads aren't pinned down from MSG91's docs (JS-rendered,
 * didn't yield the schema) - Msg91WidgetService checks a few plausible ones defensively, matching
 * how the backend's Msg91WidgetVerifier treats its own response. */
export interface Msg91WidgetCallbackData {
  message?: string;
  type?: string;
  'access-token'?: string;
  accessToken?: string;
  token?: string;
  [key: string]: unknown;
}

export interface Msg91WidgetConfiguration {
  widgetId: string;
  tokenAuth: string;
  identifier?: string;
  exposeMethods: boolean;
  captchaRenderId?: string;
  success: (data: Msg91WidgetCallbackData) => void;
  failure: (error: Msg91WidgetCallbackData) => void;
}

declare global {
  interface Window {
    initSendOTP?: (configuration: Msg91WidgetConfiguration) => void;
    sendOtp?: (
      identifier: string,
      success?: (data: Msg91WidgetCallbackData) => void,
      failure?: (error: Msg91WidgetCallbackData) => void,
    ) => void;
    verifyOtp?: (
      otp: string,
      success?: (data: Msg91WidgetCallbackData) => void,
      failure?: (error: Msg91WidgetCallbackData) => void,
      reqId?: string,
    ) => void;
    retryOtp?: (
      channel: string | null,
      success?: (data: Msg91WidgetCallbackData) => void,
      failure?: (error: Msg91WidgetCallbackData) => void,
      reqId?: string,
    ) => void;
  }
}

export {};
