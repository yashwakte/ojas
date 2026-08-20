import { TestBed } from '@angular/core/testing';
import { CouponPicker } from './coupon-picker';
import { COUPONS } from '../../constants/pricing';

describe('CouponPicker', () => {
  function create(subtotal: number, appliedCode: string | null = null) {
    TestBed.configureTestingModule({ imports: [CouponPicker] });
    const fixture = TestBed.createComponent(CouponPicker);
    fixture.componentRef.setInput('coupons', COUPONS);
    fixture.componentRef.setInput('subtotal', subtotal);
    fixture.componentRef.setInput('appliedCode', appliedCode);
    fixture.detectChanges();
    return fixture;
  }

  it('isEligible reflects whether the cart clears each coupon minimum', () => {
    const fixture = create(1200);
    const save5 = COUPONS.find((c) => c.code === 'SAVE5')!;
    const save10 = COUPONS.find((c) => c.code === 'SAVE10')!;

    expect(fixture.componentInstance.isEligible(save5)).toBeTrue();
    expect(fixture.componentInstance.isEligible(save10)).toBeFalse();
  });

  it('choose emits the code and closes when picking an eligible, unapplied coupon', () => {
    const fixture = create(1200);
    const save5 = COUPONS.find((c) => c.code === 'SAVE5')!;
    const pickedSpy = jasmine.createSpy('picked');
    const closedSpy = jasmine.createSpy('closed');
    fixture.componentInstance.picked.subscribe(pickedSpy);
    fixture.componentInstance.closed.subscribe(closedSpy);

    fixture.componentInstance.choose(save5);

    expect(pickedSpy).toHaveBeenCalledWith('SAVE5');
    expect(closedSpy).toHaveBeenCalled();
  });

  it('choose emits null when picking the already-applied coupon (removes it)', () => {
    const fixture = create(1200, 'SAVE5');
    const save5 = COUPONS.find((c) => c.code === 'SAVE5')!;
    const pickedSpy = jasmine.createSpy('picked');
    fixture.componentInstance.picked.subscribe(pickedSpy);

    fixture.componentInstance.choose(save5);

    expect(pickedSpy).toHaveBeenCalledWith(null);
  });

  it('choose does nothing for a coupon the cart has not unlocked', () => {
    const fixture = create(500);
    const save5 = COUPONS.find((c) => c.code === 'SAVE5')!;
    const pickedSpy = jasmine.createSpy('picked');
    const closedSpy = jasmine.createSpy('closed');
    fixture.componentInstance.picked.subscribe(pickedSpy);
    fixture.componentInstance.closed.subscribe(closedSpy);

    fixture.componentInstance.choose(save5);

    expect(pickedSpy).not.toHaveBeenCalled();
    expect(closedSpy).not.toHaveBeenCalled();
  });
});
