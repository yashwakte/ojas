import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

/** The longest run offered. Past ten, a customer is better served by talking to us. */
const DEFAULT_MAX = 10;

/**
 * Picking how many of something to buy.
 *
 * A native `<select>` did the job but rendered as the operating system's own control — a grey
 * system menu in the middle of a page that is otherwise entirely ours. This is the same surface
 * as the address picker: a bottom sheet on a phone, a centred card on a desktop, so choosing a
 * quantity and choosing an address feel like the same app rather than two different ones.
 *
 * A grid of tiles rather than a list: every option is one tap away with no scrolling, the current
 * one is visibly the current one, and anything past what is on the shelf is shown greyed rather
 * than silently missing — a customer who wanted eight and can only have three should be told so.
 */
@Component({
  selector: 'app-quantity-sheet',
  imports: [MatIconModule],
  templateUrl: './quantity-sheet.html',
  styleUrl: './quantity-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'close()',
  },
})
export class QuantitySheet {
  readonly productName = input.required<string>();
  readonly imageUrl = input<string | null>(null);
  readonly weight = input<string>('');
  readonly value = input.required<number>();

  /** Units on hand. Null means stock isn't tracked for this product, so the full run is offered. */
  readonly stock = input<number | null>(null);

  /** The quantity already bought and paid for, where this is editing a placed order. Tiles below
   * it are shown but locked: an order can be added to, never cut down. */
  readonly floor = input<number>(1);

  readonly picked = output<number>();
  readonly closed = output<void>();

  /** Always the full run, so the grid keeps its shape and a shopper can see what they can't have
   * rather than wondering why the numbers stop. */
  protected readonly options = computed(() => {
    const highest = Math.max(DEFAULT_MAX, this.value());
    return Array.from({ length: highest }, (_, i) => i + 1);
  });

  protected readonly outOfStockFrom = computed(() => this.stock());

  protected isAvailable(option: number): boolean {
    const stock = this.stock();
    return stock === null || option <= stock;
  }

  protected isLocked(option: number): boolean {
    return option < this.floor();
  }

  protected disabledReason(option: number): string | null {
    if (this.isLocked(option))
      return 'Already ordered — cancel the order if you no longer want these';
    if (!this.isAvailable(option)) return `Only ${this.stock()} in stock`;
    return null;
  }

  protected choose(option: number): void {
    if (this.isLocked(option) || !this.isAvailable(option)) return;
    this.picked.emit(option);
  }

  /** Public so the host binding above can reach it. */
  close(): void {
    this.closed.emit();
  }
}
