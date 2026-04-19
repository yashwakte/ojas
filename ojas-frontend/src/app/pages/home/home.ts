import { Component, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { ProductService } from '../../services/product.service';
import { CartService } from '../../services/cart.service';
import { CheckoutService } from '../../services/checkout.service';
import { AuthService } from '../../services/auth.service';
import { Product } from '../../models/interfaces';

@Component({
  selector: 'app-home',
  imports: [RouterLink, MatIconModule],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home {
  featuredProducts;
  justAdded = signal<string | null>(null);

  constructor(
    private productService: ProductService,
    private cartService: CartService,
    private checkoutService: CheckoutService,
    private auth: AuthService,
    private router: Router,
  ) {
    this.featuredProducts = this.productService.products().slice(0, 6);
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

  features = [
    {
      icon: 'verified',
      title: '100% Pure',
      desc: "Zero additives. Zero preservatives. Just nature's finest.",
    },
    {
      icon: 'eco',
      title: 'Stone-Ground',
      desc: 'Traditional chakki process preserving nutrition & taste.',
    },
    {
      icon: 'local_shipping',
      title: 'Farm Fresh',
      desc: 'Packed fresh and delivered straight to your door.',
    },
    {
      icon: 'favorite',
      title: 'Made with Love',
      desc: 'Crafted with care by families who believe in quality.',
    },
  ];

  processSteps = [
    {
      icon: 'agriculture',
      title: 'Sourced',
      desc: 'Finest grains from trusted local farms in Maharashtra',
    },
    {
      icon: 'settings',
      title: 'Stone-Ground',
      desc: 'Traditional chakki-ground for authentic taste & nutrition',
    },
    {
      icon: 'inventory_2',
      title: 'Packed Fresh',
      desc: 'Hygienically packed the same day for maximum freshness',
    },
    { icon: 'home', title: 'Delivered', desc: 'Straight to your doorstep with care and speed' },
  ];

  testimonials = [
    {
      name: 'Priya Sharma',
      text: 'The bajra flour quality is unmatched. My rotis have never tasted this good!',
      rating: 5,
    },
    {
      name: 'Amit Kulkarni',
      text: 'Finally found pure, stone-ground flour. Ojas is now a staple in our kitchen.',
      rating: 5,
    },
    {
      name: 'Sneha Patil',
      text: 'Love the ragi flour! My kids enjoy the ragi dosas every weekend.',
      rating: 5,
    },
  ];
}
