import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ReturnManagement } from './return-management';
import { ReturnRequestResponse } from '../../models/interfaces';
import { environment } from '../../../environments/environment';

/**
 * The admin queue. What matters here is that work waiting on a human is visible and that the
 * step being offered is the next one the flow actually allows — an admin handed a "Refund"
 * button on a return nobody has collected is the whole reason the pickup step exists.
 */
describe('ReturnManagement', () => {
  let http: HttpTestingController;
  const base = `${environment.apiUrl}/returns`;

  const request = (over: Partial<ReturnRequestResponse> = {}): ReturnRequestResponse => ({
    id: 'r1',
    orderId: 'order-abcdef',
    items: [
      {
        productId: 'p1',
        productName: 'Bajra Flour',
        weight: '1kg',
        price: 100,
        quantity: 2,
        refundAmount: 200,
      },
    ],
    reason: 'Damaged',
    comment: null,
    status: 'Requested',
    refundDestination: 'wallet',
    refundAmount: 200,
    refundedToWallet: 0,
    refundedToSource: 0,
    refundQueued: 0,
    events: [],
    createdAt: new Date().toISOString(),
    updatedAt: null,
    customerName: 'Asha',
    customerPhone: '9123456789',
    pickupAddress: '1 Test Street',
    ...over,
  });

  function create(queue: ReturnRequestResponse[]) {
    TestBed.configureTestingModule({
      imports: [ReturnManagement],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideNoopAnimations()],
    });
    const fixture = TestBed.createComponent(ReturnManagement);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne(`${base}/admin/all`).flush(queue);
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => http.verify());

  it('offers each return the next step its flow allows, and nothing beyond it', () => {
    const fixture = create([]);
    const pane = fixture.componentInstance;

    expect(pane.nextAction(request({ status: 'Requested' }))!.status).toBe('Approved');
    expect(pane.nextAction(request({ status: 'Approved' }))!.status).toBe('PickedUp');
    expect(pane.nextAction(request({ status: 'PickedUp' }))!.status).toBe('Refunded');
    // Nothing further happens to a settled one.
    expect(pane.nextAction(request({ status: 'Refunded' }))).toBeNull();
    expect(pane.nextAction(request({ status: 'Rejected' }))).toBeNull();
  });

  it('shows work waiting on a human by default', () => {
    const fixture = create([
      request({ id: 'a', status: 'Requested' }),
      request({ id: 'b', status: 'PickedUp' }),
      request({ id: 'c', status: 'Refunded' }),
      request({ id: 'd', status: 'Cancelled' }),
    ]);

    expect(fixture.componentInstance.visible().map((r) => r.id)).toEqual(['a', 'b']);
  });

  /** Money the business is holding that belongs to customers — the one figure worth surfacing. */
  it('totals what has been collected but not yet refunded', () => {
    const fixture = create([
      request({ id: 'a', status: 'PickedUp', refundAmount: 200 }),
      request({ id: 'b', status: 'PickedUp', refundAmount: 50 }),
      request({ id: 'c', status: 'Requested', refundAmount: 999 }),
      request({ id: 'd', status: 'Refunded', refundAmount: 999 }),
    ]);

    expect(fixture.componentInstance.awaitingRefund()).toBe(250);
  });

  it('will not refuse a return without a reason the customer can read', () => {
    const fixture = create([request()]);
    const pane = fixture.componentInstance;

    pane.startReject(pane.queue()[0]);
    pane.rejectReason.set('   ');
    pane.confirmReject(pane.queue()[0]);

    // Nothing sent: a refusal with no reason is the thing that generates the phone call.
    http.expectNone(`${base}/admin/r1/status`);
  });

  it('sends the refusal with its reason once one is given', () => {
    const fixture = create([request()]);
    const pane = fixture.componentInstance;

    pane.startReject(pane.queue()[0]);
    pane.rejectReason.set('The pack had been opened.');
    pane.confirmReject(pane.queue()[0]);

    const sent = http.expectOne(`${base}/admin/r1/status`);
    expect(sent.request.body).toEqual({ status: 'Rejected', note: 'The pack had been opened.' });
    sent.flush({
      request: request({ status: 'Rejected' }),
      walletCredited: 0,
      refundedToSource: 0,
      refundQueued: 0,
    });
  });

  it('can still refuse a return that has already been collected', () => {
    const fixture = create([]);
    const pane = fixture.componentInstance;

    // A pack can turn out to have been opened once it is back with us, which is exactly when we
    // find out — so refusing stays available until the money has actually gone.
    expect(pane.canReject(request({ status: 'PickedUp' }))).toBeTrue();
    expect(pane.canReject(request({ status: 'Refunded' }))).toBeFalse();
  });
});
