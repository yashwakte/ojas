import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { DeliveryOrders } from './delivery-orders';
import { OrderService } from '../../services/order.service';
import { OrderResponse } from '../../models/interfaces';

describe('DeliveryOrders', () => {
  const order: OrderResponse = {
    id: 'o1',
    fullName: 'Jane',
    phone: '9999999999',
    address: 'Somewhere, City',
    latitude: 18.5,
    longitude: 73.8,
    notes: '',
    items: [],
    deliveryCharge: 0,
    deliveryDistanceKm: 0,
    totalAmount: 100,
    status: 'Confirmed',
    createdAt: '2024-01-01',
  };
  const deliveredOrder: OrderResponse = { ...order, id: 'o2', status: 'Delivered' };

  let orderServiceSpy: jasmine.SpyObj<OrderService>;

  beforeEach(() => {
    orderServiceSpy = jasmine.createSpyObj('OrderService', ['getDeliveryOrders', 'markDelivered']);
    TestBed.configureTestingModule({
      imports: [DeliveryOrders],
      providers: [{ provide: OrderService, useValue: orderServiceSpy }],
    });
  });

  function create() {
    const fixture = TestBed.createComponent(DeliveryOrders);
    fixture.detectChanges();
    return fixture;
  }

  it('loads assigned orders on init', () => {
    orderServiceSpy.getDeliveryOrders.and.returnValue(of([order, deliveredOrder]));
    const fixture = create();
    expect(fixture.componentInstance.orders()).toEqual([order, deliveredOrder]);
    expect(fixture.componentInstance.loading()).toBeFalse();
  });

  it('sets an error when loading fails', () => {
    orderServiceSpy.getDeliveryOrders.and.returnValue(throwError(() => new Error('fail')));
    const fixture = create();
    expect(fixture.componentInstance.error()).toBe('Unable to load assigned orders.');
    expect(fixture.componentInstance.loading()).toBeFalse();
  });

  it('openDeliveries counts orders that are not yet delivered', () => {
    orderServiceSpy.getDeliveryOrders.and.returnValue(of([order, deliveredOrder]));
    const fixture = create();
    expect(fixture.componentInstance.openDeliveries()).toBe(1);
  });

  it('markDelivered updates the order status to Delivered on success', () => {
    orderServiceSpy.getDeliveryOrders.and.returnValue(of([order]));
    orderServiceSpy.markDelivered.and.returnValue(of(undefined));
    const fixture = create();

    fixture.componentInstance.markDelivered('o1');

    expect(orderServiceSpy.markDelivered).toHaveBeenCalledWith('o1');
    expect(fixture.componentInstance.orders()[0].status).toBe('Delivered');
    expect(fixture.componentInstance.busyOrderId()).toBeNull();
  });

  it('markDelivered sets an error on failure', () => {
    orderServiceSpy.getDeliveryOrders.and.returnValue(of([order]));
    orderServiceSpy.markDelivered.and.returnValue(throwError(() => new Error('fail')));
    const fixture = create();

    fixture.componentInstance.markDelivered('o1');

    expect(fixture.componentInstance.error()).toBe('Could not mark order as delivered.');
    expect(fixture.componentInstance.busyOrderId()).toBeNull();
  });

  it('statusClass maps known statuses to CSS classes', () => {
    orderServiceSpy.getDeliveryOrders.and.returnValue(of([]));
    const fixture = create();
    const c = fixture.componentInstance;
    expect(c.statusClass('Confirmed')).toBe('status-confirmed');
    expect(c.statusClass('Packed')).toBe('status-packed');
    expect(c.statusClass('Shipped')).toBe('status-shipped');
    expect(c.statusClass('Delivered')).toBe('status-delivered');
    expect(c.statusClass('Pending')).toBe('status-pending');
  });

  it('mapUrl prefers a provided addressMapLink over a generated Google Maps search URL', () => {
    orderServiceSpy.getDeliveryOrders.and.returnValue(of([]));
    const fixture = create();
    expect(fixture.componentInstance.mapUrl('123 St', 'https://maps.example.com/x')).toBe(
      'https://maps.example.com/x',
    );
    expect(fixture.componentInstance.mapUrl('123 St', null)).toBe(
      'https://www.google.com/maps/search/?api=1&query=123%20St',
    );
    expect(fixture.componentInstance.mapUrl('123 St')).toBe(
      'https://www.google.com/maps/search/?api=1&query=123%20St',
    );
  });
});
