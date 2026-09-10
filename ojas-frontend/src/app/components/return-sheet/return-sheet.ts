import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import {
  RETURN_REASONS,
  RefundDestination,
  ReturnEligibility,
  ReturnReason,
  ReturnableItem,
} from '../../models/interfaces';
import { RETURN_WINDOW_DAYS } from '../../constants/business';

/** What the customer has decided, handed back to the page that opened the sheet. */
export interface ReturnDraft {
  items: { productId: string; quantity: number }[];
  reason: ReturnReason;
  comment: string | null;
  refundDestination: RefundDestination;
}

/**
 * Asking to send part of a delivered order back.
 *
 * The shape every large marketplace uses, and for good reasons worth keeping: returns are
 * **per item, with a quantity**, because a customer who ordered three packs and wants to return
 * one should not have to send back all three; the **reason is a fixed list**, because we count
 * them and free text cannot be counted; and the **refund total is shown before they commit**, so
 * nobody discovers what they are getting back after the goods have gone.
 *
 * Two rules this sheet is careful about. Every rupee figure comes from the server's own
 * eligibility response — the sheet adds up numbers it was given and never derives them from the
 * price, because the order may carry a basket discount and a gateway offer that both change what
 * a pack is worth back. And the unopened-pack condition is stated on the sheet itself rather than
 * only in the policy: it is the one condition that gets a return refused, so the moment to say it
 * is before the request, not after.
 *
 * Same surface as the quantity and address sheets — bottom sheet on a phone, centred card on a
 * desktop — so it reads as this app rather than as a form bolted on.
 */
@Component({
  selector: 'app-return-sheet',
  imports: [MatIconModule, FormsModule, DecimalPipe],
  templateUrl: './return-sheet.html',
  styleUrl: './return-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'close()',
  },
})
export class ReturnSheet {
  readonly eligibility = input.required<ReturnEligibility>();
  readonly orderId = input.required<string>();
  /** Wallet credit the customer already holds is irrelevant here; what matters is whether the
   * order was paid from the wallet at all, since that share can only ever go back there. */
  readonly walletOnly = input<boolean>(false);
  readonly submitting = input<boolean>(false);
  /** Set when the API refused the request, shown in the sheet rather than as a toast that
   * disappears while they are still reading it. */
  readonly errorMessage = input<string | null>(null);

  readonly confirmed = output<ReturnDraft>();
  readonly closed = output<void>();

  protected readonly windowDays = RETURN_WINDOW_DAYS;
  protected readonly reasons = RETURN_REASONS;

  /** productId -> how many of it are going back. Absent means none. */
  private readonly picked = signal<Record<string, number>>({});

  protected readonly reason = signal<ReturnReason | null>(null);
  protected readonly comment = signal('');
  protected readonly destination = signal<RefundDestination>('wallet');

  /** Only lines with something left to return are offered. A line already fully claimed by an
   * earlier request is not a choice, and showing it greyed would only invite the question. */
  protected readonly returnable = computed(() =>
    this.eligibility().items.filter((i) => i.returnableQuantity > 0),
  );

  protected quantityFor(item: ReturnableItem): number {
    return this.picked()[item.productId] ?? 0;
  }

  protected isPicked(item: ReturnableItem): boolean {
    return this.quantityFor(item) > 0;
  }

  /** Tapping the row picks one; tapping again clears it. The stepper handles anything more. */
  protected toggle(item: ReturnableItem): void {
    this.picked.update((current) => {
      const next = { ...current };
      if (next[item.productId]) delete next[item.productId];
      else next[item.productId] = 1;
      return next;
    });
  }

  protected increase(item: ReturnableItem): void {
    this.picked.update((current) => ({
      ...current,
      [item.productId]: Math.min(item.returnableQuantity, (current[item.productId] ?? 0) + 1),
    }));
  }

  protected decrease(item: ReturnableItem): void {
    this.picked.update((current) => {
      const next = { ...current };
      const remaining = (next[item.productId] ?? 0) - 1;
      if (remaining <= 0) delete next[item.productId];
      else next[item.productId] = remaining;
      return next;
    });
  }

  protected readonly selectedCount = computed(() =>
    Object.values(this.picked()).reduce((sum, q) => sum + q, 0),
  );

  /**
   * What they will get back, added up from the server's per-unit figures.
   *
   * Capped at what the order can still refund, which is the same cap the API applies when the
   * return is finally settled — so the number on the button is the number that lands, rather than
   * a promise the order cannot honour.
   */
  protected readonly refundTotal = computed(() => {
    const picked = this.picked();
    const raw = this.eligibility().items.reduce(
      (sum, item) => sum + (picked[item.productId] ?? 0) * item.unitRefund,
      0,
    );
    return Math.min(Math.round(raw * 100) / 100, this.eligibility().refundable);
  });

  protected readonly canSubmit = computed(
    () => this.selectedCount() > 0 && this.reason() !== null && !this.submitting(),
  );

  /** A free-text note is required for "Something else" — a reason of "other" with nothing after
   * it tells whoever picks this up nothing at all. */
  protected readonly needsComment = computed(() => this.reason() === 'Other');

  protected readonly commentMissing = computed(
    () => this.needsComment() && this.comment().trim().length === 0,
  );

  protected chooseReason(reason: ReturnReason): void {
    this.reason.set(reason);
  }

  protected chooseDestination(destination: RefundDestination): void {
    this.destination.set(destination);
  }

  protected submit(): void {
    if (!this.canSubmit() || this.commentMissing()) return;

    const picked = this.picked();
    this.confirmed.emit({
      items: Object.entries(picked).map(([productId, quantity]) => ({ productId, quantity })),
      reason: this.reason()!,
      comment: this.comment().trim() || null,
      refundDestination: this.destination(),
    });
  }

  protected close(): void {
    this.closed.emit();
  }
}
