import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { ProductService } from '../../services/product.service';
import { CartService } from '../../services/cart.service';
import { CheckoutService } from '../../services/checkout.service';
import { AuthService } from '../../services/auth.service';
import { CampaignBannerService } from '../../services/campaign-banner.service';
import { CampaignBannerConfig, Product } from '../../models/interfaces';
import { PRODUCT_CATEGORY_DETAILS } from '../../constants/product-categories';
import { ProductCard } from '../../components/product-card/product-card';
import { ScrollRevealDirective } from '../../directives/scroll-reveal.directive';

@Component({
  selector: 'app-home',
  imports: [RouterLink, MatIconModule, ProductCard, ScrollRevealDirective],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home implements OnInit {
  private productService = inject(ProductService);
  private cartService = inject(CartService);
  private checkoutService = inject(CheckoutService);
  private auth = inject(AuthService);
  private router = inject(Router);
  private campaignBannerService = inject(CampaignBannerService);

  justAdded = signal<string | null>(null);

  // Every active campaign renders as its own banner + featured-products row,
  // stacked in the order they were created (oldest first).
  readonly activeCampaigns = computed(() =>
    this.campaignBannerService.campaigns().filter((c) => c.isActive),
  );

  featuredProductsFor(campaign: CampaignBannerConfig): Product[] {
    const ids = campaign.featuredProductIds ?? [];
    if (ids.length === 0) return [];
    const products = this.productService.products();
    return ids
      .map((id) => products.find((p) => p.id === id))
      .filter((p): p is Product => !!p && p.isAvailable);
  }

  readonly bestsellers = signal<Product[]>([]);
  readonly bestsellersLoading = signal(true);

  readonly festiveSavings = computed(() =>
    this.productService
      .products()
      .filter((p) => p.discount > 0 && p.isAvailable)
      .slice(0, 8),
  );

  readonly upwasSpecials = computed(() =>
    this.productService
      .products()
      .filter((p) => p.category === 'Upwas' && p.isAvailable)
      .slice(0, 8),
  );

  readonly categoryTiles = PRODUCT_CATEGORY_DETAILS;

  ngOnInit(): void {
    this.productService.getBestsellers(6).subscribe({
      next: (products) => {
        this.bestsellers.set(products);
        this.bestsellersLoading.set(false);
      },
      error: () => this.bestsellersLoading.set(false),
    });
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
