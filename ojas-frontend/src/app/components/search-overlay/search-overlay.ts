import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { SearchUiService } from '../../services/search-ui.service';
import { ProductService } from '../../services/product.service';
import { ScrollLockService } from '../../services/scroll-lock.service';
import { POPULAR_SEARCHES, searchProducts } from '../../constants/product-search';
import { ProductCategoryDetail, categoryDetail } from '../../constants/product-categories';
import { Product, effectivePrice, isOutOfStock } from '../../models/interfaces';
import { thumbnailPackShot } from '../../constants/pack-shots';

const RECENT_KEY = 'ojas_recent_searches';
const RECENT_LIMIT = 5;
/** How many matches the overlay lists before offering "See all". */
const PREVIEW_LIMIT = 6;
/** Must match the closing animations in search-overlay.scss. */
export const SEARCH_CLOSE_MS = 260;

/**
 * Product search, from anywhere in the shop.
 *
 * Type, see matching packs as you go, tap one to open it, or press Enter for the full results on
 * the products page. With nothing typed it offers recent searches, the searches that find
 * something here, and the aisles.
 *
 * On a phone it opens out of the header's search icon and takes the whole screen, with the search
 * box where the header was - the keyboard gets all the room it needs and nothing of the page
 * behind competes with the results. On a desktop it is a panel near the top of the screen.
 */
@Component({
  selector: 'app-search-overlay',
  imports: [DecimalPipe, MatIconModule],
  templateUrl: './search-overlay.html',
  styleUrl: './search-overlay.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown)': 'onDocumentKeydown($event)' },
})
export class SearchOverlay {
  readonly ui = inject(SearchUiService);
  private readonly productService = inject(ProductService);
  private readonly router = inject(Router);
  private readonly scrollLock = inject(ScrollLockService);
  private readonly injector = inject(Injector);

  private readonly input = viewChild<ElementRef<HTMLInputElement>>('searchInput');

  readonly query = signal('');
  /** The result the arrow keys have landed on; -1 is none. */
  readonly activeIndex = signal(-1);
  readonly recent = signal<string[]>([]);
  /** Playing its way out; the overlay is removed once this animation has run. */
  readonly closing = signal(false);
  readonly popular = POPULAR_SEARCHES;

  /** Where the phone reveal grows from: the icon that was tapped, if there was one. */
  readonly originX = computed(() => {
    const o = this.ui.origin();
    return o ? `${o.x}px` : null;
  });
  readonly originY = computed(() => {
    const o = this.ui.origin();
    return o ? `${o.y}px` : null;
  });

  readonly hasQuery = computed(() => this.query().trim().length > 0);
  readonly catalogueReady = computed(() => this.productService.products().length > 0);
  readonly matches = computed(() => searchProducts(this.productService.products(), this.query()));
  readonly preview = computed(() => this.matches().slice(0, PREVIEW_LIMIT));
  readonly aisles = computed(() =>
    this.productService
      .categoriesInUse()
      .map((name) => categoryDetail(name))
      .filter((c): c is ProductCategoryDetail => !!c),
  );

  readonly thumbnail = thumbnailPackShot;
  readonly effectivePrice = effectivePrice;
  readonly isOutOfStock = isOutOfStock;

  private release: (() => void) | null = null;
  private returnFocusTo: HTMLElement | null = null;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      const open = this.ui.isOpen();
      untracked(() => (open ? this.onOpen() : this.onClose()));
    });
    inject(DestroyRef).onDestroy(() => {
      this.release?.();
      if (this.closeTimer) clearTimeout(this.closeTimer);
    });
  }

  private onOpen(): void {
    if (this.closeTimer) clearTimeout(this.closeTimer);
    this.closeTimer = null;
    this.closing.set(false);
    this.returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.query.set(this.ui.seed());
    this.activeIndex.set(-1);
    this.recent.set(readRecent());
    this.release ??= this.scrollLock.lock();
    afterNextRender(
      () => {
        const el = this.input()?.nativeElement;
        el?.focus();
        el?.select();
      },
      { injector: this.injector },
    );
  }

  private onClose(): void {
    this.release?.();
    this.release = null;
    this.closing.set(false);
    // Focus goes back where it came from - the header icon, the drawer row - so a keyboard user
    // is not dropped at the top of the document.
    const back = this.returnFocusTo;
    this.returnFocusTo = null;
    if (back?.isConnected) back.focus();
  }

  /** Plays the overlay out, then removes it. */
  close(): void {
    if (!this.ui.isOpen() || this.closing()) return;
    this.closing.set(true);
    this.closeTimer = setTimeout(() => {
      this.closeTimer = null;
      this.ui.close();
    }, SEARCH_CLOSE_MS);
  }

  onInput(value: string): void {
    this.query.set(value);
    this.activeIndex.set(-1);
  }

  clear(): void {
    this.query.set('');
    this.activeIndex.set(-1);
    this.input()?.nativeElement.focus();
  }

  useSuggestion(term: string): void {
    this.query.set(term);
    this.activeIndex.set(-1);
    this.input()?.nativeElement.focus();
  }

  // Leaving for another page closes at once: the new page is the transition.
  openProduct(product: Product): void {
    this.remember(this.query());
    this.ui.close();
    this.router.navigate(['/products', product.id]);
  }

  seeAll(): void {
    const q = this.query().trim();
    if (!q) return;
    this.remember(q);
    this.ui.close();
    this.router.navigate(['/products'], { queryParams: { q } });
  }

  openAisle(name: string): void {
    this.ui.close();
    this.router.navigate(['/products'], { queryParams: { category: name } });
  }

  forgetRecent(): void {
    this.recent.set([]);
    writeRecent([]);
  }

  /** The combobox keys: arrows move through the matches, Enter opens one or shows them all. */
  onInputKeydown(event: KeyboardEvent): void {
    const count = this.preview().length;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (count) this.activeIndex.update((i) => (i + 1) % count);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (count) this.activeIndex.update((i) => (i <= 0 ? count - 1 : i - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const hit = this.preview()[this.activeIndex()];
      if (hit) this.openProduct(hit);
      else this.seeAll();
    }
  }

  /** Escape closes. (The "/" that opens it lives in the header, which is always loaded; this
   * component only arrives the first time search is opened.) */
  onDocumentKeydown(event: KeyboardEvent): void {
    if (this.ui.isOpen() && event.key === 'Escape') {
      event.preventDefault();
      this.close();
    }
  }

  private remember(term: string): void {
    const t = term.trim();
    if (!t) return;
    const next = [t, ...this.recent().filter((r) => r.toLowerCase() !== t.toLowerCase())].slice(
      0,
      RECENT_LIMIT,
    );
    this.recent.set(next);
    writeRecent(next);
  }
}

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string').slice(0, RECENT_LIMIT)
      : [];
  } catch {
    return [];
  }
}

function writeRecent(terms: string[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(terms));
  } catch {
    // Storage can be unavailable (private browsing, blocked site data). Recent searches are a
    // convenience, so losing them is fine.
  }
}
