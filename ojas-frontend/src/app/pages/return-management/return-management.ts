import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ReturnService } from '../../services/return.service';
import {
  RETURN_STATUS_LABELS,
  ReturnRequestResponse,
  ReturnStatus,
  returnReasonLabel,
} from '../../models/interfaces';

/** The buckets the queue is filtered by. "Open" is everything still waiting on a human, and it
 * is the default because that is the whole reason this pane exists. */
type ReturnFilter = 'open' | 'Requested' | 'Approved' | 'PickedUp' | 'settled';

@Component({
  selector: 'app-return-management',
  imports: [
    FormsModule,
    DecimalPipe,
    DatePipe,
    MatIconModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
  ],
  templateUrl: './return-management.html',
  styleUrl: './return-management.scss',
})
export class ReturnManagement implements OnInit {
  private readonly returnService = inject(ReturnService);
  private readonly snackBar = inject(MatSnackBar);

  readonly queue = this.returnService.queue;
  readonly loading = this.returnService.loading;
  readonly error = this.returnService.error;

  readonly statusLabels = RETURN_STATUS_LABELS;
  readonly reasonLabel = returnReasonLabel;

  readonly filter = signal<ReturnFilter>('open');
  /** The return whose action is in flight, so only that card waits rather than the whole pane. */
  readonly busyId = signal<string | null>(null);
  /** The return being refused, and the reason being typed for it. A refusal without a reason is
   * refused by the API too - the customer has to be told something. */
  readonly rejectingId = signal<string | null>(null);
  readonly rejectReason = signal('');
  /** Just acted on, so the card can flash and the pane can scroll back to it. */
  readonly justActedId = signal<string | null>(null);

  readonly filters: { id: ReturnFilter; label: string }[] = [
    { id: 'open', label: 'Needs action' },
    { id: 'Requested', label: 'Requested' },
    { id: 'Approved', label: 'To collect' },
    { id: 'PickedUp', label: 'To refund' },
    { id: 'settled', label: 'Finished' },
  ];

  readonly visible = computed(() => {
    const filter = this.filter();
    return this.queue().filter((r) => {
      if (filter === 'open') {
        return r.status === 'Requested' || r.status === 'Approved' || r.status === 'PickedUp';
      }
      if (filter === 'settled') {
        return r.status === 'Refunded' || r.status === 'Rejected' || r.status === 'Cancelled';
      }
      return r.status === filter;
    });
  });

  /** What is owed on returns that have been collected but not yet paid out. The one number the
   * owner needs at a glance: it is money the business is holding that belongs to customers. */
  readonly awaitingRefund = computed(() =>
    this.queue()
      .filter((r) => r.status === 'PickedUp')
      .reduce((sum, r) => sum + r.refundAmount, 0),
  );

  readonly countFor = (filter: ReturnFilter): number => {
    const all = this.queue();
    if (filter === 'open') {
      return all.filter(
        (r) => r.status === 'Requested' || r.status === 'Approved' || r.status === 'PickedUp',
      ).length;
    }
    if (filter === 'settled') {
      return all.filter(
        (r) => r.status === 'Refunded' || r.status === 'Rejected' || r.status === 'Cancelled',
      ).length;
    }
    return all.filter((r) => r.status === filter).length;
  };

  ngOnInit(): void {
    this.returnService.loadQueue();
  }

  reload(): void {
    this.returnService.loadQueue();
  }

  setFilter(filter: ReturnFilter): void {
    this.filter.set(filter);
  }

  totalUnits(request: ReturnRequestResponse): number {
    return request.items.reduce((sum, i) => sum + i.quantity, 0);
  }

  /** The step this return is waiting for, as a button label. Null once it is finished. */
  nextAction(request: ReturnRequestResponse): { status: ReturnStatus; label: string } | null {
    switch (request.status) {
      case 'Requested':
        return { status: 'Approved', label: 'Approve & schedule pickup' };
      case 'Approved':
        return { status: 'PickedUp', label: 'Mark collected' };
      case 'PickedUp':
        return { status: 'Refunded', label: 'Refund the customer' };
      default:
        return null;
    }
  }

