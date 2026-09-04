/**
 * Coupon catalog and the free-delivery threshold. Mirrors `OrderPricing.cs` on the
 * backend, which is the authoritative source — this copy only drives the checkout
 * preview shown before an order is placed. A coupon must be explicitly picked by the
 * customer (never auto-applied), and only one can be active at a time.
 */
export interface Coupon {
  code: string;
  title: string;
  discountPercentage: number;
  minCartValue: number;
}

export const COUPONS: readonly Coupon[] = [
  { code: 'SAVE5', title: 'Flat 5% Off', discountPercentage: 5, minCartValue: 1000 },
  { code: 'SAVE10', title: 'Flat 10% Off', discountPercentage: 10, minCartValue: 2000 },
];

export const FREE_DELIVERY_CART_THRESHOLD = 500;

/**
 * Rounds an amount to the paise. Every money figure derived from arithmetic goes through this:
 * summing and subtracting floats leaves noise that reaches the customer verbatim otherwise —
 * "Add ₹24.30000000000001 more to get FREE delivery" is what prompted this existing.
 *
 * It also matters beyond display. A difference that should be exactly zero can land at
 * 0.0000000001, which is enough to read as "you owe more" and ask a customer to pay for nothing.
 */
export function roundMoney(amount: number): number {
  return Number(amount.toFixed(2));
}

export function calculateCouponDiscount(
  coupon: Coupon | null,
  subtotal: number,
): { percentage: number; amount: number } {
  if (!coupon || subtotal < coupon.minCartValue) return { percentage: 0, amount: 0 };
  return {
    percentage: coupon.discountPercentage,
    amount: roundMoney((subtotal * coupon.discountPercentage) / 100),
  };
}

export function qualifiesForFreeDelivery(subtotal: number): boolean {
  return subtotal >= FREE_DELIVERY_CART_THRESHOLD;
}

/**
 * The "add ₹X more and delivery is free" line, or null when there is nothing to say.
 *
 * There are two entirely separate ways delivery ends up free on Ojas, and the nudge is only ever
 * about one of them. The cart-value threshold above waives a charge; the *distance* rules waive it
 * too, for anyone inside the free radius (and will waive it for everyone once that radius is set
 * to cover the whole delivery area). Offering to unlock something a customer already has reads as
 * a shop that doesn't know its own prices — and it invites them to spend more for nothing, which
 * is worse than merely wrong.
 *
 * So the nudge needs both halves: a cart below the threshold *and* a quoted delivery charge there
 * is actually something to remove. Kept here rather than in each page so the cart, the checkout
 * and the order-edit screen cannot drift apart on it.
 *
 * @param quotedDeliveryCharge what delivery costs for this address before any waiver — the
 * server's quote, not the post-threshold figure, which would make this always-zero and the nudge
 * never appear at all.
 */
export function freeDeliveryNudgeFor(
  subtotal: number,
  quotedDeliveryCharge: number,
): string | null {
  if (subtotal === 0 || qualifiesForFreeDelivery(subtotal)) return null;
  if (quotedDeliveryCharge <= 0) return null;

  const shortfall = roundMoney(FREE_DELIVERY_CART_THRESHOLD - subtotal);
  return `Add ₹${shortfall.toFixed(2)} more to get FREE delivery`;
}
