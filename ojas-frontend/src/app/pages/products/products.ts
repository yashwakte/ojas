import { Component, signal } from '@angular/core';
import { Router } from '@angular/router';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ProductService } from '../../services/product.service';
import { CartService } from '../../services/cart.service';
import { CheckoutService } from '../../services/checkout.service';
import { AuthService } from '../../services/auth.service';
import { Product } from '../../models/interfaces';

@Component({
  selector: 'app-products',
  imports: [RouterLink, MatButtonModule, MatIconModule],
  templateUrl: './products.html',
  styleUrl: './products.scss',
})
export class Products {
  selectedCategory = 'All';
  categories = ['All', 'Flour', 'Grains', 'Health Mix'];
  justAdded = signal<string | null>(null);

  constructor(
    private productService: ProductService,
    private cartService: CartService,
    private checkoutService: CheckoutService,
    private auth: AuthService,
    private router: Router,
  ) {}

  get filteredProducts(): Product[] {
    const all = this.productService.products();
    if (this.selectedCategory === 'All') return all;
    return all.filter((p) => p.category === this.selectedCategory);
  }

  addToCart(product: Product): void {
    if (!this.auth.isLoggedIn()) {
      this.router.navigate(['/login']);
      return;
    }
    this.cartService.addToCart(product);
    this.justAdded.set(product.id);
    setTimeout(() => this.justAdded.set(null), 2000);
  }

  buyNow(product: Product): void {
    if (!this.auth.isLoggedIn()) {
      this.router.navigate(['/login']);
      return;
    }
    this.checkoutService.addItem(product);
    this.router.navigate(['/checkout']);
  }

  onImgError(event: Event) {
    const img = event.target as HTMLImageElement;
    img.src = '/images/placeholder.svg';
  }

  selectCategory(cat: string) {
    this.selectedCategory = cat;
  }
}