  /** Whether refusing is still possible. Right up until the money has gone: a pack can turn out
   * to have been opened once it is back with us, which is exactly when we find out. */
  canReject(request: ReturnRequestResponse): boolean {
    return (
      request.status === 'Requested' ||
      request.status === 'Approved' ||
      request.status === 'PickedUp'
    );
  }

  advance(request: ReturnRequestResponse): void {
    const next = this.nextAction(request);
    if (!next) return;

    this.busyId.set(request.id);
    this.returnService.updateStatus(request.id, { status: next.status }).subscribe({
      next: (settlement) => {
        this.busyId.set(null);
        this.reveal(request.id);

        if (next.status !== 'Refunded') {
          this.snackBar.open(`Return ${this.statusLabels[next.status]}.`, 'Close', {
            duration: 3000,
          });
          return;
        }

        // What actually happened to the money, rather than what we assumed would. A refund to
        // the original payment method can be partly queued if the gateway refuses a leg, and the
        // admin has to be told that rather than reading a flat "refunded".
        const parts: string[] = [];
        if (settlement.walletCredited > 0)
          parts.push(`₹${settlement.walletCredited.toFixed(2)} to their wallet`);
        if (settlement.refundedToSource > 0)
          parts.push(`₹${settlement.refundedToSource.toFixed(2)} back to their payment method`);
        if (settlement.refundQueued > 0)
          parts.push(`₹${settlement.refundQueued.toFixed(2)} queued for a manual refund`);

        this.snackBar.open(
          parts.length > 0 ? `Refunded: ${parts.join(', ')}.` : 'Return closed.',
          'Close',
          { duration: 7000 },
        );

        if (settlement.refundError) {
          this.snackBar.open(settlement.refundError, 'Close', { duration: 8000 });
        }
      },
      error: (err) => {
        this.busyId.set(null);
        this.snackBar.open(
          err?.error?.message ?? 'That step could not be applied.',
          'Close',
          { duration: 6000 },
        );
        // The queue may have moved under us — another admin, another tab. Re-read rather than
        // leaving a card showing a state the server has already left.
        this.reload();
      },
    });
  }

  startReject(request: ReturnRequestResponse): void {
    this.rejectingId.set(request.id);
    this.rejectReason.set('');
  }

  cancelReject(): void {
    this.rejectingId.set(null);
    this.rejectReason.set('');
  }

  confirmReject(request: ReturnRequestResponse): void {
    const reason = this.rejectReason().trim();
    if (!reason) return;

    this.busyId.set(request.id);
    this.returnService
      .updateStatus(request.id, { status: 'Rejected', note: reason })
      .subscribe({
        next: () => {
          this.busyId.set(null);
          this.cancelReject();
          this.reveal(request.id);
          this.snackBar.open('Return refused, and the customer has been told why.', 'Close', {
            duration: 5000,
          });
        },
        error: (err) => {
          this.busyId.set(null);
          this.snackBar.open(
            err?.error?.message ?? 'That return could not be refused.',
            'Close',
            { duration: 6000 },
          );
        },
      });
  }

  /**
   * Puts the admin back on the return they just acted on.
   *
   * Acting on a card can move it out of the current filter entirely - approving a request drops
   * it out of "Requested" - and the browser keeps whatever scroll offset it had, which lands
   * somewhere past the end of a now-shorter list. Scrolling to the card is both the fix and the
   * more useful destination: it is the row whose change they want to see.
   *
   * Same helper and same reasoning as the product and hero panes; these must behave identically.
   */
  private reveal(id: string): void {
    this.justActedId.set(id);
    this.scrollTo(`return-${id}`, 'center');

    setTimeout(() => {
      if (this.justActedId() === id) this.justActedId.set(null);
    }, 2500);
  }

  private scrollTo(elementId: string, block: ScrollLogicalPosition, attemptsLeft = 5): void {
    requestAnimationFrame(() => {
      const target = document.getElementById(elementId);
      if (!target) {
        if (attemptsLeft > 1) this.scrollTo(elementId, block, attemptsLeft - 1);
        return;
      }
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block });
    });
  }
}
