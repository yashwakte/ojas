import { roundMoney } from '../constants/pricing';

export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  discount: number;
  category: string;
  imageUrl: string;
  galleryImageUrls: string[];
  weight: string;
  isAvailable: boolean;
  /** Units on hand. null means stock isn't tracked for this product yet. */
  stockQuantity: number | null;
  lowStockThreshold: number;
  ingredients: string;
  benefits: string;
  storageInfo: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * What a product actually sells for: its list price less the discount advertised against it.
 * The single definition of a product's price on the client, mirroring `ProductService.EffectivePrice`
 * on the server — which is the authority. The two used to disagree: the storefront showed a
 * "20% OFF" sale price while the cart, checkout and the order itself all charged the full list
 * price.
 */
export function effectivePrice(product: Product): number {
  return roundMoney(product.price - (product.price * (product.discount ?? 0)) / 100);
}

/** Purchasable = admin has it enabled AND it isn't a tracked product at zero. */
export function isPurchasable(product: Product): boolean {
  return product.isAvailable && (product.stockQuantity === null || product.stockQuantity > 0);
}

export function isOutOfStock(product: Product): boolean {
  return product.stockQuantity !== null && product.stockQuantity <= 0;
}

export function isLowStock(product: Product): boolean {
  return (
    product.stockQuantity !== null &&
    product.stockQuantity > 0 &&
    product.stockQuantity <= product.lowStockThreshold
  );
}

export interface CreateProductRequest {
  name: string;
  description: string;
  price: number;
  discount: number;
  category: string;
  imageUrl: string;
  galleryImageUrls: string[];
  weight: string;
  isAvailable: boolean;
  stockQuantity?: number | null;
  lowStockThreshold?: number;
  ingredients: string;
  benefits: string;
  storageInfo: string;
}

export interface UpdateProductRequest extends Partial<CreateProductRequest> {
  id: string;
}

/** A pincode Ojas delivers to, and what delivery there costs. */
export interface ServiceableArea {
  /** Six digits, e.g. "411014". */
  pincode: string;
  /** Null falls back to `defaultDeliveryCharge`. */
  charge?: number | null;
  /** For the admin's own reference — "Kharadi", "Viman Nagar". */
  label?: string | null;
}

