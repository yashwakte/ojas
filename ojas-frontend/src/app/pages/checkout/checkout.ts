import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  signal,
  computed,
  effect,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { CartService } from '../../services/cart.service';
import { CheckoutService } from '../../services/checkout.service';
import { OrderService } from '../../services/order.service';
import { CashfreeCheckoutService } from '../../services/cashfree-checkout.service';
import { WalletService } from '../../services/wallet.service';
import { ProductService } from '../../services/product.service';
import { AuthService } from '../../services/auth.service';
import { UserService } from '../../services/user.service';
import { DeliveryChargesService } from '../../services/delivery-charges.service';
import { DeliveryAddressService } from '../../services/delivery-address.service';
import {
  PlaceOrderRequest,
  SaveAddressRequest,
  SavedAddress,
  effectivePrice,
} from '../../models/interfaces';
import { MapPicker } from '../../components/map-picker/map-picker';
import { CouponPicker } from '../../components/coupon-picker/coupon-picker';
import {
  DEFAULT_CITY,
  DEFAULT_STATE,
  SERVICEABLE_STATES,
  citiesForState,
  isValidPunePincode,
} from '../../constants/serviceable-locations';
import {
  calculateCouponDiscount,
  freeDeliveryNudgeFor,
  qualifiesForFreeDelivery,
  roundMoney,
  COUPONS,
  Coupon,
} from '../../constants/pricing';
import { thumbnailPackShot } from '../../constants/pack-shots';

@Component({
  selector: 'app-checkout',
  imports: [FormsModule, MatIconModule, MapPicker, CouponPicker, DecimalPipe],
  templateUrl: './checkout.html',
  styleUrl: './checkout.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:pageshow)': 'onPageShow()' },
})
export class Checkout implements OnInit {
  fullName = '';
  phone = '';
  notes = '';

  // Structured address fields (used when no saved address is selected)
  houseNo = '';
  street = '';
  area = '';
  landmark = '';
  // We only deliver around Pune, so these start pre-filled rather than blank.
  city = DEFAULT_CITY;
  state = DEFAULT_STATE;
  pincode = '';
  manualLat: number | null = null;
  manualLng: number | null = null;
  showManualMapPicker = signal(false);

  // Save new address
  saveNewAddress = false;
  saveNewAddressLabel = '';

  readonly serviceableStates = SERVICEABLE_STATES;

  get citiesForSelectedState(): readonly string[] {
    return citiesForState(this.state);
  }

  /** Keeps city consistent when the state changes; there is only one today. */
  onStateChange(): void {
    const cities = this.citiesForSelectedState;
    if (!cities.includes(this.city)) {
      this.city = cities[0] ?? '';
    }
  }

  loading = signal(false);
  errorMsg = signal('');

  /** Applied by default; unticking saves the credit for a later order. */
  useWallet = signal(true);

  /** How much of this order the balance actually covers — the rest goes to the gateway. */
  readonly walletApplied = computed(() =>
    this.useWallet() ? roundMoney(Math.min(this.wallet.balance(), this.grandTotal())) : 0,
  );

  readonly amountDueOnline = computed(() => roundMoney(this.grandTotal() - this.walletApplied()));
  savedAddresses = signal<SavedAddress[]>([]);
  selectedSavedAddress = signal<SavedAddress | null>(null);

  deliveryCharge = signal(0);
  deliveryDistanceKm = signal<number | null>(null);
  deliveryLoading = signal(false);
  /** Set when the pinned address falls outside the serviceable radius. */
  outOfServiceArea = signal(false);
  maxRadiusKm = signal(0);

  /** Exposed to the template so each line shows what it will actually be billed at. */
  effectivePrice = effectivePrice;

  /** Summary rows are thumbnails; they load the card-sized pack shot. */
  thumbnail = thumbnailPackShot;

  readonly totalAmount = computed(() =>
    roundMoney(
      this.checkoutService.items().reduce((sum, i) => sum + effectivePrice(i.product) * i.quantity, 0),
    ),
  );

  readonly coupons = COUPONS;
  /** The coupon code the customer picked from the popup below — never auto-applied. */
  appliedCouponCode = signal<string | null>(null);
  couponPickerOpen = signal(false);

  readonly appliedCoupon = computed<Coupon | null>(
    () => this.coupons.find((c) => c.code === this.appliedCouponCode()) ?? null,
  );

  readonly discount = computed(() =>
    calculateCouponDiscount(this.appliedCoupon(), this.totalAmount()),
  );

