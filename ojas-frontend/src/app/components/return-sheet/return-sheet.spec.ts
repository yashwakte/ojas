import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReturnSheet } from './return-sheet';
import { ReturnEligibility } from '../../models/interfaces';

/**
 * The sheet decides what the customer is allowed to ask for and what they are told they will get
 * back. Both are money-adjacent, so they are pinned here rather than left to the API to catch:
 * a sheet that offers four of something and promises the wrong refund produces a support call
 * even when the server correctly refuses it.
 */
describe('ReturnSheet', () => {
  const eligibility = (over: Partial<ReturnEligibility> = {}): ReturnEligibility => ({
    canRequest: true,
    reason: null,
    windowEndsAt: new Date(Date.now() + 86400000).toISOString(),
    windowDays: 3,
    refundable: 1000,
    items: [
      {
        productId: 'p1',
        productName: 'Bajra Flour',
        weight: '1kg',
        price: 100,
        orderedQuantity: 3,
        returnableQuantity: 3,
        unitRefund: 90,
      },
      {
        productId: 'p2',
        productName: 'Rice Flour',
        weight: '500g',
        price: 60,
        orderedQuantity: 2,
        returnableQuantity: 1,
        unitRefund: 54,
      },
    ],
    ...over,
  });

  let fixture: ComponentFixture<ReturnSheet>;
  let component: any;

  function create(over: Partial<ReturnEligibility> = {}) {
    TestBed.configureTestingModule({ imports: [ReturnSheet] });
    fixture = TestBed.createComponent(ReturnSheet);
    fixture.componentRef.setInput('orderId', 'order-1');
    fixture.componentRef.setInput('eligibility', eligibility(over));
    fixture.detectChanges();
    component = fixture.componentInstance;
    return fixture;
  }

  it('offers only lines that still have something returnable', () => {
    create({
      items: [
        {
          productId: 'p1',
          productName: 'Bajra Flour',
          weight: '1kg',
          price: 100,
          orderedQuantity: 3,
          returnableQuantity: 0,
          unitRefund: 90,
        },
      ],
    });

    // A line already claimed by an earlier request is not a choice; showing it greyed would only
    // invite the question.
    expect(component.returnable().length).toBe(0);
  });

  it('totals the refund from the server figures, not from the price', () => {
    create();
    const [first] = component.returnable();

    component.toggle(first);
    // The unit refund is 90, not the 100 on the pack — the order carried a basket discount.
    expect(component.refundTotal()).toBe(90);

    component.increase(first);
    expect(component.refundTotal()).toBe(180);
  });

  it('never promises more than the order can still refund', () => {
    create({ refundable: 100 });
    const [first] = component.returnable();

    component.toggle(first);
    component.increase(first);
    component.increase(first);

    // Three at 90 is 270, but the order only holds 100 — and the API applies the same cap when
    // it settles, so the button must not promise the larger number.
    expect(component.refundTotal()).toBe(100);
  });

  it('will not exceed the returnable quantity of a line', () => {
    create();
    const riceFlour = component.returnable()[1];

    component.toggle(riceFlour);
    component.increase(riceFlour);
    component.increase(riceFlour);

    expect(component.quantityFor(riceFlour)).toBe(1);
  });

  it('tapping a chosen line again clears it', () => {
    create();
    const [first] = component.returnable();

    component.toggle(first);
    expect(component.isPicked(first)).toBeTrue();

    component.toggle(first);
    expect(component.isPicked(first)).toBeFalse();
    expect(component.refundTotal()).toBe(0);
  });

  it('does not offer changing your mind as a reason', () => {
    create();
    // Removed by the owner on 2026-09-11 - "It's their fault not ours". A customer who genuinely
    // ordered the wrong thing picks "Something else" and writes it, where a human decides.
    const labels = component.reasons.map((r: { label: string }) => r.label);
    expect(labels).not.toContain('Ordered by mistake');
    expect(labels).toContain('Something else');
  });

  it('cannot be submitted without both an item and a reason', () => {
    create();
    const [first] = component.returnable();

    expect(component.canSubmit()).toBeFalse();

    component.toggle(first);
    expect(component.canSubmit()).toBeFalse();

    component.chooseReason('Damaged');
    expect(component.canSubmit()).toBeTrue();
  });

  it('requires a note when the reason is "something else"', () => {
    create();
    component.toggle(component.returnable()[0]);
    component.chooseReason('Other');

    // "Other" with nothing after it tells whoever picks this up nothing at all.
    expect(component.commentMissing()).toBeTrue();

    const emitted: unknown[] = [];
    component.confirmed.subscribe((d: unknown) => emitted.push(d));
    component.submit();
    expect(emitted.length).toBe(0);

    component.comment.set('The bag was torn along the seam');
    expect(component.commentMissing()).toBeFalse();
  });

  it('emits what was chosen, with no money in it', () => {
    create();
    const [first] = component.returnable();
    component.toggle(first);
    component.increase(first);
    component.chooseReason('Damaged');
    component.chooseDestination('source');

    let draft: any = null;
    component.confirmed.subscribe((d: unknown) => (draft = d));
    component.submit();

    expect(draft).toEqual({
      items: [{ productId: 'p1', quantity: 2 }],
      reason: 'Damaged',
      comment: null,
      refundDestination: 'source',
    });
    // The refund is derived server-side from the order. A request that named its own amount
    // would be a self-service withdrawal.
    expect(Object.keys(draft)).not.toContain('refundAmount');
  });
});
