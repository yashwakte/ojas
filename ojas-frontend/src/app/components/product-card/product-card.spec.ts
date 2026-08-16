import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ProductCard } from './product-card';
import { Product } from '../../models/interfaces';

describe('ProductCard', () => {
  const product: Product = {
    id: 'p1',
    name: 'Bajra Flour',
    description: 'desc',
    price: 100,
    discount: 10,
    category: 'Flour',
    imageUrl: '/images/p1.jpg',
    galleryImageUrls: [],
    weight: '500g',
    isAvailable: true,
    stockQuantity: null,
    lowStockThreshold: 5,
    ingredients: '',
    benefits: '',
    storageInfo: '',
    createdAt: '',
    updatedAt: '',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ProductCard],
      providers: [provideRouter([])],
    });
  });

  function create() {
    const fixture = TestBed.createComponent(ProductCard);
    fixture.componentRef.setInput('product', product);
    fixture.detectChanges();
    return fixture;
  }

  it('should create', () => {
    const fixture = create();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('onImgError swaps the image src to the placeholder', () => {
    const fixture = create();
    const img = document.createElement('img');
    img.src = 'http://localhost/broken.jpg';
    fixture.componentInstance.onImgError({ target: img } as unknown as Event);
    expect(img.src).toContain('/images/placeholder.svg');
  });

  it('emits addToCart with the product when the add button is clicked', () => {
    const fixture = create();
    let emitted: Product | undefined;
    fixture.componentInstance.addToCart.subscribe((p) => (emitted = p));

    const btn: HTMLButtonElement = fixture.nativeElement.querySelector('.home-add-cart-btn');
    btn.click();

    expect(emitted).toEqual(product);
  });

  it('emits buyNow with the product when the buy button is clicked', () => {
    const fixture = create();
    let emitted: Product | undefined;
    fixture.componentInstance.buyNow.subscribe((p) => (emitted = p));

    const btn: HTMLButtonElement = fixture.nativeElement.querySelector('.home-buy-now-btn');
    btn.click();

    expect(emitted).toEqual(product);
  });

  it('shows the badge text when provided', () => {
    const fixture = create();
    fixture.componentRef.setInput('badge', 'Bestseller');
    fixture.detectChanges();

    const badge: HTMLElement = fixture.nativeElement.querySelector('.pbadge');
    expect(badge.textContent).toContain('Bestseller');
  });

  it('does not render a badge element when badge is not provided', () => {
    const fixture = create();
    const badge = fixture.nativeElement.querySelector('.pbadge');
    expect(badge).toBeNull();
  });

  // ===== Stock =====

  it('stays purchasable when stock is not tracked (stockQuantity null)', () => {
    const fixture = create();
    fixture.componentRef.setInput('product', { ...product, stockQuantity: null });
    fixture.detectChanges();

    const addBtn: HTMLButtonElement = fixture.nativeElement.querySelector('.home-add-cart-btn');
    expect(addBtn.disabled).toBeFalse();
    expect(fixture.nativeElement.querySelector('.pstock-veil')).toBeNull();
  });

  it('disables both actions and veils the image when out of stock', () => {
    const fixture = create();
    fixture.componentRef.setInput('product', { ...product, stockQuantity: 0 });
    fixture.detectChanges();

    const addBtn: HTMLButtonElement = fixture.nativeElement.querySelector('.home-add-cart-btn');
    const buyBtn: HTMLButtonElement = fixture.nativeElement.querySelector('.home-buy-now-btn');
    expect(addBtn.disabled).toBeTrue();
    expect(buyBtn.disabled).toBeTrue();
    expect(fixture.nativeElement.querySelector('.pstock-veil').textContent).toContain('Out of stock');
  });

  it('warns how many are left when stock is low but not gone', () => {
    const fixture = create();
    fixture.componentRef.setInput('product', { ...product, stockQuantity: 2, lowStockThreshold: 5 });
    fixture.detectChanges();

    const addBtn: HTMLButtonElement = fixture.nativeElement.querySelector('.home-add-cart-btn');
    expect(addBtn.disabled).toBeFalse();
    expect(fixture.nativeElement.querySelector('.plow-stock').textContent).toContain('Only 2 left');
  });

  it('is not purchasable when the admin has disabled it, whatever the stock', () => {
    const fixture = create();
    fixture.componentRef.setInput('product', { ...product, isAvailable: false, stockQuantity: 99 });
    fixture.detectChanges();

    const addBtn: HTMLButtonElement = fixture.nativeElement.querySelector('.home-add-cart-btn');
    expect(addBtn.disabled).toBeTrue();
  });
});
