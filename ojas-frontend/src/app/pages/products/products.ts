import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Params, Router, RouterLink, Scroll } from '@angular/router';
import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { filter } from 'rxjs';
import { MatIconModule } from '@angular/material/icon';
import { ProductService } from '../../services/product.service';
import { CartService } from '../../services/cart.service';
import { CheckoutService } from '../../services/checkout.service';
import { OrderEditDraftService } from '../../services/order-edit-draft.service';
import { ScrollLockService } from '../../services/scroll-lock.service';
import { Product, effectivePrice, isOutOfStock, isPurchasable } from '../../models/interfaces';
import {
  categoryDetail,
  isProductCategory,
  normalizeCategory,
} from '../../constants/product-categories';
import { searchProducts } from '../../constants/product-search';
import { OrderPickingBanner } from '../../components/order-picking-banner/order-picking-banner';
import { thumbnailPackShot } from '../../constants/pack-shots';

/** The last card that gets a stagger delay; everything after it arrives with this one. */
const STAGGER_CARDS = 7;
/** How far apart consecutive cards arrive. Short enough to read as one movement rather than a
 * queue. */
const STAGGER_STEP_S = 0.04;
/** How long typing has to pause before the search is applied. */
const SEARCH_DEBOUNCE_MS = 300;

export type SortKey = 'relevance' | 'price-asc' | 'price-desc' | 'discount' | 'name' | 'newest';
export type PriceBand = 'under-50' | '50-100' | 'over-100';
type Facet = 'category' | 'price' | 'size' | 'stock' | 'offer';

export const SORT_OPTIONS: readonly { key: SortKey; label: string; short: string }[] = [
  { key: 'relevance', label: 'Recommended', short: 'Sort' },
  { key: 'price-asc', label: 'Price: Low to High', short: 'Price: Low' },
  { key: 'price-desc', label: 'Price: High to Low', short: 'Price: High' },
  { key: 'discount', label: 'Biggest Discount', short: 'Discount' },
  { key: 'name', label: 'Name: A to Z', short: 'A to Z' },
  { key: 'newest', label: 'Newest First', short: 'Newest' },
];

/** Bands on the price a customer actually pays - the same figure the card shows. */
export const PRICE_BANDS: readonly { id: PriceBand; label: string; holds: (price: number) => boolean }[] = [
  { id: 'under-50', label: 'Under ₹50', holds: (p) => p < 50 },
  { id: '50-100', label: '₹50 – ₹100', holds: (p) => p >= 50 && p <= 100 },
  { id: 'over-100', label: 'Over ₹100', holds: (p) => p > 100 },
];

/** "500 g", "500G" and "500g" are the same pack. */
export function packSize(weight: string): string {
  return (weight ?? '').toLowerCase().replace(/\s+/g, '');
}

function packGrams(size: string): number {
  const m = /^([\d.]+)(kg|g|ml|l)?$/.exec(size);
  if (!m) return Number.MAX_SAFE_INTEGER;
  const n = parseFloat(m[1]);
  return m[2] === 'kg' || m[2] === 'l' ? n * 1000 : n;
}

function packLabel(size: string): string {
  return size.replace(/^([\d.]+)(kg|g|ml|l)$/, '$1 $2');
}

function parseList<T extends string>(raw: string | null, allowed?: readonly T[]): ReadonlySet<T> {
  const values = (raw ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean) as T[];
  return new Set(allowed ? values.filter((v) => allowed.includes(v)) : values);
}

export interface FilterPill {
  id: string;
  label: string;
  facet: Facet | 'q';
  value?: string;
}

/**
 * The shop.
 *
 * It was a row of category buttons over a grid, which works for a dozen products and stops
 * working once a customer is looking for one particular thing. It now works the way a grocery
 * site does: search, a category rail, sort, and filters by price, pack size, availability and
 * offers - a sidebar on a desktop, bottom sheets on a phone - with what is applied shown as pills
 * that can each be taken off.
 *
 * Everything that decides what is shown lives in the URL (?category=&q=&sort=&price=&size=&stock=
 * &offer=), so a filtered view can be shared or bookmarked, the header's category links need
 * nothing special, and the back button steps back through category changes.
 */
