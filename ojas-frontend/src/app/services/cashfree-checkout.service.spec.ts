import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { CashfreeCheckoutService } from './cashfree-checkout.service';
import { environment } from '../../environments/environment';

describe('CashfreeCheckoutService', () => {
  let service: CashfreeCheckoutService;
  let httpMock: HttpTestingController;

  const configUrl = `${environment.apiUrl}/payments/cashfree/config`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(CashfreeCheckoutService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  // The whole point of asking the server: a payment session raised against production only opens
  // in the SDK's production mode. If this fell back to the bundled value while the API had moved
  // on, every payment on the site would fail until the frontend was redeployed to match.
  it('takes the gateway mode from the API, not from the bundled environment', async () => {
    const mode = service.gatewayMode();

    httpMock.expectOne(configUrl).flush({ mode: 'production', configured: true });

    expect(await mode).toBe('production');
    expect(environment.cashfreeMode).toBe('sandbox'); // ...which is what it would have used.
  });

  it('asks only once, however many payments are started', async () => {
    const first = service.gatewayMode();
    const second = service.gatewayMode();

    httpMock.expectOne(configUrl).flush({ mode: 'production', configured: true });

    expect(await first).toBe('production');
    expect(await second).toBe('production');
    httpMock.expectNone(configUrl);
  });

  // A customer who already holds a payment session should not be stopped from paying because a
  // config lookup failed - the session came from this same API, so the built-in value is right
  // far more often than not.
  it('falls back to the bundled mode when the API cannot be reached', async () => {
    const mode = service.gatewayMode();

    httpMock.expectOne(configUrl).error(new ProgressEvent('network error'));

    expect(await mode).toBe(environment.cashfreeMode);
  });

  it('ignores a mode it does not recognise', async () => {
    const mode = service.gatewayMode();

    httpMock.expectOne(configUrl).flush({ mode: 'staging', configured: true });

    expect(await mode).toBe(environment.cashfreeMode);
  });

  /**
   * The bug these cover: `cashfree.checkout()` does not hang until the browser navigates away.
   * With `redirectTarget: "_self"` it resolves — with `{ redirect: true }` — as soon as the
   * redirect is under way. Callers treated any settlement as a failure, so "We couldn't open the
   * payment page, so nothing was charged" was painted over a page that was in the middle of
   * opening it, and it won the race against a navigation only just asked for.
   *
   * These drive the service against a stubbed SDK that behaves the way the real one documents,
   * which is the only way this is catchable: the old test doubles were written to match the
   * belief that the promise never settles, so they could never have disagreed with it.
   */
  describe('handing off to the payment page', () => {
    /** Stands in for the loaded SDK, so the service's own handling of the result is what runs. */
    function stubSdk(result: unknown): jasmine.Spy {
      const checkout = jasmine.createSpy('checkout').and.returnValue(Promise.resolve(result));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any).sdkPromise = Promise.resolve({ checkout });
      return checkout;
    }

    /** Resolves to true if the promise settled within a few microtask turns. */
    async function settled(promise: Promise<void>): Promise<boolean> {
      let done = false;
      void promise.then(() => (done = true));
      for (let i = 0; i < 5; i++) await Promise.resolve();
      return done;
    }

    it('does not report a failure when the redirect is under way', async () => {
      const checkout = stubSdk({ redirect: true });

      const failure = service.whenHandOffFails('session_abc');

      expect(await settled(failure)).toBeFalse();
      expect(checkout).toHaveBeenCalledWith({
        paymentSessionId: 'session_abc',
        redirectTarget: '_self',
      });
    });

    it('reports a failure when the SDK hands back an error', async () => {
      stubSdk({ error: { message: 'no such session' } });

      expect(await settled(service.whenHandOffFails('session_abc'))).toBeTrue();
    });

    it('reports a failure when the SDK rejects outright', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any).sdkPromise = Promise.reject(new Error('script blocked'));

      expect(await settled(service.whenHandOffFails('session_abc'))).toBeTrue();
    });
  });
});
