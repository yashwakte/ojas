import { Component, OnDestroy, OnInit, inject, signal, computed } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DatePipe, CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar } from '@angular/material/snack-bar';
import { UserService } from '../../services/user.service';
import { OrderService } from '../../services/order.service';
import { ProductService } from '../../services/product.service';
import { DeliveryChargesService } from '../../services/delivery-charges.service';
import { OrderEditDraftService } from '../../services/order-edit-draft.service';
import { ChatbotUiService } from '../../services/chatbot-ui.service';
import { MapPicker } from '../../components/map-picker/map-picker';
import {
  CancelOrderResponse,
  CashfreePaymentStatusResponse,
  OrderItem,
  OrderResponse,
  PaymentAttemptOutcome,
  RefundDestination,
  amountOutstanding,
  canPayOnline,
  deliveryEstimate,
  isOrderEditable,
  isPaymentFailed,
  paymentIcon,
  paymentLabel,
} from '../../models/interfaces';
import { CartService } from '../../services/cart.service';
import { CheckoutService } from '../../services/checkout.service';
import { WalletService } from '../../services/wallet.service';
import {
  COUPONS,
  Coupon,
  FREE_DELIVERY_CART_THRESHOLD,
  calculateCouponDiscount,
  qualifiesForFreeDelivery,
  roundMoney,
} from '../../constants/pricing';
import { CashfreeCheckoutService } from '../../services/cashfree-checkout.service';

/** Most payments answer on the very first call. These only matter for one the bank is still
 * deciding on — a UPI collect awaiting approval — which is exactly the case where telling the
 * customer to refresh is worst, because they have no idea when to. So the page keeps asking:
 * briskly at first, then at a slower cadence for a few minutes, and it updates itself the moment
 * the answer changes. */
const FAST_CONFIRM_ATTEMPTS = 8;
const FAST_CONFIRM_RETRY_MS = 2000;
const SLOW_CONFIRM_RETRY_MS = 6000;
/** ~16s brisk + ~4min slow. Past that a bank has almost certainly not just been slow, and the
 * webhook is the backstop for whenever it does land. */
const MAX_PAYMENT_CONFIRM_ATTEMPTS = 48;

