import { Component, computed, effect, inject, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { AuthService } from '../../services/auth.service';
import { CartService } from '../../services/cart.service';
import { CheckoutService } from '../../services/checkout.service';
import { WalletService } from '../../services/wallet.service';
import { ProductService } from '../../services/product.service';
import { SearchUiService } from '../../services/search-ui.service';
import { LogoutConfirmService } from '../../services/logout-confirm.service';
import { PRODUCT_CATEGORY_DETAILS } from '../../constants/product-categories';
import { HeaderAddressPicker } from '../header-address-picker/header-address-picker';
import { MobileDrawer } from '../mobile-drawer/mobile-drawer';
import { SearchTrigger } from '../search-trigger/search-trigger';

@Component({
  selector: 'app-header',
  imports: [
    RouterLink,
    RouterLinkActive,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatDividerModule,
    CurrencyPipe,
    HeaderAddressPicker,
    MobileDrawer,
    SearchTrigger,
  ],
  templateUrl: './header.html',
  styleUrl: './header.scss',
  host: {
    '[class.scrolled]': 'isScrolled()',
    '[class.customer-area]': 'isCustomerArea()',
    '[class.menu-open]': 'menuOpen()',
    '(window:scroll)': 'onScroll()',
    '(document:keydown.escape)': 'onEscape()',
    '(document:keydown)': 'onDocumentKeydown($event)',
  },
})
export class Header {
  readonly auth = inject(AuthService);
  readonly cart = inject(CartService);
  readonly checkoutService = inject(CheckoutService);
  readonly wallet = inject(WalletService);
  private readonly router = inject(Router);
  private readonly productService = inject(ProductService);
  private readonly search = inject(SearchUiService);
  private readonly logoutConfirm = inject(LogoutConfirmService);

  readonly menuOpen = signal(false);
  readonly isScrolled = signal(false);
  readonly cartBounce = signal(false);
  readonly desktopCategoryOpen = signal(false);
  readonly categoriesSheetOpen = signal(false);

  /** Only the aisles with something in them - see ProductService.categoriesInUse. */
  readonly categories = this.productService.categoriesInUse;
  readonly categoryDetails = computed(() => {
    const inUse = new Set<string>(this.categories());
    return PRODUCT_CATEGORY_DETAILS.filter((c) => inUse.has(c.name));
  });

  private prevCount = 0;
  private walletLoadedFor: string | null = null;

  constructor() {
    // The balance is shown in the account menu, which is on every page, so it has to be loaded
    // once the customer is known rather than left to whichever page happens to need it. Keyed on
    // the account so switching users re-reads it, and so it isn't re-fetched on every signal read.
    effect(() => {
      const user = this.auth.user();
      const customerId = user?.role === 'customer' ? user.id : null;

      if (!customerId) {
        this.walletLoadedFor = null;
        return;
      }
      if (this.walletLoadedFor === customerId) return;

      this.walletLoadedFor = customerId;
      this.wallet.load().subscribe({ error: () => {} });
    });
    effect(() => {
      const count = this.cart.items().length;
      if (count > this.prevCount) {
        this.cartBounce.set(true);
        setTimeout(() => this.cartBounce.set(false), 600);
      }
      this.prevCount = count;
    });
  }

  onScroll(): void {
    this.isScrolled.set(window.scrollY > 20);
  }

  /**
   * "/" opens search from anywhere, as on most shops - unless the person is typing somewhere
   * else, or is staff at work in the admin console. It lives here rather than in the search
   * overlay because the overlay is only loaded the first time search is opened.
   */
  onDocumentKeydown(event: KeyboardEvent): void {
    if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
    if (!this.isCustomerArea() || this.search.isOpen() || isTyping(event.target)) return;
    event.preventDefault();
    this.openSearch();
  }

  onEscape(): void {
    if (this.menuOpen()) this.menuOpen.set(false);
    if (this.categoriesSheetOpen()) this.categoriesSheetOpen.set(false);
  }

  toggleMenu(): void {
    this.menuOpen.update((open) => !open);
    if (this.menuOpen()) this.categoriesSheetOpen.set(false);
  }

  closeMenu(): void {
    this.menuOpen.set(false);
  }

  toggleCategoriesSheet(): void {
    this.categoriesSheetOpen.update((open) => !open);
    if (this.categoriesSheetOpen()) this.menuOpen.set(false);
  }

  /**
   * Opens the category sheet from the mobile drawer. Distinct from the toggle because the entry
   * point differs: the drawer is already open, so this has to close it and open the sheet, and
   * it must always open rather than toggle — tapping a menu item that sometimes closes the thing
   * it names would be a coin flip from the shopper's side.
   */
  openCategoriesFromMenu(): void {
    this.menuOpen.set(false);
    this.categoriesSheetOpen.set(true);
  }

  openSearch(): void {
    this.menuOpen.set(false);
    this.search.open();
  }

  /** Every Log out asks first — see LogoutConfirmService. */
  logout(): void {
    this.menuOpen.set(false);
    this.logoutConfirm.request();
  }

  openDesktopCategoryMenu(): void {
    this.desktopCategoryOpen.set(true);
  }

  closeDesktopCategoryMenu(): void {
    this.desktopCategoryOpen.set(false);
  }

  onDesktopCategoryFocusOut(event: FocusEvent): void {
    const container = event.currentTarget as HTMLElement;
    const next = event.relatedTarget as HTMLElement | null;
    if (!next || !container.contains(next)) {
      this.closeDesktopCategoryMenu();
    }
  }

  goToCheckout(): void {
    if (this.checkoutService.count() === 0) return;
    this.router.navigate(['/checkout']);
  }

  activeCheckoutCount(): number {
    return this.checkoutService.count();
  }

  getInitials(): string {
    const name = this.auth.user()?.fullName ?? '';
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }

  isCustomerArea(): boolean {
    return !this.auth.isLoggedIn() || this.auth.role() === 'customer';
  }

  homeRoute(): string {
    return this.auth.getDefaultRouteForRole();
  }
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}
