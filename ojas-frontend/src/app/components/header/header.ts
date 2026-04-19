import { Component, HostListener, signal, effect } from '@angular/core';
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
  ],
  templateUrl: './header.html',
  styleUrl: './header.scss',
  host: {
    '[class.scrolled]': 'isScrolled',
  },
})
export class Header {
  menuOpen = false;
  isScrolled = false;
  cartBounce = signal(false);

  private _prevCount = 0;

  constructor(
    public auth: AuthService,
    public cart: CartService,
    public checkoutService: CheckoutService,
    private router: Router,
  ) {
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
}
