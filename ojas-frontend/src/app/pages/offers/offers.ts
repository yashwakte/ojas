import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import {
  COUPONS,
  Coupon,
  FREE_DELIVERY_CART_THRESHOLD,
  calculateCouponDiscount,
  roundMoney,
} from '../../constants/pricing';
import { CartService } from '../../services/cart.service';

interface CouponOffer {
  coupon: Coupon;
  /** What the coupon is worth on an order that only just qualifies. A rupee figure is what a
   * shopper compares, not a percentage. */
  savingAtMinimum: number;
  qualifies: boolean;
  /** How much more the cart needs, when there is a cart and it is not there yet. */
  shortfall: number | null;
}

/**
 * The offers the shop actually runs. Everything on it is read from `constants/pricing.ts` - the
 * same catalogue the checkout's coupon picker uses, which mirrors `OrderPricing.cs` on the server -
 * so this page cannot advertise a coupon, a minimum or a percentage that checkout would not honour.
 */
@Component({
  selector: 'app-offers',
  imports: [DecimalPipe, RouterLink, MatIconModule],
  templateUrl: './offers.html',
  styleUrl: './offers.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Offers {
  private readonly cart = inject(CartService);

  readonly freeDeliveryThreshold = FREE_DELIVERY_CART_THRESHOLD;
  readonly cartTotal = this.cart.totalAmount;

  readonly couponOffers = computed<CouponOffer[]>(() => {
    const total = this.cartTotal();
    return COUPONS.map((coupon) => ({
      coupon,
      savingAtMinimum: calculateCouponDiscount(coupon, coupon.minCartValue).amount,
      qualifies: total >= coupon.minCartValue,
      shortfall: total > 0 && total < coupon.minCartValue ? roundMoney(coupon.minCartValue - total) : null,
    }));
  });

  readonly qualifiesForFreeDelivery = computed(() => this.cartTotal() >= FREE_DELIVERY_CART_THRESHOLD);

  readonly freeDeliveryShortfall = computed(() => {
    const total = this.cartTotal();
    return total > 0 && total < FREE_DELIVERY_CART_THRESHOLD
      ? roundMoney(FREE_DELIVERY_CART_THRESHOLD - total)
      : null;
  });
}
