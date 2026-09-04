import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import type { CashfreeInstance } from '@cashfreepayments/cashfree-js';

/** What the API says about the gateway it is talking to. */
interface CashfreeConfig {
  mode: 'sandbox' | 'production';
  configured: boolean;
}

/** How long to wait for the browser to actually leave for the payment page before concluding it
 * is not going to. Only ever decides when to stop waiting; nothing is charged either way.
 *
 * It only ever runs while this page is still on screen — the moment the browser starts leaving,
 * the wait is abandoned rather than timed out (see whenHandOffFails). That is what lets it be
 * generous: on a cheap phone on mobile data, fetching the config, code-splitting the SDK chunk and
 * pulling Cashfree's own script can genuinely take longer than a dozen seconds, and cutting it off
 * at that point put "We couldn't open the payment page" on screen moments before the payment page
 * opened perfectly well. */
const HandOffWatchdogMs = 20_000;

/** Survives the round trip to Cashfree's page and back, including a Back press that rebuilds the
 * app from scratch. Session-scoped: it is meaningless in a new tab or a later visit. */
const AwaitingPaymentKey = 'ojas.awaitingPayment';

/** Loads Cashfree's checkout SDK on first use (not eagerly - most visits never reach checkout)
 * and hands off to its hosted payment page. Whether a payment succeeded or failed never comes
 * from here - that only ever comes from the backend, via the webhook or a status check.
 *
 * The sandbox/production mode is asked of the API rather than compiled in. A payment session
 * raised against one environment will not open in the other, and while the mode lived in the
 * frontend bundle *and* in the API's configuration, going live meant changing both in lockstep
 * across two separately deployed things - with every payment on the site broken in between. The
 * server owns the answer; the bundled value is only the fallback for when it can't be reached. */
@Injectable({ providedIn: 'root' })
export class CashfreeCheckoutService {
  private readonly http = inject(HttpClient);
  private sdkPromise: Promise<CashfreeInstance> | null = null;
  private modePromise: Promise<'sandbox' | 'production'> | null = null;

  /** Which Cashfree environment the API is talking to. Asked once and remembered - the answer
   * cannot change without the API being redeployed. Falls back to the value built into the
   * bundle if the call fails, rather than blocking a payment on a config lookup. */
  gatewayMode(): Promise<'sandbox' | 'production'> {
    this.modePromise ??= firstValueFrom(
      this.http.get<CashfreeConfig>(`${environment.apiUrl}/payments/cashfree/config`),
    )
      .then((config) =>
        config?.mode === 'production' || config?.mode === 'sandbox'
          ? config.mode
          : environment.cashfreeMode,
      )
      // The payment session the caller already holds came from this same API, so it was raised
      // in whatever mode the API is in; the build-time value is the best remaining guess.
      .catch(() => environment.cashfreeMode);
    return this.modePromise;
  }

  private loadSdk(): Promise<CashfreeInstance> {
    this.sdkPromise ??= (async () => {
      const [{ load }, mode] = await Promise.all([
        import('@cashfreepayments/cashfree-js'),
        this.gatewayMode(),
      ]);
      return load({ mode });
    })().catch((error) => {
      // Don't cache a failed load - a customer who retries after a dropped connection should get
      // a fresh attempt rather than the same rejection for the rest of the session.
      this.sdkPromise = null;
      throw error;
    });
    return this.sdkPromise;
  }

