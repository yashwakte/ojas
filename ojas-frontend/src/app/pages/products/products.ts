import { Component, computed, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ProductService } from '../../services/product.service';
import { CartService } from '../../services/cart.service';
import { CheckoutService } from '../../services/checkout.service';
import { AuthService } from '../../services/auth.service';
import { Product } from '../../models/interfaces';
import { DecimalPipe } from '@angular/common';
import { PRODUCT_CATEGORIES } from '../../constants/product-categories';

@Component({
  selector: 'app-products',
  imports: [RouterLink, MatButtonModule, MatIconModule, DecimalPipe],
  templateUrl: './products.html',
  styleUrl: './products.scss',
})
export class Products {
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
    this.cartService.addToCart(product);
    this.justAdded.set(product.id);
    setTimeout(() => this.justAdded.set(null), 2000);
  }

  // Guests are allowed through — /checkout's auth guard collects the login and
  // sends them straight back, with the item still in their basket.
  buyNow(product: Product): void {
    this.checkoutService.addItem(product);
    this.router.navigate(['/checkout']);
  }

  onImgError(event: Event) {
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
