import { Injectable, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map, Observable, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  Product,
  CreateProductRequest,
  UpdateProductRequest,
} from '../models/interfaces';

@Injectable({ providedIn: 'root' })
export class ProductService {
  private readonly apiUrl = `${environment.apiUrl}/products`;
  private readonly _products = signal<Product[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly products = this._products.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  constructor(private http: HttpClient) {
    this.loadProducts();
  }

  /**
   * Loads the catalogue into the shared signal.
   *
   * `bypassCache` is for the admin console. The catalogue is served with `public, max-age=60,
   * stale-while-revalidate=300` to anonymous visitors, and a shared cache that has stored one of
   * those copies will keep answering with it for minutes - including to an admin who has just
   * saved an edit, because their own `no-store` response header only governs responses the origin
   * actually gets asked for. A one-off query parameter is a different cache key, so the request
   * cannot be answered from any stored copy at any layer. It is deliberately NOT the default:
   * customers are the traffic this cache exists for.
   */
  loadProducts(options?: { bypassCache?: boolean }): void {
    this._loading.set(true);
    this._error.set(null);
    const params = options?.bypassCache ? { _: Date.now() } : undefined;
    this.http.get<Product[]>(this.apiUrl, { params }).subscribe({
      next: (products) => {
        this._products.set(products.map((product) => this.normalizeProduct(product)));
        this._loading.set(false);
      },
      error: () => {
        this._error.set('Failed to load products');
        this._loading.set(false);
      },
    });
  }

  getProduct(id: string): Product | undefined {
    return this._products().find((p) => p.id === id);
  }

  getByCategory(category: string): Product[] {
    return this._products().filter((p) => p.category === category);
  }

  getBestsellers(limit = 6): Observable<Product[]> {
    return this.http
      .get<Product[]>(`${this.apiUrl}/bestsellers`, { params: { limit } })
      .pipe(map((products) => products.map((product) => this.normalizeProduct(product))));
  }

  /** Admin-only: tracked products at or below their low-stock threshold. */
  getLowStock(): Observable<Product[]> {
    return this.http
      .get<Product[]>(`${this.apiUrl}/low-stock`)
      .pipe(map((products) => products.map((product) => this.normalizeProduct(product))));
  }

  createProduct(request: CreateProductRequest): Observable<Product> {
    return this.http.post<Product>(this.apiUrl, request).pipe(
      map((product) => this.normalizeProduct(product)),
      tap((product) => this._products.update((products) => [...products, product])),
    );
  }

  updateProduct(request: UpdateProductRequest): Observable<Product> {
    return this.http.patch<Product>(`${this.apiUrl}/${request.id}`, request).pipe(
      map((product) => this.normalizeProduct(product)),
      tap((product) =>
        this._products.update((products) =>
          products.map((current) => (current.id === product.id ? product : current)),
        ),
      ),
    );
  }

  deleteProduct(id: string): Observable<void> {
    return this.http
      .delete<void>(`${this.apiUrl}/${id}`)
      .pipe(tap(() => this._products.update((products) => products.filter((product) => product.id !== id))));
  }

  clearError(): void {
    this._error.set(null);
  }

  private normalizeProduct(product: Product): Product {
    return {
      ...product,
      discount: product.discount ?? 0,
      imageUrl: product.imageUrl ?? '',
      galleryImageUrls: product.galleryImageUrls ?? [],
      isAvailable: product.isAvailable ?? true,
      // undefined (field absent on older documents) must normalise to null —
      // "not tracked" — and never to 0, which would read as out of stock.
      stockQuantity: product.stockQuantity ?? null,
      lowStockThreshold: product.lowStockThreshold ?? 5,
      ingredients: product.ingredients || 'See the product description for ingredient details.',
      benefits: product.benefits || 'See the product description for nutritional and usage benefits.',
      storageInfo: product.storageInfo || 'Store in a cool, dry place in an airtight container.',
      updatedAt: product.updatedAt ?? product.createdAt,
    };
  }
}
