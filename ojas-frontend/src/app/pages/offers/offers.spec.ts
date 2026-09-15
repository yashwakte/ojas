import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Offers } from './offers';
import { CartService } from '../../services/cart.service';
import { Product } from '../../models/interfaces';

describe('Offers', () => {
  const product: Product = {
    id: 'p1',
    name: 'Jowar Flour',
    description: 'desc',
    price: 800,
    discount: 0,
    category: 'Everyday Flours',
    imageUrl: '',
    galleryImageUrls: [],
    weight: '1kg',
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

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [Offers],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
  });

  afterEach(() => localStorage.clear());

  function render(): string {
    const fixture = TestBed.createComponent(Offers);
    fixture.detectChanges();
    return ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ');
  }

  it('lists both coupons with their minimums, taken from the same constants checkout uses', () => {
    const text = render();

    expect(text).toContain('5% off orders of ₹1,000 or more');
    expect(text).toContain('10% off orders of ₹2,000 or more');
    expect(text).toContain('SAVE5');
    expect(text).toContain('SAVE10');
    expect(text).not.toContain('Exciting offers are on the way');
  });

  it('says what each coupon is worth on an order that only just qualifies', () => {
    const text = render();

    expect(text).toContain('Save ₹50 on a ₹1,000 order');
    expect(text).toContain('Save ₹200 on a ₹2,000 order');
  });

  it('mentions free delivery as automatic, not as a coupon', () => {
    expect(render()).toContain('Free delivery on orders of ₹500 or more');
  });

  it('tells a shopper with a cart how far they are from each offer', () => {
    TestBed.inject(CartService).addToCart(product); // ₹800

    const text = render();

    expect(text).toContain('Add ₹200 more to your cart to use this');
    expect(text).toContain('Add ₹1,200 more to your cart to use this');
    // ₹800 is already past the ₹500 free-delivery line.
    expect(text).toContain('Your cart qualifies');
  });

  it('says nothing about progress to a shopper with an empty cart', () => {
    const text = render();

    expect(text).not.toContain('more to your cart');
    expect(text).not.toContain('Your cart qualifies');
  });
});
