import { Injectable, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map, Observable, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  Product,
  CreateProductRequest,
  UpdateProductRequest,
} from '../models/interfaces';
import { packShotSrc } from '../constants/pack-shots';

@Injectable({ providedIn: 'root' })
export class ProductService {
  private readonly apiUrl = `${environment.apiUrl}/products`;
  private readonly _products = signal<Product[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  /** Ids the API has told us do not exist, so a product page can say so instead of waiting. */
  private readonly _unknown = signal<ReadonlySet<string>>(new Set());
  /** Ids already fetched individually, so a page that re-renders does not re-request them. */
  private readonly _requested = new Set<string>();

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

  /**
   * Makes sure one product is in hand, fetching just that one if the catalogue has not arrived.
   *
   * A product page opened directly — a shared link, a bookmark, a search result — used to render
   * "Product Not Found" while the catalogue request was still in flight, and only then flip to the
   * real page. The product was never missing; the page simply could not tell "we have not looked
   * yet" apart from "we looked and there is nothing", because both are an absence from a list.
   *
   * So there are three states now, not two, and this drives them. Asking for one product by id is
   * also markedly less to wait for than the whole catalogue on a phone: the page can be drawn from
   * a single small response while the full list arrives behind it for the rail at the bottom.
   */
  ensureProduct(id: string): void {
    if (!id || this.getProduct(id) || this._requested.has(id)) return;
    this._requested.add(id);

    this.http.get<Product>(`${this.apiUrl}/${id}`).subscribe({
      next: (product) => {
        const normalized = this.normalizeProduct(product);
        this._products.update((products) =>
          products.some((p) => p.id === normalized.id)
            ? products.map((p) => (p.id === normalized.id ? normalized : p))
            : [...products, normalized],
        );
      },
      // A 404 is an answer: this id is not a product, and the page should say so rather than
      // spinning forever. Anything else is treated the same way — after a failed direct fetch
      // there is nothing further this page can do but tell the truth.
      error: () => this._unknown.update((ids) => new Set(ids).add(id)),
    });
  }

  /** True once we have asked the API about this id and been told there is no such product. */
  isUnknown(id: string): boolean {
    return this._unknown().has(id);
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
      // Stamped with the pack-shot revision here, at the single point every product enters the
      // app, so a re-shoot reaches customers who already have the old file cached. Every screen
      // that shows a product — card, detail page, lightbox, cart, checkout, orders, admin — reads
      // its image from this list, so doing it once here is doing it everywhere. See packShotSrc.
      imageUrl: packShotSrc(product.imageUrl ?? ''),
      galleryImageUrls: (product.galleryImageUrls ?? []).map(packShotSrc),
      isAvailable: product.isAvailable ?? true,
      // Absent on every document written before listing existed, and those are all real products
      // the shop has been selling — so the default has to be "listed", never the other way round.
      isListed: product.isListed ?? true,
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
