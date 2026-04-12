import { Component, OnInit, effect } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SlicePipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { ProductService } from '../../services/product.service';
import { Product } from '../../models/interfaces';

@Component({
  selector: 'app-home',
  imports: [RouterLink, MatIconModule, SlicePipe],
  templateUrl: './home.html',
  styleUrl: './home.scss'
})
export class Home implements OnInit {
  featuredProducts: Product[] = [];
  heroProducts: Product[] = [];

  constructor(private productService: ProductService) {
    effect(() => {
      const all = this.productService.products();
      this.featuredProducts = all.slice(0, 6);
      this.heroProducts = all.slice(0, 4);
    });
  }

  ngOnInit() {
    this.productService.loadProducts();
  }

  getImageUrl(product: Product): string {
    return product.imageUrl || '';
  }

  features = [
    { icon: 'verified', title: '100% Pure', desc: 'Zero additives. Zero preservatives. Just nature\'s finest.' },
    { icon: 'eco', title: 'Stone-Ground', desc: 'Traditional chakki process preserving nutrition & taste.' },
    { icon: 'local_shipping', title: 'Farm Fresh', desc: 'Packed fresh and delivered straight to your door.' },
    { icon: 'favorite', title: 'Made with Love', desc: 'Crafted with care by families who believe in quality.' }
  ];

  processSteps = [
    { icon: 'agriculture', title: 'Sourced', desc: 'Finest grains from trusted local farms in Maharashtra' },
    { icon: 'settings', title: 'Stone-Ground', desc: 'Traditional chakki-ground for authentic taste & nutrition' },
    { icon: 'inventory_2', title: 'Packed Fresh', desc: 'Hygienically packed the same day for maximum freshness' },
    { icon: 'home', title: 'Delivered', desc: 'Straight to your doorstep with care and speed' }
  ];

  testimonials = [
    { name: 'Priya Sharma', text: 'The bajra flour quality is unmatched. My rotis have never tasted this good!', rating: 5 },
    { name: 'Amit Kulkarni', text: 'Finally found pure, stone-ground flour. Ojas is now a staple in our kitchen.', rating: 5 },
    { name: 'Sneha Patil', text: 'Love the ragi flour! My kids enjoy the ragi dosas every weekend.', rating: 5 }
  ];
}
