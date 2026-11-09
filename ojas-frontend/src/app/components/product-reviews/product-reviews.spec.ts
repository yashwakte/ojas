import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { computed, signal } from '@angular/core';
import { of } from 'rxjs';

import { ProductReviews } from './product-reviews';
import { ReviewService } from '../../services/review.service';
import { AuthService } from '../../services/auth.service';
import { ProductReview, ProductReviewsResponse } from '../../models/interfaces';

function review(id: string, productId: string, rating = 5): ProductReview {
  return {
    id,
    productId,
    productName: 'Modak Pith',
    authorName: 'Priya S.',
    rating,
    comment: 'Soft modak every time.',
    createdAt: '2026-09-23T19:19:07.898Z',
    updatedAt: null,
  };
}

describe('ProductReviews', () => {
  let fixture: ComponentFixture<ProductReviews>;
  let responses: Record<string, ProductReviewsResponse>;
  let emitted: ProductReview[][];

  beforeEach(async () => {
    responses = {
      p1: {
        summary: { average: 5, count: 2, distribution: [0, 0, 0, 0, 2] },
        reviews: [review('a', 'p1'), review('b', 'p1')],
        top: [review('a', 'p1'), review('b', 'p1')],
      },
      p2: {
        summary: { average: 4, count: 1, distribution: [0, 0, 0, 1, 0] },
        reviews: [review('c', 'p2', 4)],
        top: [review('c', 'p2', 4)],
      },
    };
    const mine = signal(new Map<string, ProductReview>());
    const reviewService = {
      forProduct: (key: string) => of(responses[key]),
      mineByProduct: computed(() => mine()),
      mineIds: computed(() => new Set<string>()),
      canReview: () => false,
      loadMine: () => undefined,
    };
    const auth = { isLoggedIn: signal(false), role: signal(null) };

    await TestBed.configureTestingModule({
      imports: [ProductReviews],
      providers: [
        provideRouter([]),
        { provide: ReviewService, useValue: reviewService },
        { provide: AuthService, useValue: auth },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ProductReviews);
    fixture.componentRef.setInput('productId', 'p1');
    fixture.componentRef.setInput('productName', 'Modak Pith');
    emitted = [];
    fixture.componentInstance.topChange.subscribe((top) => emitted.push(top));
    fixture.detectChanges();
    await fixture.whenStable();
  });

  // The product page puts these into its structured data, and Google accepts review markup only
  // for reviews visible on the page - so what is reported must be exactly what the block shows.
  it('reports the top reviews it shows once they have loaded', () => {
    expect(emitted.at(-1)?.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it("reports the next product's top reviews, not the last one's, after a hop", async () => {
    fixture.componentRef.setInput('productId', 'p2');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(emitted.at(-1)?.map((r) => r.id)).toEqual(['c']);
  });
});
