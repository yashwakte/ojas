import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { MyOrders } from './my-orders';
import { UserService } from '../../services/user.service';
import { OrderResponse } from '../../models/interfaces';

describe('MyOrders', () => {
  let userServiceSpy: jasmine.SpyObj<UserService>;

  const order: OrderResponse = {
    id: 'o1',
    fullName: 'Jane',
    phone: '9999999999',
    address: 'Somewhere',
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

  beforeEach(() => {
    userServiceSpy = jasmine.createSpyObj('UserService', ['getMyOrders']);
    TestBed.configureTestingModule({
      imports: [MyOrders],
      providers: [provideRouter([]), { provide: UserService, useValue: userServiceSpy }],
    });
  });

  function create() {
    const fixture = TestBed.createComponent(MyOrders);
    fixture.detectChanges();
    return fixture;
  }

  it('loads orders on init and stops loading', () => {
    userServiceSpy.getMyOrders.and.returnValue(of([order]));
    const fixture = create();
    expect(fixture.componentInstance.orders()).toEqual([order]);
    expect(fixture.componentInstance.loading()).toBeFalse();
    expect(fixture.componentInstance.error()).toBe('');
  });

  it('sets an error message when loading fails', () => {
    userServiceSpy.getMyOrders.and.returnValue(throwError(() => new Error('fail')));
    const fixture = create();
    expect(fixture.componentInstance.error()).toBe('Failed to load orders.');
    expect(fixture.componentInstance.loading()).toBeFalse();
  });

  it('getStatusClass maps known statuses to CSS classes', () => {
    userServiceSpy.getMyOrders.and.returnValue(of([]));
    const fixture = create();
    const c = fixture.componentInstance;
    expect(c.getStatusClass('Confirmed')).toBe('status-confirmed');
    expect(c.getStatusClass('packed')).toBe('status-packed');
    expect(c.getStatusClass('DELIVERED')).toBe('status-delivered');
    expect(c.getStatusClass('Shipped')).toBe('status-shipped');
    expect(c.getStatusClass('Cancelled')).toBe('status-cancelled');
    expect(c.getStatusClass('Pending')).toBe('status-pending');
    expect(c.getStatusClass('SomethingElse')).toBe('status-pending');
  });
});