@Component({
  selector: 'app-my-orders',
  imports: [
    RouterLink,
    DatePipe,
    CurrencyPipe,
    FormsModule,
    MatIconModule,
    MatButtonModule,
    MapPicker,
  ],
  templateUrl: './my-orders.html',
  styleUrl: './my-orders.scss',
})
export class MyOrders implements OnInit, OnDestroy {
  private readonly userService = inject(UserService);
  private readonly orderService = inject(OrderService);
  private readonly productService = inject(ProductService);
  private readonly deliveryCharges = inject(DeliveryChargesService);
  private readonly orderEditDraft = inject(OrderEditDraftService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly snackBar = inject(MatSnackBar);
  private readonly chatbotUi = inject(ChatbotUiService);
  private readonly cashfreeCheckout = inject(CashfreeCheckoutService);
  private readonly cartService = inject(CartService);
  private readonly checkoutService = inject(CheckoutService);
  readonly wallet = inject(WalletService);

  orders = signal<OrderResponse[]>([]);
  loading = signal(true);
  error = signal('');

  /** Id of the order currently open for editing, if any. */
  editingId = signal<string | null>(null);
  editItems = signal<OrderItem[]>([]);
  editPhone = '';
  editNotes = '';
  editAddress = '';
  editLat: number | null = null;
  editLng: number | null = null;
  showEditMap = signal(false);
  saving = signal(false);
  editError = signal('');

  /** What the order already holds, per product. An edit may add to these but never go under
   * them — the floor the minus button stops at, mirroring what the server enforces. */
  private originalQuantities = new Map<string, number>();

  /** Total of the order as it stands on the server, to price the change against. */
  originalTotal = signal(0);
  /** What was actually captured — money that really arrived, shown to the customer as such. */
  originalAmountPaid = signal(0);

  /** What an offer on the gateway's own payment page knocked off. The customer was charged this
   * much less and owes nothing further for it, so it counts towards settling the order even
   * though no money changed hands. Shown as its own line so the arithmetic on screen adds up. */
  originalGatewayDiscount = signal(0);

  /**
   * What the order is already settled for: money received plus anything the gateway discounted.
   *
   * This — not the captured figure — is what an edit is priced against. Measuring against money
   * received alone demanded the offer back: an order paid in full with a ₹200 discount showed
   * "You'll pay ₹200.00 more online to confirm these changes" the moment it was opened for
   * editing, before the customer had changed a single thing.
   */
  readonly originalSettledAmount = computed(() =>
    roundMoney(this.originalAmountPaid() + this.originalGatewayDiscount()),
  );
  /** The distance-based quote for the pinned location, before the free-delivery rule. */
  editDeliveryQuote = signal(0);
  quotingDelivery = signal(false);
  /** The coupon on the order being edited, re-validated against every change below. */
  editCouponCode = signal<string | null>(null);

  editItemsTotal = computed(() =>
    roundMoney(this.editItems().reduce((sum, i) => sum + i.price * i.quantity, 0)),
  );

  /** The coupon only if the edited cart still clears its minimum — mirrors the server, which is
   * the authority. Null once an edit drops the cart under that minimum. */
  readonly editCoupon = computed<Coupon | null>(() => {
    const code = this.editCouponCode();
    const coupon = COUPONS.find((c) => c.code === code) ?? null;
    return coupon && this.editItemsTotal() >= coupon.minCartValue ? coupon : null;
  });

  /** Set when the edit has invalidated the coupon the order was placed with, so the customer is
   * warned rather than left to notice the total moving on its own. */
  readonly editRemovedCoupon = computed<Coupon | null>(() => {
    const code = this.editCouponCode();
    if (!code || this.editCoupon()) return null;
    return COUPONS.find((c) => c.code === code) ?? null;
  });

  readonly editDiscount = computed(() =>
    calculateCouponDiscount(this.editCoupon(), this.editItemsTotal()),
  );

  /** Re-evaluated on every change, so dropping back under the free-delivery threshold starts
   * showing a delivery charge again instead of stale "Free". */
  readonly editDeliveryCharge = computed(() =>
    qualifiesForFreeDelivery(this.editItemsTotal()) ? 0 : this.editDeliveryQuote(),
  );

  /** What the order will total once saved. */
  newTotal = computed(() =>
    roundMoney(this.editItemsTotal() - this.editDiscount().amount + this.editDeliveryCharge()),
  );

  /** Positive = customer owes more and must pay it online; negative = a refund is due. Rounded
   * because the sign is what decides between asking for money and handing it back: an unrounded
   * difference that should be exactly zero can land on 0.0000000001 and read as "you owe more". */
  amountDifference = computed(() => roundMoney(this.newTotal() - this.originalSettledAmount()));

  /** Nudges toward getting free delivery back when an edit has just lost it. */
  readonly editFreeDeliveryNudge = computed(() => {
    const subtotal = this.editItemsTotal();
    if (subtotal === 0 || subtotal >= FREE_DELIVERY_CART_THRESHOLD) return null;
    return `Add ₹${roundMoney(FREE_DELIVERY_CART_THRESHOLD - subtotal).toFixed(2)} more to get FREE delivery`;
  });

  /** Id awaiting cancel confirmation — avoids an accidental one-click cancel. */
  confirmingCancelId = signal<string | null>(null);
  cancelling = signal(false);
  /** Where a cancelling customer wants money already captured to go back to. Wallet is the
   * default because it lands instantly; a refund to the card takes days and needs an admin. */
  cancelRefundDestination = signal<RefundDestination>('wallet');

  /** Set from the ?cashfreeOrderId= query param Cashfree's hosted page redirects back to. The
   * redirect itself proves nothing about whether the bank approved the charge, so the verdict
   * is fetched from the server (which asks the gateway) rather than inferred from the landing. */
  pendingCashfreeOrderId = signal<string | null>(null);
  cashfreePaymentStatus = signal<
    'checking' | 'paid' | 'failed' | 'pending' | 'discarded' | null
  >(null);

  /** Order whose unpaid changes are being dropped, so only that card shows a spinner. */
  discardingAmendmentId = signal<string | null>(null);

  /** What the gateway said went wrong, shown verbatim rather than replaced with a guess. */
  paymentFailureReason = signal<string | null>(null);

  /** Order being re-placed after a failed payment, so only that card shows a spinner. */
  retryingPaymentId = signal<string | null>(null);

  /** Order whose outstanding balance is being taken to the gateway, so only that card waits. */
  startingPaymentId = signal<string | null>(null);

  /**
   * True while the gateway says a payment for this order is still with the bank. Every route to
   * paying is withheld meanwhile: a customer told "we're not sure yet" and handed a Pay button
   * will reasonably press it, and then the same change is paid for twice. The surplus would come
   * back to their wallet, but taking the money at all is the thing to avoid.
   */
  paymentInFlightFor(orderId: string): boolean {
    return (
      this.pendingCashfreeOrderId() === orderId &&
      (this.cashfreePaymentStatus() === 'pending' || this.cashfreePaymentStatus() === 'checking')
    );
  }

  /**
   * Strictly newest first. Delivered and cancelled orders used to be pushed to the bottom, which
   * meant a customer's most recent order could be buried under older ones the moment it finished
   * — the list stopped reading as a history. The one exception is the order being edited, pinned
   * to the top so the customer never loses track of it mid-edit.
   */
  readonly sortedOrders = computed(() => {
    const editingId = this.editingId();
    const sorted = [...this.orders()].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    if (!editingId) return sorted;
    const editIndex = sorted.findIndex((o) => o.id === editingId);
    if (editIndex <= 0) return sorted;
    const [edited] = sorted.splice(editIndex, 1);
    return [edited, ...sorted];
  });

  ngOnInit(): void {
    const cashfreeOrderId = this.route.snapshot.queryParamMap.get('cashfreeOrderId');
    if (cashfreeOrderId) {
      this.pendingCashfreeOrderId.set(cashfreeOrderId);
      this.cashfreePaymentStatus.set('checking');
      // Drop the query param so refreshing this page doesn't re-trigger the check. A plain
      // history call rather than Router.navigate, since there's no route change to make here.
      window.history.replaceState({}, '', window.location.pathname);
    }
    this.load();
  }

  dismissCashfreeBanner(): void {
    this.stopConfirming();
    this.pendingCashfreeOrderId.set(null);
    this.cashfreePaymentStatus.set(null);
    this.paymentFailureReason.set(null);
  }

  /**
   * Asks the server to check with the payment gateway directly, which answers straight away
   * instead of leaving the customer watching a spinner until the webhook happens to land. Only
   * a genuinely still-in-flight payment (a UPI collect request awaiting approval, say) falls
   * back to retrying, and even then it retries itself rather than asking for a page refresh.
   */
  private confirmCashfreePayment(attempt = 0): void {
    const orderId = this.pendingCashfreeOrderId();
    const status = this.cashfreePaymentStatus();
    // Carries on through 'pending' as well as 'checking': a payment the bank hasn't settled is
    // precisely the one that must resolve on its own rather than waiting for a manual refresh.
    if (!orderId || (status !== 'checking' && status !== 'pending')) return;
    if (this.destroyed) return;


    this.orderService.getCashfreePaymentStatus(orderId).subscribe({
      next: (result) => {
        // Keyed off what happened to the payment they just made, not off how the order stands.
        // The two differ exactly where it matters most: a top-up the bank is still deciding on
        // leaves the order fully paid for its current contents, and reporting *that* is how a
        // pending payment used to be announced as a success.
        const outcome = result.outcome ?? (result.paymentStatus as PaymentAttemptOutcome);
        this.applyPaymentResult(orderId, result);

        if (outcome === 'Discarded' || result.amendmentDiscarded) {
          // They came back without paying, so the changes it was for are gone and the order is
          // untouched — which the swapped-in order above already reflects.
          this.cashfreePaymentStatus.set('discarded');
          this.productService.loadProducts();
          return;
        }
        if (outcome === 'Paid') {
          this.cashfreePaymentStatus.set('paid');
          // The sale is real at last, so this is the point the basket is emptied — not when the
          // order record was written, which is what used to lose the customer's selection the
          // moment a payment failed.
          this.clearPurchasedItems(orderId);
          return;
        }
        if (outcome === 'Failed') {
          this.cashfreePaymentStatus.set('failed');
          this.paymentFailureReason.set(result.paymentFailureReason ?? null);
          // A failed payment puts the stock back and returns any wallet credit server-side. The
          // cart is deliberately left alone: it is what the customer retries from.
          this.productService.loadProducts();
          this.wallet.load().subscribe({ error: () => {} });
          return;
        }

        // Still with the bank. Say so straight away rather than spinning silently, and keep
        // asking underneath so it settles itself — never claim success, and never invite a
        // second payment for the same thing while it is outstanding.
        this.cashfreePaymentStatus.set('pending');
        if (attempt >= MAX_PAYMENT_CONFIRM_ATTEMPTS) return;

        const delay =
          attempt < FAST_CONFIRM_ATTEMPTS ? FAST_CONFIRM_RETRY_MS : SLOW_CONFIRM_RETRY_MS;
        this.scheduleConfirm(attempt + 1, delay);
      },
      error: () => {
        this.cashfreePaymentStatus.set('pending');
        if (attempt < MAX_PAYMENT_CONFIRM_ATTEMPTS) {
          this.scheduleConfirm(attempt + 1, SLOW_CONFIRM_RETRY_MS);
        }
      },
    });
  }

  /** Held so the poll can be stopped, rather than firing into a component that is gone. */
  private confirmTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  private scheduleConfirm(attempt: number, delayMs: number): void {
    if (this.destroyed) return;
    if (this.confirmTimer) clearTimeout(this.confirmTimer);
    this.confirmTimer = setTimeout(() => this.confirmCashfreePayment(attempt), delayMs);
  }

  /** Stops the poll — on leaving the page, and whenever the answer stops mattering. */
  private stopConfirming(): void {
    if (this.confirmTimer) clearTimeout(this.confirmTimer);
    this.confirmTimer = null;
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.stopConfirming();
  }

  /**
   * The single way this page updates an order on screen: swap in the version the server just
   * returned, whole.
   *
   * Every handler goes through here on purpose. Patching a field or two onto the copy already in
   * the list is what repeatedly left the page describing a state the server had moved on from —
   * a cancelled order still offering to take a payment, a paid order still claiming nothing had
   * been paid — because the fields nobody thought to patch kept their stale values. An action
   * that changes an order changes more of it than the caller tends to remember.
   */
  private replaceOrder(updated: OrderResponse | null | undefined): boolean {
    if (!updated) return false;
    this.orders.update((all) => all.map((o) => (o.id === updated.id ? updated : o)));
    return true;
  }

  /**
   * Puts the gateway's verdict on screen without waiting for a reload.
   *
   * Prefers the whole order the server sent back. The list was fetched *before* the payment was
   * recorded, so patching just the status onto it left every other field describing an unpaid
   * order — the amount paid stayed at zero, which meant no delivery estimate, a cancel dialog
   * offering to refund ₹0, and, worst of all, an edit screen that priced the change against
   * nothing and demanded the whole total over again from someone who had just paid it.
   *
   * Falls back to patching the two fields when no order came back, so an older response shape
   * still updates the pill rather than leaving it stale.
   */
  private applyPaymentResult(orderId: string, result: CashfreePaymentStatusResponse): void {
    if (this.replaceOrder(result.order)) return;

    // No order came back, which the server no longer does. Patch what we do know so the pill
    // isn't stale. Deliberately no reload here: load() restarts the confirm poll, and a poll
    // whose own result triggers another load is an endless loop.
    this.orders.update((all) =>
      all.map((o) =>
        o.id === orderId
          ? {
              ...o,
              paymentStatus: result.paymentStatus,
              paymentInstrument: result.paymentInstrument ?? null,
            }
          : o,
      ),
    );
  }

  /**
   * Takes what was actually bought out of the basket. Keyed off the order's own items rather than
   * emptying the cart wholesale, so anything added since is left where it is.
   */
  private clearPurchasedItems(orderId: string): void {
    const order = this.orders().find((o) => o.id === orderId);
    if (!order) return;
    for (const item of order.items) {
      this.cartService.removeFromCart(item.productId);
      this.checkoutService.removeItem(item.productId);
    }
  }

  openChatSupport(): void {
    this.chatbotUi.openChat();
  }

  canModify(order: OrderResponse): boolean {
    // A failed payment bought nothing, so there is nothing to edit or cancel — only to retry.
    return isOrderEditable(order.status) && !isPaymentFailed(order);
  }

  /** Exposed to the template. */
  isPaymentFailed = isPaymentFailed;

  /** Recomputed per render rather than cached, so an order sitting on screen past its promised
   * day starts showing the delay on the next change detection instead of staying stale. */
  deliveryEstimate(order: OrderResponse) {
    return deliveryEstimate(order);
  }

  /** Exposed to the template — how the customer actually paid, not a blanket assumption. */
  paymentLabel = paymentLabel;
  paymentIcon = paymentIcon;

  startEdit(order: OrderResponse): void {
    this.editingId.set(order.id);
    // Picks up where an unpaid edit left off rather than throwing it away — but prices against
    // the live order below, since that is what has actually been paid for.
    const startingItems = order.pendingAmendment?.items ?? order.items;
    this.editItems.set(startingItems.map((i) => ({ ...i })));
    // The floor is what the *order* holds, never what an unpaid amendment proposed — otherwise
    // resuming an edit would lock in quantities nobody has paid for yet.
    this.originalQuantities = new Map(order.items.map((i) => [i.productId, i.quantity]));
    this.editPhone = order.phone;
    this.editNotes = order.notes;
    this.editAddress = order.address;
    this.editLat = order.latitude;
    this.editLng = order.longitude;
    this.originalTotal.set(order.totalAmount);
    this.originalAmountPaid.set(order.amountPaid ?? 0);
    this.originalGatewayDiscount.set(order.gatewayDiscount ?? 0);
    this.editCouponCode.set(order.couponCode ?? null);
    this.editDeliveryQuote.set(order.deliveryCharge);
    // The stored charge is already post-free-delivery, so a cart that was over the threshold has
    // no distance quote to fall back on. Re-quote up front rather than showing a stale zero if
    // the edit drops back under it.
    if (order.deliveryCharge === 0) this.requoteDelivery();
    this.showEditMap.set(false);
    this.editError.set('');
    this.productService.loadProducts();
    // The order jumps to the top of the list as soon as editing starts;
    // scroll there so the customer sees it move and land in edit mode.
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  cancelEdit(): void {
    this.editingId.set(null);
    this.editItems.set([]);
    this.showEditMap.set(false);
    this.editError.set('');
    this.orderEditDraft.clear();
  }

  /** Sends the customer to Products to pick more items, then back here to resume. */
  addMoreProducts(order: OrderResponse): void {
    this.orderEditDraft.begin(order.id, this.editItems());
    this.router.navigate(['/products']);
  }

  /** Restores an in-progress edit after a trip to Products/product-detail to add items. */
  private resumeDraftIfAny(): void {
    const draft = this.orderEditDraft.draft();
    if (!draft) return;
    const order = this.orders().find((o) => o.id === draft.orderId);
    if (!order || !this.canModify(order)) {
      this.orderEditDraft.clear();
      return;
    }
    this.startEdit(order);
    this.editItems.set(draft.items);
    this.orderEditDraft.clear();
  }

  /** How many of this product the order already has. Newly added lines have none, so they can
   * be taken back down to zero — nothing has been bought yet. */
  originalQuantityOf(productId: string): number {
    return this.originalQuantities.get(productId) ?? 0;
  }

  changeQty(index: number, delta: number): void {
    this.editItems.update((items) =>
      items
        .map((item, i) => {
          if (i !== index) return item;
          // Never below what the order already holds: those goods are bought and paid for.
          const floor = this.originalQuantityOf(item.productId);
          return { ...item, quantity: Math.max(floor, item.quantity + delta) };
        })
        // A line the customer added and then took back to zero simply drops out again.
        .filter((item) => item.quantity > 0),
    );
  }

  onEditLocationConfirmed(location: { lat: number; lng: number; address?: string }): void {
    this.editLat = location.lat;
    this.editLng = location.lng;
    if (location.address) this.editAddress = location.address;
    this.showEditMap.set(false);
    this.requoteDelivery();
  }

  /** Moving the pin can change delivery, so the difference stays honest. */
  private requoteDelivery(): void {
    if (this.editLat === null || this.editLng === null) return;
    this.quotingDelivery.set(true);
    this.deliveryCharges
      .previewCharge(
        this.editLat,
        this.editLng,
        DeliveryChargesService.pincodeFrom(this.editAddress),
      )
      .subscribe({
      next: (quote) => {
        this.editDeliveryQuote.set(quote.charge);
        this.quotingDelivery.set(false);
      },
      error: () => this.quotingDelivery.set(false),
    });
  }

  saveEdit(order: OrderResponse): void {
    if (!this.editItems().length) {
      this.editError.set(
        'An order needs at least one item. Cancel it instead if you no longer want it.',
      );
      return;
    }
    if (this.editLat === null || this.editLng === null) {
      this.editError.set('Please pin your delivery location.');
      return;
    }

    this.saving.set(true);
    this.editError.set('');

    this.orderService
      .updateMyOrder(order.id, {
        fullName: order.fullName,
        phone: this.editPhone,
        address: this.editAddress,
        latitude: this.editLat,
        longitude: this.editLng,
        notes: this.editNotes,
        items: this.editItems(),
        // Sent explicitly so the server re-validates it against the new subtotal rather than
        // treating the omission as "no coupon" and silently dropping the customer's discount.
        couponCode: this.editCouponCode(),
      })
      .subscribe({
        next: (result) => {
          // The server's version, whole - it owns the recomputed totals.
          this.replaceOrder(result.order);
          this.saving.set(false);
          this.cancelEdit();
          // Item quantities may have changed, shifting stock server-side.
          this.productService.loadProducts();

          // COD is gone, so a higher total is always settled online — and the changes are not
          // made until it is paid. Saying "order updated" here would be a lie the customer would
          // catch the moment they backed out of the payment page.
          if (result.pendingPayment && result.paymentSessionId) {
            this.showSuccess(
              `Almost there — pay ₹${result.topUpAmount?.toFixed(2)} to confirm your changes.`,
            );
            // Both handlers rather than .finally(), which would rethrow the rejection.
            const handoffDidNotTake = () => {
              this.showError(
                `We couldn't open the payment page for the extra ₹${result.topUpAmount?.toFixed(2)}. Your order is unchanged — use "Pay" on it to try again.`,
              );
            };
            this.cashfreeCheckout
              .checkout(result.paymentSessionId)
              .then(handoffDidNotTake, handoffDidNotTake);
            return;
          }

          if (result.removedCouponCode) {
            this.showSuccess(
              `Order updated. Coupon ${result.removedCouponCode} no longer applies at this cart value.`,
            );
          } else if (result.refundAmount) {
            this.showSuccess(
              `Order updated. ₹${result.refundAmount.toFixed(2)} added to your wallet.`,
            );
            this.wallet.load().subscribe({ error: () => {} });
          } else {
            this.showSuccess('Order updated');
          }

          window.scrollTo({ top: 0, behavior: 'smooth' });
        },
        error: (err) => {
          this.saving.set(false);
          this.editError.set(
            err.error?.message ?? 'Could not update this order. Please try again.',
          );
          // The window may have closed while they were editing.
          if (err.error?.notEditable) this.load();
        },
      });
  }

  /**
   * Resumes payment for changes that were priced but never paid for — the customer who closed the
   * payment page and came back later. Reuses the session the edit already created rather than
   * making them redo the edit.
   */
  payForAmendment(order: OrderResponse): void {
    const amendment = order.pendingAmendment;
    if (!amendment?.paymentSessionId) return;
    // Belt and braces with the template guard: a payment already with the bank must not be
    // joined by a second one for the same changes.
    if (this.paymentInFlightFor(order.id)) return;

    const handoffDidNotTake = () => {
      this.showError(
        `We couldn't open the payment page for ₹${amendment.topUpAmount.toFixed(2)}. Your order is unchanged — please try again.`,
      );
    };
    this.cashfreeCheckout
      .checkout(amendment.paymentSessionId)
      .then(handoffDidNotTake, handoffDidNotTake);
  }

  /** Drops unpaid changes for good. Nothing was charged, so the order simply goes back to what
   * it was and the items the edit was holding are released. */
  discardAmendment(order: OrderResponse): void {
    this.discardingAmendmentId.set(order.id);
    this.orderService.discardAmendment(order.id).subscribe({
      next: (updated) => {
        this.replaceOrder(updated);
        this.discardingAmendmentId.set(null);
        this.productService.loadProducts();
        this.showSuccess('Changes discarded. Your order is unchanged and nothing was charged.');
      },
      error: () => {
        this.discardingAmendmentId.set(null);
        this.showError('Could not discard those changes. Please try again.');
      },
    });
  }

  /**
   * Takes another run at a payment that failed. The original order is gone — it was stood down
   * and its stock released — so this places the same items afresh and goes straight to the
   * payment page, rather than sending the customer back to the cart to redo the checkout they
   * already completed once.
   *
   * Everything is re-priced server-side on the way through, so a delivery charge or coupon that
   * no longer applies is corrected here rather than carried over from the failed attempt.
   */
  retryPayment(order: OrderResponse): void {
    if (this.paymentInFlightFor(order.id)) return;
    this.retryingPaymentId.set(order.id);

    this.orderService
      .placeOrder({
        fullName: order.fullName,
        phone: order.phone,
        address: order.address,
        latitude: order.latitude,
        longitude: order.longitude,
        notes: order.notes,
        items: order.items,
        couponCode: order.couponCode ?? null,
        // The failed order's wallet credit was returned, so it is spendable again.
        useWallet: true,
        // Retires the failed attempt once this one exists, so the customer is left looking at
        // one live order rather than a dead one sitting above it.
        retryOfOrderId: order.id,
      })
      .subscribe({
        next: (placed) => {
          this.retryingPaymentId.set(null);
          // The retry has taken stock again.
          this.productService.loadProducts();

          if (placed.paymentSessionId) {
            const handoffDidNotTake = () => {
              this.showError(
                "We couldn't open the payment page, so nothing was charged. Please try again.",
              );
              this.load();
            };
            this.cashfreeCheckout
              .checkout(placed.paymentSessionId)
              .then(handoffDidNotTake, handoffDidNotTake);
            return;
          }

          // Wallet credit covered the whole total this time, so there is no payment to make.
          this.wallet.load().subscribe({ error: () => {} });
          this.load();
          this.showSuccess('Order placed — your wallet covered the full amount.');
        },
        error: (err) => {
          this.retryingPaymentId.set(null);
          // Most likely someone bought the last one while this order sat unpaid, which is worth
          // saying precisely rather than as a generic failure.
          this.showError(
            err.error?.message ?? 'Could not place this order again. Please try again.',
          );
          if (err.error?.outOfStock) this.productService.loadProducts();
        },
      });
  }

  /**
   * The pack shot for an order line, looked up in the live catalogue rather than stored on the
   * order. Orders record what was bought and at what price — the photo is presentation, and
   * copying it onto every line would freeze an image the catalogue has since improved.
   *
   * Null for a product that has since been withdrawn, which the template draws as a plain tile
   * rather than a broken image.
   */
  itemImage(item: OrderItem): string | null {
    return this.productService.getProduct(item.productId)?.imageUrl ?? null;
  }

  /** Exposed to the template: what an order still owes, and whether paying it is the next move. */
  canPayOnline = canPayOnline;
  amountOutstanding = amountOutstanding;

  /**
   * Pays an order that was placed but never paid for.
   *
   * This is the way out of what used to be a dead end. An order whose payment was abandoned sat
   * in the list saying "Payment Pending" with Edit and Cancel buttons and no way to hand over the
   * money — and nothing resolved it either, because the only thing that ever asked the gateway
   * what had happened was the redirect back from the payment page, which is exactly the step
   * that customer never took.
   *
   * The server reconciles against the gateway before it raises anything, so all three answers
   * below are possible and each is reported for what it is. Announcing "pay now" over money that
   * has already arrived, or over a payment the bank is still deciding on, is how a customer ends
   * up paying twice.
   */
  payNow(order: OrderResponse): void {
    if (this.startingPaymentId() || this.paymentInFlightFor(order.id)) return;
    this.startingPaymentId.set(order.id);

    this.orderService.resumePayment(order.id).subscribe({
      next: (result) => {
        this.startingPaymentId.set(null);
        // Whole order in, always — it has just been reconciled against the gateway and can have
        // moved in more ways than this handler knows about.
        this.replaceOrder(result.order);

        if (result.alreadyPaid) {
          this.wallet.load().subscribe({ error: () => {} });
          this.clearPurchasedItems(order.id);
          this.showSuccess('Good news — this order is already paid for. Nothing more is due.');
          return;
        }

        if (result.paymentInFlight) {
          this.showError(
            "A payment for this order is still with your bank. We'll update it as soon as they decide — please don't pay again yet.",
          );
          return;
        }

        if (!result.paymentSessionId) {
          this.showError("We couldn't start the payment. Your order is unchanged - please try again.");
          return;
        }

        const handoffDidNotTake = () => {
          this.showError(
            `We couldn't open the payment page for ₹${result.amountDue.toFixed(2)}. Your order is unchanged — please try again.`,
          );
        };
        this.cashfreeCheckout
          .checkout(result.paymentSessionId)
          .then(handoffDidNotTake, handoffDidNotTake);
      },
      error: (err) => {
        this.startingPaymentId.set(null);
        this.showError(err.error?.message ?? "We couldn't start the payment. Please try again.");
        // The refusal usually means the order has moved on server-side — it was cancelled, or an
        // edit is now waiting on its own payment. Re-read rather than leaving a stale card up.
        this.load();
      },
    });
  }

  askCancel(orderId: string): void {
    this.confirmingCancelId.set(orderId);
    this.cancelRefundDestination.set('wallet');
  }

  /** Says what actually happened to the money, rather than a bare "Order cancelled". */
  private cancellationMessage(result: CancelOrderResponse): string {
    if (result.sourceRefundQueued > 0 && result.walletCredited > 0) {
      return `Order cancelled. ₹${result.walletCredited.toFixed(2)} back in your wallet, and ₹${result.sourceRefundQueued.toFixed(2)} refunded to your original payment method within 5-7 working days.`;
    }
    if (result.sourceRefundQueued > 0) {
      return `Order cancelled. ₹${result.sourceRefundQueued.toFixed(2)} will reach your original payment method within 5-7 working days.`;
    }
    if (result.walletCredited > 0) {
      return `Order cancelled. ₹${result.walletCredited.toFixed(2)} added to your wallet.`;
    }
    return 'Order cancelled';
  }

  dismissCancel(): void {
    this.confirmingCancelId.set(null);
  }

  confirmCancel(order: OrderResponse): void {
    this.cancelling.set(true);
    this.orderService.cancelMyOrder(order.id, this.cancelRefundDestination()).subscribe({
      next: (result) => {
        // Cancelling discards any pending edit and returns wallet credit server-side, so the
        // whole order has to come back. Setting just the status left the amendment block - and
        // its Pay button - still on screen against a cancelled order.
        if (!this.replaceOrder(result.order)) this.load();
        this.cancelling.set(false);
        this.confirmingCancelId.set(null);
        // A cancelled order is finished, so stop watching a payment that can no longer apply.
        if (this.pendingCashfreeOrderId() === order.id) this.dismissCashfreeBanner();
        // Cancelling restores stock server-side; refresh so out-of-stock
        // products the customer bought the last of show as buyable again.
        this.productService.loadProducts();
        if (result.walletCredited > 0) this.wallet.load().subscribe({ error: () => {} });
        this.showSuccess(this.cancellationMessage(result));
        window.scrollTo({ top: 0, behavior: 'smooth' });
      },
      error: (err) => {
        this.cancelling.set(false);
        this.confirmingCancelId.set(null);
        this.error.set(err.error?.message ?? 'Could not cancel this order.');
        if (err.error?.notEditable) this.load();
      },
    });
  }

  getStatusClass(status: string): string {
    switch (status.toLowerCase()) {
      case 'confirmed':
        return 'status-confirmed';
      case 'packed':
        return 'status-packed';
      case 'delivered':
        return 'status-delivered';
      case 'shipped':
        return 'status-shipped';
      case 'cancelled':
        return 'status-cancelled';
      default:
        return 'status-pending';
    }
  }

  private showSuccess(message: string): void {
    this.snackBar.open(message, 'Close', { duration: 3000, panelClass: 'snack-success' });
  }

  /** For failures the customer has to act on from an order card. Deliberately not `error()`,
   * which replaces the whole list with an error panel — hiding the very buttons the message is
   * telling them to use. */
  private showError(message: string): void {
    this.snackBar.open(message, 'Close', { duration: 6000, panelClass: 'snack-error' });
  }

  private load(): void {
    this.loading.set(true);
    this.userService.getMyOrders().subscribe({
      next: (orders) => {
        this.orders.set(orders);
        this.loading.set(false);
        this.resumeDraftIfAny();
        // Only ever *starts* the confirm run. A poll already under way owns its own schedule -
        // reloading mid-flight must not spawn a second chain alongside it.
        if (this.cashfreePaymentStatus() === 'checking' && this.confirmTimer === null) {
          this.confirmCashfreePayment();
        }
      },
      error: () => {
        this.error.set('Failed to load orders.');
        this.loading.set(false);
      },
    });
  }
}
