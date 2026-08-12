import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { CartService } from './cart.service';
import { AuthService } from './auth.service';
import { Product } from '../models/interfaces';

describe('CartService', () => {
  let service: CartService;
  let auth: AuthService;

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
  });

  afterEach(() => localStorage.clear());

  function login(id = 'u1') {
    auth.saveAuth({ id, fullName: 'Jane', email: 'j@x.com', phone: '9999999999', role: 'customer' });
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
});
