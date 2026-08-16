import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { CheckoutService } from './checkout.service';
import { AuthService } from './auth.service';
import { Product } from '../models/interfaces';

describe('CheckoutService', () => {
  let service: CheckoutService;
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
    service = TestBed.inject(CheckoutService);
    auth = TestBed.inject(AuthService);
  });

  afterEach(() => localStorage.clear());

  function login(id = 'u1') {
    auth.saveAuth({ id, fullName: 'Jane', email: 'j@x.com', phone: '9999999999', role: 'customer' });
    TestBed.flushEffects();
  }

  it('starts empty when logged out', () => {
    expect(service.items()).toEqual([]);
    expect(service.count()).toBe(0);
  });

  it('reloads items from localStorage keyed by user id on login', () => {
    localStorage.setItem('ojas_checkout_u1', JSON.stringify([{ product, quantity: 2 }]));
    login('u1');
    expect(service.items()).toEqual([{ product, quantity: 2 }]);
  });

  it('resets on logout', () => {
    login('u1');
    service.addItem(product);
    auth.logout();
    TestBed.flushEffects();
    expect(service.items()).toEqual([]);
  });

  it('addItem adds a new item defaulting to quantity 1', () => {
    login();
    service.addItem(product);
    expect(service.items()).toEqual([{ product, quantity: 1 }]);
    expect(service.count()).toBe(1);
  });

  it('addItem with explicit quantity', () => {
    login();
    service.addItem(product, 3);
    expect(service.items()).toEqual([{ product, quantity: 3 }]);
  });

  it('addItem accumulates quantity for an existing product', () => {
    login();
    service.addItem(product, 2);
    service.addItem(product, 3);
    expect(service.items()).toEqual([{ product, quantity: 5 }]);
  });

  it('mergeItems overwrites quantity for existing items and appends new ones', () => {
    login();
    service.addItem(product, 1);
    service.mergeItems([
      { product, quantity: 9 },
      { product: product2, quantity: 2 },
    ]);
    expect(service.items()).toEqual([
      { product, quantity: 9 },
      { product: product2, quantity: 2 },
    ]);
  });

  it('updateQuantity sets a new quantity for a matching item', () => {
    login();
    service.addItem(product);
    service.updateQuantity('p1', 7);
    expect(service.items()).toEqual([{ product, quantity: 7 }]);
  });

  it('removeItem removes the matching item', () => {
    login();
    service.addItem(product);
    service.addItem(product2);
    service.removeItem('p1');
    expect(service.items()).toEqual([{ product: product2, quantity: 1 }]);
  });

  it('clear empties items and removes the localStorage key', () => {
    login('u9');
    service.addItem(product);
    service.clear();
    expect(service.items()).toEqual([]);
    expect(localStorage.getItem('ojas_checkout_u9')).toBeNull();
  });

  it('persists to a per-user localStorage key', () => {
    login('u55');
    service.addItem(product, 2);
    expect(JSON.parse(localStorage.getItem('ojas_checkout_u55')!)).toEqual([{ product, quantity: 2 }]);
  });

  it('load() returns [] on invalid JSON', () => {
    localStorage.setItem('ojas_checkout_ubad', 'not-json{');
    login('ubad');
    expect(service.items()).toEqual([]);
  });
});