  /** The distance-based quote from the server, overridden to free once the cart
   * clears the free-delivery threshold — automatic, unlike the coupon discount above. */
  readonly effectiveDeliveryCharge = computed(() =>
    qualifiesForFreeDelivery(this.totalAmount()) ? 0 : this.deliveryCharge(),
  );

  readonly grandTotal = computed(() =>
    roundMoney(this.totalAmount() - this.discount().amount + this.effectiveDeliveryCharge()),
  );

  /** Nudges the customer toward free delivery — the one reward that's automatic rather
   * than picked. Each coupon tile shows its own unlock progress. Measured against the *quoted*
   * charge, not the effective one: a customer whose address is already inside the free-delivery
   * radius has nothing to unlock, and offering it to them anyway invites them to spend more for
   * something they already have. See freeDeliveryNudgeFor. */
  readonly freeDeliveryNudge = computed(() =>
    freeDeliveryNudgeFor(this.totalAmount(), this.deliveryCharge()),
  );

  constructor(
    private cartService: CartService,
    public checkoutService: CheckoutService,
    private orderService: OrderService,
    private cashfreeCheckout: CashfreeCheckoutService,
    private productService: ProductService,
    public auth: AuthService,
    private userService: UserService,
    private deliveryChargesService: DeliveryChargesService,
    private deliveryAddress: DeliveryAddressService,
    public wallet: WalletService,
    private router: Router,
  ) {
    // If items are removed after a coupon was applied and the cart falls back below
    // that coupon's minimum, drop it rather than leaving a stale "Remove" state showing.
    effect(() => {
      const coupon = this.appliedCoupon();
      if (coupon && this.totalAmount() < coupon.minCartValue) {
        this.appliedCouponCode.set(null);
      }
    });
  }

  ngOnInit(): void {
    // Back from the payment page without paying, on a browser that rebuilt the app rather than
    // restoring it from cache. The order exists and is unpaid, so it is dealt with there.
    const awaiting = this.cashfreeCheckout.awaitingPayment();
    if (awaiting) {
      this.goToUnfinishedOrder(awaiting);
      return;
    }

    // Balance drives the payment summary below, so it's needed before they can pay.
    this.wallet.load().subscribe({ error: () => {} });

    const user = this.auth.user();

    // Pre-fill from logged-in user - set before the saved-addresses lookup below
    // so a match's own phone (once that response lands) overrides this default,
    // rather than risk this unconditional assignment running after it.
    this.fullName = user?.fullName ?? '';
    this.phone = user?.phone ?? '';

    // Load saved addresses, preferring whatever they were already shopping
    // against so the charge quoted on the product page is the one they pay.
    this.userService.getProfile().subscribe({
      next: (profile) => {
        this.savedAddresses.set(profile.savedAddresses ?? []);

        const browsing = this.deliveryAddress.selected();
        const match = browsing
          ? (profile.savedAddresses?.find((a) => a.label === browsing.label) ?? browsing)
          : profile.savedAddresses?.find((a) => a.isDefault);

        if (match) {
          this.selectedSavedAddress.set(match);
          // Falls back to the account phone for addresses saved before this field
          // existed, rather than leaving the field blank.
          this.phone = match.phone || user?.phone || '';
          this.updateDeliveryEstimate();
        }
      },
      error: () => {},
    });

    // Redirect if nothing to checkout
    if (this.checkoutService.items().length === 0) {
      this.router.navigate(['/products']);
    }
  }

  get isAddressValid(): boolean {
    if (this.selectedSavedAddress()) return true;
    return !!(
      this.houseNo.trim() &&
      this.street.trim() &&
      this.area.trim() &&
      this.city.trim() &&
      this.state &&
      isValidPunePincode(this.pincode.trim()) &&
      this.manualLat !== null &&
      this.manualLng !== null
    );
  }

  private get composedAddress(): string {
    return [
      this.houseNo.trim(),
      this.street.trim(),
      this.area.trim(),
      this.landmark.trim() ? `Near ${this.landmark.trim()}` : '',
      this.city.trim(),
      `${this.state} - ${this.pincode.trim()}`,
    ]
      .filter(Boolean)
      .join(', ');
  }


  /**
   * The customer is back on checkout with an order already placed and unpaid — they pressed Back
   * from the payment page rather than paying, or the handoff failed outright.
   *
   * They are sent to their order rather than left here, for two reasons. This page cannot take
   * the payment: pressing "Proceed to Pay" again would place a *second* order for the same
   * basket. And the honest answer to "what happened to my payment" is the gateway's, which is
   * exactly what My Orders asks for when handed the order id — it reconciles against Cashfree and
   * says plainly whether anything was charged, instead of this page guessing.
   */
  private goToUnfinishedOrder(orderId: string): void {
    this.cashfreeCheckout.clearAwaitingPayment();
    this.loading.set(false);
    this.router.navigate(['/my-orders'], { queryParams: { cashfreeOrderId: orderId } });
  }

