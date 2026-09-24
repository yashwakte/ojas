import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  MyReviewsResponse,
  ProductReview,
  ProductReviewsResponse,
  WriteReviewRequest,
} from '../models/interfaces';
import { AuthService } from './auth.service';

/**
 * Product reviews: the public reads, the signed-in customer's own reviews, and the admin's list.
 *
 * The customer's own reviews are held against the account that loaded them and dropped the moment
 * a different account (or nobody) is signed in, so one person's "Your review" can never be drawn
 * on another's product page after a switch in the same tab.
 */
@Injectable({ providedIn: 'root' })
export class ReviewService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly apiUrl = `${environment.apiUrl}/reviews`;

  private readonly _mine = signal<ProductReview[]>([]);
  private readonly _reviewable = signal<ReadonlySet<string>>(new Set());
  private readonly _mineLoadedFor = signal<string | null>(null);
  private readonly _all = signal<ProductReview[]>([]);
  private readonly _loadingAll = signal(false);
  private readonly _allError = signal<string | null>(null);

  readonly mine = this._mine.asReadonly();
  readonly all = this._all.asReadonly();
  readonly loadingAll = this._loadingAll.asReadonly();
  readonly allError = this._allError.asReadonly();

  /** The customer's most recent review of each product, by product id. One review per purchase,
   * so a customer who bought a product twice may have two; this is the latest. */
  readonly mineByProduct = computed(() => {
    const latest = new Map<string, ProductReview>();
    for (const review of this._mine()) {
      if (!latest.has(review.productId)) latest.set(review.productId, review);
    }
    return latest;
  });

  /** The ids of every review this customer wrote, so a product page can offer Edit on theirs. */
  readonly mineIds = computed(() => new Set(this._mine().map((review) => review.id)));

  constructor() {
    effect(() => {
      const userId = this.auth.user()?.id ?? null;
      if (userId !== this._mineLoadedFor()) {
        this._mine.set([]);
        this._reviewable.set(new Set());
        this._mineLoadedFor.set(null);
      }
    });
  }

  /** Whether the signed-in customer has had this product delivered, and so may review it. */
  canReview(productId: string): boolean {
    return this._reviewable().has(productId);
  }

  /** A product's summary, top reviews and first page of reviews; `skip` > 0 fetches a later
   * page (no top reviews). Ten a page - a product with hundreds of reviews is never sent whole. */
  forProduct(key: string, skip = 0): Observable<ProductReviewsResponse> {
    const query = skip > 0 ? `?skip=${skip}` : '';
    return this.http.get<ProductReviewsResponse>(
      `${this.apiUrl}/product/${encodeURIComponent(key)}${query}`,
    );
  }

  featured(): Observable<ProductReview[]> {
    return this.http.get<ProductReview[]>(`${this.apiUrl}/featured`);
  }

  private mineInFlight = false;

  /** Loads the signed-in customer's reviews. Quiet on failure: every page that uses this still
   * works without it, it just cannot offer "Rate this". Several delivered orders on one page each
   * ask for it; one request answers them all. */
  loadMine(): void {
    const user = this.auth.user();
    if (!user || user.role !== 'customer' || this.mineInFlight) return;

    this.mineInFlight = true;
    this.http.get<MyReviewsResponse>(`${this.apiUrl}/my`).subscribe({
      next: (response) => {
        this.mineInFlight = false;
        // Signed out or switched while the request was in flight: not this account's answer.
        if (this.auth.user()?.id !== user.id) return;
        this._mine.set(response.reviews);
        this._reviewable.set(new Set(response.reviewableProductIds));
        this._mineLoadedFor.set(user.id);
      },
      error: () => {
        this.mineInFlight = false;
      },
    });
  }

  /** Posts the review for one purchase: `orderId` names the delivered order (the orders page
   * knows it); without it the API uses the earliest purchase not yet reviewed. One review per
   * purchase - the API refuses a second for the same order. */
  create(productId: string, request: WriteReviewRequest, orderId?: string | null): Observable<ProductReview> {
    const query = orderId ? `?orderId=${encodeURIComponent(orderId)}` : '';
    return this.http
      .post<ProductReview>(`${this.apiUrl}/my/${productId}${query}`, request)
      .pipe(
        tap((saved) => {
          this._mine.update((all) => [saved, ...all]);
          // That purchase is spent; the API re-answers whether another remains on the next load.
          this.loadMine();
        }),
      );
  }

  /** The customer's review of one product on one order, if they have written it. */
  reviewFor(orderId: string, productId: string): ProductReview | null {
    return this._mine().find((r) => r.orderId === orderId && r.productId === productId) ?? null;
  }

  /** Rewrites one of the customer's own reviews. */
  update(reviewId: string, request: WriteReviewRequest): Observable<ProductReview> {
    return this.http
      .put<ProductReview>(`${this.apiUrl}/my/review/${reviewId}`, request)
      .pipe(
        tap((saved) => this._mine.update((all) => all.map((r) => (r.id === reviewId ? saved : r)))),
      );
  }

  remove(reviewId: string): Observable<void> {
    return this.http
      .delete<void>(`${this.apiUrl}/my/review/${reviewId}`)
      .pipe(tap(() => this._mine.update((all) => all.filter((r) => r.id !== reviewId))));
  }

  // ===== ADMIN =====

  loadAll(): void {
    this._loadingAll.set(true);
    this._allError.set(null);
    this.http.get<ProductReview[]>(`${this.apiUrl}/admin/all`).subscribe({
      next: (reviews) => {
        this._all.set(reviews);
        this._loadingAll.set(false);
      },
      error: () => {
        this._allError.set('Failed to load reviews');
        this._loadingAll.set(false);
      },
    });
  }

  setHidden(id: string, hidden: boolean): Observable<ProductReview> {
    return this.http
      .patch<ProductReview>(`${this.apiUrl}/admin/${id}/visibility`, { hidden })
      .pipe(tap((updated) => this._all.update((all) => all.map((r) => (r.id === id ? updated : r)))));
  }
}