export interface DeliveryChargesConfig {
  id: string;
  warehouseAddress: string;
  warehouseLatitude: number;
  warehouseLongitude: number;
  freeDeliveryUpToKm: number;
  perKmChargeAfterFree: number;
  /** Serviceable radius from the warehouse; 0 means no limit. Only used before pincodes are
   * configured — see `serviceableAreas`. */
  maxDeliveryRadiusKm: number;
  /** The pincodes Ojas delivers to. Once this has any entries it is the authority on both
   * whether we deliver somewhere and what it costs, and the customer's map pin stops affecting
   * the bill — which is what stops a crafted request pricing its own delivery to zero. */
  serviceableAreas: ServiceableArea[];
  /** What delivery costs for a serviceable pincode that doesn't name its own charge. */
  defaultDeliveryCharge: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateDeliveryChargesRequest {
  warehouseAddress?: string;
  warehouseLatitude?: number;
  warehouseLongitude?: number;
  freeDeliveryUpToKm?: number;
  perKmChargeAfterFree?: number;
  maxDeliveryRadiusKm?: number;
  serviceableAreas?: ServiceableArea[];
  defaultDeliveryCharge?: number;
  isActive?: boolean;
}

export interface DeliveryChargeCalculation {
  distanceKm: number;
  charge: number;
  isFree: boolean;
  /** False when we don't deliver to this address. */
  isServiceable: boolean;
  maxRadiusKm: number;
  /** True when the charge came from the serviceable-pincode list rather than the map pin. */
  pricedByPincode?: boolean;
}

export interface CampaignBannerConfig {
  id: string;
  title: string;
  subtitle: string;
  ctaText: string;
  ctaLink: string;
  backgroundImageUrl: string;
  isActive: boolean;
  featuredSectionTitle: string;
  featuredProductIds: string[];
  fallbackBestsellerProductIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface UpdateCampaignBannerRequest {
  title?: string;
  subtitle?: string;
  ctaText?: string;
  ctaLink?: string;
  backgroundImageUrl?: string;
  isActive?: boolean;
  featuredSectionTitle?: string;
  featuredProductIds?: string[];
  fallbackBestsellerProductIds?: string[];
}

export interface AuthResponse {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  role: UserRole;
  csrfToken?: string;
}

/**
 * Who the session cookie in this browser actually belongs to, straight from the server.
 * Cookies and localStorage are shared by every tab in a browser profile, so the cached user
 * can end up describing a different account than the cookie does - this is what that cache
 * gets reconciled against. See AuthService.syncSession.
 */
export interface SessionResponse {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  role: UserRole;
  /** The session's own CSRF token, so a tab that resynchronises onto a different account can
   * keep making mutating requests instead of silently failing every one of them. */
  csrfToken: string;
}

export type UserRole = 'customer' | 'admin' | 'delivery';

export interface RegisterRequest {
  fullName: string;
  email: string;
  phone: string;
  password: string;
  turnstileToken: string;
}

/** Returned by /register while the account awaits OTP verification - not a session yet. */
export interface RegisterPendingResponse {
  email: string;
  message: string;
  /** Populated outside Production only, so the flow can be tested without real email set up. */
  devCode?: string | null;
}

export interface VerifyEmailOtpRequest {
  email: string;
  code: string;
}

export interface ResendEmailOtpRequest {
  email: string;
}

export interface ResendEmailOtpResponse {
  message: string;
  /** Populated outside Production only, so the flow can be tested without real email set up. */
  devCode?: string | null;
}

export interface LoginRequest {
  email: string;
  password: string;
  turnstileToken: string;
}

export interface CartItem {
  product: Product;
  quantity: number;
}

export interface OrderItem {
  productId: string;
  productName: string;
  price: number;
  weight: string;
  quantity: number;
}

export interface PlaceOrderRequest {
  fullName: string;
  phone: string;
  address: string;
  latitude: number;
  longitude: number;
  notes: string;
  items: OrderItem[];
  /** Set only when the customer explicitly picked one from the Coupons & Offers list. */
  couponCode?: string | null;
  /** Wallet balance is applied by default; false when the customer unticks it to save it. */
  useWallet?: boolean;
  /** Names a failed order this one replaces, so the dead attempt drops out of the customer's
   * list once its replacement exists. The server only honours it for their own failed order. */
  retryOfOrderId?: string | null;
}

/** Same shape as placing an order — the server recomputes totals either way. Sending
 * `couponCode` matters here: omitting it makes the server fall back to the order's existing
 * coupon rather than dropping the customer's discount. */
export type UpdateMyOrderRequest = PlaceOrderRequest;

/** An edit can move money, so it reports more than the updated order. */
export interface UpdateMyOrderResponse {
  order: OrderResponse;
  /** Set when the new total exceeds what was already captured and the difference is owed. */
  topUpAmount?: number | null;
  /** Cashfree session for paying `topUpAmount`, when there is one. */
  paymentSessionId?: string | null;
  /** Set when the new total fell below what was paid; the money lands in the wallet. */
  refundAmount?: number | null;
  /** The coupon the edit invalidated, if the cart dropped under its minimum cart value. */
  removedCouponCode?: string | null;
  /** True when the changes cost more than the order holds, so they have NOT been made: they are
   * parked as `order.pendingAmendment` and only paying `topUpAmount` makes them real. `order` is
   * still the order as it stands, so the customer never sees goods they haven't paid for. */
  pendingPayment?: boolean;
}

/** What became of one payment attempt. Mirrors `PaymentAttemptOutcomes` on the server. */
export type PaymentAttemptOutcome = 'Paid' | 'Pending' | 'Failed' | 'Discarded';

/** The server's verdict after asking the payment gateway directly. */
export interface CashfreePaymentStatusResponse {
  paymentStatus: string;
  paymentInstrument?: string | null;
  /** The customer left the payment page without paying, so the edit they were paying for has
   * been dropped and their order is untouched. */
  amendmentDiscarded?: boolean;
  /** Why the payment failed, when it did. */
  paymentFailureReason?: string | null;
  /** What became of the payment the customer just came back from — which is a different question
   * from how the order stands overall. A top-up left pending at the bank leaves the order itself
   * fully paid for its current contents, so keying the banner off the order's status announced
   * "payment successful" while the thing they had just tried to pay for sat unapplied below. */
  outcome?: PaymentAttemptOutcome;
  /** The order as it now stands. Confirming a payment moves the amount paid, the status, and —
   * when a pending edit was what got paid for — the items and total too, so the whole order comes
   * back rather than leaving the page to patch a field onto its pre-payment copy. */
  order?: OrderResponse | null;
}

/** Statuses at which a customer may still edit or cancel; mirrors the API. */
export const CUSTOMER_EDITABLE_STATUSES = ['Pending', 'Confirmed'];

export function isOrderEditable(status: string): boolean {
  return CUSTOMER_EDITABLE_STATUSES.some((s) => s.toLowerCase() === status.toLowerCase());
}

export interface OrderResponse {
  id: string;
  fullName: string;
  phone: string;
  address: string;
  latitude: number;
  longitude: number;
  addressMapLink?: string | null;
  notes: string;
  items: OrderItem[];
  subtotal: number;
  couponCode?: string | null;
  discountPercentage: number;
  discountAmount: number;
  deliveryCharge: number;
  deliveryDistanceKm: number;
  totalAmount: number;
  status: string;
  /** "Cashfree" for every new order. Orders placed before COD was retired still say "COD". */
  paymentMethod: string;
  /** "Pending" | "Paid" | "PartiallyPaid" | "Failed", or legacy COD "Collected". */
  paymentStatus: string;
  createdAt: string;
  deliveryPartnerId?: string | null;
  deliveryPartnerName?: string | null;
  updatedAt?: string | null;
  /** Cashfree's payment_session_id, needed to open the hosted checkout page via the JS SDK. */
  paymentSessionId?: string | null;
  /** How the customer actually paid, from Cashfree's payment_group — "upi", "credit_card",
   * "net_banking", "wallet" and so on. Null until a payment succeeds. */
  paymentInstrument?: string | null;
  /** Cumulative amount actually captured, which an edit can leave short of the total. */
  amountPaid: number;
  /** Owed back to the customer's original payment method after they cancelled and asked for it
   * there rather than as wallet credit; an admin issues it. */
  refundPendingAmount?: number | null;
  /** How much of this order was paid from wallet balance. */
  walletAmountApplied: number;
  /** What the payment gateway knocked off — a bank offer, or a code entered on its own page.
   * The customer was charged this much less than the order total and owes nothing further, so
   * without showing it the order reads as though money is missing. */
  gatewayDiscount?: number;
  /** An edit the customer priced but hasn't paid the difference for yet. Everything above still
   * describes what was actually bought and paid for — this is only a proposal, and it disappears
   * if the top-up goes unpaid. */
  pendingAmendment?: PendingAmendment | null;
  /** Why the payment failed, in the gateway's own words. Set only when `paymentStatus` is
   * 'Failed'. Shown verbatim: a declined card and an abandoned page need different things done
   * about them, so guessing between them is worse than saying nothing. */
  paymentFailureReason?: string | null;
  /** What has been handed back so far — wallet credit and refunds to the original payment method
   * alike. A cancelled order that was paid for shows nothing paid once it is refunded, so without
   * this the customer sees no sign of where their money went. */
  amountRefunded?: number;
  /** How `amountRefunded` was split. One cancellation routinely goes both ways at once — the
   * wallet-funded share can only return to the wallet while the rest goes back to the card — and
   * a single total leaves the customer hunting a card statement for money that went elsewhere. */
  refundedToSource?: number;
  refundedToWallet?: number;
}

/** One destination the money went back to. There is a line per destination because a single
 * cancellation routinely uses two of them at once. */
export interface RefundLine {
  destination: 'wallet' | 'source';
  amount: number;
  /** What the customer should expect, which differs by destination: wallet credit is there now,
   * a card refund is not. */
  note: string;
  /** Still on its way rather than already handed over. */
  pending: boolean;
}

export interface RefundBreakdown {
  title: string;
  lines: RefundLine[];
  /** Any line still in flight, which the card uses to pick its colour. */
  pending: boolean;
}

/** What an admin's status change actually did. Cancelling gives goods and money back, so the
 * whole order comes back rather than the page patching one field onto its stale copy. */
export interface AdminStatusChangeResponse {
  order: OrderResponse | null;
  /** Credited to the customer's wallet — the wallet-funded share of what they had paid. */
  walletCredited: number;
  /** Sent back to the original payment method. */
  refundedToSource: number;
  /** The gateway would not take it, so it is owed and waiting to be retried. */
  sourceRefundQueued: number;
  refundError?: string | null;
}

/** What cancelling an order would hand back, so the admin confirms against the real figure. */
export interface CancellationPreviewResponse {
  amountPaid: number;
  walletShare: number;
  gatewayShare: number;
  hasPendingAmendment: boolean;
}

export interface RefundOrderResponse {
  refunded: number;
  error?: string | null;
  order: OrderResponse | null;
}

/** A priced-but-unpaid edit waiting on its top-up. */
export interface PendingAmendment {
  items: OrderItem[];
  subtotal: number;
  couponCode?: string | null;
  discountAmount: number;
  deliveryCharge: number;
  /** What the order will total once the top-up is paid. */
  totalAmount: number;
  /** What has to be paid for these changes to take effect. */
  topUpAmount: number;
  /** Cashfree session for paying it — lets the customer resume without re-editing. */
  paymentSessionId?: string | null;
  /** After this the changes are dropped and the stock they held goes back. */
  expiresAt: string;
}

/** Where a cancelling customer wants their money back. */
export type RefundDestination = 'wallet' | 'source';

export interface CancelOrderResponse {
  walletCredited: number;
  sourceRefundQueued: number;
  /** The order as it now stands. Cancelling moves far more than the status — it discards any
   * pending edit and returns wallet credit — so the whole order comes back rather than leaving
   * the page to patch one field and keep the rest of its pre-cancellation copy. */
  order?: OrderResponse | null;
}

export interface WalletTransactionResponse {
  /** Signed: positive credits the customer, negative is balance spent. */
  amount: number;
  balanceAfter: number;
  reason: string;
  orderId?: string | null;
  createdAt: string;
}

export interface WalletResponse {
  balance: number;
  transactions: WalletTransactionResponse[];
}

/** Ledger reason codes mapped to what a customer would recognise on a statement. */
const WALLET_REASON_LABELS: Record<string, string> = {
  OrderEditRefund: 'Refund from changing an order',
  UnappliedTopUpReturned: 'Returned — payment arrived after the changes were dropped',
  OrderCancellationRefund: 'Refund from a cancelled order',
  WalletPortionReturned: 'Wallet amount returned from a cancelled order',
  OrderPayment: 'Paid towards an order',
  AdminAdjustment: 'Adjustment by Ojas',
};

export function walletReasonLabel(reason: string): string {
  return WALLET_REASON_LABELS[reason] ?? reason;
}

/** Cashfree's payment_group values mapped to what a customer would recognise. */
const PAYMENT_INSTRUMENT_LABELS: Record<string, string> = {
  upi: 'Paid via UPI',
  credit_card: 'Paid by Credit Card',
  debit_card: 'Paid by Debit Card',
  credit_card_emi: 'Paid by Credit Card EMI',
  debit_card_emi: 'Paid by Debit Card EMI',
  cardless_emi: 'Paid by EMI',
  net_banking: 'Paid via Net Banking',
  wallet: 'Paid by Wallet',
  pay_later: 'Paid via Pay Later',
  bank_transfer: 'Paid by Bank Transfer',
  vba_transfer: 'Paid by Bank Transfer',
};

/** Short forms, for an order paid partly from wallet and partly at the gateway — saying only one
 * of the two would misdescribe how the customer actually paid. */
const PAYMENT_INSTRUMENT_SHORT: Record<string, string> = {
  upi: 'UPI',
  credit_card: 'card',
  debit_card: 'card',
  credit_card_emi: 'card EMI',
  debit_card_emi: 'card EMI',
  cardless_emi: 'EMI',
  net_banking: 'net banking',
  wallet: 'wallet',
  pay_later: 'pay later',
  bank_transfer: 'bank transfer',
  vba_transfer: 'bank transfer',
};

/** What the payment pill on an order should read. Falls back to the payment status alone when
 * the gateway hasn't told us the instrument (or for a legacy COD order, which has none). */
export function paymentLabel(order: OrderResponse): string {
  if (order.paymentMethod === 'COD') {
    return order.paymentStatus === 'Collected' ? 'Payment Collected' : 'Pay on Delivery';
  }

  if (order.paymentMethod === 'Wallet') {
    return 'Paid from Wallet';
  }

  switch (order.paymentStatus) {
    case 'Paid': {
      const instrument = order.paymentInstrument;
      // Part wallet, part gateway — which is what an order paid from wallet and then topped up
      // online looks like. Naming only the card would hide the credit they spent, and naming only
      // the wallet would hide the money that actually left their bank.
      if (order.walletAmountApplied > 0 && instrument) {
        return `Paid — wallet + ${PAYMENT_INSTRUMENT_SHORT[instrument] ?? 'online'}`;
      }
      return (instrument && PAYMENT_INSTRUMENT_LABELS[instrument]) ?? 'Paid Online';
    }
    case 'PartiallyPaid':
      return 'Part-paid — balance due';
    case 'Failed':
      return 'Payment Failed';
    default:
      return 'Payment Pending';
  }
}

/**
 * What the customer still owes on an order: its total, less everything settled against it —
 * money actually captured plus anything the gateway discounted on its own payment page.
 *
 * Mirrors `Order.SettledAmount` on the server, and deliberately not `totalAmount - amountPaid`:
 * a customer who used a bank offer was charged less than the order was raised for and owes
 * nothing further, so measuring against money received alone would keep asking them for a
 * difference that had already been discounted away.
 */
export function amountOutstanding(order: OrderResponse): number {
  const settled = order.amountPaid + (order.gatewayDiscount ?? 0);
  return roundToPaise(order.totalAmount - settled);
}

/** Money is computed in paise everywhere, so comparisons don't turn on floating-point dust. */
function roundToPaise(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * True when the only useful thing left to do with an order is pay for it.
 *
 * This exists because an unpaid order used to be a dead end: it sat in the customer's list saying
 * "Payment Pending", offered Edit and Cancel, and gave them no way at all to hand over the money.
 * Anything this returns true for must be shown a way to pay.
 *
 * Deliberately excludes:
 *  - a failed payment, whose route forward is "Try payment again" — standing an order down
 *    cancels it and puts the stock back, so it is re-placed rather than paid for;
 *  - a legacy Cash on Delivery order, which is settled at the door;
 *  - an order with a pending amendment, which has its own Pay button for its own amount. Offering
 *    both is how a customer pays twice for the same change.
 */
export function canPayOnline(order: OrderResponse): boolean {
  const status = order.status.toLowerCase();
  if (status === 'cancelled' || status === 'delivered') return false;
  if (isPaymentFailed(order)) return false;
  if (isCashOnDelivery(order)) return false;
  if (order.pendingAmendment) return false;
  return amountOutstanding(order) > 0;
}

/** An order whose payment never went through. Deliberately its own idea rather than a shade of
 * "cancelled": nothing was bought, nothing was charged, and the only thing the customer can
 * usefully do is try again — so it is presented differently and can't be edited. */
export function isPaymentFailed(order: OrderResponse): boolean {
  return order.paymentStatus === 'Failed';
}

/**
 * The server's answer to "let me pay what this order still owes". Exactly one of the three
 * outcomes below applies, and they must not be collapsed into one another — telling a customer
 * whose money already arrived to pay again is the failure this whole endpoint exists to prevent.
 */
export interface ResumePaymentResponse {
  /** The order as it now stands, after the server reconciled it against the gateway. */
  order: OrderResponse;
  /** What is still owed, computed server-side. The browser never names a price. */
  amountDue: number;
  /** Set when a fresh gateway order was raised and the customer should be sent to pay. */
  paymentSessionId?: string | null;
  /** Asking the gateway turned up money we hadn't recorded. Nothing is owed. */
  alreadyPaid?: boolean;
  /** A payment is still with the bank. No second one may be started until it resolves. */
  paymentInFlight?: boolean;
}

export interface DeliveryEstimate {
  label: string;
  /** True once the whole window has passed with the order still undelivered. */
  delayed: boolean;
}

/** Local midnight, so "which day is it" comparisons don't turn on the time of day. */
function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatDay(date: Date): string {
  return date.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** How long delivery takes, in days from the order being placed. */
export const DELIVERY_DAYS_MIN = 1;
export const DELIVERY_DAYS_MAX = 2;

/**
 * The span an order placed at `placedAt` is expected to arrive within: the day after, through the
 * day after that. One definition, shared by the promise made on a product page before buying and
 * the estimate shown against the order afterwards, so the two can't drift apart.
 */
export function deliveryWindow(placedAt = new Date()): { from: Date; to: Date } {
  const from = startOfDay(placedAt);
  from.setDate(from.getDate() + DELIVERY_DAYS_MIN);

  const to = startOfDay(placedAt);
  to.setDate(to.getDate() + DELIVERY_DAYS_MAX);

  return { from, to };
}

/** Just the span: "1–2 days". For places whose own heading already says what it refers to. */
export function deliveryDaysLabel(): string {
  return `${DELIVERY_DAYS_MIN}–${DELIVERY_DAYS_MAX} days`;
}

/** The delivery window as two dates — "31 Aug - 2 Sep". Used before purchase, where a customer
 * comparing options wants the days themselves rather than a count of them. Derived from the same
 * `deliveryWindow` as the post-purchase estimate, so the two can never promise different things. */
export function deliveryBetweenLabel(placedAt = new Date()): string {
  const { from, to } = deliveryWindow(placedAt);
  const day = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return `${day(from)} - ${day(to)}`;
}

/** The pre-purchase promise: "Arriving in 1–2 days". */
export function deliveryPromiseLabel(): string {
  return `Arriving in ${deliveryDaysLabel()}`;
}

/** The outer edge of that window as a date, so the promise is checkable rather than vague. */
export function deliveryPromiseByDate(now = new Date()): string {
  return formatDay(deliveryWindow(now).to);
}

/**
 * When the customer should expect their order: within one to two days of placing it. Derived from
 * the order's own `createdAt` rather than stored, so it stays right without anything having to
 * keep it up to date, and it narrows on its own as the window closes — "in 1–2 days" the day it
 * is placed, then "today or tomorrow", then "today".
 *
 * Once the window has passed with the order still undelivered, it says so rather than leaving a
 * date that has already gone by on screen. Nothing is promised at all for an order that is
 * finished, cancelled, or not yet paid for — there is no delivery to promise until there is a sale.
 */
export function deliveryEstimate(order: OrderResponse, now = new Date()): DeliveryEstimate | null {
  const status = order.status.toLowerCase();
  if (status === 'delivered' || status === 'cancelled') return null;
  if (isPaymentFailed(order)) return null;
  // Legacy COD orders are the one kind that is genuinely on its way while still unpaid.
  if (order.amountPaid <= 0 && order.paymentMethod !== 'COD') return null;

  const placed = new Date(order.createdAt);
  if (Number.isNaN(placed.getTime())) return null;

  const { from, to } = deliveryWindow(placed);
  const today = startOfDay(now).getTime();

  if (today > to.getTime()) {
    return { label: "Delayed — we'll attempt delivery in the next 1–2 days", delayed: true };
  }
  if (today === to.getTime()) return { label: 'Arriving today', delayed: false };
  if (today === from.getTime()) return { label: 'Arriving today or tomorrow', delayed: false };
  return { label: `${deliveryPromiseLabel()}, by ${formatDay(to)}`, delayed: false };
}

/** Orders placed before Cash on Delivery was retired. No new order can be one, but these still
 * exist and are still the only kind where money changes hands at the door. */
export function isCashOnDelivery(order: OrderResponse): boolean {
  return order.paymentMethod === 'COD';
}

/** The icon that goes with `paymentLabel`. Shared so the customer, admin and delivery views
 * describe the same order the same way — they used to each hardcode their own guess. */
export function paymentIcon(order: OrderResponse): string {
  if (isCashOnDelivery(order)) return 'payments';
  switch (order.paymentStatus) {
    case 'Paid':
      return 'verified';
    case 'Failed':
      return 'error_outline';
    case 'PartiallyPaid':
      return 'account_balance_wallet';
    default:
      return 'schedule';
  }
}

/** True when the order is square: paid online, or cash taken at the door for a legacy COD one. */
export function isPaymentSettled(order: OrderResponse): boolean {
  return order.paymentStatus === 'Paid' || order.paymentStatus === 'Collected';
}

/** True when money is still owed — a failed payment, or an edit that outran what was captured. */
export function isPaymentOutstanding(order: OrderResponse): boolean {
  return order.paymentStatus === 'Failed' || order.paymentStatus === 'PartiallyPaid';
}

export interface StaffUserResponse {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  role: UserRole;
  /** True while the account still has no password - the invite was sent but never accepted. */
  invitePending?: boolean;
  /** Set while an admin-approved device enrollment is standing by, so this account's next
   * device can enroll on password alone with no OTP email. Null once consumed or expired. */
  pendingDeviceApprovalExpiresAt?: string | null;
}

/** No password: the account is created dormant and the staff member sets their own via the
 * emailed invite, so an admin never handles someone else's credentials. */
export interface CreateStaffRequest {
  fullName: string;
  email: string;
  phone: string;
  role: Exclude<UserRole, 'customer'>;
}

export interface CreateStaffResponse extends StaffUserResponse {
  /** Populated outside Production only, so the flow can be walked without a working inbox. */
  devInviteToken?: string | null;
}

export interface AcceptInviteRequest {
  token: string;
  password: string;
}

export interface InvitePreviewResponse {
  fullName: string;
  email: string;
  role: UserRole;
}

export interface ResendInviteResponse {
  message: string;
  devInviteToken?: string | null;
}

/** Step one of moving a staff account to a new device: proves the password, triggers the code. */
export interface DeviceOtpRequest {
  email: string;
  password: string;
}

export interface DeviceOtpResponse {
  message: string;
  /** Populated outside Production only, so the flow can be tested without real email set up. */
  devCode?: string | null;
  /** True when an admin already cleared this account's next device ahead of time - no code was
   * sent, and the caller should go straight to PreApprovedEnrollRequest instead. */
  preApproved?: boolean;
}

/** Step two: redeeming the code binds the calling browser as the account's one trusted device. */
export interface EnrollDeviceRequest {
  email: string;
  password: string;
  code: string;
}

/** Alternative to EnrollDeviceRequest for an account with a standing admin approval - no code,
 * since the trust comes from the admin's own action rather than proof of email control. */
export interface PreApprovedEnrollRequest {
  email: string;
  password: string;
}

export interface ForgotPasswordRequest {
  email: string;
  turnstileToken: string;
}

export interface ForgotPasswordResponse {
  message: string;
  /** Populated outside Production only, so the flow can be tested without real email set up. */
  devCode?: string | null;
}

export interface ResetPasswordRequest {
  email: string;
  code: string;
  newPassword: string;
}

/** The pre-widget raw-code send path - still functions server-side (kept as a fallback, not
 * deleted) but is no longer called from the login page, which sends via Msg91WidgetService
 * instead. Left here only for completeness against the still-live endpoint. */
export interface PhoneLoginRequest {
  phone: string;
  turnstileToken: string;
}

export interface PhoneLoginResponse {
  message: string;
  /** Populated outside Production only, so the flow can be tested without real MSG91 set up. */
  devCode?: string | null;
}

/** widgetToken is the access token Msg91WidgetService.verifyOtp() resolves with - the backend
 * checks it against MSG91 and binds it to this exact phone (Msg91WidgetVerifier), so a token
 * verified for one number can't be replayed against another. */
export interface PhoneLoginVerifyRequest {
  phone: string;
  widgetToken: string;
}

export interface StaffDeviceResponse {
  label: string;
  enrolledVia: string;
  createdAt: string;
  lastSeenAt: string;
}

export interface UpdateOrderStatusRequest {
  status: string;
}

export interface AssignDeliveryPartnerRequest {
  deliveryPartnerId: string;
}

export interface SavedAddress {
  label: string;
  /** Empty for addresses saved before this field existed. */
  phone: string;
  fullAddress: string;
  latitude: number;
  longitude: number;
  mapLink?: string | null;
  isDefault: boolean;
}

export interface SaveAddressRequest {
  label: string;
  phone: string;
  fullAddress: string;
  latitude: number;
  longitude: number;
  isDefault: boolean;
}

export interface UpdateProfileRequest {
  fullName: string;
  email: string;
  phone: string;
}

export interface UserProfileResponse {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  createdAt: string;
  savedAddresses: SavedAddress[];
}

/** Topic always comes from a quick-reply button the widget rendered - there is no free-text
 * input. Undefined means "show the greeting and main menu" (the very first request). */
export interface ChatbotRequest {
  topic?: string;
}

export interface ChatbotQuickReply {
  label: string;
  topic: string;
}

/** Escalate is a display hint (surface the contact details more prominently), not a separate
 * channel - reply already contains everything the bot has to say. */
export interface ChatbotResponse {
  reply: string;
  escalate: boolean;
  quickReplies: ChatbotQuickReply[];
}
