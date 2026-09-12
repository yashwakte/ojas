import {
  Component,
  ChangeDetectionStrategy,
  ElementRef,
  afterRenderEffect,
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
import { RETURN_WINDOW_DAYS } from '../../constants/business';
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
import { packShotSrcset, thumbnailPackShot } from '../../constants/pack-shots';

/** How many products the "You May Also Like" rail carries at most. Enough that the rail is worth
 * scrolling on a wide screen and still a bounded number of images to fetch. */
const SIMILAR_RAIL_SIZE = 12;

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

  /** The returns window, read from the shared constant so this page, the cart and the Refunds
   * and Cancellations policy can never quote three different numbers of days. */
  readonly returnWindowDays = RETURN_WINDOW_DAYS;

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

  /**
   * True while it is not yet known whether this product exists.
   *
   * The template has three branches, not two. Without this one, a page opened directly rendered
   * "Product Not Found" for as long as the catalogue took to arrive and then replaced it with the
   * product — which reads as a broken link followed by a flicker, and is the single worst thing a
   * shared product link can do.
   */
  readonly resolving = computed(
    () => !this.product() && !this.productService.isUnknown(this.id()),
  );

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

  /**
   * What to show under "You May Also Like".
   *
   * Products from the same category first, because those are the genuinely comparable ones — then
   * the rest of the catalogue to fill the rail out. The section used to be same-category only and
   * capped at six, which meant a product in a thin category (or the only product in one) got an
   * empty rail and the page just stopped, with no way onward except the browser's Back button. A
   * dead end at the bottom of a product page is the one place a shop can least afford one.
   *
   * The fill is not padding for its own sake: everything in it is a real product a customer can
   * buy, and the same-category matches always come first, so relevance is never traded away — the
   * rail only reaches for the rest of the shop once it has run out of close matches.
   */
  similarProducts = computed(() => {
    const p = this.product();
    if (!p) return [];
    const all = this.productService.products();
    const others = all.filter((sp) => sp.id !== p.id);
    const sameCategory = others.filter((sp) => sp.category === p.category);
    const rest = others.filter((sp) => sp.category !== p.category);
    return [...sameCategory, ...rest].slice(0, SIMILAR_RAIL_SIZE);
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

      // Fetch this one product straight away rather than waiting on the whole catalogue. On a
      // deep link that is the difference between one small response and the entire product list.
      this.productService.ensureProduct(this.id());
    });

    // The rail's own controls depend on how much of it fits, which is not known until it has been
    // laid out. Re-read after every render rather than once: the product can change under the same
    // component instance, and the rail is often still empty on the first pass because the
    // catalogue has not arrived yet.
    afterRenderEffect(() => {
      this.similarProducts();
      this.onSimilarScroll();
    });
  }

  /** The "You May Also Like" rail, so its arrows know how far to move it and its edge fades know
   * which end still has products behind them. */
  private readonly similarScroll = viewChild<ElementRef<HTMLElement>>('similarScroll');
  readonly similarCanScrollLeft = signal(false);
  readonly similarCanScrollRight = signal(false);

  /**
   * Moves the rail by one screenful, in whichever direction.
   *
   * A screenful rather than one card: the rail is a scroll container with snap points, so the
   * browser settles it on a card boundary itself, and matching the step to what is visible is what
   * makes a click feel like turning a page rather than nudging a list.
   */
  scrollSimilar(direction: -1 | 1): void {
    const rail = this.similarScroll()?.nativeElement;
    if (!rail) return;
    rail.scrollBy({ left: direction * rail.clientWidth * 0.85, behavior: 'smooth' });
  }

  /** Keeps the edge fades and the arrows honest about which way there is more to see. */
  onSimilarScroll(): void {
    const rail = this.similarScroll()?.nativeElement;
    if (!rail) return;
    // A pixel of slack: sub-pixel layout means scrollLeft rarely lands exactly on either end, and
    // without it the arrow at the end of the rail never quite goes away.
    const slack = 2;
    this.similarCanScrollLeft.set(rail.scrollLeft > slack);
    this.similarCanScrollRight.set(
      rail.scrollLeft + rail.clientWidth < rail.scrollWidth - slack,
    );
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

  /** Widths the browser may choose between for the main gallery image. */
  readonly srcset = packShotSrcset;

  /** The card-sized file, for the thumbnail strip and the "You May Also Like" rail — neither of
   * which is ever drawn larger than a couple of hundred pixels. The rail alone was pulling twelve
   * full-size pack shots to draw twelve small cards. */
  readonly thumbnail = thumbnailPackShot;

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
      case 'Everyday Flours':
        return [
          ...base,
          { icon: 'settings', text: 'Traditional Stone-Ground' },
          { icon: 'restaurant', text: 'Perfect for Rotis & Bhakris' },
        ];
      case 'Traditional & Festive':
        return [
          ...base,
          { icon: 'celebration', text: 'A Festival Favourite' },
          { icon: 'restaurant', text: 'Traditional Maharashtrian Recipes' },
        ];
      case 'Health & Breakfast':
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
      case 'Baking & Desserts':
        return [
          ...base,
          { icon: 'cake', text: 'Easy Desserts & Baking' },
          { icon: 'straighten', text: 'Precise, Consistent Measure' },
        ];
      case 'Spices & Essentials':
        return [
          ...base,
          { icon: 'soup_kitchen', text: 'Kitchen Essential' },
          { icon: 'inventory_2', text: 'Small Packs, Always Fresh' },
        ];
      default:
        return base;
    }
  }
}
