import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';
import type { Msg91WidgetCallbackData } from '../types/msg91-widget';

const SCRIPT_URL = 'https://verify.msg91.com/otp-provider.js';
const CAPTCHA_ELEMENT_ID = 'msg91-phone-captcha';
// Long enough to cover an interactive captcha challenge a customer has to solve by hand before
// sendOtp proceeds; short enough that a customer is never left staring at a dead spinner. Found
// necessary in practice: MSG91's widget uses hCaptcha internally, and hCaptcha refuses to fully
// validate on "localhost" - without this, sendOtp's callbacks simply never fire and the button
// spins forever. verifyOtp gets a shorter window since no captcha is involved at that step.
const SendOtpWatchdogMs = 30_000;
const VerifyOtpWatchdogMs = 15_000;

/** MSG91's own message for a valid-but-not-yet-entered state, distinct from a wrong code. */
export class Msg91WidgetError extends Error {}

/** Loads MSG91's OTP Widget script (Custom UI / exposeMethods mode - no popup, Ojas keeps its
 * own form) and wraps its callback-style window.sendOtp/verifyOtp API in promises.
 *
 * exposeMethods requires a real DOM element for its captcha to render into
 * (id="msg91-phone-captcha") - that element must already be in the DOM the moment the script's
 * onload fires initSendOTP, which is why this is only initialised from the phone-login step of
 * the login page, after Angular has rendered that step's template, never eagerly on page load.
 *
 * The exact field name for the returned access token isn't pinned down from MSG91's docs (their
 * docs page is JS-rendered and did not yield the schema) - checked defensively across a few
 * plausible names, mirroring how the backend's Msg91WidgetVerifier treats its own response. */
@Injectable({ providedIn: 'root' })
export class Msg91WidgetService {
  private initPromise: Promise<void> | null = null;

  get captchaElementId(): string {
    return CAPTCHA_ELEMENT_ID;
  }

  private loadScript(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (document.getElementById('msg91-otp-widget-script')) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.id = 'msg91-otp-widget-script';
      script.src = SCRIPT_URL;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Msg91WidgetError('Could not load the verification widget.'));
      document.body.appendChild(script);
    });
  }

  /** Loads the script and calls initSendOTP exactly once. Safe to call on every attempt to
   * switch to phone login - subsequent calls reuse the same in-flight/completed promise. */
  initialize(): Promise<void> {
    this.initPromise ??= this.loadScript().then(
      () =>
        new Promise<void>((resolve, reject) => {
          if (!window.initSendOTP) {
            reject(new Msg91WidgetError('The verification widget did not load correctly.'));
            return;
          }
          window.initSendOTP({
            widgetId: environment.msg91WidgetId,
            tokenAuth: environment.msg91TokenAuth,
            exposeMethods: true,
            captchaRenderId: CAPTCHA_ELEMENT_ID,
            // Deliberately no-ops: MSG91's docs warn that listening here *and* on the per-call
            // callbacks below fires duplicate events. sendOtp/verifyOtp's own callbacks are used
            // instead, since they're what tell this specific call apart from a stray one.
            success: () => {},
            failure: () => {},
          });
          resolve();
        }),
    );
    return this.initPromise;
  }

  /** identifier must carry the country code with no "+" (MSG91's own requirement) - Ojas stores
   * bare 10-digit numbers, so callers pass the raw phone and this prefixes it. */
  sendOtp(phone: string): Promise<void> {
    return withWatchdog(
      new Promise((resolve, reject) => {
        if (!window.sendOtp) {
          reject(new Msg91WidgetError('The verification widget is not ready yet.'));
          return;
        }
        window.sendOtp(
          toMsg91Identifier(phone),
          () => resolve(),
          (error) => reject(new Msg91WidgetError(firstNonEmpty(error) ?? 'Could not send the code. Please try again.')),
        );
      }),
      SendOtpWatchdogMs,
      'Sending the code is taking too long. Please try again.',
    );
  }

  /** Resolves with the access token Ojas's backend verifies server-side - never trusted as proof
   * of anything on its own here, only forwarded. */
  verifyOtp(code: string): Promise<string> {
    return withWatchdog(
      new Promise<string>((resolve, reject) => {
        if (!window.verifyOtp) {
          reject(new Msg91WidgetError('The verification widget is not ready yet.'));
          return;
        }
        window.verifyOtp(
          code,
          (data) => {
            const token = data['access-token'] ?? data['accessToken'] ?? data['token'];
            if (typeof token === 'string' && token.length > 0) {
              resolve(token);
            } else {
              reject(new Msg91WidgetError('That code is invalid or has expired.'));
            }
          },
          (error) => reject(new Msg91WidgetError(firstNonEmpty(error) ?? 'That code is invalid or has expired.')),
        );
      }),
      VerifyOtpWatchdogMs,
      'Verifying the code is taking too long. Please try again.',
    );
  }
}

/** Bounds a promise that depends on a third-party callback that isn't guaranteed to ever fire -
 * without this, a stuck captcha or a dropped connection leaves the caller waiting forever with
 * no way out, the exact failure mode CashfreeCheckoutService.whenHandOffFails exists to avoid on
 * the payment page. */
function withWatchdog<T>(promise: Promise<T>, ms: number, timeoutMessage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const watchdog = setTimeout(() => reject(new Msg91WidgetError(timeoutMessage)), ms);
    promise.then(
      (value) => {
        clearTimeout(watchdog);
        resolve(value);
      },
      (error) => {
        clearTimeout(watchdog);
        reject(error);
      },
    );
  });
}

function toMsg91Identifier(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.startsWith('91') && digits.length === 12 ? digits : `91${digits.slice(-10)}`;
}

function firstNonEmpty(data: Msg91WidgetCallbackData): string | undefined {
  return typeof data.message === 'string' && data.message.length > 0 ? data.message : undefined;
}
