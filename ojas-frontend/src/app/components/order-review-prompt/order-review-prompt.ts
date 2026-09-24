import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { OrderItem, ProductReview } from '../../models/interfaces';
import { ReviewService } from '../../services/review.service';
import { ProductService } from '../../services/product.service';
import { thumbnailPackShot } from '../../constants/pack-shots';
import { StarRating } from '../star-rating/star-rating';
import { ReviewSheet } from '../review-sheet/review-sheet';

interface PromptLine {
  productId: string;
  productName: string;
  image: string | null;
  review: ProductReview | null;
}

/**
 * "How was it?" on a delivered order: each product with a row of stars to tap until it is
 * reviewed, then the rating the customer gave with a way to edit it. One review per purchase:
 * this order's review of a product is written once, and edited after that; the same product on
 * a later order is a fresh purchase and gets its own stars.
 *
 * This is the review section after purchase. It sits on the order itself because that is where a
 * customer comes back to after the delivery - the moment the flour is in their kitchen - and a
 * tap on a star opens the sheet with that rating already chosen, so a review is two taps away.
 */
@Component({
  selector: 'app-order-review-prompt',
  imports: [MatIconModule, StarRating, ReviewSheet],
  templateUrl: './order-review-prompt.html',
  styleUrl: './order-review-prompt.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrderReviewPrompt implements OnInit {
  private readonly reviews = inject(ReviewService);
  private readonly products = inject(ProductService);

  readonly items = input.required<OrderItem[]>();
  /** The delivered order these items came on - the purchase each review is for. */
  readonly orderId = input.required<string>();

  protected readonly five = [1, 2, 3, 4, 5];
  protected readonly open = signal<{ line: PromptLine; rating: number } | null>(null);
  protected readonly justSaved = signal<string | null>(null);

  protected readonly lines = computed<PromptLine[]>(() => {
    // Read so this recomputes when the customer's reviews arrive or change.
    this.reviews.mine();
    const orderId = this.orderId();
    const seen = new Set<string>();
    return this.items()
      .filter((item) => !seen.has(item.productId) && seen.add(item.productId))
      .map((item) => {
        const url = this.products.getProduct(item.productId)?.imageUrl;
        return {
          productId: item.productId,
          productName: item.productName,
          image: url ? thumbnailPackShot(url) : null,
          review: this.reviews.reviewFor(orderId, item.productId),
        };
      });
  });

  protected readonly allRated = computed(() => this.lines().every((line) => !!line.review));

  ngOnInit(): void {
    this.reviews.loadMine();
  }

  protected rate(line: PromptLine, rating = 0): void {
    this.open.set({ line, rating });
  }

  protected onSaved(review: ProductReview): void {
    this.open.set(null);
    this.justSaved.set(review.productId);
    setTimeout(() => {
      if (this.justSaved() === review.productId) this.justSaved.set(null);
    }, 2600);
  }
}
