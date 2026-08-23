/** The published package ships no types (dist/script.js and dist/script.esm.js only) - this
 * covers just the surface Ojas actually calls: load() and checkout(). */
declare module '@cashfreepayments/cashfree-js' {
  export interface CashfreeCheckoutOptions {
    paymentSessionId: string;
    redirectTarget?: '_self' | '_blank' | '_top' | HTMLElement;
  }

  export interface CashfreeInstance {
    checkout(options: CashfreeCheckoutOptions): Promise<{ error?: unknown; redirect?: boolean }>;
  }

  export function load(config: { mode: 'sandbox' | 'production' }): Promise<CashfreeInstance>;
}
