import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { ProductReview, ReviewSummary } from '../../models/interfaces';
import { ReviewService } from '../../services/review.service';
import { AuthService } from '../../services/auth.service';
import { StarRating } from '../star-rating/star-rating';
import { ReviewSheet } from '../review-sheet/review-sheet';
import { ScrollRevealDirective } from '../../directives/scroll-reveal.directive';

/**
 * The reviews block on a product page: the average and how the stars are spread, the product's
 * two best reviews, then - behind "See all" - every review, newest first, ten at a time. A
 * product with two hundred reviews loads twelve until someone asks for more.
 *
 * A customer who has reviewed this product (here or from My Orders) sees their latest review with
 * Edit, never the prompt to write one again. A later delivered order of the same product is its
 * own purchase and is rated from that order in My Orders.
 *
 * Every review here is a verified purchase: the API only accepts one from a customer with a
 * delivered order carrying the product.
 */
@Component({
  selector: 'app-product-reviews',
  imports: [DatePipe, NgTemplateOutlet, RouterLink, MatIconModule, StarRating, ReviewSheet, ScrollRevealDirective],
  templateUrl: './product-reviews.html',
  styleUrl: './product-reviews.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductReviews {
  private readonly reviews = inject(ReviewService);
  private readonly auth = inject(AuthService);

  readonly productId = input.required<string>();
  readonly productName = input.required<string>();
  readonly imageUrl = input<string | null>(null);
  readonly returnUrl = input<string>('/');

  /** The summary, once loaded, so the page can show it beside the price. */
  readonly summaryChange = output<ReviewSummary>();

  protected readonly summary = signal<ReviewSummary | null>(null);
  /** The product's best reviews, always shown. */
  protected readonly top = signal<ProductReview[]>([]);
  /** Reviews loaded so far, newest first - the "See all" list. */
  protected readonly list = signal<ProductReview[]>([]);
  protected readonly loaded = signal(false);
  protected readonly expanded = signal(false);
  protected readonly loadingMore = signal(false);
  protected readonly sheetOpen = signal(false);
  protected readonly sheetRating = signal(0);

  /** How far through the server's newest-first list this page has read, and how long that list
   * was when first read - what decides whether "Show more" has anything left to fetch. */
  private fetched = 0;
  private serverTotal = 0;

  protected readonly isCustomer = computed(
    () => this.auth.isLoggedIn() && this.auth.role() === 'customer',
  );
  protected readonly isGuest = computed(() => !this.auth.isLoggedIn());

  /** The customer's latest review of this product, if any. */
  protected readonly myLatest = computed(
    () => this.reviews.mineByProduct().get(this.productId()) ?? null,
  );
  protected readonly mineIds = this.reviews.mineIds;

  /** The review the open sheet is editing; null when it is writing a new one. */
  protected readonly editing = signal<ProductReview | null>(null);
  /** "Write a review" is offered only to a customer who has never reviewed this product - having
   * written one here or from My Orders, they see it and edit it instead. */
  protected readonly canReview = computed(
    () => this.isCustomer() && !this.myLatest() && this.reviews.canReview(this.productId()),
  );

  /** The "See all" list, without the top reviews already shown above it. */
  protected readonly rest = computed(() => {
    const topIds = new Set(this.top().map((r) => r.id));
    return this.list().filter((r) => !topIds.has(r.id));
  });

  /** Reviews not among the top ones - what "See all" would add. */
  protected readonly moreCount = computed(() =>
    Math.max(0, (this.summary()?.count ?? 0) - this.top().length),
  );

  protected readonly hasMore = computed(() => {
    this.list();
    return this.fetched < this.serverTotal;
  });

  /** Bars from five stars down, each as a share of the reviews. */
  protected readonly bars = computed(() => {
    const s = this.summary();
    if (!s || !s.count) return [];
    return [5, 4, 3, 2, 1].map((stars) => ({
      stars,
      count: s.distribution[stars - 1] ?? 0,
      percent: Math.round(((s.distribution[stars - 1] ?? 0) / s.count) * 100),
    }));
  });

  constructor() {
    effect(() => {
      const id = this.productId();
      untracked(() => this.load(id));
    });

    // The customer's own reviews decide whether "Write a review" or "Your review" is shown.
    effect(() => {
      if (this.isCustomer()) untracked(() => this.reviews.loadMine());
    });
  }

  private load(id: string): void {
    this.loaded.set(false);
    this.expanded.set(false);
    this.reviews.forProduct(id).subscribe({
      next: (response) => {
        this.summary.set(response.summary);
        this.top.set(response.top ?? []);
        this.fetched = response.reviews.length;
        this.serverTotal = response.summary.count;
        this.list.set(response.reviews);
        this.loaded.set(true);
        this.summaryChange.emit(response.summary);
      },
      // A product page whose reviews fail to load is still a product page; the block stays quiet.
      error: () => this.loaded.set(true),
    });
  }

  /** "See all": opens the full list; the first page is already here. */
  protected seeAll(): void {
    this.expanded.set(true);
  }

  /** "Show more": the next ten from the server. */
  protected loadMore(): void {
    if (this.loadingMore() || !this.hasMore()) return;
    this.loadingMore.set(true);
    this.reviews.forProduct(this.productId(), this.fetched).subscribe({
      next: (response) => {
        this.fetched += response.reviews.length;
        // Nothing came back: the list is shorter than it was (a review was hidden meanwhile).
        if (response.reviews.length === 0) this.serverTotal = this.fetched;
        const known = new Set(this.list().map((r) => r.id));
        this.list.set([...this.list(), ...response.reviews.filter((r) => !known.has(r.id))]);
        this.loadingMore.set(false);
      },
      error: () => this.loadingMore.set(false),
    });
  }

  /** Opens the sheet for a new review, or for editing one of the customer's own. */
  protected openSheet(rating = 0, review: ProductReview | null = null): void {
    this.editing.set(review);
    this.sheetRating.set(rating);
    this.sheetOpen.set(true);
  }

  protected closeSheet(): void {
    this.sheetOpen.set(false);
  }

  /** Put the saved review on the page straight away rather than waiting for the cache in front of
   * the public read to catch up; the summary moves by exactly that review. */
  protected onSaved(review: ProductReview): void {
    this.sheetOpen.set(false);
    const before = this.editing();
    const replace = (all: ProductReview[]) => all.map((r) => (r.id === review.id ? review : r));

    if (review.isHidden) {
      this.dropReview(review.id, before?.rating ?? null);
      return;
    }
    if (before) {
      this.top.set(replace(this.top()));
      this.list.set(replace(this.list()));
      this.adjustSummary(before.rating, review.rating);
    } else {
      this.list.set([review, ...this.list()]);
      if (this.top().length < 2) this.top.set([...this.top(), review]);
      this.adjustSummary(null, review.rating);
    }
  }

  protected onRemoved(): void {
    const removed = this.editing();
    this.sheetOpen.set(false);
    if (removed) this.dropReview(removed.id, removed.rating);
  }

  private dropReview(id: string, rating: number | null): void {
    this.top.set(this.top().filter((r) => r.id !== id));
    this.list.set(this.list().filter((r) => r.id !== id));
    this.adjustSummary(rating, null);
  }

  /** Moves the summary by one review: `from` stars out (an edit or removal), `to` stars in. */
  private adjustSummary(from: number | null, to: number | null): void {
    const previous = this.summary() ?? { average: 0, count: 0, distribution: [0, 0, 0, 0, 0] };
    const distribution = [...previous.distribution];
    if (from) distribution[from - 1] = Math.max(0, distribution[from - 1] - 1);
    if (to) distribution[to - 1]++;
    const count = distribution.reduce((sum, n) => sum + n, 0);
    const average = count
      ? Math.round((distribution.reduce((sum, n, i) => sum + n * (i + 1), 0) / count) * 10) / 10
      : 0;
    const summary = { average, count, distribution };
    this.summary.set(summary);
    this.summaryChange.emit(summary);
  }

  protected initial(name: string): string {
    return (name.trim()[0] ?? 'O').toUpperCase();
  }
}
