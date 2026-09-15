import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { CartService } from './cart.service';
import { AuthService } from './auth.service';
import { BASKET_SAVE_DEBOUNCE_MS } from './basket-sync.service';
import { CartItem, Product, UserRole } from '../models/interfaces';
import { environment } from '../../environments/environment';

describe('CartService', () => {
  let service: CartService;
  let auth: AuthService;
  let httpMock: HttpTestingController;

  const product: Product = {
    id: 'p1',
    name: 'Bajra Flour',
    description: 'desc',
    price: 100,
    discount: 0,
    category: 'Flour',
    imageUrl: '',
    galleryImageUrls: [],
    weight: '500g',
    isAvailable: true,
    isListed: true,
    stockQuantity: null,
    lowStockThreshold: 5,
    ingredients: '',
    benefits: '',
    storageInfo: '',
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
  };

  const product2: Product = { ...product, id: 'p2', name: 'Ragi Flour', price: 150 };

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(CartService);
    auth = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => localStorage.clear());

  function login(id = 'u1', role: UserRole = 'customer') {
    auth.saveAuth({ id, fullName: 'Jane', email: 'j@x.com', phone: '9999999999', role });
    TestBed.flushEffects();
  }

  it('starts empty when logged out', () => {
    expect(service.items()).toEqual([]);
    expect(service.totalCount()).toBe(0);
    expect(service.totalAmount()).toBe(0);
  });

  it('reloads items from localStorage keyed by user id when the auth user changes', () => {
    localStorage.setItem('ojas_cart_u1', JSON.stringify([{ product, quantity: 2 }]));
    login('u1');
    expect(service.items()).toEqual([{ product, quantity: 2 }]);
  });

  it('resets to empty when the user logs out', () => {
    login('u1');
    service.addToCart(product);
    expect(service.items().length).toBe(1);

    auth.logout();
    // Logout completes only once the server has answered - see AuthService.logout.
    httpMock.expectOne((r) => r.url.endsWith('/auth/logout')).flush('');
    TestBed.flushEffects();
    expect(service.items()).toEqual([]);
  });

  it('addToCart adds a new item with quantity 1', () => {
    login();
    service.addToCart(product);
    expect(service.items()).toEqual([{ product, quantity: 1 }]);
  });

  it('addToCart increments quantity for an existing item', () => {
    login();
    service.addToCart(product);
    service.addToCart(product);
    expect(service.items()).toEqual([{ product, quantity: 2 }]);
  });

  it('addToCart persists to the per-user localStorage key', () => {
    login('u42');
    service.addToCart(product);
    const raw = localStorage.getItem('ojas_cart_u42');
    expect(JSON.parse(raw!)).toEqual([{ product, quantity: 1 }]);
  });

  it('removeFromCart removes the matching item and persists', () => {
    login('u1');
    service.addToCart(product);
    service.addToCart(product2);
    service.removeFromCart('p1');
    expect(service.items()).toEqual([{ product: product2, quantity: 1 }]);
    expect(JSON.parse(localStorage.getItem('ojas_cart_u1')!)).toEqual([{ product: product2, quantity: 1 }]);
  });

  it('updateQuantity sets a new quantity', () => {
    login();
    service.addToCart(product);
    service.updateQuantity('p1', 5);
    expect(service.items()).toEqual([{ product, quantity: 5 }]);
  });

  it('updateQuantity below 1 removes the item', () => {
    login();
    service.addToCart(product);
    service.updateQuantity('p1', 0);
    expect(service.items()).toEqual([]);
  });

  it('clearCart empties items and removes the localStorage key', () => {
    login('u7');
    service.addToCart(product);
    service.clearCart();
    expect(service.items()).toEqual([]);
    expect(localStorage.getItem('ojas_cart_u7')).toBeNull();
  });

  it('totalCount sums quantities and totalAmount sums price*quantity', () => {
    login();
    service.addToCart(product); // qty 1, price 100
    service.addToCart(product2); // qty 1, price 150
    service.updateQuantity('p1', 3); // 3 * 100 = 300
    expect(service.totalCount()).toBe(4);
    expect(service.totalAmount()).toBe(450);
  });

  it('load() returns [] when localStorage contains invalid JSON', () => {
    localStorage.setItem('ojas_cart_ubad', '{not json');
    login('ubad');
    expect(service.items()).toEqual([]);
  });

  // ---------- the server copy ----------

  describe('with the server copy, for a signed-in customer', () => {
    const cartUrl = `${environment.apiUrl}/cart`;

    const basket = (items: CartItem[], updatedAt: string | null = '2026-09-15T00:00:00Z') => ({
      items,
      checkoutItems: [],
      updatedAt,
    });

    /** Compared by id and quantity: products from the server pass through normalizeProduct,
     * which fills in defaults, so whole-object equality would be testing that instead. */
    const lines = () => service.items().map((i) => [i.product.id, i.quantity]);

    beforeEach(() => jasmine.clock().install());
    afterEach(() => jasmine.clock().uninstall());

    it("replaces this browser's cached cart with the account's, so another device's changes show", () => {
      localStorage.setItem('ojas_cart_u1', JSON.stringify([{ product, quantity: 2 }]));
      login('u1');

      // Drawn from the cache at once, while the real one is fetched.
      expect(lines()).toEqual([['p1', 2]]);
      expect(service.ready()).toBeFalse();

      httpMock.expectOne(cartUrl).flush(basket([{ product: product2, quantity: 1 }]));

      expect(service.ready()).toBeTrue();
      expect(lines()).toEqual([['p2', 1]]);
    });

    it("adopts this browser's cart the first time an account is synced, instead of emptying it", () => {
      // Every customer's cart lived only in their browser before this. The first sign-in after it
      // shipped must carry that cart over, not replace it with the server's empty one.
      localStorage.setItem('ojas_cart_u1', JSON.stringify([{ product, quantity: 2 }]));
      login('u1');

      httpMock.expectOne(cartUrl).flush(basket([], null));
      expect(lines()).toEqual([['p1', 2]]);

      jasmine.clock().tick(BASKET_SAVE_DEBOUNCE_MS);
      const save = httpMock.expectOne(`${cartUrl}/items`);
      expect(save.request.method).toBe('PUT');
      expect(save.request.body).toEqual({ items: [{ productId: 'p1', quantity: 2 }] });
      save.flush(null);
    });

    it('replays a change made before the server copy arrived onto it, rather than overwriting it', () => {
      login('u1');
      service.addToCart(product);

      httpMock.expectOne(cartUrl).flush(basket([{ product: product2, quantity: 3 }]));

      expect(lines()).toEqual([
        ['p2', 3],
        ['p1', 1],
      ]);
      jasmine.clock().tick(BASKET_SAVE_DEBOUNCE_MS);
      expect(httpMock.expectOne(`${cartUrl}/items`).request.body).toEqual({
        items: [
          { productId: 'p2', quantity: 3 },
          { productId: 'p1', quantity: 1 },
        ],
      });
    });

    it("brings a signed-out visitor's cart into the account when they sign in", () => {
      service.addToCart(product);
      login('u1');

      httpMock.expectOne(cartUrl).flush(basket([
        { product, quantity: 1 },
        { product: product2, quantity: 1 },
      ]));

      expect(lines()).toEqual([
        ['p1', 2],
        ['p2', 1],
      ]);
      expect(localStorage.getItem('ojas_cart_guest')).toBeNull();
    });

    it('keeps what it shows, and saves nothing, when the server cannot be reached', () => {
      localStorage.setItem('ojas_cart_u1', JSON.stringify([{ product, quantity: 2 }]));
      login('u1');

      httpMock.expectOne(cartUrl).flush('down', { status: 503, statusText: 'Down' });

      expect(service.ready()).toBeTrue();
      expect(lines()).toEqual([['p1', 2]]);

      service.addToCart(product2);
      jasmine.clock().tick(BASKET_SAVE_DEBOUNCE_MS);
      // Overwriting the account's cart with this device's view of it could throw away whatever
      // was added on another device. It waits for a successful fetch instead.
      httpMock.expectNone(`${cartUrl}/items`);
      expect(lines()).toEqual([
        ['p1', 2],
        ['p2', 1],
      ]);
    });

    it('saves a burst of taps as one request, once the burst is over', () => {
      login('u1');
      httpMock.expectOne(cartUrl).flush(basket([]));

      service.addToCart(product);
      service.addToCart(product);
      service.addToCart(product);
      httpMock.expectNone(`${cartUrl}/items`);

      jasmine.clock().tick(BASKET_SAVE_DEBOUNCE_MS);
      expect(httpMock.expectOne(`${cartUrl}/items`).request.body).toEqual({
        items: [{ productId: 'p1', quantity: 3 }],
      });
    });

    it('does not refetch the cart when the session token is merely refreshed', () => {
      login('u1');
      httpMock.expectOne(cartUrl).flush(basket([]));

      auth.saveAuth({ id: 'u1', fullName: 'Jane', email: 'j@x.com', phone: '9999999999', role: 'customer', csrfToken: 'rotated' });
      TestBed.flushEffects();

      httpMock.expectNone(cartUrl);
    });

    it("never saves one account's cart into another's", () => {
      login('u1');
      httpMock.expectOne(cartUrl).flush(basket([]));
      service.addToCart(product);

      // Someone else signs in before the save has gone out.
      login('u2');
      httpMock.expectOne(cartUrl).flush(basket([]));
      jasmine.clock().tick(BASKET_SAVE_DEBOUNCE_MS);

      httpMock.expectNone(`${cartUrl}/items`);
    });

    it('keeps a staff account\'s cart in this browser only', () => {
      login('staff1', 'admin');

      httpMock.expectNone(cartUrl);
      expect(service.ready()).toBeTrue();
    });
  });
});
