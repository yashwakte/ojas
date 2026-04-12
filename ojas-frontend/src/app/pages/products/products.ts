import { Component, OnInit } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ProductService } from '../../services/product.service';
import { Product } from '../../models/interfaces';

@Component({
  selector: 'app-products',
  imports: [MatButtonModule, MatIconModule],
  templateUrl: './products.html',
  styleUrl: './products.scss'
})
export class Products implements OnInit {
  selectedCategory = 'All';
  categories = ['All', 'Flour', 'Grains', 'Health Mix'];

  constructor(public productService: ProductService) {}

  ngOnInit() {
    this.productService.loadProducts();
  }

  get filteredProducts(): Product[] {
    const all = this.productService.products();
    if (this.selectedCategory === 'All') return all;
    return all.filter(p => p.category === this.selectedCategory);
  }

  getImageUrl(product: Product): string {
    return product.imageUrl || '';
  }

  selectCategory(cat: string) {
    this.selectedCategory = cat;
  }
}
