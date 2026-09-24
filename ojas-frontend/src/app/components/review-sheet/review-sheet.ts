import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  OnInit,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { ProductReview } from '../../models/interfaces';
import { ReviewService } from '../../services/review.service';

/** Mirrors ProductReview.CommentMaxLength on the API, which trims anything past it. */
export const REVIEW_COMMENT_MAX = 600;

/** What each star count means, said under the stars as they are picked, the way the large
 * marketplaces do - a bare number of stars is harder to commit to than a word. */
const RATING_WORDS = ['', 'Poor', 'Could be better', 'Good', 'Very good', 'Loved it'];

/**
 * Writing (or rewriting) a review of one product.
 *
 * The same surface as the quantity and address sheets: a bottom sheet on a phone, a centred card
 * on a desktop, with the same backdrop, radii and easing. It saves through ReviewService itself,
 * so the orders page and the product page open it with the same inputs and get back the saved
 * review.
 */
@Component({
  selector: 'app-review-sheet',
  imports: [FormsModule, MatIconModule],
  templateUrl: './review-sheet.html',
  styleUrl: './review-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'close()',
  },
})
export class ReviewSheet implements OnInit {
  private readonly reviews = inject(ReviewService);

  readonly productId = input.required<string>();
  readonly productName = input.required<string>();
  readonly imageUrl = input<string | null>(null);
  /** The review being edited. Null posts the review for a purchase not yet reviewed - one
   * review per purchase, so a reviewed purchase is edited, never reviewed twice. */
  readonly existing = input<ProductReview | null>(null);
  /** The delivered order this review is for, when the page knows it (the orders page does). */
  readonly orderId = input<string | null>(null);
  /** A star already tapped on the page that opened this, so the tap is not asked for twice. */
  readonly initialRating = input<number>(0);

  readonly saved = output<ProductReview>();
  readonly removed = output<void>();
  readonly closed = output<void>();

  protected readonly five = [1, 2, 3, 4, 5];
  protected readonly maxLength = REVIEW_COMMENT_MAX;
  protected readonly rating = signal(0);
  protected readonly hover = signal(0);
  protected readonly comment = signal('');
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly confirmingRemove = signal(false);

  protected readonly shown = computed(() => this.hover() || this.rating());
  protected readonly word = computed(() => RATING_WORDS[this.shown()] ?? '');
  protected readonly remaining = computed(() => this.maxLength - this.comment().length);

  ngOnInit(): void {
    const existing = this.existing();
    this.rating.set(this.initialRating() || existing?.rating || 0);
    this.comment.set(existing?.comment ?? '');
  }

  protected pick(stars: number): void {
    this.rating.set(stars);
    this.error.set(null);
  }

  /** Arrow keys move the choice, as they do in any radio group. */
  protected onStarKey(event: KeyboardEvent): void {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowUp'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowDown'
          ? -1
          : 0;
    if (!step) return;
    event.preventDefault();
    this.pick(Math.max(1, Math.min(5, (this.rating() || 0) + step)));
  }

  protected submit(): void {
    if (this.saving()) return;
    if (!this.rating()) {
      this.error.set('Tap a star to rate it first.');
      return;
    }

    this.saving.set(true);
    this.error.set(null);
    const request = { rating: this.rating(), comment: this.comment().trim() };
    const existing = this.existing();
    (existing
      ? this.reviews.update(existing.id, request)
      : this.reviews.create(this.productId(), request, this.orderId())
    ).subscribe({
        next: (review) => {
          this.saving.set(false);
          this.saved.emit(review);
        },
        error: (err) => {
          this.saving.set(false);
          this.error.set(err?.error?.message ?? 'We could not save your review. Please try again.');
        },
      });
  }

  protected remove(): void {
    if (this.saving()) return;
    if (!this.confirmingRemove()) {
      this.confirmingRemove.set(true);
      return;
    }

    const existing = this.existing();
    if (!existing) return;
    this.saving.set(true);
    this.reviews.remove(existing.id).subscribe({
      next: () => {
        this.saving.set(false);
        this.removed.emit();
      },
      error: (err) => {
        this.saving.set(false);
        this.confirmingRemove.set(false);
        this.error.set(err?.error?.message ?? 'We could not remove your review. Please try again.');
      },
    });
  }

  /** Public so the host binding above can reach it. */
  close(): void {
    if (!this.saving()) this.closed.emit();
  }
}
