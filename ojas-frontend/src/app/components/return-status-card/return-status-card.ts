import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import {
  RETURN_STATUS_LABELS,
  RETURN_TIMELINE,
  ReturnRequestResponse,
  ReturnStatus,
  canCancelReturn,
  isReturnFinished,
  returnReasonLabel,
} from '../../models/interfaces';

/**
 * One return, as the customer sees it on their order.
 *
 * Its own component rather than markup inside the orders page for the ordinary reason - the
 * orders page is already the largest thing in the app and this is a self-contained card with its
 * own styles - and for one specific one: a return has a timeline, and a timeline is exactly the
 * kind of thing that gets quietly duplicated the moment a second screen wants to show it.
 *
 * A finished return stays on screen rather than disappearing. "What happened to the pack I sent
 * back" is the question the orders page exists to answer, and hiding settled returns is what
 * sends people to the phone.
 */
@Component({
  selector: 'app-return-status-card',
  imports: [MatIconModule, DecimalPipe],
  templateUrl: './return-status-card.html',
  styleUrl: './return-status-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReturnStatusCard {
  readonly request = input.required<ReturnRequestResponse>();
  /** True while this one's cancellation is in flight, so only it shows the waiting state. */
  readonly cancelling = input<boolean>(false);

  readonly cancelRequested = output<ReturnRequestResponse>();

  protected readonly statusLabels = RETURN_STATUS_LABELS;
  protected readonly timeline = RETURN_TIMELINE;
  protected readonly reasonLabel = returnReasonLabel;

  protected readonly finished = computed(() => isReturnFinished(this.request()));
  protected readonly cancellable = computed(() => canCancelReturn(this.request()));

  /** Rejected and cancelled are endings rather than steps, so they get no progress rail - a
   * track the return is never going to finish reads as though it still might. */
  protected readonly showTimeline = computed(
    () => this.request().status !== 'Rejected' && this.request().status !== 'Cancelled',
  );

  /** Anything we have said to the customer about this return, in the order it was said. */
  protected readonly notes = computed(() =>
    this.request()
      .events.filter((e) => !!e.note)
      .map((e) => e.note as string),
  );

  private step(): number {
    return Math.max(0, RETURN_TIMELINE.indexOf(this.request().status));
  }

  protected isStepDone(step: ReturnStatus): boolean {
    return RETURN_TIMELINE.indexOf(step) <= this.step();
  }

  protected cancel(): void {
    this.cancelRequested.emit(this.request());
  }
}
