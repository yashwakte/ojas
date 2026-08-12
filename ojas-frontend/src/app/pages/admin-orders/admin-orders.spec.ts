import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { AdminOrders } from './admin-orders';
import { OrderService } from '../../services/order.service';
import { AuthService } from '../../services/auth.service';
import { OrderResponse, StaffUserResponse } from '../../models/interfaces';

describe('AdminOrders', () => {
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
    status: 'Pending',
    createdAt: '2024-01-01',
  };
  const order2: OrderResponse = { ...order, id: 'o2', status: 'Confirmed', deliveryPartnerId: 'd1' };

  const partner: StaffUserResponse = {
    id: 'd1',
    fullName: 'Delivery Dan',
    email: 'd@x.com',
    phone: '9999999999',
    role: 'delivery',
  };

  let orderServiceSpy: jasmine.SpyObj<OrderService>;
  let authServiceSpy: jasmine.SpyObj<AuthService>;

  beforeEach(() => {
    orderServiceSpy = jasmine.createSpyObj('OrderService', [
      'getAdminOrders',
      'getDeliveryPartners',
      'updateOrderStatusAsAdmin',
      'assignDeliveryPartner',
    ]);
    authServiceSpy = jasmine.createSpyObj('AuthService', ['createStaff']);

    TestBed.configureTestingModule({
      imports: [AdminOrders],
      providers: [
        { provide: OrderService, useValue: orderServiceSpy },
        { provide: AuthService, useValue: authServiceSpy },
      ],
    });
  });

  function create() {
    orderServiceSpy.getAdminOrders.and.returnValue(of([order, order2]));
    orderServiceSpy.getDeliveryPartners.and.returnValue(of([partner]));
    const fixture = TestBed.createComponent(AdminOrders);
    fixture.detectChanges();
    return fixture;
  }

  it('loads orders and delivery partners on init', () => {
    const fixture = create();
    expect(fixture.componentInstance.orders()).toEqual([order, order2]);
    expect(fixture.componentInstance.deliveryPartners()).toEqual([partner]);
    expect(fixture.componentInstance.loading()).toBeFalse();
  });

  it('sets an error when loading orders fails', () => {
    orderServiceSpy.getAdminOrders.and.returnValue(throwError(() => new Error('fail')));
    orderServiceSpy.getDeliveryPartners.and.returnValue(of([]));
    const fixture = TestBed.createComponent(AdminOrders);
    fixture.detectChanges();
    expect(fixture.componentInstance.error()).toBe('Failed to load admin dashboard.');
    expect(fixture.componentInstance.loading()).toBeFalse();
  });

  it('sets a partial error when orders load but partners fail', () => {
    orderServiceSpy.getAdminOrders.and.returnValue(of([order]));
    orderServiceSpy.getDeliveryPartners.and.returnValue(throwError(() => new Error('fail')));
    const fixture = TestBed.createComponent(AdminOrders);
    fixture.detectChanges();
    expect(fixture.componentInstance.error()).toBe('Orders loaded, but delivery partner list failed to load.');
    expect(fixture.componentInstance.orders()).toEqual([order]);
  });

  it('filteredOrders filters by the selected status', () => {
    const fixture = create();
    fixture.componentInstance.setStatusFilter('confirmed');
    expect(fixture.componentInstance.filteredOrders()).toEqual([order2]);
    fixture.componentInstance.setStatusFilter('all');
    expect(fixture.componentInstance.filteredOrders()).toEqual([order, order2]);
  });

  it('pendingCount and activeDeliveryCount are computed from orders', () => {
    const fixture = create();
    expect(fixture.componentInstance.pendingCount()).toBe(1);
    expect(fixture.componentInstance.activeDeliveryCount()).toBe(1);
  });

  it('setStatusDraft / setDeliveryDraft update the per-order draft maps', () => {
    const fixture = create();
    fixture.componentInstance.setStatusDraft('o1', 'Packed');
    expect(fixture.componentInstance.statusDraft()['o1']).toBe('Packed');

    fixture.componentInstance.setDeliveryDraft('o1', 'd1');
    expect(fixture.componentInstance.deliveryDraft()['o1']).toBe('d1');
  });

  it('updateOrderStatus is a no-op when the draft matches the current status', () => {
    const fixture = create();
    fixture.componentInstance.updateOrderStatus(order); // draft defaults to current status
    expect(orderServiceSpy.updateOrderStatusAsAdmin).not.toHaveBeenCalled();
  });

  it('updateOrderStatus updates the order on success', () => {
    orderServiceSpy.updateOrderStatusAsAdmin.and.returnValue(of(undefined));
    const fixture = create();
    fixture.componentInstance.setStatusDraft('o1', 'Packed');

    fixture.componentInstance.updateOrderStatus(order);

    expect(orderServiceSpy.updateOrderStatusAsAdmin).toHaveBeenCalledWith('o1', { status: 'Packed' });
    expect(fixture.componentInstance.orders().find((o) => o.id === 'o1')?.status).toBe('Packed');
    expect(fixture.componentInstance.busyOrderAction()).toBeNull();
  });

  it('updateOrderStatus sets an error on failure', () => {
    orderServiceSpy.updateOrderStatusAsAdmin.and.returnValue(throwError(() => new Error('fail')));
    const fixture = create();
    fixture.componentInstance.setStatusDraft('o1', 'Packed');

    fixture.componentInstance.updateOrderStatus(order);

    expect(fixture.componentInstance.error()).toBe('Could not update order status. Please try again.');
  });

  it('assignDelivery is a no-op when the draft matches the current partner', () => {
    const fixture = create();
    fixture.componentInstance.assignDelivery(order2); // draft defaults to d1, same as current
    expect(orderServiceSpy.assignDeliveryPartner).not.toHaveBeenCalled();
  });

  it('assignDelivery assigns a partner and records the partner name on success', () => {
    orderServiceSpy.assignDeliveryPartner.and.returnValue(of(undefined));
    const fixture = create();
    fixture.componentInstance.setDeliveryDraft('o1', 'd1');

    fixture.componentInstance.assignDelivery(order);

    expect(orderServiceSpy.assignDeliveryPartner).toHaveBeenCalledWith('o1', { deliveryPartnerId: 'd1' });
    expect(fixture.componentInstance.orders().find((o) => o.id === 'o1')?.deliveryPartnerName).toBe('Delivery Dan');
  });

  it('assignDelivery sets an error on failure', () => {
    orderServiceSpy.assignDeliveryPartner.and.returnValue(throwError(() => new Error('fail')));
    const fixture = create();
    fixture.componentInstance.setDeliveryDraft('o1', 'd1');

    fixture.componentInstance.assignDelivery(order);

    expect(fixture.componentInstance.error()).toBe('Could not assign delivery partner. Please try again.');
  });

  it('updateStaffField updates a single field of the staff form', () => {
    const fixture = create();
    fixture.componentInstance.updateStaffField('fullName', 'New Staff');
    expect(fixture.componentInstance.staffForm().fullName).toBe('New Staff');
  });

  it('toggleStaffPasswordVisibility flips the visibility flag', () => {
    const fixture = create();
    expect(fixture.componentInstance.showStaffPassword()).toBeFalse();
    fixture.componentInstance.toggleStaffPasswordVisibility();
    expect(fixture.componentInstance.showStaffPassword()).toBeTrue();
  });

  it('createStaffAccount adds a new delivery partner to the list on success', () => {
    const newStaff: StaffUserResponse = { id: 'd2', fullName: 'New Guy', email: 'n@x.com', phone: '9999999999', role: 'delivery' };
    authServiceSpy.createStaff.and.returnValue(of(newStaff));
    const fixture = create();
    fixture.componentInstance.updateStaffField('fullName', 'New Guy');
    fixture.componentInstance.updateStaffField('email', 'n@x.com');
    fixture.componentInstance.updateStaffField('phone', '9999999999');
    fixture.componentInstance.updateStaffField('password', 'secret123');

    fixture.componentInstance.createStaffAccount();

    expect(fixture.componentInstance.deliveryPartners()).toContain(newStaff);
    expect(fixture.componentInstance.staffMessage()).toContain('New Guy');
    expect(fixture.componentInstance.creatingStaff()).toBeFalse();
  });

  it('createStaffAccount sets staffError on failure', () => {
    authServiceSpy.createStaff.and.returnValue(throwError(() => ({ error: { message: 'Email taken' } })));
    const fixture = create();

    fixture.componentInstance.createStaffAccount();

    expect(fixture.componentInstance.staffError()).toBe('Email taken');
    expect(fixture.componentInstance.creatingStaff()).toBeFalse();
  });

  it('statusClass maps known statuses to CSS classes', () => {
    const fixture = create();
    const c = fixture.componentInstance;
    expect(c.statusClass('Confirmed')).toBe('status-confirmed');
    expect(c.statusClass('Packed')).toBe('status-packed');
    expect(c.statusClass('Shipped')).toBe('status-shipped');
    expect(c.statusClass('Delivered')).toBe('status-delivered');
    expect(c.statusClass('Cancelled')).toBe('status-cancelled');
    expect(c.statusClass('Pending')).toBe('status-pending');
  });
});