  /**
   * Hands off to Cashfree's hosted payment page, and resolves **only if that did not take** —
   * that is, only when the customer is still sitting on our page and needs telling.
   *
   * The shape matters, because getting it wrong is what put "We couldn't open the payment page"
   * on screen before the payment page had even opened. `cashfree.checkout()` does **not** hang
   * until the browser navigates away: with `redirectTarget: "_self"` it *resolves*, with
   * `{ redirect: true }`, as soon as the redirect is under way. Callers were treating any
   * settlement — resolution included — as a failure, so the error was shown every time the
   * handoff worked, and it won the race against a navigation that had only just been asked for.
   *
   * So: a resolved checkout carrying no `error` means the browser is on its way to Cashfree, and
   * this promise deliberately never settles. A rejection, or a resolved `{ error }`, is a real
   * failure and settles at once. The watchdog is the backstop for the case neither happens and
   * the navigation silently doesn't occur, so a customer is never left under a spinner forever.
   *
   * The remaining trap, and the reason for the listeners below: the watchdog outlives the handoff.
   * Once the browser leaves for Cashfree this page is not destroyed, it is frozen — and pressing
   * Back restores it from the back/forward cache with its timers intact. The pending countdown
   * then resumes and fires, so a customer who reached the payment page, looked at it, and decided
   * to come back was met with "We couldn't open the payment page" about a page they had just been
   * standing on. The same thing happened to anyone whose SDK load simply ran long: the error
   * appeared and the redirect followed it a moment later.
   *
   * So the wait is *abandoned*, not failed, the instant the browser starts leaving. `pagehide` is
   * the precise signal for that and fires whether the document is discarded or frozen;
   * `visibilitychange` backs it up on the in-app browsers where `pagehide` is unreliable. The
   * watchdog therefore only ever fires on a page that has demonstrably stayed put — which is
   * exactly the case it was written for and the only one it can be right about.
   */
  whenHandOffFails(paymentSessionId: string): Promise<void> {
    return new Promise<void>((resolve) => {
      let settled = false;

      const stopWaiting = () => {
        settled = true;
        clearTimeout(watchdog);
        window.removeEventListener('pagehide', abandon);
        document.removeEventListener('visibilitychange', abandonIfHidden);
      };

      /** The browser is leaving (or freezing) this page, so the handoff took. Never report a
       * failure from here — not now, and not when the page comes back from the cache. */
      const abandon = () => {
        if (!settled) stopWaiting();
      };

      const abandonIfHidden = () => {
        if (document.visibilityState === 'hidden') abandon();
      };

      const failed = () => {
        if (settled) return;
        stopWaiting();
        resolve();
      };

      const watchdog = setTimeout(failed, HandOffWatchdogMs);
      window.addEventListener('pagehide', abandon);
      document.addEventListener('visibilitychange', abandonIfHidden);

      this.loadSdk()
        .then((cashfree) => cashfree.checkout({ paymentSessionId, redirectTarget: '_self' }))
        .then((result) => {
          // Only an actual error means the handoff did not take. Anything else means the browser
          // is leaving, and we must not paint an error over a page that is about to go.
          if (result?.error) failed();
        }, failed);
    });
  }

  /**
   * Remembers that we sent the customer off to pay for a particular order.
   *
   * The browser leaves this app entirely for Cashfree's page, and there are two ways back: the
   * customer pays and Cashfree redirects to My Orders, or they change their mind and press Back,
   * which lands them on the checkout page they left. Checkout has no way to tell that second case
   * from a fresh visit on its own, so it used to greet them with "We couldn't open the payment
   * page" — about a page that had opened perfectly well, for an order that already exists.
   *
   * Session storage rather than a field, because pressing Back can rebuild the whole app.
   */
  markAwaitingPayment(orderId: string): void {
    try {
      sessionStorage.setItem(AwaitingPaymentKey, orderId);
    } catch {
      // Private browsing, or storage disabled. Losing the marker only costs the redirect below;
      // it must never stop a payment being started.
    }
  }

  /** The order we last sent someone off to pay for, if they are back without having finished. */
  awaitingPayment(): string | null {
    try {
      return sessionStorage.getItem(AwaitingPaymentKey);
    } catch {
      return null;
    }
  }

  clearAwaitingPayment(): void {
    try {
      sessionStorage.removeItem(AwaitingPaymentKey);
    } catch {
      // Nothing to do - an unreadable store is an absent marker.
    }
  }
}
