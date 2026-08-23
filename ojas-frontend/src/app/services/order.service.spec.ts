import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { OrderService } from './order.service';
import { environment } from '../../environments/environment';
import { OrderResponse, StaffUserResponse, PlaceOrderRequest } from '../models/interfaces';

describe('OrderService', () => {
  let service: OrderService;
  let httpMock: HttpTestingController;

  const order: OrderResponse = {
    id: 'o1',
    fullName: 'Jane',
    phone: '9999999999',
    address: 'Somewhere',
    latitude: 18.5,
    longitude: 73.8,
    notes: '',
    items: [],
    subtotal: 0,
    discountPercentage: 0,
    discountAmount: 0,
    deliveryCharge: 0,
    deliveryDistanceKm: 0,
    totalAmount: 100,
    status: 'Pending',
    paymentMethod: 'COD',
    paymentStatus: 'Pending',
    amountPaid: 0,
    walletAmountApplied: 0,
    createdAt: '2024-01-01',
  };

  const partner: StaffUserResponse = {
    id: 'd1',
    fullName: 'Delivery Dan',
    email: 'd@x.com',
    phone: '9999999999',
    role: 'delivery',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(OrderService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('does not fire any HTTP request on construction', () => {
    httpMock.verify();
    expect(service.orders()).toEqual([]);
    expect(service.loading()).toBeFalse();
  });

  it('loadAll() fetches orders and delivery partners, populating both signals', () => {
    service.loadAll();
    expect(service.loading()).toBeTrue();

    httpMock.expectOne(`${environment.apiUrl}/orders/admin/all`).flush([order]);
    httpMock.expectOne(`${environment.apiUrl}/orders/admin/delivery-partners`).flush([partner]);

    expect(service.orders()).toEqual([order]);
    expect(service.deliveryPartners()).toEqual([partner]);
    expect(service.loading()).toBeFalse();
  });

  it('loadAll() sets an error when the orders request fails', () => {
    service.loadAll();
    httpMock.expectOne(`${environment.apiUrl}/orders/admin/all`).flush('x', { status: 500, statusText: 'err' });
    httpMock.expectOne(`${environment.apiUrl}/orders/admin/delivery-partners`).flush([]);
    expect(service.error()).toBe('Failed to load orders');
    expect(service.loading()).toBeFalse();
  });

  it('loadAll() silently ignores a failed delivery-partners request', () => {
    service.loadAll();
    httpMock.expectOne(`${environment.apiUrl}/orders/admin/all`).flush([order]);
    httpMock
      .expectOne(`${environment.apiUrl}/orders/admin/delivery-partners`)
      .flush('x', { status: 500, statusText: 'err' });
    expect(service.deliveryPartners()).toEqual([]);
    expect(service.error()).toBeNull();
  });

  it('placeOrder() posts to /orders', () => {
    const request: PlaceOrderRequest = {
      fullName: 'Jane',
      phone: '9999999999',
      address: 'Somewhere',
      latitude: 18.5,
      longitude: 73.8,
      notes: '',
      items: [],
    };
    service.placeOrder(request).subscribe((res) => expect(res).toEqual(order));
    const req = httpMock.expectOne(`${environment.apiUrl}/orders`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(request);
    req.flush(order);
  });

  it('getAdminOrders() gets /orders/admin/all', () => {
    service.getAdminOrders().subscribe((res) => expect(res).toEqual([order]));
    httpMock.expectOne(`${environment.apiUrl}/orders/admin/all`).flush([order]);
  });

  it('getDeliveryOrders() gets /orders/delivery/my', () => {
    service.getDeliveryOrders().subscribe((res) => expect(res).toEqual([order]));
    httpMock.expectOne(`${environment.apiUrl}/orders/delivery/my`).flush([order]);
  });

  it('getDeliveryPartners() gets /orders/admin/delivery-partners', () => {
    service.getDeliveryPartners().subscribe((res) => expect(res).toEqual([partner]));
    httpMock.expectOne(`${environment.apiUrl}/orders/admin/delivery-partners`).flush([partner]);
  });

  it('updateOrderStatusAsAdmin() patches /orders/admin/:id/status', () => {
    service.updateOrderStatusAsAdmin('o1', { status: 'Packed' }).subscribe();
    const req = httpMock.expectOne(`${environment.apiUrl}/orders/admin/o1/status`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ status: 'Packed' });
    req.flush(null);
  });

  it('assignDeliveryPartner() patches /orders/admin/:id/assign', () => {
    service.assignDeliveryPartner('o1', { deliveryPartnerId: 'd1' }).subscribe();
    const req = httpMock.expectOne(`${environment.apiUrl}/orders/admin/o1/assign`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ deliveryPartnerId: 'd1' });
    req.flush(null);
  });

  it('markDelivered() patches /orders/delivery/:id/delivered', () => {
    service.markDelivered('o1').subscribe();
    const req = httpMock.expectOne(`${environment.apiUrl}/orders/delivery/o1/delivered`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({});
    req.flush(null);
  });

  it('markPaymentCollected() patches /orders/delivery/:id/payment-collected', () => {
    service.markPaymentCollected('o1').subscribe();
    const req = httpMock.expectOne(`${environment.apiUrl}/orders/delivery/o1/payment-collected`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({});
    req.flush(null);
  });
});
