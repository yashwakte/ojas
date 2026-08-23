import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';
import type { CashfreeInstance } from '@cashfreepayments/cashfree-js';

/** Loads Cashfree's checkout SDK on first use (not eagerly - most visits never reach checkout)
 * and hands off to its hosted payment page. A successful checkout() call navigates the browser
 * away entirely (redirectTarget: "_self"), so callers should treat the returned promise as
 * "the SDK itself failed to open" rather than "the payment failed or succeeded" - that only ever
 * comes from the backend's webhook. */
@Injectable({ providedIn: 'root' })
export class CashfreeCheckoutService {
  private sdkPromise: Promise<CashfreeInstance> | null = null;

  private loadSdk(): Promise<CashfreeInstance> {
    this.sdkPromise ??= import('@cashfreepayments/cashfree-js').then(({ load }) =>
      load({ mode: environment.cashfreeMode }),
    );
    return this.sdkPromise;
  }

  async checkout(paymentSessionId: string): Promise<void> {
    const cashfree = await this.loadSdk();
    await cashfree.checkout({ paymentSessionId, redirectTarget: '_self' });
  }
}
