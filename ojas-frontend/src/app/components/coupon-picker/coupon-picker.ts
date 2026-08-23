import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { Coupon } from '../../constants/pricing';

/**
 * A Swiggy/Zomato-style coupon sheet: mounted only while open (the parent
 * gates it with `@if`, the same way `MapPicker` is mounted), so this
 * component owns no open/close state of its own — just the pick.
 */
@Component({
  selector: 'app-coupon-picker',
  imports: [MatIconModule, DecimalPipe],
  templateUrl: './coupon-picker.html',
  styleUrl: './coupon-picker.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CouponPicker {
  coupons = input.required<readonly Coupon[]>();
  subtotal = input.required<number>();
  appliedCode = input<string | null>(null);

  /** Null means "remove the currently applied coupon". */
  picked = output<string | null>();
  closed = output<void>();

  isEligible(coupon: Coupon): boolean {
    return this.subtotal() >= coupon.minCartValue;
  }

  choose(coupon: Coupon): void {
    if (!this.isEligible(coupon)) return;
    this.picked.emit(this.appliedCode() === coupon.code ? null : coupon.code);
    this.closed.emit();
  }
}