  /**
   * Pressing Back from Cashfree's page restores this one from the browser's back/forward cache,
   * which resumes the app without re-running ngOnInit. Without this the customer would sit here
   * looking at a spinner, and then at an error, for an order that is perfectly fine and merely
   * unpaid.
   */
  onPageShow(): void {
    const orderId = this.cashfreeCheckout.awaitingPayment();
    if (orderId) this.goToUnfinishedOrder(orderId);
  }

  placeOrder(): void {
    this.errorMsg.set('');

    if (this.outOfServiceArea()) {
      this.errorMsg.set(
        `We currently deliver only within ${this.maxRadiusKm()} km of our store. Please pick a delivery address inside that area.`,
      );
      return;
    }

    if (this.selectedSavedAddress() && this.isUnsetPin(this.selectedSavedAddress()!)) {
      this.errorMsg.set(
        'That saved address has an unset location pin. Edit it in your profile and drop a pin on the map before using it.',
      );
      return;
    }

    const selectedAddress = this.selectedSavedAddress();
    const deliveryAddress = selectedAddress?.fullAddress ?? this.composedAddress;
    const latitude = selectedAddress?.latitude ?? this.manualLat!;
    const longitude = selectedAddress?.longitude ?? this.manualLng!;
    const request: PlaceOrderRequest = {
      fullName: this.fullName,
      phone: this.phone,
      address: deliveryAddress,
      latitude,
      longitude,
      notes: this.notes,
      items: this.checkoutService.items().map((i) => ({
        productId: i.product.id,
        productName: i.product.name,
        // Sent for completeness only - the server prices every line from the catalog itself
        // and ignores whatever arrives here.
        price: effectivePrice(i.product),
        weight: i.product.weight,
        quantity: i.quantity,
      })),
      couponCode: this.appliedCouponCode(),
      useWallet: this.useWallet(),
    };

    this.loading.set(true);
    this.orderService.placeOrder(request).subscribe({
      next: (res) => {
        // Stock was just decremented server-side; refresh the shared product
        // cache so the products page reflects it without a manual reload.
        this.productService.loadProducts();
        // Save new address if user opted in
        if (
          this.saveNewAddress &&
          this.saveNewAddressLabel.trim() &&
          !this.selectedSavedAddress()
        ) {
          const req: SaveAddressRequest = {
            label: this.saveNewAddressLabel.trim(),
            phone: this.phone,
            fullAddress: deliveryAddress,
            latitude,
            longitude,
            isDefault: false,
          };
          this.userService.saveAddress(req).subscribe({ error: () => {} });
        }
        // Every order is paid online, so this always hands off to the hosted payment page. On
        // success that navigates the browser away entirely, which is why `loading` deliberately
        // stays true - it only resolves here if the SDK itself failed to open.
        // Wallet covered the whole total, so there was no gateway payment to make and the order
        // is already settled - straight to My Orders rather than a payment page.
        if (res.paymentStatus === 'Paid' && !res.paymentSessionId) {
          this.clearOrderedItems();
          this.wallet.load().subscribe({ error: () => {} });
          this.loading.set(false);
          this.router.navigate(['/my-orders']);
          return;
        }

        // The cart is deliberately NOT emptied here. A payment that is declined or walked away
        // from leaves the customer with nothing to retry from if their selection was thrown away
        // the moment the order record was written. My Orders clears it once the payment is
        // actually confirmed, which is the first point at which the sale is real.

        if (res.paymentSessionId) {
          // The order now exists, unpaid. Remembered so that if the customer comes back here by
          // pressing Back rather than by paying, this page recognises the return instead of
          // treating it as a fresh visit.
          this.cashfreeCheckout.markAwaitingPayment(res.id);

          // Runs only if the handoff actually failed and the customer is still here. It used to
          // run on success too - the SDK resolves as soon as the redirect is under way, not when
          // the browser has left - which put an error on screen every time it worked.
          //
          // Either way the order exists, so this must not offer to "try again" from here: doing
          // that would place a second order for the same basket. My Orders is where an unpaid
          // order can actually be paid, and it says what the gateway really thinks happened.
          this.cashfreeCheckout
            .whenHandOffFails(res.paymentSessionId)
            .then(() => this.goToUnfinishedOrder(res.id));
          return;
        }

        this.loading.set(false);
        this.errorMsg.set("We couldn't start the payment. Please try again.");
      },
      error: (err) => {
        this.loading.set(false);
        if (err.status === 401) {
          this.errorMsg.set('Session expired. Please login again.');
        } else if (err.status === 503) {
          // No fallback to suggest - COD was retired, so online payment is the only way to pay.
          this.errorMsg.set(
            err.error?.message ??
              "Online payment isn't available right now. Please try again in a few minutes.",
          );
        } else if (err.error?.outOfStock) {
          // Someone bought the last one while this order was being filled in.
          this.errorMsg.set(err.error.message ?? 'An item just went out of stock.');
        } else if (err.error?.outOfRange) {
          // The server is the authority on the delivery area — mirror its verdict.
          this.outOfServiceArea.set(true);
          this.maxRadiusKm.set(err.error.maxRadiusKm ?? this.maxRadiusKm());
          this.errorMsg.set(err.error.message ?? 'This address is outside our delivery area.');
        } else {
          // The server's own words first. It routinely knows something worth saying that none of
          // the branches above match - "We couldn't start the payment", for one, which is a
          // different situation from a failed order and reads as one to the customer. Throwing
          // that away for a blanket "failed to place order" is how a specific, accurate
          // explanation became a vague and slightly wrong one.
          this.errorMsg.set(err.error?.message ?? 'Failed to place order. Please try again.');
        }
      },
    });
  }

