import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { Checkout } from './checkout';
import { CartService } from '../../services/cart.service';
import { CheckoutService, CheckoutItem } from '../../services/checkout.service';
import { OrderService } from '../../services/order.service';
import { ProductService } from '../../services/product.service';
import { AuthService } from '../../services/auth.service';
import { UserService } from '../../services/user.service';
import { DeliveryChargesService } from '../../services/delivery-charges.service';
import {
  AuthResponse,
  OrderResponse,
  Product,
  SavedAddress,
  UserProfileResponse,
} from '../../models/interfaces';

describe('Checkout', () => {
  const product: Product = {
    id: 'p1',
    name: 'Bajra Flour',
    description: 'desc',
    price: 100,
    discount: 0,
    category: 'Flour',
    imageUrl: '',
    galleryImageUrls: [],
    weight: '500g',
    isAvailable: true,
    stockQuantity: null,
    lowStockThreshold: 5,
    ingredients: '',
    benefits: '',
    storageInfo: '',
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
  };

  const authUser: AuthResponse = {
    id: 'u1',
    fullName: 'Jane Doe',
    email: 'jane@x.com',
    phone: '9999999999',
    role: 'customer',
  };

  const defaultAddress: SavedAddress = {
    label: 'Home',
    fullAddress: '123 Main St',
    latitude: 18.5,
    longitude: 73.8,
    isDefault: true,
  };

  const profile: UserProfileResponse = {
    id: 'u1',
    fullName: 'Jane Doe',
    email: 'jane@x.com',
    phone: '9999999999',
    createdAt: '2024-01-01',
    savedAddresses: [defaultAddress],
  };

  const order: OrderResponse = {
    id: 'o1',
    fullName: 'Jane Doe',
    phone: '9999999999',
    address: '123 Main St',
    latitude: 18.5,
    longitude: 73.8,
    notes: '',
    items: [],
    deliveryCharge: 0,
    deliveryDistanceKm: 3,
    totalAmount: 100,
    status: 'Pending',
    paymentMethod: 'COD',
    paymentStatus: 'Pending',
    createdAt: '2024-01-01',
  };

  let items: ReturnType<typeof signal<CheckoutItem[]>>;
  let cartServiceSpy: jasmine.SpyObj<CartService>;
  let checkoutServiceSpy: any;
  let orderServiceSpy: jasmine.SpyObj<OrderService>;
  let productServiceSpy: jasmine.SpyObj<ProductService>;
  let authServiceSpy: any;
  let userServiceSpy: jasmine.SpyObj<UserService>;
  let deliveryChargesServiceSpy: jasmine.SpyObj<DeliveryChargesService>;
  let router: Router;

  beforeEach(() => {
    items = signal<CheckoutItem[]>([{ product, quantity: 2 }]);
    cartServiceSpy = jasmine.createSpyObj('CartService', ['removeFromCart']);
    checkoutServiceSpy = jasmine.createSpyObj('CheckoutService', ['updateQuantity', 'removeItem', 'clear', 'addItem', 'mergeItems'], {
      items,
    });
    orderServiceSpy = jasmine.createSpyObj('OrderService', ['placeOrder']);
    productServiceSpy = jasmine.createSpyObj('ProductService', ['loadProducts']);
    authServiceSpy = { user: signal<AuthResponse | null>(authUser) };
    userServiceSpy = jasmine.createSpyObj('UserService', ['getProfile', 'saveAddress']);
    userServiceSpy.getProfile.and.returnValue(of(profile));
    deliveryChargesServiceSpy = jasmine.createSpyObj('DeliveryChargesService', ['previewCharge']);
    deliveryChargesServiceSpy.previewCharge.and.returnValue(
      of({ distanceKm: 3, charge: 20, isFree: false, isServiceable: true, maxRadiusKm: 25 }),
    );

    TestBed.configureTestingModule({
      imports: [Checkout],
      providers: [
        provideRouter([]),
        { provide: CartService, useValue: cartServiceSpy },
        { provide: CheckoutService, useValue: checkoutServiceSpy },
        { provide: OrderService, useValue: orderServiceSpy },
        { provide: ProductService, useValue: productServiceSpy },
        { provide: AuthService, useValue: authServiceSpy },
        { provide: UserService, useValue: userServiceSpy },
        { provide: DeliveryChargesService, useValue: deliveryChargesServiceSpy },
      ],
    });
    router = TestBed.inject(Router);
  });

  function create() {
    const fixture = TestBed.createComponent(Checkout);
    fixture.detectChanges();
    return fixture;
  }

  it('should create and pre-fill fullName/phone from the logged-in user', () => {
    const fixture = create();
    expect(fixture.componentInstance.fullName).toBe('Jane Doe');
    expect(fixture.componentInstance.phone).toBe('9999999999');
  });

  it('loads saved addresses and pre-selects + estimates delivery for the default one', () => {
    const fixture = create();
    expect(fixture.componentInstance.savedAddresses()).toEqual([defaultAddress]);
    expect(fixture.componentInstance.selectedSavedAddress()).toEqual(defaultAddress);
    expect(deliveryChargesServiceSpy.previewCharge).toHaveBeenCalledWith(18.5, 73.8);
    expect(fixture.componentInstance.deliveryCharge()).toBe(20);
    expect(fixture.componentInstance.deliveryDistanceKm()).toBe(3);
  });

  it('redirects to /products when there is nothing to check out', () => {
    items.set([]);
    spyOn(router, 'navigate');
    create();
    expect(router.navigate).toHaveBeenCalledWith(['/products']);
  });

  it('totalAmount and grandTotal compute from checkout items and delivery charge', () => {
    const fixture = create();
    expect(fixture.componentInstance.totalAmount()).toBe(200); // 100 * 2
    expect(fixture.componentInstance.grandTotal()).toBe(220); // + 20 delivery
  });

  it('isAddressValid is true when a saved address is selected', () => {
    const fixture = create();
    expect(fixture.componentInstance.isAddressValid).toBeTrue();
  });

  it('isAddressValid requires all manual fields + coordinates when no saved address is selected', () => {
    const fixture = create();
    fixture.componentInstance.useNewAddress();
    expect(fixture.componentInstance.isAddressValid).toBeFalse();

    fixture.componentInstance.houseNo = '12';
    fixture.componentInstance.street = 'Main St';
    fixture.componentInstance.area = 'Area';
    fixture.componentInstance.city = 'Pune';
    fixture.componentInstance.state = 'Maharashtra';
    fixture.componentInstance.pincode = '411001';
    fixture.componentInstance.manualLat = 18.5;
    fixture.componentInstance.manualLng = 73.8;
    expect(fixture.componentInstance.isAddressValid).toBeTrue();
  });

  it('selectAddress toggles off the same address and re-estimates', () => {
    const fixture = create();
    fixture.componentInstance.selectAddress(defaultAddress);
    expect(fixture.componentInstance.selectedSavedAddress()).toBeNull();
  });

  it('useNewAddress clears the selection and re-estimates', () => {
    const fixture = create();
    fixture.componentInstance.useNewAddress();
    expect(fixture.componentInstance.selectedSavedAddress()).toBeNull();
    expect(fixture.componentInstance.deliveryCharge()).toBe(0);
    expect(fixture.componentInstance.deliveryDistanceKm()).toBeNull();
  });

  it('onManualLocationConfirmed sets coordinates, hides the picker, and re-estimates', () => {
    const fixture = create();
    fixture.componentInstance.useNewAddress();
    deliveryChargesServiceSpy.previewCharge.calls.reset();

    fixture.componentInstance.onManualLocationConfirmed({ lat: 19, lng: 74 });

    expect(fixture.componentInstance.manualLat).toBe(19);
    expect(fixture.componentInstance.manualLng).toBe(74);
    expect(fixture.componentInstance.showManualMapPicker()).toBeFalse();
    expect(deliveryChargesServiceSpy.previewCharge).toHaveBeenCalledWith(19, 74);
  });

  it('placeOrder submits using the selected saved address and clears cart/checkout on success', () => {
    orderServiceSpy.placeOrder.and.returnValue(of(order));
    const fixture = create();

    fixture.componentInstance.placeOrder();

    expect(orderServiceSpy.placeOrder).toHaveBeenCalledWith(
      jasmine.objectContaining({
        fullName: 'Jane Doe',
        phone: '9999999999',
        address: '123 Main St',
        latitude: 18.5,
        longitude: 73.8,
      }),
    );
    expect(fixture.componentInstance.orderPlaced()).toBeTrue();
    expect(fixture.componentInstance.orderId()).toBe('o1');
    expect(cartServiceSpy.removeFromCart).toHaveBeenCalledWith('p1');
    expect(checkoutServiceSpy.clear).toHaveBeenCalled();
    // Stock changed server-side; the cached product list must be refreshed.
    expect(productServiceSpy.loadProducts).toHaveBeenCalled();
  });

  it('placeOrder scrolls to top on success, so the confirmation is visible rather than the footer', () => {
    orderServiceSpy.placeOrder.and.returnValue(of(order));
    // window.scrollTo is overloaded ((x,y) vs (options)), which makes toHaveBeenCalledWith's
    // inferred signature fight the typing - asserting on the captured call args directly
    // sidesteps that instead.
    const scrollToSpy = spyOn(window, 'scrollTo').and.stub();
    const fixture = create();

    fixture.componentInstance.placeOrder();

    expect(scrollToSpy.calls.mostRecent().args[0]).toEqual({ top: 0, behavior: 'smooth' });
  });

  it('placeOrder saves a new address when opted in and none is currently selected', () => {
    orderServiceSpy.placeOrder.and.returnValue(of(order));
    userServiceSpy.saveAddress.and.returnValue(of({}));
    const fixture = create();
    fixture.componentInstance.useNewAddress();
    fixture.componentInstance.houseNo = '12';
    fixture.componentInstance.street = 'Main St';
    fixture.componentInstance.area = 'Area';
    fixture.componentInstance.city = 'Pune';
    fixture.componentInstance.state = 'Maharashtra';
    fixture.componentInstance.pincode = '411001';
    fixture.componentInstance.manualLat = 18.5;
    fixture.componentInstance.manualLng = 73.8;
    fixture.componentInstance.saveNewAddress = true;
    fixture.componentInstance.saveNewAddressLabel = 'Office';

    fixture.componentInstance.placeOrder();

    expect(userServiceSpy.saveAddress).toHaveBeenCalledWith(
      jasmine.objectContaining({ label: 'Office', isDefault: false }),
    );
  });

  it('placeOrder sets a session-expired message on 401', () => {
    orderServiceSpy.placeOrder.and.returnValue(throwError(() => ({ status: 401 })));
    const fixture = create();

    fixture.componentInstance.placeOrder();

    expect(fixture.componentInstance.errorMsg()).toBe('Session expired. Please login again.');
    expect(fixture.componentInstance.loading()).toBeFalse();
  });

  it('placeOrder sets a generic error message on other failures', () => {
    orderServiceSpy.placeOrder.and.returnValue(throwError(() => ({ status: 500 })));
    const fixture = create();

    fixture.componentInstance.placeOrder();

    expect(fixture.componentInstance.errorMsg()).toBe('Failed to place order. Please try again.');
  });

  it('incrementCartQty / decrementCartQty delegate to checkoutService.updateQuantity', () => {
    const fixture = create();
    fixture.componentInstance.incrementCartQty(0);
    expect(checkoutServiceSpy.updateQuantity).toHaveBeenCalledWith('p1', 3);

    fixture.componentInstance.decrementCartQty(0);
    // item quantity in the signal is still the original mock value (2), decrement calls with 1
    expect(checkoutServiceSpy.updateQuantity).toHaveBeenCalledWith('p1', 1);
  });

  it('decrementCartQty does nothing when quantity is already 1', () => {
    items.set([{ product, quantity: 1 }]);
    const fixture = create();
    checkoutServiceSpy.updateQuantity.calls.reset();

    fixture.componentInstance.decrementCartQty(0);

    expect(checkoutServiceSpy.updateQuantity).not.toHaveBeenCalled();
  });

  it('removeItem removes via checkoutService and navigates to /cart when nothing is left', () => {
    const fixture = create();
    spyOn(router, 'navigate');
    checkoutServiceSpy.removeItem.and.callFake(() => items.set([]));

    fixture.componentInstance.removeItem(0);

    expect(checkoutServiceSpy.removeItem).toHaveBeenCalledWith('p1');
    expect(router.navigate).toHaveBeenCalledWith(['/cart']);
  });
});
