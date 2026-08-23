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
