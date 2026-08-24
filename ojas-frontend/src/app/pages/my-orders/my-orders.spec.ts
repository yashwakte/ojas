import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { WalletService } from '../../services/wallet.service';
import { MyOrders } from './my-orders';
import { UserService } from '../../services/user.service';
import { ChatbotUiService } from '../../services/chatbot-ui.service';
import { OrderService } from '../../services/order.service';
import { ProductService } from '../../services/product.service';
import { CashfreeCheckoutService } from '../../services/cashfree-checkout.service';
import { OrderResponse, deliveryEstimate, paymentLabel } from '../../models/interfaces';
import { CartService } from '../../services/cart.service';
import { CheckoutService } from '../../services/checkout.service';

/** Lets the checkout handoff's promise callbacks run. fixture.whenStable() can't be used here:
 * the success snackbar leaves a timer pending, so the zone never reports stable. */
const flushMicrotasks = () => Promise.resolve().then(() => Promise.resolve());

describe('MyOrders', () => {
  let userServiceSpy: jasmine.SpyObj<UserService>;
  let orderServiceSpy: jasmine.SpyObj<OrderService>;
  let productServiceSpy: jasmine.SpyObj<ProductService>;
  let cashfreeCheckoutServiceSpy: jasmine.SpyObj<CashfreeCheckoutService>;
  let walletServiceSpy: jasmine.SpyObj<WalletService>;
  let cartServiceSpy: jasmine.SpyObj<CartService>;
  let checkoutServiceSpy: jasmine.SpyObj<CheckoutService>;

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
    status: 'Confirmed',
    paymentMethod: 'COD',
    paymentStatus: 'Pending',
    amountPaid: 0,
    walletAmountApplied: 0,
    createdAt: '2024-01-01',
  };

  beforeEach(() => {
    userServiceSpy = jasmine.createSpyObj('UserService', ['getMyOrders']);
    orderServiceSpy = jasmine.createSpyObj('OrderService', [
      'getCashfreePaymentStatus',
      'updateMyOrder',
      'cancelMyOrder',
      'discardAmendment',
      'placeOrder',
    ]);
    productServiceSpy = jasmine.createSpyObj('ProductService', ['loadProducts']);
    cashfreeCheckoutServiceSpy = jasmine.createSpyObj('CashfreeCheckoutService', ['checkout']);
    // A handoff that takes navigates the browser away, so the promise never settles. Resolving it
    // instead would model the *failure* path — the component treats "came back" as "the page
    // didn't open" — and fire a snackbar after the fixture is torn down.
    cashfreeCheckoutServiceSpy.checkout.and.returnValue(new Promise<void>(() => {}));
    walletServiceSpy = jasmine.createSpyObj('WalletService', ['load'], { balance: signal(0) });
    walletServiceSpy.load.and.returnValue(of({ balance: 0, transactions: [] }));
    cartServiceSpy = jasmine.createSpyObj('CartService', ['removeFromCart']);
    checkoutServiceSpy = jasmine.createSpyObj('CheckoutService', ['removeItem']);

    TestBed.configureTestingModule({
      imports: [MyOrders],
      providers: [
        provideRouter([]),
        { provide: UserService, useValue: userServiceSpy },
        { provide: OrderService, useValue: orderServiceSpy },
        { provide: ProductService, useValue: productServiceSpy },
        { provide: CashfreeCheckoutService, useValue: cashfreeCheckoutServiceSpy },
        { provide: WalletService, useValue: walletServiceSpy },
        { provide: CartService, useValue: cartServiceSpy },
        { provide: CheckoutService, useValue: checkoutServiceSpy },
      ],
    });
  });

  function create() {
    const fixture = TestBed.createComponent(MyOrders);
    fixture.detectChanges();
    return fixture;
  }

  /** Simulates landing back from Cashfree's hosted checkout via ?cashfreeOrderId=. */
  function createWithQueryParam(cashfreeOrderId: string) {
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: { snapshot: { queryParamMap: convertToParamMap({ cashfreeOrderId }) } },
    });
    return create();
  }

  it('loads orders on init and stops loading', () => {
    userServiceSpy.getMyOrders.and.returnValue(of([order]));
    const fixture = create();
    expect(fixture.componentInstance.orders()).toEqual([order]);
    expect(fixture.componentInstance.loading()).toBeFalse();
    expect(fixture.componentInstance.error()).toBe('');
  });

  it('openChatSupport opens the shared chatbot widget', () => {
    userServiceSpy.getMyOrders.and.returnValue(of([]));
    const fixture = create();
    const chatbotUi = TestBed.inject(ChatbotUiService);
    spyOn(chatbotUi, 'openChat');

    fixture.componentInstance.openChatSupport();

    expect(chatbotUi.openChat).toHaveBeenCalled();
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

  it('leaves the payment banner untouched when there is no ?cashfreeOrderId', () => {
    userServiceSpy.getMyOrders.and.returnValue(of([order]));
    const fixture = create();

    expect(fixture.componentInstance.cashfreePaymentStatus()).toBeNull();
    expect(orderServiceSpy.getCashfreePaymentStatus).not.toHaveBeenCalled();
  });

  it('asks the gateway directly on return, rather than waiting for the webhook to reach our database', () => {
    userServiceSpy.getMyOrders.and.returnValue(of([order]));
    orderServiceSpy.getCashfreePaymentStatus.and.returnValue(
      of({ paymentStatus: 'Paid', paymentInstrument: 'upi' }),
    );

    const fixture = createWithQueryParam('o1');

    expect(orderServiceSpy.getCashfreePaymentStatus).toHaveBeenCalledWith('o1');
    // Settled on the first call - no refresh, and no waiting out a poll loop.
    expect(fixture.componentInstance.cashfreePaymentStatus()).toBe('paid');
  });

  it('reflects the gateway verdict on the order card, so the payment pill updates in place', () => {
    userServiceSpy.getMyOrders.and.returnValue(of([{ ...order, paymentMethod: 'Cashfree' }]));
    orderServiceSpy.getCashfreePaymentStatus.and.returnValue(
      of({ paymentStatus: 'Paid', paymentInstrument: 'upi' }),
    );

    const fixture = createWithQueryParam('o1');

    const updated = fixture.componentInstance.orders()[0];
    expect(updated.paymentStatus).toBe('Paid');
    expect(updated.paymentInstrument).toBe('upi');
    expect(paymentLabel(updated)).toBe('Paid via UPI');
  });

  // The order list is fetched the instant the customer lands back from checkout — before the
  // payment has been recorded — so what the confirmation puts on screen has to be the whole
  // order, not a status patched onto that pre-payment copy.
  describe('after a payment is confirmed', () => {
    const unpaid: OrderResponse = {
      ...order,
      paymentMethod: 'Cashfree',
      paymentStatus: 'Pending',
      totalAmount: 780,
      amountPaid: 0,
      items: [
        { productId: 'p1', productName: 'Bajra Flour', price: 130, weight: '1kg', quantity: 6 },
      ],
    };
    const settled: OrderResponse = {
      ...unpaid,
      paymentStatus: 'Paid',
      paymentInstrument: 'upi',
      amountPaid: 780,
    };

    function landBackFromCheckout() {
      userServiceSpy.getMyOrders.and.returnValue(of([unpaid]));
      orderServiceSpy.getCashfreePaymentStatus.and.returnValue(
        of({ paymentStatus: 'Paid', paymentInstrument: 'upi', order: settled }),
      );
      return createWithQueryParam('o1');
    }

    it('shows the money as paid without needing a page refresh', () => {
      const fixture = landBackFromCheckout();

      expect(fixture.componentInstance.orders()[0].amountPaid).toBe(780);
      expect(fixture.componentInstance.orders()[0].paymentStatus).toBe('Paid');
    });

    it('prices an edit against what was just paid, not against zero', () => {
      const fixture = landBackFromCheckout();

      // Editing straight after paying used to read amountPaid as 0 and demand the whole total
      // again from someone who had just paid it.
      fixture.componentInstance.startEdit(fixture.componentInstance.orders()[0]);

      expect(fixture.componentInstance.originalAmountPaid()).toBe(780);
      expect(fixture.componentInstance.amountDifference()).toBe(0);
    });

    it('promises delivery on the freshly paid order', () => {
      const fixture = landBackFromCheckout();

      // Gated on the order having been paid for, so a stale zero silently hid this.
      expect(deliveryEstimate(fixture.componentInstance.orders()[0])).not.toBeNull();
    });
  });

  // ---------- a payment the bank is still deciding on ----------

  describe('when a payment is left pending', () => {
    /** Paid in full for what it holds, with an unpaid edit riding on top — the exact shape in
     * which a pending top-up used to be announced as a success. */
    const withPendingTopUp: OrderResponse = {
      ...order,
      paymentMethod: 'Cashfree',
      paymentStatus: 'Paid',
      paymentInstrument: 'upi',
      totalAmount: 832.4,
      amountPaid: 832.4,
      pendingAmendment: {
        items: [
          { productId: 'p1', productName: 'Ragi Malt', price: 119, weight: '500g', quantity: 2 },
        ],
        subtotal: 238,
        discountAmount: 0,
        deliveryCharge: 0,
        totalAmount: 951.4,
        topUpAmount: 119,
        paymentSessionId: 'session_topup',
        expiresAt: '2099-01-01T00:00:00Z',
      },
    };

    function landBackOnAPendingPayment() {
      userServiceSpy.getMyOrders.and.returnValue(of([withPendingTopUp]));
      orderServiceSpy.getCashfreePaymentStatus.and.returnValue(
        // The order is square for what it holds, but the attempt itself has not settled.
        of({ paymentStatus: 'Paid', paymentInstrument: 'upi', outcome: 'Pending' as const }),
      );
      return createWithQueryParam('o1');
    }

    it('does not claim success just because the order is square for what it holds', () => {
      const fixture = landBackOnAPendingPayment();

      expect(fixture.componentInstance.cashfreePaymentStatus()).not.toBe('paid');
    });

    it('withholds every route to paying again, so the same change is not paid for twice', () => {
      const fixture = landBackOnAPendingPayment();

      expect(fixture.componentInstance.paymentInFlightFor('o1')).toBeTrue();

      fixture.componentInstance.payForAmendment(withPendingTopUp);
      fixture.componentInstance.retryPayment(withPendingTopUp);

      expect(cashfreeCheckoutServiceSpy.checkout).not.toHaveBeenCalled();
      expect(orderServiceSpy.placeOrder).not.toHaveBeenCalled();
    });

    it('leaves the basket alone, since nothing has actually been bought yet', () => {
      landBackOnAPendingPayment();

      expect(cartServiceSpy.removeFromCart).not.toHaveBeenCalled();
    });

    it('offers paying again only once the gateway has settled it', () => {
      userServiceSpy.getMyOrders.and.returnValue(of([withPendingTopUp]));
      orderServiceSpy.getCashfreePaymentStatus.and.returnValue(
        of({ paymentStatus: 'Paid', paymentInstrument: 'upi', outcome: 'Discarded' as const }),
      );
      const fixture = createWithQueryParam('o1');

      expect(fixture.componentInstance.paymentInFlightFor('o1')).toBeFalse();
    });
  });

  it('settles the payment banner to "failed" when the gateway reports a failed payment', () => {
    userServiceSpy.getMyOrders.and.returnValue(of([order]));
    orderServiceSpy.getCashfreePaymentStatus.and.returnValue(of({ paymentStatus: 'Failed' }));

    const fixture = createWithQueryParam('o1');

    expect(fixture.componentInstance.cashfreePaymentStatus()).toBe('failed');
  });

  it('says a payment is pending straight away, rather than spinning silently', () => {
    userServiceSpy.getMyOrders.and.returnValue(of([order]));
    orderServiceSpy.getCashfreePaymentStatus.and.returnValue(
      of({ paymentStatus: 'Pending', outcome: 'Pending' as const }),
    );

    const fixture = createWithQueryParam('o1');

    expect(fixture.componentInstance.cashfreePaymentStatus()).toBe('pending');
  });

  it('keeps asking until a pending payment settles, so nobody has to refresh', () => {
    jasmine.clock().install();
    try {
      userServiceSpy.getMyOrders.and.returnValue(of([order]));
      orderServiceSpy.getCashfreePaymentStatus.and.returnValue(
        of({ paymentStatus: 'Pending', outcome: 'Pending' as const }),
      );
      const fixture = createWithQueryParam('o1');
      const callsWhilePending = orderServiceSpy.getCashfreePaymentStatus.calls.count();

      // Well past the point the old code gave up at, which is where the customer was left with
      // a stale page and no way to move it on but a manual reload.
      for (let i = 0; i < 12; i++) jasmine.clock().tick(6000);

      expect(orderServiceSpy.getCashfreePaymentStatus.calls.count()).toBeGreaterThan(
        callsWhilePending,
      );
      expect(fixture.componentInstance.cashfreePaymentStatus()).toBe('pending');
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('picks up the answer on its own once the bank settles a pending payment', () => {
    jasmine.clock().install();
    try {
      const settled: OrderResponse = {
        ...order,
        paymentMethod: 'Cashfree',
        paymentStatus: 'Paid',
        amountPaid: 100,
      };
      userServiceSpy.getMyOrders.and.returnValue(of([order]));
      orderServiceSpy.getCashfreePaymentStatus.and.returnValue(
        of({ paymentStatus: 'Pending', outcome: 'Pending' as const }),
      );
      const fixture = createWithQueryParam('o1');
      expect(fixture.componentInstance.cashfreePaymentStatus()).toBe('pending');

      // The bank makes up its mind while the customer is still sitting on the page.
      orderServiceSpy.getCashfreePaymentStatus.and.returnValue(
        of({ paymentStatus: 'Paid', outcome: 'Paid' as const, order: settled }),
      );
      jasmine.clock().tick(6000);

      expect(fixture.componentInstance.cashfreePaymentStatus()).toBe('paid');
      expect(fixture.componentInstance.orders()[0].amountPaid).toBe(100);
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('stops asking once the page is left, rather than polling into a dead component', () => {
    jasmine.clock().install();
    try {
      userServiceSpy.getMyOrders.and.returnValue(of([order]));
      orderServiceSpy.getCashfreePaymentStatus.and.returnValue(
        of({ paymentStatus: 'Pending', outcome: 'Pending' as const }),
      );
      const fixture = createWithQueryParam('o1');

      fixture.destroy();
      const afterDestroy = orderServiceSpy.getCashfreePaymentStatus.calls.count();
      jasmine.clock().tick(60000);

      expect(orderServiceSpy.getCashfreePaymentStatus.calls.count()).toBe(afterDestroy);
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('dismissCashfreeBanner clears the pending order id and status', () => {
    userServiceSpy.getMyOrders.and.returnValue(of([order]));
    orderServiceSpy.getCashfreePaymentStatus.and.returnValue(of({ paymentStatus: 'Paid' }));
    const fixture = createWithQueryParam('o1');

    fixture.componentInstance.dismissCashfreeBanner();

    expect(fixture.componentInstance.pendingCashfreeOrderId()).toBeNull();
    expect(fixture.componentInstance.cashfreePaymentStatus()).toBeNull();
  });

  // ---------- edit repricing ----------

  /** 12 x ₹100 = ₹1200, which clears SAVE5's ₹1000 minimum. */
  const couponOrder: OrderResponse = {
    ...order,
    couponCode: 'SAVE5',
    subtotal: 1200,
    totalAmount: 1140,
    amountPaid: 1140,
    paymentMethod: 'Cashfree',
    paymentStatus: 'Paid',
    items: [
      { productId: 'p1', productName: 'Product One', price: 100, weight: '1kg', quantity: 12 },
    ],
  };

  function startEditing(o: OrderResponse) {
    userServiceSpy.getMyOrders.and.returnValue(of([o]));
    const fixture = create();
    fixture.componentInstance.startEdit(o);
    return fixture;
  }

  it('keeps a still-valid coupon applied while editing', () => {
    const fixture = startEditing(couponOrder);

    expect(fixture.componentInstance.editCoupon()?.code).toBe('SAVE5');
    expect(fixture.componentInstance.editDiscount().amount).toBe(60);
    expect(fixture.componentInstance.editRemovedCoupon()).toBeNull();
  });

  // An edit only ever adds. Taking things off a placed order was the one way an edit could owe
  // money back, and it is now refused — the minus button stops at what the order already holds.
  it('will not take a quantity below what the order already holds', () => {
    const fixture = startEditing(couponOrder);

    fixture.componentInstance.changeQty(0, -3);

    expect(fixture.componentInstance.editItems()[0].quantity).toBe(12);
    expect(fixture.componentInstance.originalQuantityOf('p1')).toBe(12);
  });

  it('lets a line the customer just added be taken back off again', () => {
    const fixture = startEditing(couponOrder);
    // Nothing of this product was ordered, so there is nothing bought to protect.
    fixture.componentInstance.editItems.update((items) => [
      ...items,
      { productId: 'p2', productName: 'Jowar Flour', price: 50, weight: '1kg', quantity: 1 },
    ]);

    fixture.componentInstance.changeQty(1, -1);

    expect(fixture.componentInstance.editItems().length).toBe(1);
    expect(fixture.componentInstance.editItems()[0].productId).toBe('p1');
  });

  it('keeps delivery free as an edit adds to a cart already over the threshold', () => {
    const fixture = startEditing(couponOrder);
    fixture.componentInstance.editDeliveryQuote.set(40);

    expect(fixture.componentInstance.editDeliveryCharge()).toBe(0);

    fixture.componentInstance.changeQty(0, 3);

    // Adding can only ever keep it over the line, never bring it back under.
    expect(fixture.componentInstance.editDeliveryCharge()).toBe(0);
  });

  it('measures the difference against what was actually paid, not the order total', () => {
    const fixture = startEditing(couponOrder);
    fixture.componentInstance.editDeliveryQuote.set(0);

    // Up to 15 x ₹100 = ₹1500, 5% off = ₹1425 against ₹1140 already paid.
    fixture.componentInstance.changeQty(0, 3);

    expect(fixture.componentInstance.amountDifference()).toBe(285);
  });

  it('sends the coupon code on save, so the server cannot read the omission as "no coupon"', () => {
    orderServiceSpy.updateMyOrder.and.returnValue(
      of({
        order: couponOrder,
        topUpAmount: null,
        paymentSessionId: null,
        refundAmount: null,
        removedCouponCode: null,
      }),
    );
    const fixture = startEditing(couponOrder);

    fixture.componentInstance.saveEdit(couponOrder);

    expect(orderServiceSpy.updateMyOrder).toHaveBeenCalledWith(
      'o1',
      jasmine.objectContaining({ couponCode: 'SAVE5' }),
    );
  });

  it('hands off to the payment page when an edit leaves a balance owing', async () => {
    orderServiceSpy.updateMyOrder.and.returnValue(
      of({
        order: couponOrder,
        topUpAmount: 285,
        paymentSessionId: 'session_topup',
        refundAmount: null,
        removedCouponCode: null,
        pendingPayment: true,
      }),
    );
    const fixture = startEditing(couponOrder);

    fixture.componentInstance.saveEdit(couponOrder);
    await flushMicrotasks();

    expect(cashfreeCheckoutServiceSpy.checkout).toHaveBeenCalledWith('session_topup');
  });

  // ---------- changes that were never paid for ----------

  /** An order with an edit priced but not paid for. The order's own fields still describe what
   * was actually bought — that separation is the fix for the customer who backed out of the
   * payment page and found their order silently changed anyway. */
  const orderWithAmendment: OrderResponse = {
    ...order,
    paymentMethod: 'Cashfree',
    paymentStatus: 'Paid',
    totalAmount: 600,
    amountPaid: 600,
    items: [{ productId: 'p1', productName: 'Bajra Flour', price: 100, weight: '1kg', quantity: 6 }],
    pendingAmendment: {
      items: [
        { productId: 'p1', productName: 'Bajra Flour', price: 100, weight: '1kg', quantity: 9 },
      ],
      subtotal: 900,
      discountAmount: 0,
      deliveryCharge: 0,
      totalAmount: 900,
      topUpAmount: 300,
      paymentSessionId: 'session_topup',
      expiresAt: '2099-01-01T00:00:00Z',
    },
  };

  it('reuses the existing session to pay for changes rather than making the customer re-edit', () => {
    userServiceSpy.getMyOrders.and.returnValue(of([orderWithAmendment]));
    const fixture = create();

    fixture.componentInstance.payForAmendment(orderWithAmendment);

    expect(cashfreeCheckoutServiceSpy.checkout).toHaveBeenCalledWith('session_topup');
  });

  it('drops unpaid changes and puts the untouched order back on screen', () => {
    userServiceSpy.getMyOrders.and.returnValue(of([orderWithAmendment]));
    const restored: OrderResponse = { ...orderWithAmendment, pendingAmendment: null };
    orderServiceSpy.discardAmendment.and.returnValue(of(restored));
    const fixture = create();

    fixture.componentInstance.discardAmendment(orderWithAmendment);

    expect(orderServiceSpy.discardAmendment).toHaveBeenCalledWith('o1');
    expect(fixture.componentInstance.orders()[0].pendingAmendment).toBeNull();
    expect(fixture.componentInstance.discardingAmendmentId()).toBeNull();
  });

  it('resumes an unpaid edit from where it left off rather than from the untouched order', () => {
    userServiceSpy.getMyOrders.and.returnValue(of([orderWithAmendment]));
    const fixture = create();

    fixture.componentInstance.startEdit(orderWithAmendment);

    expect(fixture.componentInstance.editItems()[0].quantity).toBe(9);
    // Still priced against what was actually paid, so the ask stays honest.
    expect(fixture.componentInstance.originalAmountPaid()).toBe(600);
  });

  it('says plainly that abandoned changes were dropped, instead of asking for a refresh', () => {
    userServiceSpy.getMyOrders.and.returnValue(of([order]));
    orderServiceSpy.getCashfreePaymentStatus.and.returnValue(
      of({ paymentStatus: 'Paid', paymentInstrument: 'upi', amendmentDiscarded: true }),
    );
    const fixture = createWithQueryParam('o1');

    expect(fixture.componentInstance.cashfreePaymentStatus()).toBe('discarded');
  });

  // ---------- money never shows more than two decimals ----------

  it('caps the edit screen free-delivery nudge at two decimals', () => {
    // 3 x 158.57 sums to 475.70999999999998 in binary floating point, which used to reach the
    // customer verbatim: "Add ₹24.29000000000002 more to get FREE delivery".
    const oddPriced: OrderResponse = {
      ...order,
      items: [
        { productId: 'p1', productName: 'Bajra Flour', price: 158.57, weight: '1kg', quantity: 3 },
      ],
    };
    userServiceSpy.getMyOrders.and.returnValue(of([oddPriced]));
    const fixture = create();

    fixture.componentInstance.startEdit(oddPriced);
    fixture.componentInstance.editDeliveryQuote.set(0);

    expect(fixture.componentInstance.editFreeDeliveryNudge()).toBe(
      'Add ₹24.29 more to get FREE delivery',
    );
    expect(fixture.componentInstance.editItemsTotal()).toBe(475.71);
  });

  it('reports no change to pay when the edited total matches what was paid', () => {
    const oddPaid: OrderResponse = {
      ...order,
      paymentMethod: 'Cashfree',
      paymentStatus: 'Paid',
      totalAmount: 475.71,
      amountPaid: 475.71,
      items: [
        { productId: 'p1', productName: 'Bajra Flour', price: 158.57, weight: '1kg', quantity: 3 },
      ],
    };
    userServiceSpy.getMyOrders.and.returnValue(of([oddPaid]));
    const fixture = create();

    fixture.componentInstance.startEdit(oddPaid);
    fixture.componentInstance.editDeliveryQuote.set(0);

    // Unrounded this lands on a value like 5.7e-14, which is enough to read as "you owe more"
    // and ask the customer to pay for a change they didn't make.
    expect(fixture.componentInstance.amountDifference()).toBe(0);
  });

  // ---------- cancellation refund destination ----------

  const paidOrder: OrderResponse = {
    ...order,
    paymentMethod: 'Cashfree',
    paymentStatus: 'Paid',
    amountPaid: 600,
    totalAmount: 600,
  };

  it('defaults the refund destination to the wallet, which is the instant option', () => {
    userServiceSpy.getMyOrders.and.returnValue(of([paidOrder]));
    const fixture = create();

    fixture.componentInstance.askCancel(paidOrder.id);

    expect(fixture.componentInstance.cancelRefundDestination()).toBe('wallet');
  });

  it('sends the chosen refund destination when cancelling', () => {
    userServiceSpy.getMyOrders.and.returnValue(of([paidOrder]));
    orderServiceSpy.cancelMyOrder.and.returnValue(
      of({ walletCredited: 0, sourceRefundQueued: 600 }),
    );
    const fixture = create();

    fixture.componentInstance.askCancel(paidOrder.id);
    fixture.componentInstance.cancelRefundDestination.set('source');
    fixture.componentInstance.confirmCancel(paidOrder);

    expect(orderServiceSpy.cancelMyOrder).toHaveBeenCalledWith('o1', 'source');
  });

  it('reloads the wallet after a cancellation credited it', () => {
    userServiceSpy.getMyOrders.and.returnValue(of([paidOrder]));
    orderServiceSpy.cancelMyOrder.and.returnValue(
      of({
        walletCredited: 600,
        sourceRefundQueued: 0,
        order: { ...paidOrder, status: 'Cancelled', paymentStatus: 'Paid', amountPaid: 0 },
      }),
    );
    const fixture = create();

    fixture.componentInstance.confirmCancel(paidOrder);

    expect(walletServiceSpy.load).toHaveBeenCalled();
    expect(fixture.componentInstance.orders()[0].status).toBe('Cancelled');
  });

  // The reported bug: cancelling set only `status` locally, so everything else on the card kept
  // rendering from the pre-cancellation copy — including the pending edit and its Pay button.
  it('clears a pending edit from the card when the order is cancelled', () => {
    const withPendingEdit: OrderResponse = {
      ...paidOrder,
      pendingAmendment: {
        items: [],
        subtotal: 0,
        discountAmount: 0,
        deliveryCharge: 0,
        totalAmount: 700,
        topUpAmount: 100,
        paymentSessionId: 'session_topup',
        expiresAt: '2099-01-01T00:00:00Z',
      },
    };
    userServiceSpy.getMyOrders.and.returnValue(of([withPendingEdit]));
    orderServiceSpy.cancelMyOrder.and.returnValue(
      of({
        walletCredited: 600,
        sourceRefundQueued: 0,
        // What the server actually does: the edit is discarded along with the order.
        order: { ...paidOrder, status: 'Cancelled', pendingAmendment: null },
      }),
    );
    const fixture = create();

    fixture.componentInstance.confirmCancel(withPendingEdit);

    const shown = fixture.componentInstance.orders()[0];
    expect(shown.status).toBe('Cancelled');
    expect(shown.pendingAmendment).toBeNull();
    expect(fixture.componentInstance.canModify(shown)).toBeFalse();
  });

  it('stops watching a payment for an order that has just been cancelled', () => {
    userServiceSpy.getMyOrders.and.returnValue(of([paidOrder]));
    orderServiceSpy.getCashfreePaymentStatus.and.returnValue(
      of({ paymentStatus: 'Pending', outcome: 'Pending' as const }),
    );
    orderServiceSpy.cancelMyOrder.and.returnValue(
      of({
        walletCredited: 600,
        sourceRefundQueued: 0,
        order: { ...paidOrder, status: 'Cancelled' },
      }),
    );
    const fixture = createWithQueryParam('o1');
    expect(fixture.componentInstance.cashfreePaymentStatus()).toBe('pending');

    fixture.componentInstance.confirmCancel(paidOrder);

    // A cancelled order can't take that payment, so the banner goes rather than lingering.
    expect(fixture.componentInstance.cashfreePaymentStatus()).toBeNull();
  });

  it('does not open a payment page when an edit only owes the customer a refund', async () => {
    orderServiceSpy.updateMyOrder.and.returnValue(
      of({
        order: couponOrder,
        topUpAmount: null,
        paymentSessionId: null,
        refundAmount: 200,
        removedCouponCode: null,
      }),
    );
    const fixture = startEditing(couponOrder);

    fixture.componentInstance.saveEdit(couponOrder);
    await flushMicrotasks();

    expect(cashfreeCheckoutServiceSpy.checkout).not.toHaveBeenCalled();
  });
  // ---------- a payment that never went through ----------

  const failedOrder: OrderResponse = {
    ...order,
    paymentMethod: 'Cashfree',
    status: 'Cancelled',
    paymentStatus: 'Failed',
    paymentFailureReason: 'Your card was declined by the issuing bank',
    items: [{ productId: 'p1', productName: 'Bajra Flour', price: 100, weight: '1kg', quantity: 6 }],
  };

  it('offers no edit or cancel on an order whose payment failed — there is nothing to change', () => {
    userServiceSpy.getMyOrders.and.returnValue(of([failedOrder]));
    const fixture = create();

    expect(fixture.componentInstance.canModify(failedOrder)).toBeFalse();
    expect(fixture.componentInstance.isPaymentFailed(failedOrder)).toBeTrue();
  });

  it('re-places the same items and goes straight to payment when retrying a failed order', () => {
    userServiceSpy.getMyOrders.and.returnValue(of([failedOrder]));
    orderServiceSpy.placeOrder.and.returnValue(
      of({ ...failedOrder, id: 'o2', paymentSessionId: 'session_retry' }),
    );
    const fixture = create();

    fixture.componentInstance.retryPayment(failedOrder);

    expect(orderServiceSpy.placeOrder).toHaveBeenCalledWith(
      jasmine.objectContaining({
        phone: failedOrder.phone,
        address: failedOrder.address,
        items: failedOrder.items,
        useWallet: true,
        // Names the attempt being replaced, so it stops showing once this one exists.
        retryOfOrderId: 'o1',
      }),
    );
    // Straight to the payment page — no detour through the cart and checkout again.
    expect(cashfreeCheckoutServiceSpy.checkout).toHaveBeenCalledWith('session_retry');
    expect(fixture.componentInstance.retryingPaymentId()).toBeNull();
  });

  it('says why a retry could not be placed instead of failing silently', () => {
    userServiceSpy.getMyOrders.and.returnValue(of([failedOrder]));
    orderServiceSpy.placeOrder.and.returnValue(
      throwError(() => ({ error: { outOfStock: true, message: 'Bajra Flour just went out of stock.' } })),
    );
    const fixture = create();

    fixture.componentInstance.retryPayment(failedOrder);

    expect(cashfreeCheckoutServiceSpy.checkout).not.toHaveBeenCalled();
    expect(fixture.componentInstance.retryingPaymentId()).toBeNull();
  });

  it("reports the gateway's own reason rather than guessing at the bank", () => {
    userServiceSpy.getMyOrders.and.returnValue(of([order]));
    orderServiceSpy.getCashfreePaymentStatus.and.returnValue(
      of({
        paymentStatus: 'Failed',
        paymentFailureReason: 'Insufficient funds in the account',
      }),
    );
    const fixture = createWithQueryParam('o1');

    expect(fixture.componentInstance.cashfreePaymentStatus()).toBe('failed');
    expect(fixture.componentInstance.paymentFailureReason()).toBe(
      'Insufficient funds in the account',
    );
  });

  it('leaves the cart alone when a payment fails, so the customer can retry from it', () => {
    userServiceSpy.getMyOrders.and.returnValue(of([failedOrder]));
    orderServiceSpy.getCashfreePaymentStatus.and.returnValue(
      of({ paymentStatus: 'Failed', paymentFailureReason: 'Card declined' }),
    );
    createWithQueryParam('o1');

    expect(cartServiceSpy.removeFromCart).not.toHaveBeenCalled();
    expect(checkoutServiceSpy.removeItem).not.toHaveBeenCalled();
  });

  it('empties what was bought out of the cart once the payment is confirmed', () => {
    const paidUp: OrderResponse = { ...failedOrder, status: 'Confirmed', paymentStatus: 'Paid' };
    userServiceSpy.getMyOrders.and.returnValue(of([paidUp]));
    orderServiceSpy.getCashfreePaymentStatus.and.returnValue(
      of({ paymentStatus: 'Paid', paymentInstrument: 'upi' }),
    );
    createWithQueryParam('o1');

    expect(cartServiceSpy.removeFromCart).toHaveBeenCalledWith('p1');
    expect(checkoutServiceSpy.removeItem).toHaveBeenCalledWith('p1');
  });

  it('lists orders strictly newest first, without burying finished ones at the bottom', () => {
    const at = (id: string, createdAt: string, status = 'Confirmed'): OrderResponse => ({
      ...order,
      id,
      createdAt,
      status,
    });
    userServiceSpy.getMyOrders.and.returnValue(
      of([
        at('older', '2026-08-20T10:00:00Z'),
        // Finished, but the most recent thing that happened — so it belongs at the top.
        at('newest', '2026-08-23T10:00:00Z', 'Cancelled'),
        at('middle', '2026-08-22T10:00:00Z', 'Delivered'),
      ]),
    );
    const fixture = create();

    expect(fixture.componentInstance.sortedOrders().map((o) => o.id)).toEqual([
      'newest',
      'middle',
      'older',
    ]);
  });

  // ---------- delivery estimate ----------

  const paidToday: OrderResponse = {
    ...order,
    paymentMethod: 'Cashfree',
    paymentStatus: 'Paid',
    amountPaid: 600,
    status: 'Confirmed',
    createdAt: '2026-08-23T10:00:00Z',
  };

  // Placed on the 23rd, so the window runs the 24th through the 25th. The estimate narrows on
  // its own as that window closes rather than repeating one figure until it goes stale.
  it('promises 1-2 days on the day the order is placed, naming the outer date', () => {
    const estimate = deliveryEstimate(paidToday, new Date('2026-08-23T12:00:00'));

    expect(estimate).toEqual({ label: 'Arriving in 1–2 days, by Tue, 25 Aug', delayed: false });
  });

  it('narrows to "today or tomorrow" on the first day of the window', () => {
    const estimate = deliveryEstimate(paidToday, new Date('2026-08-24T09:00:00'));

    expect(estimate?.label).toBe('Arriving today or tomorrow');
    expect(estimate?.delayed).toBeFalse();
  });

  it('narrows to "today" on the last day of the window', () => {
    const estimate = deliveryEstimate(paidToday, new Date('2026-08-25T09:00:00'));

    expect(estimate?.label).toBe('Arriving today');
    expect(estimate?.delayed).toBeFalse();
  });

  it('owns up to a delay once the whole window has gone by', () => {
    const estimate = deliveryEstimate(paidToday, new Date('2026-08-26T09:00:00'));

    expect(estimate?.delayed).toBeTrue();
    expect(estimate?.label).toContain('1–2 days');
  });

  it('promises nothing for an order that is finished, cancelled or unpaid', () => {
    const now = new Date('2026-08-23T12:00:00');

    expect(deliveryEstimate({ ...paidToday, status: 'Delivered' }, now)).toBeNull();
    expect(deliveryEstimate({ ...paidToday, status: 'Cancelled' }, now)).toBeNull();
    expect(deliveryEstimate(failedOrder, now)).toBeNull();
    // Awaiting its first payment: there is no sale yet, so nothing to promise.
    expect(deliveryEstimate({ ...paidToday, amountPaid: 0, paymentStatus: 'Pending' }, now))
      .toBeNull();
  });
});
