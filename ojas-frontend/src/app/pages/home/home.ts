import { Component, OnInit, effect } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { ProductService } from '../../services/product.service';
import { Product } from '../../models/interfaces';

@Component({
  selector: 'app-home',
  imports: [RouterLink, MatIconModule],
  templateUrl: './home.html',
  styleUrl: './home.scss'
})
export class Home implements OnInit {
  featuredProducts: Product[] = [];

  constructor(private productService: ProductService) {
    effect(() => {
      this.featuredProducts = this.productService.products().slice(0, 6);
    });
  }

  ngOnInit() {
    this.productService.loadProducts();
  }

  getImageUrl(product: Product): string {
    return product.imageUrl || '';
  }

  features = [
    { icon: 'verified', title: '100% Pure', desc: 'No additives or preservatives. Pure, natural ingredients only.' },
    { icon: 'eco', title: 'Traditional Process', desc: 'Stone-ground and processed using age-old methods.' },
    { icon: 'local_shipping', title: 'Fresh Delivery', desc: 'Freshly packed and delivered to your doorstep.' },
    { icon: 'favorite', title: 'Made with Love', desc: 'Every product is crafted with care and passion.' }
  ];

  processSteps = [
    { icon: 'agriculture', title: 'Sourced', desc: 'Finest grains from trusted local farms' },
    { icon: 'settings', title: 'Stone-Ground', desc: 'Traditional chakki-ground process' },
    { icon: 'inventory_2', title: 'Packed Fresh', desc: 'Hygienically packed same day' },
    { icon: 'home', title: 'Delivered', desc: 'Straight to your doorstep' }
  ];
}
