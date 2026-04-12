import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { Product } from '../models/interfaces';
import { tap } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ProductService {
  private readonly apiUrl = `${environment.apiUrl}/products`;
  private readonly _products = signal<Product[]>([]);
  private loaded = false;

  readonly products = this._products.asReadonly();

  constructor(private http: HttpClient) {}

  loadProducts() {
    if (this.loaded) return;
    this.http.get<Product[]>(this.apiUrl).pipe(
      tap(products => {
        this._products.set(products);
        this.loaded = true;
      })
    ).subscribe();
  }

  getProduct(id: string) {
    return this.http.get<Product>(`${this.apiUrl}/${id}`);
  }

  getByCategory(category: string) {
    return this.http.get<Product[]>(`${this.apiUrl}/category/${category}`);
  }
}
