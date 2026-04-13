import { Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ProductService } from '../../services/product.service';
import { Product } from '../../models/interfaces';

@Component({
  selector: 'app-products',
  imports: [MatButtonModule, MatIconModule],
  templateUrl: './products.html',
  styleUrl: './products.scss',
})
export class Products {
  selectedCategory = 'All';
  categories = ['All', 'Flour', 'Grains', 'Health Mix'];

  constructor(private productService: ProductService) {}

  get filteredProducts(): Product[] {
    const all = this.productService.products();
    if (this.selectedCategory === 'All') return all;
    return all.filter((p) => p.category === this.selectedCategory);
  }

  onImgError(event: Event) {
    const img = event.target as HTMLImageElement;
    img.src = '/images/placeholder.svg';
  }

  selectCategory(cat: string) {
    this.selectedCategory = cat;
  }
}
