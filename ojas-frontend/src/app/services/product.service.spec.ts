import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ProductService } from './product.service';
import { environment } from '../../environments/environment';
import { Product } from '../models/interfaces';

describe('ProductService', () => {
  let service: ProductService;
  let httpMock: HttpTestingController;

  const rawProduct: any = {
    id: 'p1',
    name: 'Bajra Flour',
    description: 'desc',
    price: 100,
    category: 'Flour',
    weight: '500g',
    createdAt: '2024-01-01',
    // discount, imageUrl, galleryImageUrls, isAvailable, ingredients, benefits, storageInfo, updatedAt omitted
  };

  const fullProduct: Product = {
    id: 'p2',
    name: 'Ragi Flour',
    description: 'desc2',
    price: 200,
    discount: 10,
    category: 'Grains',
    imageUrl: '/images/ragi.jpg',
    galleryImageUrls: ['/images/g1.jpg'],
    weight: '1kg',
    isAvailable: false,
    stockQuantity: null,
    lowStockThreshold: 5,
    ingredients: 'Ragi',
    benefits: 'Iron rich',
    storageInfo: 'Cool place',
    createdAt: '2024-02-01',
    updatedAt: '2024-03-01',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ProductService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  function flushInitialLoad(products: any[] = []) {
    const req = httpMock.expectOne(environment.apiUrl + '/products');
    expect(req.request.method).toBe('GET');
    req.flush(products);
  }

  it('calls loadProducts on construction and normalizes missing optional fields', () => {
    flushInitialLoad([rawProduct]);
    const products = service.products();
    expect(products.length).toBe(1);
    expect(products[0].discount).toBe(0);
    expect(products[0].imageUrl).toBe('');
    expect(products[0].galleryImageUrls).toEqual([]);
    expect(products[0].isAvailable).toBeTrue();
    expect(products[0].ingredients).toBe('See the product description for ingredient details.');
    expect(products[0].benefits).toBe('See the product description for nutritional and usage benefits.');
    expect(products[0].storageInfo).toBe('Store in a cool, dry place in an airtight container.');
    expect(products[0].updatedAt).toBe(rawProduct.createdAt);
    expect(service.loading()).toBeFalse();
    expect(service.error()).toBeNull();
  });

  it('preserves fields that are already provided (no defaulting)', () => {
    flushInitialLoad([fullProduct]);
    expect(service.products()[0]).toEqual(fullProduct);
  });

  it('sets error and stops loading when loadProducts fails', () => {
    flushInitialLoad();
    service.loadProducts();
    const req = httpMock.expectOne(environment.apiUrl + '/products');
    req.flush('fail', { status: 500, statusText: 'Server Error' });
    expect(service.error()).toBe('Failed to load products');
    expect(service.loading()).toBeFalse();
  });

  // Anonymous catalogue reads are cached publicly for minutes. An admin who has just saved must
  // not be answered from one of those stored copies, so their read carries a one-off query
  // parameter - a different cache key, which no layer can satisfy from what it already holds.
  it('bypassCache sends a one-off parameter so no stored copy can answer the read', () => {
    flushInitialLoad();

    service.loadProducts({ bypassCache: true });
    const busted = httpMock.expectOne((r) => r.url === environment.apiUrl + '/products');
    expect(busted.request.params.has('_')).toBeTrue();
    busted.flush([]);

    // The default stays cacheable: customers are the traffic that cache exists for.
    service.loadProducts();
    const plain = httpMock.expectOne(environment.apiUrl + '/products');
    expect(plain.request.params.keys().length).toBe(0);
    plain.flush([]);
  });

  it('clearError resets error to null', () => {
    flushInitialLoad();
    service.loadProducts();
    httpMock.expectOne(environment.apiUrl + '/products').flush('x', { status: 500, statusText: 'err' });
    expect(service.error()).not.toBeNull();
    service.clearError();
    expect(service.error()).toBeNull();
  });

  it('getProduct returns the product with the matching id from the signal', () => {
    flushInitialLoad([rawProduct, fullProduct]);
    expect(service.getProduct('p2')).toEqual(fullProduct);
    expect(service.getProduct('missing')).toBeUndefined();
  });

  it('getByCategory filters by category from the signal', () => {
    flushInitialLoad([rawProduct, fullProduct]);
    expect(service.getByCategory('Grains')).toEqual([fullProduct]);
    expect(service.getByCategory('Nope')).toEqual([]);
  });

  it('getBestsellers issues a GET with a limit param and normalizes the response', () => {
    flushInitialLoad();
    let result: Product[] | undefined;
    service.getBestsellers(3).subscribe((r) => (result = r));
    const req = httpMock.expectOne(
      (r) => r.url === environment.apiUrl + '/products/bestsellers' && r.params.get('limit') === '3',
    );
    req.flush([rawProduct]);
    expect(result?.[0].discount).toBe(0);
  });

  it('getBestsellers defaults limit to 6', () => {
    flushInitialLoad();
    service.getBestsellers().subscribe();
    const req = httpMock.expectOne(
      (r) => r.url === environment.apiUrl + '/products/bestsellers' && r.params.get('limit') === '6',
    );
    req.flush([]);
  });

  it('createProduct posts, normalizes the response, and appends to the products signal', () => {
    flushInitialLoad([fullProduct]);
    let created: Product | undefined;
    const createReq = { ...rawProduct } as any;
    delete createReq.id;
    delete createReq.createdAt;
    service.createProduct(createReq).subscribe((p) => (created = p));
    const req = httpMock.expectOne(environment.apiUrl + '/products');
    expect(req.request.method).toBe('POST');
    req.flush(rawProduct);
    expect(created?.discount).toBe(0);
    expect(service.products()).toEqual([fullProduct, jasmine.objectContaining({ id: 'p1' })]);
  });

  it('updateProduct patches, normalizes, and replaces the matching product in the signal', () => {
    flushInitialLoad([fullProduct]);
    const updatedRaw = { ...fullProduct, name: 'Ragi Flour Updated' };
    service.updateProduct({ id: 'p2', name: 'Ragi Flour Updated' }).subscribe();
    const req = httpMock.expectOne(environment.apiUrl + '/products/p2');
    expect(req.request.method).toBe('PATCH');
    req.flush(updatedRaw);
    expect(service.products()[0].name).toBe('Ragi Flour Updated');
  });

  it('deleteProduct deletes and removes the product from the signal', () => {
    flushInitialLoad([fullProduct]);
    service.deleteProduct('p2').subscribe();
    const req = httpMock.expectOne(environment.apiUrl + '/products/p2');
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
    expect(service.products()).toEqual([]);
  });
});
