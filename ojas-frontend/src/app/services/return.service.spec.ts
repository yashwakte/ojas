import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { ReturnService } from './return.service';
import { ReturnRequestResponse } from '../models/interfaces';
import { environment } from '../../environments/environment';

describe('ReturnService', () => {
  let service: ReturnService;
  let http: HttpTestingController;
  const base = `${environment.apiUrl}/returns`;

  const request = (over: Partial<ReturnRequestResponse> = {}): ReturnRequestResponse => ({
    id: 'r1',
    orderId: 'o1',
    items: [
      {
        productId: 'p1',
        productName: 'Bajra Flour',
        weight: '1kg',
        price: 100,
        quantity: 1,
        refundAmount: 100,
      },
    ],
    reason: 'Damaged',
    comment: null,
    status: 'Requested',
    refundDestination: 'wallet',
    refundAmount: 100,
    refundedToWallet: 0,
    refundedToSource: 0,
    refundQueued: 0,
    events: [],
    createdAt: new Date().toISOString(),
    updatedAt: null,
    ...over,
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), ReturnService],
    });
    service = TestBed.inject(ReturnService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('adds a newly raised return to the customer list without a re-fetch', () => {
    service.create({
      orderId: 'o1',
      items: [{ productId: 'p1', quantity: 1 }],
      reason: 'Damaged',
      comment: null,
      refundDestination: 'wallet',
    }).subscribe();

    http.expectOne(`${base}/my`).flush(request());

    expect(service.mine().length).toBe(1);
  });

  /**
   * The rule that exists because patching one field onto a stale copy is what once left cancelled
   * orders still offering to take a payment. Settling a return moves the refund splits, the queued
   * balance and the timeline at once.
   */
  it('swaps in the whole updated request rather than patching a status', () => {
    service.loadQueue();
    http.expectOne(`${base}/admin/all`).flush([request()]);

    service.updateStatus('r1', { status: 'Refunded' }).subscribe();
    http.expectOne(`${base}/admin/r1/status`).flush({
      request: request({
        status: 'Refunded',
        refundedToWallet: 100,
        events: [{ status: 'Refunded', note: null, by: 'admin', at: new Date().toISOString() }],
      }),
      walletCredited: 100,
      refundedToSource: 0,
      refundQueued: 0,
    });

    const [updated] = service.queue();
    expect(updated.status).toBe('Refunded');
    expect(updated.refundedToWallet).toBe(100);
    expect(updated.events.length).toBe(1);
  });

  it('counts everything still waiting on a human, and nothing that is finished', () => {
    service.loadQueue();
    http.expectOne(`${base}/admin/all`).flush([
      request({ id: 'a', status: 'Requested' }),
      request({ id: 'b', status: 'Approved' }),
      request({ id: 'c', status: 'PickedUp' }),
      request({ id: 'd', status: 'Refunded' }),
      request({ id: 'e', status: 'Rejected' }),
      request({ id: 'f', status: 'Cancelled' }),
    ]);

    expect(service.openQueueCount()).toBe(3);
  });

  it('leaves the orders page usable when the returns list fails to load', () => {
    service.loadMine();
    http.expectOne(`${base}/my`).flush('nope', { status: 500, statusText: 'Server Error' });

    expect(service.mine()).toEqual([]);
    expect(service.loading()).toBeFalse();
  });
});
