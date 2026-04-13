import { Injectable, signal } from '@angular/core';
import { Product } from '../models/interfaces';
import { PRODUCTS } from '../data/products';

@Injectable({ providedIn: 'root' })
export class ProductService {
  private readonly _products = signal<Product[]>(PRODUCTS);

  readonly products = this._products.asReadonly();

  getProduct(id: string): Product | undefined {
    return PRODUCTS.find((p) => p.id === id);
  }

  getByCategory(category: string): Product[] {
    return PRODUCTS.filter((p) => p.category === category);
  }
}
