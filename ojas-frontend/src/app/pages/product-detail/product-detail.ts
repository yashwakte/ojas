import {
  Component,
  ChangeDetectionStrategy,
  ElementRef,
  input,
  computed,
  signal,
  effect,
  inject,
  viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { DecimalPipe } from '@angular/common';
import { ImageLightbox } from '../../components/image-lightbox/image-lightbox';
import { ProductService } from '../../services/product.service';
import { CartService } from '../../services/cart.service';
import { CheckoutService } from '../../services/checkout.service';
import { AuthService } from '../../services/auth.service';
import { FREE_DELIVERY_CART_THRESHOLD } from '../../constants/pricing';
import { DeliveryAddressService } from '../../services/delivery-address.service';
import { OrderEditDraftService } from '../../services/order-edit-draft.service';
import {
  Product,
  deliveryDaysLabel,
  deliveryPromiseByDate,
  deliveryPromiseLabel,
  effectivePrice,
  isLowStock,
  isOutOfStock,
  isPurchasable,
} from '../../models/interfaces';
import { OrderPickingBanner } from '../../components/order-picking-banner/order-picking-banner';

@Component({
  selector: 'app-product-detail',
  imports: [RouterLink, MatIconModule, DecimalPipe, OrderPickingBanner, ImageLightbox],
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
  private orderEditDraft = inject(OrderEditDraftService);
  // Public so the template can show the "Deliver to" bar and open the picker.
  readonly deliveryAddress = inject(DeliveryAddressService);
  readonly picking = this.orderEditDraft.picking;

  /** The one rule that actually makes delivery free. Everything else is priced from the delivery
   * pincode by the server, which is why this page no longer quotes a free-distance ring. */
  readonly freeDeliveryThreshold = FREE_DELIVERY_CART_THRESHOLD;

  changeDeliveryAddress(): void {
    this.deliveryAddress.openPicker();
  }

  readonly purchasable = computed(() => {
    const p = this.product();
    return !!p && isPurchasable(p);
  });

  readonly addButtonLabel = computed(() => {
    const justAdded = this.justAdded() === this.product()?.id;
    if (this.picking()) return justAdded ? 'Added!' : 'Add to Order';
    return justAdded ? 'Added to Cart!' : 'Add to Cart';
  });

  readonly outOfStock = computed(() => {
    const p = this.product();
    return !!p && isOutOfStock(p);
  });

  readonly lowStock = computed(() => {
    const p = this.product();
    return !!p && isLowStock(p);
  });

  /** Never let the quantity stepper exceed what's actually on the shelf. */
  readonly maxQuantity = computed(() => this.product()?.stockQuantity ?? Infinity);

  product = computed(() => this.productService.getProduct(this.id()));

  /** The shared definition, so this page advertises exactly what the cart will charge. */
  readonly effectivePrice = effectivePrice;

  /** The delivery promise for an order placed now. Computed per render rather than cached so the
   * date is still right for a tab left open across midnight, and shared with the orders page so
   * the promise made here is the one shown against the order afterwards. */
  deliveryPromise(): string {
    return deliveryPromiseLabel();
  }

  /** The outer edge of that window, so the promise is checkable rather than vague. */
  deliveryPromiseBy(): string {
    return deliveryPromiseByDate();
  }

  /** For the spec card, whose "Estimated Delivery" heading already supplies the verb. */
  deliveryDays(): string {
    return deliveryDaysLabel();
  }

  discountedPrice = computed(() => {
    const p = this.product();
    return p ? effectivePrice(p) : 0;
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

  /** The scrolling strip the photos live in. Scroll position is the source of truth for which
   * photo is showing — the strip is a real scroller, so a swipe, a thumbnail and an arrow all
   * end up saying the same thing rather than each keeping their own idea of it. */
  private readonly galleryTrack = viewChild<ElementRef<HTMLElement>>('galleryTrack');

  /** Open on this photo, or null when the full-screen viewer is closed. */
  readonly lightboxIndex = signal<number | null>(null);

  selectImage(index: number): void {
    this.activeImageIndex.set(index);
    const track = this.galleryTrack()?.nativeElement;
    if (!track) return;
    track.scrollTo({ left: index * track.clientWidth, behavior: 'smooth' });
  }

  /** Keeps the dots and thumbnails in step with a finger. Reading the scroll position rather than
   * counting swipe gestures means a flick that carries through two photos is reported honestly. */
  onGalleryScroll(): void {
    const track = this.galleryTrack()?.nativeElement;
    if (!track || track.clientWidth === 0) return;
    const index = Math.round(track.scrollLeft / track.clientWidth);
    if (index !== this.activeImageIndex()) this.activeImageIndex.set(index);
  }

  openLightbox(index: number): void {
    this.lightboxIndex.set(index);
  }

  closeLightbox(): void {
    this.lightboxIndex.set(null);
  }

  /** The viewer and the page keep one idea of which photo is current, so closing on photo 3
   * leaves the strip on photo 3 rather than snapping back to where it was opened. */
  onLightboxIndexChanged(index: number): void {
    this.selectImage(index);
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
    this.quantity.update((q) => Math.min(this.maxQuantity(), q + 1));
  }

  decreaseQty(): void {
    this.quantity.update((q) => Math.max(1, q - 1));
  }

  addToCart(): void {
    const p = this.product();
    if (!p) return;
    if (this.picking()) {
      this.orderEditDraft.addProduct(p, this.quantity());
    } else {
      for (let i = 0; i < this.quantity(); i++) {
        this.cartService.addToCart(p);
      }
    }
    this.justAdded.set(p.id);
    setTimeout(() => this.justAdded.set(null), 2000);
  }

  // Guests are allowed through — /checkout's auth guard collects the login and
  // sends them straight back, with the item still in their basket.
  buyNow(): void {
    const p = this.product();
    if (!p) return;
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
