import {
  Component,
  ChangeDetectionStrategy,
  input,
  computed,
  signal,
  effect,
  inject,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { ProductService } from '../../services/product.service';
import { CartService } from '../../services/cart.service';
import { CheckoutService } from '../../services/checkout.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-product-detail',
  imports: [RouterLink, MatIconModule],
  templateUrl: './product-detail.html',
  styleUrl: './product-detail.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductDetail {
  id = input.required<string>();

  private productService = inject(ProductService);
  private cartService = inject(CartService);
  private checkoutService = inject(CheckoutService);
  private auth = inject(AuthService);
  private router = inject(Router);

  product = computed(() => this.productService.getProduct(this.id()));

  similarProducts = computed(() => {
    const p = this.product();
    if (!p) return [];
    return this.productService
      .getByCategory(p.category)
      .filter((sp) => sp.id !== p.id)
      .slice(0, 6);
  });

  highlights = computed(() => {
    const p = this.product();
    if (!p) return [];
    return this.getHighlightsForCategory(p.category);
  });

  quantity = signal(1);
  descExpanded = signal(false);
  justAdded = signal<string | null>(null);

  constructor() {
    effect(() => {
      this.id();
      this.quantity.set(1);
      this.descExpanded.set(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  increaseQty(): void {
    this.quantity.update((q) => q + 1);
  }

  decreaseQty(): void {
    this.quantity.update((q) => Math.max(1, q - 1));
  }

  addToCart(): void {
    const p = this.product();
    if (!p) return;
    if (!this.auth.isLoggedIn()) {
      this.router.navigate(['/login']);
      return;
    }
    for (let i = 0; i < this.quantity(); i++) {
      this.cartService.addToCart(p);
    }
    this.justAdded.set(p.id);
    setTimeout(() => this.justAdded.set(null), 2000);
  }

  buyNow(): void {
    const p = this.product();
    if (!p) return;
    if (!this.auth.isLoggedIn()) {
      this.router.navigate(['/login']);
      return;
    }
    this.checkoutService.addItem(p, this.quantity());
    this.router.navigate(['/checkout']);
  }

  toggleDescription(): void {
    this.descExpanded.update((v) => !v);
  }

  onImgError(event: Event): void {
    const img = event.target as HTMLImageElement;
    img.src = '/images/placeholder.svg';
  }

  private getHighlightsForCategory(category: string): { icon: string; text: string }[] {
    const base = [
      { icon: 'eco', text: '100% Natural & Organic' },
      { icon: 'block', text: 'No Preservatives or Additives' },
      { icon: 'verified', text: 'Quality Tested' },
    ];
    switch (category) {
      case 'Flour':
        return [
          ...base,
          { icon: 'settings', text: 'Traditional Stone-Ground' },
          { icon: 'restaurant', text: 'Perfect for Rotis & Bhakris' },
        ];
      case 'Grains':
        return [
          ...base,
          { icon: 'grain', text: 'Whole Grain Goodness' },
          { icon: 'fitness_center', text: 'High in Fiber & Protein' },
        ];
      case 'Health Mix':
        return [
          ...base,
          { icon: 'favorite', text: 'Nutrient-Rich Superfood' },
          { icon: 'family_restroom', text: 'Suitable for All Ages' },
        ];
      default:
        return base;
    }
  }
}
