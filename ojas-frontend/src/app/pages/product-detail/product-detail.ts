import { Component, ChangeDetectionStrategy, input, computed, signal, effect, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { DecimalPipe } from '@angular/common';
import { ProductService } from '../../services/product.service';
import { CartService } from '../../services/cart.service';
import { CheckoutService } from '../../services/checkout.service';
import { AuthService } from '../../services/auth.service';
import { DeliveryChargesService } from '../../services/delivery-charges.service';
import { Product } from '../../models/interfaces';

@Component({
  selector: 'app-product-detail',
  imports: [RouterLink, MatIconModule, DecimalPipe],
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
  private deliveryChargesService = inject(DeliveryChargesService);

  freeDeliveryUpToKm = computed(() => this.deliveryChargesService.config()?.freeDeliveryUpToKm ?? null);

  product = computed(() => this.productService.getProduct(this.id()));

  discountedPrice = computed(() => {
    const p = this.product();
    if (!p) return 0;
    if (p.discount && p.discount > 0) {
      return p.price - (p.price * p.discount) / 100;
    }
    return p.price;
  });

  galleryImages = computed(() => {
    const p = this.product();
    if (!p) return [];
    return [p.imageUrl, ...(p.galleryImageUrls ?? [])].filter(Boolean);
  });

  activeImageIndex = signal(0);

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
  expandedSections = signal<Set<string>>(new Set());

  constructor() {
    effect(() => {
      this.id();
      this.quantity.set(1);
      this.descExpanded.set(false);
      this.expandedSections.set(new Set());
      this.activeImageIndex.set(0);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  selectImage(index: number): void {
    this.activeImageIndex.set(index);
  }

  toggleSection(key: string): void {
    this.expandedSections.update((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  isSectionExpanded(key: string): boolean {
    return this.expandedSections().has(key);
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
      case 'Upwas':
        return [
          ...base,
          { icon: 'self_improvement', text: 'Fasting Friendly' },
          { icon: 'spa', text: 'Upwas Approved' },
        ];
      case 'Premium Atta':
        return [
          ...base,
          { icon: 'settings', text: 'Traditional Stone-Ground' },
          { icon: 'restaurant', text: 'Perfect for Rotis & Bhakris' },
        ];
      case 'Powder Box':
        return [
          ...base,
          { icon: 'science', text: 'Kitchen Essential' },
          { icon: 'straighten', text: 'Precise, Consistent Measure' },
        ];
      default:
        return base;
    }
  }
}
