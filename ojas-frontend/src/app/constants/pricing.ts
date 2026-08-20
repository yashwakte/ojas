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

export function calculateCouponDiscount(
  coupon: Coupon | null,
  subtotal: number,
): { percentage: number; amount: number } {
  if (!coupon || subtotal < coupon.minCartValue) return { percentage: 0, amount: 0 };
  return {
    percentage: coupon.discountPercentage,
    amount: Math.round(((subtotal * coupon.discountPercentage) / 100) * 100) / 100,
  };
}

export function qualifiesForFreeDelivery(subtotal: number): boolean {
  return subtotal >= FREE_DELIVERY_CART_THRESHOLD;
}
