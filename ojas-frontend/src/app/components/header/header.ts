import { Component, HostListener, signal, effect } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatBadgeModule } from '@angular/material/badge';
import { MatDividerModule } from '@angular/material/divider';
import { AuthService } from '../../services/auth.service';
import { CartService } from '../../services/cart.service';
import { CheckoutService } from '../../services/checkout.service';
import { ChatbotUiService } from '../../services/chatbot-ui.service';
import { WalletService } from '../../services/wallet.service';
import { PRODUCT_CATEGORIES, PRODUCT_CATEGORY_DETAILS } from '../../constants/product-categories';
import { HeaderAddressPicker } from '../header-address-picker/header-address-picker';

@Component({
  selector: 'app-header',
  imports: [
    RouterLink,
    RouterLinkActive,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatBadgeModule,
    MatDividerModule,
    CurrencyPipe,
    HeaderAddressPicker,
  ],
  templateUrl: './header.html',
  styleUrl: './header.scss',
  host: {
    '[class.scrolled]': 'isScrolled',
    '[class.customer-area]': 'isCustomerArea()',
  },
})
export class Header {
  menuOpen = false;
  isScrolled = false;
  cartBounce = signal(false);
  desktopCategoryOpen = signal(false);
  categoriesSheetOpen = signal(false);

  readonly categories = PRODUCT_CATEGORIES;
  readonly categoryDetails = PRODUCT_CATEGORY_DETAILS;

  private _prevCount = 0;
  private walletLoadedFor: string | null = null;

  constructor(
    public auth: AuthService,
    public cart: CartService,
    public checkoutService: CheckoutService,
    public chatbotUi: ChatbotUiService,
    public wallet: WalletService,
    private router: Router,
  ) {
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
      if (count > this._prevCount) {
        this.cartBounce.set(true);
        setTimeout(() => this.cartBounce.set(false), 600);
      }
      this._prevCount = count;
    });
  }

  @HostListener('window:scroll')
  onScroll() {
    this.isScrolled = window.scrollY > 20;
  }

  toggleMenu() {
    this.menuOpen = !this.menuOpen;
    if (this.menuOpen) {
      this.categoriesSheetOpen.set(false);
    }
  }

  toggleCategoriesSheet(): void {
    this.categoriesSheetOpen.update((open) => !open);
    if (this.categoriesSheetOpen()) {
      this.menuOpen = false;
    }
  }

  /**
   * Opens the category sheet from the mobile drawer. Distinct from the toggle because the entry
   * point differs: the drawer is already open, so this has to close it and open the sheet, and
   * it must always open rather than toggle — tapping a menu item that sometimes closes the thing
   * it names would be a coin flip from the shopper's side.
   */
  openCategoriesFromMenu(): void {
    this.menuOpen = false;
    this.categoriesSheetOpen.set(true);
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

  openChatSupport(): void {
    this.chatbotUi.openChat();
    this.toggleMenu();
  }

  homeRoute(): string {
    return this.auth.getDefaultRouteForRole();
  }
}