  /** Only for a sale that is already complete — a wallet-covered order never reaches the
   * gateway, so there is no payment left to fail. */
  private clearOrderedItems(): void {
    this.checkoutService.items().forEach((item) => this.cartService.removeFromCart(item.product.id));
    this.checkoutService.clear();
  }

  isUnsetPin(addr: SavedAddress): boolean {
    return addr.latitude === 0 && addr.longitude === 0;
  }

  selectAddress(addr: SavedAddress): void {
    if (this.selectedSavedAddress()?.label === addr.label) {
      this.selectedSavedAddress.set(null);
      this.phone = this.auth.user()?.phone ?? '';
    } else {
      this.selectedSavedAddress.set(addr);
      // Falls back to the account phone for addresses saved before this field existed.
      this.phone = addr.phone || this.auth.user()?.phone || '';
    }
    this.updateDeliveryEstimate();
  }

  useNewAddress(): void {
    this.selectedSavedAddress.set(null);
    this.phone = this.auth.user()?.phone ?? '';
    this.updateDeliveryEstimate();
  }

  onManualLocationConfirmed(location: { lat: number; lng: number }): void {
    this.manualLat = location.lat;
    this.manualLng = location.lng;
    this.showManualMapPicker.set(false);
    this.updateDeliveryEstimate();
  }

  private updateDeliveryEstimate(): void {
    const selectedAddress = this.selectedSavedAddress();
    const latitude = selectedAddress?.latitude ?? this.manualLat;
    const longitude = selectedAddress?.longitude ?? this.manualLng;

    if (
      latitude === null ||
      latitude === undefined ||
      longitude === null ||
      longitude === undefined
    ) {
      this.deliveryCharge.set(0);
      this.deliveryDistanceKm.set(null);
      this.outOfServiceArea.set(false);
      return;
    }

    this.deliveryLoading.set(true);
    // The address the order will actually carry, so the preview is priced the same way the
    // order will be - by pincode, server-side.
    const address = selectedAddress?.fullAddress ?? this.composedAddress;

    this.deliveryChargesService
      .previewCharge(latitude, longitude, DeliveryChargesService.pincodeFrom(address))
      .subscribe({
      next: (result) => {
        this.deliveryCharge.set(result.charge);
        this.deliveryDistanceKm.set(result.distanceKm);
        this.outOfServiceArea.set(!result.isServiceable);
        this.maxRadiusKm.set(result.maxRadiusKm);
        this.deliveryLoading.set(false);
      },
      error: () => {
        this.deliveryCharge.set(0);
        this.deliveryDistanceKm.set(null);
        this.outOfServiceArea.set(false);
        this.deliveryLoading.set(false);
      },
    });
  }

  incrementCartQty(index: number): void {
    const item = this.checkoutService.items()[index];
    this.checkoutService.updateQuantity(item.product.id, item.quantity + 1);
  }

  decrementCartQty(index: number): void {
    const item = this.checkoutService.items()[index];
    if (item.quantity <= 1) return;
    this.checkoutService.updateQuantity(item.product.id, item.quantity - 1);
  }

  removeItem(index: number): void {
    const item = this.checkoutService.items()[index];
    this.checkoutService.removeItem(item.product.id);
    if (this.checkoutService.items().length === 0) {
      this.router.navigate(['/cart']);
    }
  }
}
