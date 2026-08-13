import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { AdminDashboard } from './admin-dashboard';
import { AuthService } from '../../services/auth.service';
import { OrderService } from '../../services/order.service';
import { ProductService } from '../../services/product.service';
import { DeliveryChargesService } from '../../services/delivery-charges.service';
import { CampaignBannerService } from '../../services/campaign-banner.service';
import {
  CampaignBannerConfig,
  DeliveryChargesConfig,
  OrderResponse,
  Product,
  StaffUserResponse,
} from '../../models/interfaces';

describe('AdminDashboard', () => {
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
    createdAt: '2024-01-05',
  };
  const order2: OrderResponse = { ...order, id: 'o2', status: 'Delivered', totalAmount: 250, createdAt: '2024-01-01' };
  const order3: OrderResponse = { ...order, id: 'o3', status: 'Confirmed', createdAt: '2024-01-03' };

  const partner: StaffUserResponse = {
    id: 'd1',
    fullName: 'Delivery Dan',
    email: 'd@x.com',
    phone: '9999999999',
    role: 'delivery',
  };

  let authServiceSpy: jasmine.SpyObj<AuthService>;
  let orderServiceSpy: jasmine.SpyObj<OrderService>;
  let productServiceSpy: any;
  let deliveryChargesServiceSpy: any;
  let campaignBannerServiceSpy: any;

  beforeEach(() => {
    authServiceSpy = jasmine.createSpyObj('AuthService', ['createStaff', 'logout']);
    orderServiceSpy = jasmine.createSpyObj('OrderService', [
      'getAdminOrders',
      'getDeliveryPartners',
      'updateOrderStatusAsAdmin',
      'assignDeliveryPartner',
    ]);
    orderServiceSpy.getAdminOrders.and.returnValue(of([order, order2, order3]));
    orderServiceSpy.getDeliveryPartners.and.returnValue(of([partner]));

    productServiceSpy = jasmine.createSpyObj('ProductService', ['loadProducts'], {
      products: signal<Product[]>([]),
      loading: signal(false),
      error: signal<string | null>(null),
    });
    deliveryChargesServiceSpy = jasmine.createSpyObj('DeliveryChargesService', ['loadConfig', 'calculateDeliveryCharge'], {
      config: signal<DeliveryChargesConfig | null>(null),
      loading: signal(false),
      error: signal<string | null>(null),
    });
    deliveryChargesServiceSpy.calculateDeliveryCharge.and.returnValue({ charge: 0, isFree: true, breakdown: '' });
    campaignBannerServiceSpy = jasmine.createSpyObj('CampaignBannerService', ['loadCampaigns'], {
      campaigns: signal<CampaignBannerConfig[]>([]),
      loading: signal(false),
    });

    TestBed.configureTestingModule({
      imports: [AdminDashboard],
      providers: [
        { provide: AuthService, useValue: authServiceSpy },
        { provide: OrderService, useValue: orderServiceSpy },
        { provide: ProductService, useValue: productServiceSpy },
        { provide: DeliveryChargesService, useValue: deliveryChargesServiceSpy },
        { provide: CampaignBannerService, useValue: campaignBannerServiceSpy },
      ],
    });
  });

  // MatSnackBarModule declares its own `providers: [MatSnackBar]` pulled into this standalone
  // component's own injector, shadowing a TestBed-level override - spy on the real instance.
  function create() {
    const fixture = TestBed.createComponent(AdminDashboard);
    fixture.detectChanges();
    const snackBar = fixture.debugElement.injector.get(MatSnackBar);
    spyOn(snackBar, 'open').and.stub();
    return { fixture, snackBar };
  }

  it('should create and load orders + delivery partners on init', () => {
    const { fixture } = create();
    expect(fixture.componentInstance).toBeTruthy();
    expect(fixture.componentInstance.orders().length).toBe(3);
    expect(fixture.componentInstance.deliveryPartners()).toEqual([partner]);
    expect(fixture.componentInstance.loadingOrders()).toBeFalse();
    expect(fixture.componentInstance.loadingPartners()).toBeFalse();
  });

  it('sets an error when loading orders fails', () => {
    orderServiceSpy.getAdminOrders.and.returnValue(throwError(() => new Error('fail')));
    const { fixture } = create();
    expect(fixture.componentInstance.ordersError()).toBe('Failed to load orders');
  });

  it('sets an error when loading delivery partners fails', () => {
    orderServiceSpy.getDeliveryPartners.and.returnValue(throwError(() => new Error('fail')));
    const { fixture } = create();
    expect(fixture.componentInstance.partnersError()).toBe('Failed to load delivery partners');
  });

  it('getTabIndex reflects the active tab and onTabChange updates it', () => {
    const { fixture } = create();
    expect(fixture.componentInstance.getTabIndex()).toBe(0); // 'orders'

    fixture.componentInstance.onTabChange({ index: 1 });
    expect(fixture.componentInstance.activeTab()).toBe('products');
    expect(fixture.componentInstance.getTabIndex()).toBe(1);
  });

  it('refreshCurrentTab delegates to the right service for each tab', () => {
    const { fixture } = create();
    orderServiceSpy.getAdminOrders.calls.reset();

    fixture.componentInstance.refreshCurrentTab(); // orders
    expect(orderServiceSpy.getAdminOrders).toHaveBeenCalled();

    fixture.componentInstance.activeTab.set('delivery-partners');
    fixture.componentInstance.refreshCurrentTab();
    expect(orderServiceSpy.getDeliveryPartners).toHaveBeenCalled();

    fixture.componentInstance.activeTab.set('products');
    fixture.componentInstance.refreshCurrentTab();
    expect(productServiceSpy.loadProducts).toHaveBeenCalled();

    fixture.componentInstance.activeTab.set('delivery-charges');
    fixture.componentInstance.refreshCurrentTab();
    expect(deliveryChargesServiceSpy.loadConfig).toHaveBeenCalled();

    fixture.componentInstance.activeTab.set('campaign-banner');
    fixture.componentInstance.refreshCurrentTab();
    expect(campaignBannerServiceSpy.loadCampaigns).toHaveBeenCalled();
  });

  it('filteredOrders defaults to the "pending" filter and sorts pending first, then by date desc', () => {
    const { fixture } = create();
    expect(fixture.componentInstance.statusFilter()).toBe('pending');
    expect(fixture.componentInstance.filteredOrders()).toEqual([order]);

    fixture.componentInstance.setStatusFilter('all');
    const sorted = fixture.componentInstance.filteredOrders();
    expect(sorted[0].id).toBe('o1'); // pending first
    expect(sorted[1].id).toBe('o3'); // then newest-first among the rest
    expect(sorted[2].id).toBe('o2');
  });

  it('pendingCount, activeDeliveryCount, and totalRevenue are computed from orders', () => {
    const { fixture } = create();
    expect(fixture.componentInstance.pendingCount()).toBe(1);
    expect(fixture.componentInstance.activeDeliveryCount()).toBe(1); // order3 confirmed
    expect(fixture.componentInstance.totalRevenue()).toBe(250); // order2 delivered
  });

  it('setStatusDraft / setDeliveryDraft update per-order drafts', () => {
    const { fixture } = create();
    fixture.componentInstance.setStatusDraft('o1', 'Packed');
    expect(fixture.componentInstance.statusDraft()['o1']).toBe('Packed');
    fixture.componentInstance.setDeliveryDraft('o1', 'd1');
    expect(fixture.componentInstance.deliveryDraft()['o1']).toBe('d1');
  });

  it('updateOrderStatus updates the order and shows a success message', () => {
    orderServiceSpy.updateOrderStatusAsAdmin.and.returnValue(of(undefined));
    const { fixture, snackBar } = create();
    fixture.componentInstance.setStatusDraft('o1', 'Packed');

    fixture.componentInstance.updateOrderStatus(order);

    expect(orderServiceSpy.updateOrderStatusAsAdmin).toHaveBeenCalledWith('o1', { status: 'Packed' });
    expect(fixture.componentInstance.orders().find((o) => o.id === 'o1')?.status).toBe('Packed');
    expect(snackBar.open).toHaveBeenCalledWith('Order status updated', 'Close', jasmine.any(Object));
  });

  it('updateOrderStatus is a no-op when the draft equals the current status', () => {
    const { fixture } = create();
    fixture.componentInstance.updateOrderStatus(order);
    expect(orderServiceSpy.updateOrderStatusAsAdmin).not.toHaveBeenCalled();
  });

  it('updateOrderStatus sets an error message on failure', () => {
    orderServiceSpy.updateOrderStatusAsAdmin.and.returnValue(throwError(() => new Error('fail')));
    const { fixture } = create();
    fixture.componentInstance.setStatusDraft('o1', 'Packed');

    fixture.componentInstance.updateOrderStatus(order);

    expect(fixture.componentInstance.ordersError()).toBe('Could not update order status');
  });

  it('assignDelivery assigns a partner and shows a success message', () => {
    orderServiceSpy.assignDeliveryPartner.and.returnValue(of(undefined));
    const { fixture, snackBar } = create();
    fixture.componentInstance.setDeliveryDraft('o1', 'd1');

    fixture.componentInstance.assignDelivery(order);

    expect(orderServiceSpy.assignDeliveryPartner).toHaveBeenCalledWith('o1', { deliveryPartnerId: 'd1' });
    expect(fixture.componentInstance.orders().find((o) => o.id === 'o1')?.deliveryPartnerName).toBe('Delivery Dan');
    expect(snackBar.open).toHaveBeenCalledWith('Delivery partner assigned', 'Close', jasmine.any(Object));
  });

  it('assignDelivery sets an error message on failure', () => {
    orderServiceSpy.assignDeliveryPartner.and.returnValue(throwError(() => new Error('fail')));
    const { fixture } = create();
    fixture.componentInstance.setDeliveryDraft('o1', 'd1');

    fixture.componentInstance.assignDelivery(order);

    expect(fixture.componentInstance.ordersError()).toBe('Could not assign delivery partner');
  });

  it('statusClass / getPartnerName helpers', () => {
    const { fixture } = create();
    expect(fixture.componentInstance.statusClass('Confirmed')).toBe('status-confirmed');
    expect(fixture.componentInstance.statusClass('Unknown')).toBe('status-pending');
    expect(fixture.componentInstance.getPartnerName('d1')).toBe('Delivery Dan');
    expect(fixture.componentInstance.getPartnerName('missing')).toBe('Unknown');
  });

  it('updateStaffField / toggleStaffPasswordVisibility', () => {
    const { fixture } = create();
    fixture.componentInstance.updateStaffField('fullName', 'New Staff');
    expect(fixture.componentInstance.staffForm().fullName).toBe('New Staff');

    expect(fixture.componentInstance.showStaffPassword()).toBeFalse();
    fixture.componentInstance.toggleStaffPasswordVisibility();
    expect(fixture.componentInstance.showStaffPassword()).toBeTrue();
  });

  it('createStaffAccount validates required fields before calling the service', () => {
    const { fixture } = create();
    fixture.componentInstance.createStaffAccount();
    expect(fixture.componentInstance.staffError()).toBe('All fields are required');
    expect(authServiceSpy.createStaff).not.toHaveBeenCalled();
  });

  it('createStaffAccount validates the email format', () => {
    const { fixture } = create();
    fixture.componentInstance.updateStaffField('fullName', 'New Staff');
    fixture.componentInstance.updateStaffField('email', 'not-an-email');
    fixture.componentInstance.updateStaffField('phone', '9999999999');
    fixture.componentInstance.updateStaffField('password', 'password123');

    fixture.componentInstance.createStaffAccount();

    expect(fixture.componentInstance.staffError()).toBe('Please enter a valid email address');
    expect(authServiceSpy.createStaff).not.toHaveBeenCalled();
  });

  it('createStaffAccount requires a password of at least 8 characters', () => {
    const { fixture } = create();
    fixture.componentInstance.updateStaffField('fullName', 'New Staff');
    fixture.componentInstance.updateStaffField('email', 'n@x.com');
    fixture.componentInstance.updateStaffField('phone', '9999999999');
    fixture.componentInstance.updateStaffField('password', 'short');

    fixture.componentInstance.createStaffAccount();

    expect(fixture.componentInstance.staffError()).toBe('Password must be at least 8 characters');
    expect(authServiceSpy.createStaff).not.toHaveBeenCalled();
  });

  it('createStaffAccount creates the staff member and shows a success message', () => {
    const newStaff: StaffUserResponse = {
      id: 'd2',
      fullName: 'New Guy',
      email: 'n@x.com',
      phone: '9999999999',
      role: 'delivery',
    };
    authServiceSpy.createStaff.and.returnValue(of(newStaff));
    const { fixture, snackBar } = create();
    fixture.componentInstance.updateStaffField('fullName', 'New Guy');
    fixture.componentInstance.updateStaffField('email', 'n@x.com');
    fixture.componentInstance.updateStaffField('phone', '9999999999');
    fixture.componentInstance.updateStaffField('password', 'password123');

    fixture.componentInstance.createStaffAccount();

    expect(fixture.componentInstance.deliveryPartners()).toContain(newStaff);
    expect(snackBar.open).toHaveBeenCalledWith('Staff account created', 'Close', jasmine.any(Object));
    expect(fixture.componentInstance.creatingStaff()).toBeFalse();
  });

  it('createStaffAccount sets a staffError message on failure', () => {
    authServiceSpy.createStaff.and.returnValue(throwError(() => ({ error: { message: 'Email taken' } })));
    const { fixture } = create();
    fixture.componentInstance.updateStaffField('fullName', 'New Guy');
    fixture.componentInstance.updateStaffField('email', 'n@x.com');
    fixture.componentInstance.updateStaffField('phone', '9999999999');
    fixture.componentInstance.updateStaffField('password', 'password123');

    fixture.componentInstance.createStaffAccount();

    expect(fixture.componentInstance.staffError()).toBe('Email taken');
    expect(fixture.componentInstance.creatingStaff()).toBeFalse();
  });

  it('logout delegates to auth.logout()', () => {
    const { fixture } = create();
    fixture.componentInstance.logout();
    expect(authServiceSpy.logout).toHaveBeenCalled();
  });

  it('renders the products tab (real ProductManagement child) without error when switched to', () => {
    const { fixture } = create();
    fixture.componentInstance.onTabChange({ index: 1 });
    expect(() => fixture.detectChanges()).not.toThrow();
  });

  it('renders the delivery-charges tab (real DeliveryChargesManagement child) without error when switched to', () => {
    const { fixture } = create();
    fixture.componentInstance.onTabChange({ index: 3 });
    expect(() => fixture.detectChanges()).not.toThrow();
  });

  it('renders the campaign-banner tab (real CampaignBannerManagement child) without error when switched to', () => {
    const { fixture } = create();
    fixture.componentInstance.onTabChange({ index: 4 });
    expect(() => fixture.detectChanges()).not.toThrow();
  });
});
