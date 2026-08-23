import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { Checkout } from './checkout';
import { CartService } from '../../services/cart.service';
import { CheckoutService, CheckoutItem } from '../../services/checkout.service';
import { OrderService } from '../../services/order.service';
import { CashfreeCheckoutService } from '../../services/cashfree-checkout.service';
import { ProductService } from '../../services/product.service';
import { AuthService } from '../../services/auth.service';
import { UserService } from '../../services/user.service';
import { DeliveryChargesService } from '../../services/delivery-charges.service';
import { WalletService } from '../../services/wallet.service';
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
    phone: '9888877766',
    fullAddress: '123 Main St, Kharadi, Pune - 411014',
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
    subtotal: 100,
    discountPercentage: 0,
    discountAmount: 0,
    deliveryCharge: 0,
    deliveryDistanceKm: 3,
    totalAmount: 100,
    status: 'Pending',
    paymentMethod: 'Cashfree',
    paymentStatus: 'Pending',
    amountPaid: 0,
    walletAmountApplied: 0,
    paymentSessionId: 'session_abc',
    createdAt: '2024-01-01',
  };

  let items: ReturnType<typeof signal<CheckoutItem[]>>;
  let cartServiceSpy: jasmine.SpyObj<CartService>;
  let checkoutServiceSpy: any;
  let orderServiceSpy: jasmine.SpyObj<OrderService>;
  let cashfreeCheckoutServiceSpy: jasmine.SpyObj<CashfreeCheckoutService>;
  let productServiceSpy: jasmine.SpyObj<ProductService>;
  let authServiceSpy: any;
  let userServiceSpy: jasmine.SpyObj<UserService>;
  let deliveryChargesServiceSpy: jasmine.SpyObj<DeliveryChargesService>;
  let walletServiceSpy: jasmine.SpyObj<WalletService>;
  let walletBalance: ReturnType<typeof signal<number>>;
  let router: Router;

  beforeEach(() => {
    items = signal<CheckoutItem[]>([{ product, quantity: 2 }]);
    cartServiceSpy = jasmine.createSpyObj('CartService', ['removeFromCart']);
    checkoutServiceSpy = jasmine.createSpyObj(
      'CheckoutService',
      ['updateQuantity', 'removeItem', 'clear', 'addItem', 'mergeItems'],
      {
        items,
      },
    );
    orderServiceSpy = jasmine.createSpyObj('OrderService', ['placeOrder']);
    cashfreeCheckoutServiceSpy = jasmine.createSpyObj('CashfreeCheckoutService', ['checkout']);
    cashfreeCheckoutServiceSpy.checkout.and.returnValue(Promise.resolve());
    productServiceSpy = jasmine.createSpyObj('ProductService', ['loadProducts']);
    authServiceSpy = { user: signal<AuthResponse | null>(authUser) };
    userServiceSpy = jasmine.createSpyObj('UserService', ['getProfile', 'saveAddress']);
    userServiceSpy.getProfile.and.returnValue(of(profile));
    deliveryChargesServiceSpy = jasmine.createSpyObj('DeliveryChargesService', ['previewCharge']);
    deliveryChargesServiceSpy.previewCharge.and.returnValue(
      of({ distanceKm: 3, charge: 20, isFree: false, isServiceable: true, maxRadiusKm: 25 }),
    );
    walletBalance = signal(0);
    walletServiceSpy = jasmine.createSpyObj('WalletService', ['load'], {
      balance: walletBalance,
    });
    walletServiceSpy.load.and.returnValue(of({ balance: walletBalance(), transactions: [] }));

    TestBed.configureTestingModule({
      imports: [Checkout],
      providers: [
        provideRouter([]),
        { provide: WalletService, useValue: walletServiceSpy },
        { provide: CartService, useValue: cartServiceSpy },
        { provide: CheckoutService, useValue: checkoutServiceSpy },
        { provide: OrderService, useValue: orderServiceSpy },
        { provide: CashfreeCheckoutService, useValue: cashfreeCheckoutServiceSpy },
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
    // No saved addresses here, so nothing overrides the account phone.
    userServiceSpy.getProfile.and.returnValue(of({ ...profile, savedAddresses: [] }));
    const fixture = create();
    expect(fixture.componentInstance.fullName).toBe('Jane Doe');
    expect(fixture.componentInstance.phone).toBe('9999999999');
  });

  it('loads saved addresses and pre-selects + estimates delivery for the default one', () => {
    const fixture = create();
    expect(fixture.componentInstance.savedAddresses()).toEqual([defaultAddress]);
    expect(fixture.componentInstance.selectedSavedAddress()).toEqual(defaultAddress);
    // The pincode goes along with the pin, because that is what the server actually prices from.
    expect(deliveryChargesServiceSpy.previewCharge).toHaveBeenCalledWith(18.5, 73.8, '411014');
    expect(fixture.componentInstance.deliveryCharge()).toBe(20);
    expect(fixture.componentInstance.deliveryDistanceKm()).toBe(3);
    // The pre-selected address's own phone wins over the account's.
    expect(fixture.componentInstance.phone).toBe('9888877766');
  });

  it('selectAddress fills the phone field from the address, falling back to the account phone for one with none', () => {
    const fixture = create();
    const officeNoPhone = { ...defaultAddress, label: 'Office', phone: '' };

    fixture.componentInstance.selectAddress(officeNoPhone);
    expect(fixture.componentInstance.phone).toBe('9999999999'); // account phone fallback

    fixture.componentInstance.selectAddress(defaultAddress);
    expect(fixture.componentInstance.phone).toBe('9888877766'); // the address's own phone
  });

  it('deselecting a saved address and useNewAddress both revert the phone to the account phone', () => {
    const fixture = create();
    expect(fixture.componentInstance.phone).toBe('9888877766');

    fixture.componentInstance.selectAddress(defaultAddress); // toggles it off
    expect(fixture.componentInstance.phone).toBe('9999999999');

    fixture.componentInstance.selectAddress(defaultAddress); // back on
    expect(fixture.componentInstance.phone).toBe('9888877766');

    fixture.componentInstance.useNewAddress();
    expect(fixture.componentInstance.phone).toBe('9999999999');
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

  it('applies no discount automatically, even once the cart clears a coupon threshold', () => {
    items.set([{ product, quantity: 25 }]); // 2500, well past both coupon minimums
    const fixture = create();
    expect(fixture.componentInstance.discount()).toEqual({ percentage: 0, amount: 0 });
    expect(fixture.componentInstance.appliedCouponCode()).toBeNull();
  });

  it('free delivery is still automatic and independent of any coupon', () => {
    items.set([{ product, quantity: 6 }]); // 600, past the ₹500 free-delivery threshold
    const fixture = create();
    expect(fixture.componentInstance.effectiveDeliveryCharge()).toBe(0);
  });

  it('nudges toward free delivery only, since coupons show their own unlock progress', () => {
    items.set([{ product, quantity: 3 }]); // 300, below the ₹500 free-delivery threshold
    let fixture = create();
    expect(fixture.componentInstance.freeDeliveryNudge()).toBe(
      'Add ₹200.00 more to get FREE delivery',
    );

    items.set([{ product, quantity: 6 }]); // 600, past free delivery
    fixture = create();
    expect(fixture.componentInstance.freeDeliveryNudge()).toBeNull();
  });

  it('couponPickerOpen starts closed and opens on request; the popup reports the pick back', () => {
    items.set([{ product, quantity: 11 }]); // 1100
    const fixture = create();
    expect(fixture.componentInstance.couponPickerOpen()).toBeFalse();

    fixture.componentInstance.couponPickerOpen.set(true);
    expect(fixture.componentInstance.couponPickerOpen()).toBeTrue();

    // The picker component owns eligibility/toggle logic itself (see coupon-picker.spec.ts) -
    // checkout only needs to react to whatever code it reports back.
    fixture.componentInstance.appliedCouponCode.set('SAVE5');
    expect(fixture.componentInstance.discount()).toEqual({ percentage: 5, amount: 55 });
    expect(fixture.componentInstance.grandTotal()).toBe(1045); // 1100 - 55 + 0 (free delivery)
  });

  it('switching the applied coupon code replaces the discount', () => {
    items.set([{ product, quantity: 21 }]); // 2100, clears both minimums
    const fixture = create();

    fixture.componentInstance.appliedCouponCode.set('SAVE5');
    expect(fixture.componentInstance.discount()).toEqual({ percentage: 5, amount: 105 });

    fixture.componentInstance.appliedCouponCode.set('SAVE10');
    expect(fixture.componentInstance.discount()).toEqual({ percentage: 10, amount: 210 });
  });

  it('drops the applied coupon once the cart falls back below its minimum', () => {
    items.set([{ product, quantity: 11 }]); // 1100, clears SAVE5's minimum
    const fixture = create();
    fixture.componentInstance.appliedCouponCode.set('SAVE5');
    fixture.detectChanges();
    expect(fixture.componentInstance.discount()).toEqual({ percentage: 5, amount: 55 });

    items.set([{ product, quantity: 3 }]); // 300, back below ₹1000
    fixture.detectChanges();

    expect(fixture.componentInstance.appliedCouponCode()).toBeNull();
    expect(fixture.componentInstance.discount()).toEqual({ percentage: 0, amount: 0 });
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
    // A brand-new address, whose pincode comes from the form's own pincode field.
    expect(deliveryChargesServiceSpy.previewCharge).toHaveBeenCalledWith(19, 74, null);
  });

  it('placeOrder submits using the selected saved address', () => {
    orderServiceSpy.placeOrder.and.returnValue(of(order));
    const fixture = create();

    fixture.componentInstance.placeOrder();

    expect(orderServiceSpy.placeOrder).toHaveBeenCalledWith(
      jasmine.objectContaining({
        fullName: 'Jane Doe',
        // The selected saved address's own phone, not the account's.
        phone: '9888877766',
        address: '123 Main St, Kharadi, Pune - 411014',
        latitude: 18.5,
        longitude: 73.8,
        couponCode: null,
      }),
    );
    // Stock changed server-side; the cached product list must be refreshed.
    expect(productServiceSpy.loadProducts).toHaveBeenCalled();
  });

  it('placeOrder sends the applied coupon code', () => {
    items.set([{ product, quantity: 11 }]); // 1100, clears SAVE5's minimum
    orderServiceSpy.placeOrder.and.returnValue(of(order));
    const fixture = create();
    fixture.componentInstance.appliedCouponCode.set('SAVE5');

    fixture.componentInstance.placeOrder();

    expect(orderServiceSpy.placeOrder).toHaveBeenCalledWith(
      jasmine.objectContaining({ couponCode: 'SAVE5' }),
    );
  });

  it('placeOrder hands every order off to the hosted payment page, since COD was retired', () => {
    orderServiceSpy.placeOrder.and.returnValue(of(order));
    const fixture = create();

    fixture.componentInstance.placeOrder();

    expect(cashfreeCheckoutServiceSpy.checkout).toHaveBeenCalledWith('session_abc');
    // The redirect takes over from here, so the spinner deliberately stays up.
    expect(fixture.componentInstance.loading()).toBeTrue();
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
      jasmine.objectContaining({ label: 'Office', phone: '9999999999', isDefault: false }),
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

  it('placeOrder surfaces the server message when Cashfree is not configured (503)', () => {
    orderServiceSpy.placeOrder.and.returnValue(
      throwError(() => ({ status: 503, error: { message: 'Online payment is unavailable.' } })),
    );
    const fixture = create();

    fixture.componentInstance.placeOrder();

    expect(fixture.componentInstance.errorMsg()).toBe('Online payment is unavailable.');
  });

  it('keeps the cart while handing off to payment, so a declined card leaves it to retry from', async () => {
    orderServiceSpy.placeOrder.and.returnValue(of(order));
    const fixture = create();

    fixture.componentInstance.placeOrder();
    await fixture.whenStable();

    expect(cashfreeCheckoutServiceSpy.checkout).toHaveBeenCalledWith('session_abc');
    // Emptying the basket here is what used to leave a customer whose payment failed with
    // nothing to try again from. My Orders clears it once the payment is actually confirmed.
    expect(checkoutServiceSpy.clear).not.toHaveBeenCalled();
    expect(cartServiceSpy.removeFromCart).not.toHaveBeenCalled();
  });

  it('tells the customer nothing was charged if the payment page never opens', async () => {
    orderServiceSpy.placeOrder.and.returnValue(of(order));
    cashfreeCheckoutServiceSpy.checkout.and.returnValue(Promise.reject(new Error('sdk failed')));
    const fixture = create();

    fixture.componentInstance.placeOrder();
    await fixture.whenStable();

    expect(fixture.componentInstance.loading()).toBeFalse();
    expect(fixture.componentInstance.errorMsg()).toContain('nothing was charged');
  });

  // ---------- wallet ----------

  // ---------- money never shows more than two decimals ----------

  it('caps the free-delivery nudge at two decimals instead of leaking float noise', () => {
    // 3 x 158.57 = 475.71 in decimal, but 475.70999999999998 in binary floating point, so the
    // shortfall used to render as "Add ₹24.29000000000002 more".
    const odd: Product = { ...product, price: 158.57, discount: 0 };
    items.set([{ product: odd, quantity: 3 }]);
    const fixture = create();

    const nudge = fixture.componentInstance.freeDeliveryNudge();

    expect(nudge).toBe('Add ₹24.29 more to get FREE delivery');
  });

  it('rounds the cart total to the paise rather than carrying float noise into it', () => {
    const odd: Product = { ...product, price: 158.57, discount: 0 };
    items.set([{ product: odd, quantity: 3 }]);
    const fixture = create();

    expect(fixture.componentInstance.totalAmount()).toBe(475.71);
    expect(fixture.componentInstance.grandTotal().toString()).not.toContain('0000');
  });

  it('applies no wallet credit when the balance is empty', () => {
    const fixture = create();

    expect(fixture.componentInstance.walletApplied()).toBe(0);
    expect(fixture.componentInstance.amountDueOnline()).toBe(
      fixture.componentInstance.grandTotal(),
    );
  });

  it('spends only up to the order total, leaving the rest of the balance alone', () => {
    walletBalance.set(1000);
    const fixture = create();

    // Cart is 200 + 20 delivery = 220, well under the balance.
    expect(fixture.componentInstance.grandTotal()).toBe(220);
    expect(fixture.componentInstance.walletApplied()).toBe(220);
    expect(fixture.componentInstance.amountDueOnline()).toBe(0);
  });

  it('covers part of the order and leaves the remainder for the gateway', () => {
    walletBalance.set(100);
    const fixture = create();

    expect(fixture.componentInstance.walletApplied()).toBe(100);
    expect(fixture.componentInstance.amountDueOnline()).toBe(120);
  });

  it('never labels the outstanding figure as the amount the wallet covered', () => {
    // The two are different numbers, and pairing one's label with the other's value produced a
    // summary reading "Covered by wallet  ₹0.00" on an order the wallet had covered in full.
    walletBalance.set(1000);
    const fixture = create();
    fixture.detectChanges();

    const text: string = fixture.nativeElement.textContent;
    expect(fixture.componentInstance.amountDueOnline()).toBe(0);
    expect(text).toContain('To pay online');
    expect(text).not.toContain('Covered by wallet');
    // The amount the wallet actually took is shown on its own row, as a deduction.
    expect(text).toContain('220.00');
  });

  it('unticking the wallet leaves the balance unspent', () => {
    walletBalance.set(1000);
    const fixture = create();

    fixture.componentInstance.useWallet.set(false);

    expect(fixture.componentInstance.walletApplied()).toBe(0);
    expect(fixture.componentInstance.amountDueOnline()).toBe(220);
  });

  it('sends the wallet preference with the order', () => {
    orderServiceSpy.placeOrder.and.returnValue(of(order));
    const fixture = create();
    fixture.componentInstance.useWallet.set(false);

    fixture.componentInstance.placeOrder();

    expect(orderServiceSpy.placeOrder).toHaveBeenCalledWith(
      jasmine.objectContaining({ useWallet: false }),
    );
  });

  it('goes straight to My Orders when the wallet covered the whole total', async () => {
    // No payment session because there was nothing left to charge.
    orderServiceSpy.placeOrder.and.returnValue(
      of({ ...order, paymentMethod: 'Wallet', paymentStatus: 'Paid', paymentSessionId: null }),
    );
    spyOn(router, 'navigate');
    const fixture = create();

    fixture.componentInstance.placeOrder();
    await fixture.whenStable();

    expect(cashfreeCheckoutServiceSpy.checkout).not.toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/my-orders']);
    expect(fixture.componentInstance.errorMsg()).toBe('');
    // Nothing was left to pay, so there is no payment that could still fail - this is the one
    // path where emptying the basket at once is right.
    expect(cartServiceSpy.removeFromCart).toHaveBeenCalledWith('p1');
    expect(checkoutServiceSpy.clear).toHaveBeenCalled();
  });

  it('surfaces a clear error when the order comes back with no payment session at all', async () => {
    orderServiceSpy.placeOrder.and.returnValue(of({ ...order, paymentSessionId: null }));
    const fixture = create();

    fixture.componentInstance.placeOrder();
    await fixture.whenStable();

    expect(cashfreeCheckoutServiceSpy.checkout).not.toHaveBeenCalled();
    expect(fixture.componentInstance.errorMsg()).toContain("couldn't start the payment");
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
