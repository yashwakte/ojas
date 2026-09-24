import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ProductReview } from '../../models/interfaces';
import { ReviewService } from '../../services/review.service';
import { StarRating } from '../../components/star-rating/star-rating';

type ReviewFilter = 'all' | 'low' | 'hidden';

/**
 * The admin's view of customer reviews: every review, newest first, with the one power the admin
 * has over them - hiding one from the storefront, or putting it back.
 *
 * Reviews publish the moment a verified buyer posts them, the way the large marketplaces run
 * them; this is where anything abusive, or a phone number, or a complaint that belongs with
 * support, is taken down. The words and stars cannot be edited here, deliberately.
 */
@Component({
  selector: 'app-review-management',
  imports: [DatePipe, MatIconModule, MatButtonModule, MatProgressSpinnerModule, StarRating],
  templateUrl: './review-management.html',
  styleUrl: './review-management.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReviewManagement implements OnInit {
  private readonly reviews = inject(ReviewService);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly loading = this.reviews.loadingAll;
  protected readonly error = this.reviews.allError;
  protected readonly filter = signal<ReviewFilter>('all');
  protected readonly busyId = signal<string | null>(null);

  protected readonly filters: { id: ReviewFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'low', label: '1–2 stars' },
    { id: 'hidden', label: 'Hidden' },
  ];

  protected readonly visible = computed(() => this.reviews.all().filter(this.matcher(this.filter())));

  protected readonly average = computed(() => {
    const shown = this.reviews.all().filter((r) => !r.isHidden);
    return shown.length ? shown.reduce((sum, r) => sum + r.rating, 0) / shown.length : 0;
  });

  protected readonly publicCount = computed(
    () => this.reviews.all().filter((r) => !r.isHidden).length,
  );

  ngOnInit(): void {
    this.reviews.loadAll();
  }

  protected reload(): void {
    this.reviews.loadAll();
  }

  protected countFor(filter: ReviewFilter): number {
    return this.reviews.all().filter(this.matcher(filter)).length;
  }

  protected toggle(review: ProductReview): void {
    if (this.busyId()) return;
    const hide = !review.isHidden;
    this.busyId.set(review.id);
    this.reviews.setHidden(review.id, hide).subscribe({
      next: () => {
        this.busyId.set(null);
        this.snackBar.open(
          hide ? 'Review hidden from the shop.' : 'Review is public again.',
          'OK',
          { duration: 3000 },
        );
      },
      error: () => {
        this.busyId.set(null);
        this.snackBar.open('Could not update that review. Please try again.', 'OK', {
          duration: 4000,
          panelClass: 'error-snackbar',
        });
      },
    });
  }

  private matcher(filter: ReviewFilter): (review: ProductReview) => boolean {
    switch (filter) {
      case 'low':
        return (r) => r.rating <= 2;
      case 'hidden':
        return (r) => !!r.isHidden;
      default:
        return () => true;
    }
  }
}