@Component({
  selector: 'app-products',
  imports: [RouterLink, MatIconModule, DecimalPipe, NgTemplateOutlet, OrderPickingBanner],
  templateUrl: './products.html',
  styleUrl: './products.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Products {
  private readonly productService = inject(ProductService);
  private readonly cartService = inject(CartService);
  private readonly checkoutService = inject(CheckoutService);
  private readonly orderEditDraft = inject(OrderEditDraftService);
  private readonly scrollLock = inject(ScrollLockService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly resultsTop = viewChild<ElementRef<HTMLElement>>('resultsTop');

  /** Product tiles show a card-sized pack shot, not the full-resolution one. */
  readonly thumbnail = thumbnailPackShot;
  /** The shared definition, so a tile advertises exactly what the cart will charge. */
  readonly effectivePrice = effectivePrice;
  readonly isOutOfStock = isOutOfStock;
  readonly isPurchasable = isPurchasable;
  readonly sortOptions = SORT_OPTIONS;
  readonly skeletons = Array.from({ length: 8 }, (_, i) => i);

  readonly picking = this.orderEditDraft.picking;
  readonly justAdded = signal<string | null>(null);

  // ----- What the URL says -----
  readonly selectedCategory = signal<string>('All');
  readonly query = signal('');
  readonly sort = signal<SortKey>('relevance');
  readonly priceBands = signal<ReadonlySet<PriceBand>>(new Set());
  readonly sizes = signal<ReadonlySet<string>>(new Set());
  readonly inStockOnly = signal(false);
  readonly onOfferOnly = signal(false);

  /** What is in the search box, which runs a beat ahead of the URL while someone types. */
  readonly searchDraft = signal('');
  private committedQuery = '';
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  readonly filterSheetOpen = signal(false);
  readonly sortSheetOpen = signal(false);
  private releaseScroll: (() => void) | null = null;

  /** Set just before a filter change navigates, so the router's jump to the top can be undone. */
  private keepScrollY: number | null = null;
  private scrollToResultsAfter = false;

  constructor() {
    // The router reuses this component across /products?… navigations (same route, different
    // query params), so the state is read from the live stream, not a one-time snapshot -
    // otherwise clicking another category in the header while already here would do nothing.
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const category = normalizeCategory(params.get('category'));
      this.selectedCategory.set(isProductCategory(category) ? category : 'All');

      const q = (params.get('q') ?? '').trim();
      this.query.set(q);
      // Only take the box's text from the URL when the change came from somewhere else (the
      // search overlay, a link). Echoing our own commit back would eat whatever was typed since.
      if (q !== this.committedQuery) {
        this.committedQuery = q;
        this.searchDraft.set(q);
      }

      const sort = params.get('sort') as SortKey | null;
      this.sort.set(sort && SORT_OPTIONS.some((o) => o.key === sort) ? sort : 'relevance');
      this.priceBands.set(parseList(params.get('price'), PRICE_BANDS.map((b) => b.id)));
      this.sizes.set(parseList(params.get('size')));
      this.inStockOnly.set(params.get('stock') === '1');
      this.onOfferOnly.set(params.get('offer') === '1');
    });

    // Changing a filter is a router navigation, and the router answers every forward navigation
    // by scrolling to the top of the page. On a shop that is exactly wrong: someone half-way down
    // the grid who narrows it wants to stay with the grid. The router jumps on its Scroll event -
    // but Router.events is fed from the router's internal stream by a subscription made before
    // the router's scroller subscribes, so this handler runs BEFORE the jump, and restoring here
    // directly was undone a moment later (measured: every desktop filter click landed at y=0). A
    // microtask lands after the jump and still before anything is painted.
    this.router.events
      .pipe(
        filter((e): e is Scroll => e instanceof Scroll),
        takeUntilDestroyed(),
      )
      .subscribe(() => {
        if (this.keepScrollY === null) return;
        const y = this.keepScrollY;
        const thenResults = this.scrollToResultsAfter;
        this.keepScrollY = null;
        this.scrollToResultsAfter = false;
        queueMicrotask(() => {
          window.scrollTo(0, y);
          if (thenResults) this.scrollToResults();
        });
      });

    inject(DestroyRef).onDestroy(() => {
      if (this.searchTimer) clearTimeout(this.searchTimer);
      this.releaseScroll?.();
    });
  }

  // ----- The catalogue, narrowed -----

  readonly categories = computed<readonly string[]>(() => [
    'All',
    ...this.productService.categoriesInUse(),
  ]);

  private readonly searched = computed(() => {
    const all = this.productService.products();
    const q = this.query();
    return q ? searchProducts(all, q) : all;
  });

  /** Whether a product passes every filter, optionally ignoring one - which is how each group's
   * counts are worked out: "how many would I get if I also picked this?" */
  private passes(p: Product, ignore?: Facet): boolean {
    const category = this.selectedCategory();
    if (ignore !== 'category' && category !== 'All' && p.category !== category) return false;

    const bands = this.priceBands();
    if (ignore !== 'price' && bands.size > 0) {
      const price = effectivePrice(p);
      if (!PRICE_BANDS.some((b) => bands.has(b.id) && b.holds(price))) return false;
    }

    const sizes = this.sizes();
    if (ignore !== 'size' && sizes.size > 0 && !sizes.has(packSize(p.weight))) return false;
    if (ignore !== 'stock' && this.inStockOnly() && !isPurchasable(p)) return false;
    if (ignore !== 'offer' && this.onOfferOnly() && !(p.discount > 0)) return false;
    return true;
  }

  readonly filteredProducts = computed(() => {
    const list = this.searched().filter((p) => this.passes(p));
    return this.sorted(list);
  });

  private sorted(list: Product[]): Product[] {
    const byName = (a: Product, b: Product) => a.name.localeCompare(b.name);
    const out = [...list];
    switch (this.sort()) {
      case 'price-asc':
        out.sort((a, b) => effectivePrice(a) - effectivePrice(b) || byName(a, b));
        break;
      case 'price-desc':
        out.sort((a, b) => effectivePrice(b) - effectivePrice(a) || byName(a, b));
        break;
      case 'discount':
        out.sort((a, b) => (b.discount ?? 0) - (a.discount ?? 0) || byName(a, b));
        break;
      case 'name':
        out.sort(byName);
        break;
      case 'newest':
        out.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
        break;
      default:
        // Recommended: the catalogue's own order (or best match, when searching) - with anything
        // that cannot be bought today moved to the end rather than taking a front-row slot.
        break;
    }
    // Stable, so this only moves the unavailable ones.
    return out.sort((a, b) => Number(!isPurchasable(a)) - Number(!isPurchasable(b)));
  }

  // ----- Counts for the filter groups -----

  private readonly categoryCounts = computed(() => {
    const counts = new Map<string, number>();
    const base = this.searched().filter((p) => this.passes(p, 'category'));
    counts.set('All', base.length);
    for (const p of base) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
    return counts;
  });

  categoryCount(category: string): number {
    return this.categoryCounts().get(category) ?? 0;
  }

  readonly priceOptions = computed(() => {
    const base = this.searched().filter((p) => this.passes(p, 'price'));
    return PRICE_BANDS.map((b) => ({
      id: b.id,
      label: b.label,
      count: base.filter((p) => b.holds(effectivePrice(p))).length,
    }));
  });

  readonly sizeOptions = computed(() => {
    const all = [...new Set(this.productService.products().map((p) => packSize(p.weight)))]
      .filter(Boolean)
      .sort((a, b) => packGrams(a) - packGrams(b));
    const base = this.searched().filter((p) => this.passes(p, 'size'));
    return all.map((id) => ({
      id,
      label: packLabel(id),
      count: base.filter((p) => packSize(p.weight) === id).length,
    }));
  });

  readonly inStockCount = computed(
    () => this.searched().filter((p) => this.passes(p, 'stock') && isPurchasable(p)).length,
  );

  readonly onOfferCount = computed(
    () => this.searched().filter((p) => this.passes(p, 'offer') && p.discount > 0).length,
  );

  // ----- What is applied -----

  readonly activeFilterCount = computed(
    () =>
      (this.selectedCategory() !== 'All' ? 1 : 0) +
      this.priceBands().size +
      this.sizes().size +
      (this.inStockOnly() ? 1 : 0) +
      (this.onOfferOnly() ? 1 : 0),
  );

  readonly activePills = computed<FilterPill[]>(() => {
    const pills: FilterPill[] = [];
    const q = this.query();
    if (q) pills.push({ id: 'q', label: `“${q}”`, facet: 'q' });
    const category = this.selectedCategory();
    if (category !== 'All') pills.push({ id: 'category', label: category, facet: 'category' });
    for (const b of PRICE_BANDS) {
      if (this.priceBands().has(b.id)) pills.push({ id: `price-${b.id}`, label: b.label, facet: 'price', value: b.id });
    }
    for (const s of this.sizes()) {
      pills.push({ id: `size-${s}`, label: packLabel(s), facet: 'size', value: s });
    }
    if (this.inStockOnly()) pills.push({ id: 'stock', label: 'In stock', facet: 'stock' });
    if (this.onOfferOnly()) pills.push({ id: 'offer', label: 'On offer', facet: 'offer' });
    return pills;
  });

  readonly sortLabel = computed(() => SORT_OPTIONS.find((o) => o.key === this.sort())?.short ?? 'Sort');

  // ----- Page heading -----

  /** A small label over the title saying what kind of page this is, so the title can be a name. */
  readonly eyebrow = computed(() => {
    if (this.query() && this.selectedCategory() === 'All') return 'Search results';
    return this.selectedCategory() === 'All' ? 'The Ojas pantry' : 'Category';
  });

  readonly title = computed(() => {
    const q = this.query();
    const category = this.selectedCategory();
    if (q && category === 'All') return `“${q}”`;
    return category === 'All' ? 'All products' : category;
  });

  readonly subtitle = computed(() => {
    const category = this.selectedCategory();
    if (this.query() && category === 'All') {
      const n = this.filteredProducts().length;
      return `${n} ${n === 1 ? 'product matches' : 'products match'} your search.`;
    }
    if (category !== 'All') return categoryDetail(category)?.blurb ?? '';
    return 'Stone-ground flours, fasting staples and kitchen essentials, packed fresh and delivered across Pune.';
  });

  readonly showSkeleton = computed(
    () => this.productService.loading() && this.productService.products().length === 0,
  );
  readonly showError = computed(
    () => !!this.productService.error() && this.productService.products().length === 0,
  );

  // ----- Commands -----

  selectCategory(category: string): void {
    this.patchQuery({ category: category === 'All' ? null : category }, { scroll: true });
  }

  setSort(key: string): void {
    const sort = SORT_OPTIONS.some((o) => o.key === key) ? (key as SortKey) : 'relevance';
    this.sortSheetOpen.set(false);
    this.syncScrollLock();
    this.patchQuery({ sort: sort === 'relevance' ? null : sort }, { replaceUrl: true, scroll: true });
  }

  toggleBand(id: PriceBand): void {
    const next = new Set(this.priceBands());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.patchQuery({ price: joinOrNull(next) }, { replaceUrl: true, scroll: true });
  }

  toggleSize(id: string): void {
    const next = new Set(this.sizes());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.patchQuery({ size: joinOrNull(next) }, { replaceUrl: true, scroll: true });
  }

  toggleInStock(): void {
    this.patchQuery({ stock: this.inStockOnly() ? null : '1' }, { replaceUrl: true, scroll: true });
  }

  toggleOnOffer(): void {
    this.patchQuery({ offer: this.onOfferOnly() ? null : '1' }, { replaceUrl: true, scroll: true });
  }

  removePill(pill: FilterPill): void {
    switch (pill.facet) {
      case 'q':
        this.clearSearch();
        return;
      case 'category':
        this.selectCategory('All');
        return;
      case 'price':
        this.toggleBand(pill.value as PriceBand);
        return;
      case 'size':
        this.toggleSize(pill.value ?? '');
        return;
      case 'stock':
        this.toggleInStock();
        return;
      case 'offer':
        this.toggleOnOffer();
        return;
    }
  }

  clearAll(): void {
    this.committedQuery = '';
    this.searchDraft.set('');
    this.patchQuery(
      { category: null, q: null, price: null, size: null, stock: null, offer: null },
      { scroll: true },
    );
  }

  onSearchInput(value: string): void {
    this.searchDraft.set(value);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.commitSearch(), SEARCH_DEBOUNCE_MS);
  }

  commitSearch(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = null;
    const q = this.searchDraft().trim();
    if (q === this.committedQuery) return;
    this.committedQuery = q;
    // Replaced rather than pushed: every pause while typing is not a page to go back to.
    this.patchQuery({ q: q || null }, { replaceUrl: true });
  }

  clearSearch(): void {
    this.searchDraft.set('');
    this.commitSearch();
  }

  openFilterSheet(): void {
    this.sortSheetOpen.set(false);
    this.filterSheetOpen.set(true);
    this.syncScrollLock();
  }

  openSortSheet(): void {
    this.filterSheetOpen.set(false);
    this.sortSheetOpen.set(true);
    this.syncScrollLock();
  }

  closeSheets(): void {
    this.filterSheetOpen.set(false);
    this.sortSheetOpen.set(false);
    this.syncScrollLock();
  }

  private syncScrollLock(): void {
    const open = this.filterSheetOpen() || this.sortSheetOpen();
    if (open && !this.releaseScroll) this.releaseScroll = this.scrollLock.lock();
    if (!open && this.releaseScroll) {
      this.releaseScroll();
      this.releaseScroll = null;
    }
  }

  private patchQuery(params: Params, options: { replaceUrl?: boolean; scroll?: boolean } = {}): void {
    if (typeof window !== 'undefined') {
      this.keepScrollY = window.scrollY;
      this.scrollToResultsAfter = !!options.scroll;
    }
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: params,
      queryParamsHandling: 'merge',
      replaceUrl: options.replaceUrl ?? false,
    });
  }

  /** Brings the top of the results back into view if the customer has scrolled past it - and
   * leaves the page alone if they have not. */
  private scrollToResults(): void {
    const el = this.resultsTop()?.nativeElement;
    if (!el || this.filterSheetOpen()) return;
    if (el.getBoundingClientRect().top < 0) {
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    }
  }

  retry(): void {
    this.productService.loadProducts();
  }

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
   * The stagger applies to roughly the first screenful and then stops: a row of cards arriving in
   * sequence reads as deliberate, but with a flat step and no ceiling the last card of a
   * thirty-product grid did not appear until nearly two seconds after the page - and with
   * `animation-fill-mode: both` it is genuinely invisible until then.
   */
  cardDelay(index: number): string {
    return `${Math.min(index, STAGGER_CARDS) * STAGGER_STEP_S}s`;
  }

  /** How many photographs are fetched at normal priority rather than lazily. About a first
   * screenful on a desktop grid. */
  readonly eagerImageCount = 6;

  onImgError(event: Event): void {
    const img = event.target as HTMLImageElement;
    img.src = '/images/placeholder.svg';
  }
}

function joinOrNull(values: ReadonlySet<string>): string | null {
  return values.size ? [...values].join(',') : null;
}
