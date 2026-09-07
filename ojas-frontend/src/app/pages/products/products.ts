import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ProductService } from '../../services/product.service';
import { CartService } from '../../services/cart.service';
import { CheckoutService } from '../../services/checkout.service';
import { AuthService } from '../../services/auth.service';
import { OrderEditDraftService } from '../../services/order-edit-draft.service';
import { Product, effectivePrice, isOutOfStock, isPurchasable } from '../../models/interfaces';
import { DecimalPipe } from '@angular/common';
import { PRODUCT_CATEGORIES } from '../../constants/product-categories';
import { OrderPickingBanner } from '../../components/order-picking-banner/order-picking-banner';
import { thumbnailPackShot } from '../../constants/pack-shots';

/** The last card that gets a stagger delay; everything after it arrives with this one. */
const STAGGER_CARDS = 7;
/** How far apart consecutive cards arrive. Short enough to read as one movement rather than a
 * queue. */
const STAGGER_STEP_S = 0.04;

@Component({
  selector: 'app-products',
  imports: [RouterLink, MatButtonModule, MatIconModule, DecimalPipe, OrderPickingBanner],
  templateUrl: './products.html',
  styleUrl: './products.scss',
})
export class Products {
  /** Product tiles show a card-sized pack shot, not the full-resolution one. */
  thumbnail = thumbnailPackShot;

  /** The shared definition, so a tile advertises exactly what the cart will charge. */
  readonly effectivePrice = effectivePrice;
  readonly isOutOfStock = isOutOfStock;
  readonly isPurchasable = isPurchasable;

  private readonly orderEditDraft = inject(OrderEditDraftService);
  readonly picking = this.orderEditDraft.picking;

  categories = ['All', ...PRODUCT_CATEGORIES];
  justAdded = signal<string | null>(null);
  selectedCategory = signal('All');

  constructor(
    private productService: ProductService,
    private cartService: CartService,
    private checkoutService: CheckoutService,
    private auth: AuthService,
    private route: ActivatedRoute,
    private router: Router,
  ) {
    // The router reuses this component instance across /products?category=…
    // navigations (same route, different query params), so the category
    // must be read from the live query-param stream rather than a one-time
    // snapshot in ngOnInit — otherwise clicking a different category in the
    // navbar while already on this page silently does nothing.
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const category = params.get('category');
      this.selectedCategory.set(
        category && (this.categories as string[]).includes(category) ? category : 'All',
      );
    });
  }

  readonly filteredProducts = computed(() => {
    const all = this.productService.products();
    const category = this.selectedCategory();
    if (category === 'All') return all;
    return all.filter((p) => p.category === category);
  });

  addToCart(product: Product): void {
    if (this.picking()) {
      this.orderEditDraft.addProduct(product);
    } else {
      this.cartService.addToCart(product);
    }
    this.justAdded.set(product.id);
    setTimeout(() => this.justAdded.set(null), 2000);
  }

  // Guests are allowed through — /checkout's auth guard collects the login and
  // sends them straight back, with the item still in their basket.
  buyNow(product: Product): void {
    this.checkoutService.addItem(product);
    this.router.navigate(['/checkout']);
  }

  /**
   * How much later than the card before it each card fades in.
   *
   * The stagger used to be a flat 60ms per card with no ceiling, which was fine when the shop had
   * a dozen products and is not fine now that it has more than thirty: the last card in the grid
   * did not start appearing until nearly two seconds after the page, and `animation-fill-mode:
   * both` means it is genuinely invisible until then, not merely faint. A customer who lands on
   * the browse page and scrolls sees empty space and concludes the site is slow — which, in the
   * only sense that matters to them, it was.
   *
   * So the stagger applies to roughly the first screenful and then stops. That keeps the effect
   * where it is doing its job — a row of cards arriving in sequence reads as deliberate — and
   * takes it off every card the customer would otherwise have to wait on.
   */
  cardDelay(index: number): string {
    return `${Math.min(index, STAGGER_CARDS) * STAGGER_STEP_S}s`;
  }

  /** How many photographs are fetched at normal priority rather than lazily. About a first
   * screenful on a desktop grid; on a phone it is more than one, which costs a few kilobytes and
   * buys the next flick of the thumb. */
  readonly eagerImageCount = 6;

  onImgError(event: Event): void {
    const img = event.target as HTMLImageElement;
    img.src = '/images/placeholder.svg';
  }

  selectCategory(cat: string) {
    // Navigate rather than setting the signal directly, so the URL and the
    // query-param subscription above stay the single source of truth.
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { category: cat === 'All' ? null : cat },
      queryParamsHandling: 'merge',
    });
  }
}
