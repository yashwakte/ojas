import { Component, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ProductService } from '../../services/product.service';
import { CartService } from '../../services/cart.service';
import { CheckoutService } from '../../services/checkout.service';
import { AuthService } from '../../services/auth.service';
import { Product } from '../../models/interfaces';
import { DecimalPipe } from '@angular/common';
import { PRODUCT_CATEGORIES } from '../../constants/product-categories';

@Component({
  selector: 'app-products',
  imports: [RouterLink, MatButtonModule, MatIconModule, DecimalPipe],
  templateUrl: './products.html',
  styleUrl: './products.scss',
})
export class Products implements OnInit {
  selectedCategory = 'All';
  categories = ['All', ...PRODUCT_CATEGORIES];
  justAdded = signal<string | null>(null);

  constructor(
    private productService: ProductService,
    private cartService: CartService,
    private checkoutService: CheckoutService,
    private auth: AuthService,
    private route: ActivatedRoute,
    private router: Router,
  ) {}

  ngOnInit(): void {
    const category = this.route.snapshot.queryParamMap.get('category');
    if (category && (this.categories as string[]).includes(category)) {
      this.selectedCategory = category;
    }
  }

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
