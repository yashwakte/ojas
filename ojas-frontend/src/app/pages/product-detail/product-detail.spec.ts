import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { signal } from '@angular/core';
import { ProductDetail } from './product-detail';
import { ProductService } from '../../services/product.service';
import { CartService } from '../../services/cart.service';
import { CheckoutService } from '../../services/checkout.service';
import { AuthService } from '../../services/auth.service';
import { DeliveryChargesService } from '../../services/delivery-charges.service';
import { Product, DeliveryChargesConfig } from '../../models/interfaces';

describe('ProductDetail', () => {
  const product: Product = {
    id: 'p1',
    name: 'Bajra Flour',
    description: 'desc',
    price: 100,
    discount: 10,
    category: 'Flour',
    imageUrl: '/images/p1.jpg',
    galleryImageUrls: ['/images/p1b.jpg'],
    weight: '500g',
    isAvailable: true,
    ingredients: 'Bajra',
    benefits: 'Fiber',
    storageInfo: 'Cool place',
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
  };
  const similarProduct: Product = { ...product, id: 'p2', name: 'Jowar Flour' };

  let productServiceSpy: jasmine.SpyObj<ProductService>;
  let cartServiceSpy: jasmine.SpyObj<CartService>;
  let checkoutServiceSpy: jasmine.SpyObj<CheckoutService>;
  let authServiceSpy: any;
  let deliveryChargesServiceSpy: any;
  let router: Router;

  beforeEach(() => {
    productServiceSpy = jasmine.createSpyObj('ProductService', ['getProduct', 'getByCategory']);
    productServiceSpy.getProduct.and.returnValue(product);
    productServiceSpy.getByCategory.and.returnValue([product, similarProduct]);

    cartServiceSpy = jasmine.createSpyObj('CartService', ['addToCart']);
    checkoutServiceSpy = jasmine.createSpyObj('CheckoutService', ['addItem']);
    authServiceSpy = jasmine.createSpyObj('AuthService', ['isLoggedIn']);
    authServiceSpy.isLoggedIn.and.returnValue(true);
    deliveryChargesServiceSpy = { config: signal<DeliveryChargesConfig | null>(null) };

    TestBed.configureTestingModule({
      imports: [ProductDetail],
      providers: [
        provideRouter([]),
        { provide: ProductService, useValue: productServiceSpy },
        { provide: CartService, useValue: cartServiceSpy },
        { provide: CheckoutService, useValue: checkoutServiceSpy },
        { provide: AuthService, useValue: authServiceSpy },
        { provide: DeliveryChargesService, useValue: deliveryChargesServiceSpy },
      ],
    });
    router = TestBed.inject(Router);
  });

  function create(id = 'p1') {
    const fixture = TestBed.createComponent(ProductDetail);
    fixture.componentRef.setInput('id', id);
    fixture.detectChanges();
    return fixture;
  }

  it('should create and resolve the product from the id input', () => {
    const fixture = create();
    expect(fixture.componentInstance.product()).toEqual(product);
  });

  it('discountedPrice applies the discount percentage', () => {
    const fixture = create();
    expect(fixture.componentInstance.discountedPrice()).toBe(90);
  });

  it('discountedPrice equals price when there is no discount', () => {
    productServiceSpy.getProduct.and.returnValue({ ...product, discount: 0 });
    const fixture = create();
    expect(fixture.componentInstance.discountedPrice()).toBe(100);
  });

  it('discountedPrice is 0 when the product is not found', () => {
    productServiceSpy.getProduct.and.returnValue(undefined);
    const fixture = create('missing');
    expect(fixture.componentInstance.discountedPrice()).toBe(0);
  });

  it('galleryImages combines the main image with gallery images', () => {
    const fixture = create();
    expect(fixture.componentInstance.galleryImages()).toEqual(['/images/p1.jpg', '/images/p1b.jpg']);
  });

  it('similarProducts excludes the current product and reads from getByCategory', () => {
    const fixture = create();
    expect(fixture.componentInstance.similarProducts()).toEqual([similarProduct]);
    expect(productServiceSpy.getByCategory).toHaveBeenCalledWith('Flour');
  });

  it('selectImage sets the active image index', () => {
    const fixture = create();
    fixture.componentInstance.selectImage(1);
    expect(fixture.componentInstance.activeImageIndex()).toBe(1);
  });

  it('toggleSection expands and collapses a section', () => {
    const fixture = create();
    expect(fixture.componentInstance.isSectionExpanded('ingredients')).toBeFalse();
    fixture.componentInstance.toggleSection('ingredients');
    expect(fixture.componentInstance.isSectionExpanded('ingredients')).toBeTrue();
    fixture.componentInstance.toggleSection('ingredients');
    expect(fixture.componentInstance.isSectionExpanded('ingredients')).toBeFalse();
  });

  it('increaseQty / decreaseQty adjust quantity, never going below 1', () => {
    const fixture = create();
    fixture.componentInstance.increaseQty();
    expect(fixture.componentInstance.quantity()).toBe(2);
    fixture.componentInstance.decreaseQty();
    fixture.componentInstance.decreaseQty();
    expect(fixture.componentInstance.quantity()).toBe(1);
  });

  it('toggleDescription flips descExpanded', () => {
    const fixture = create();
    expect(fixture.componentInstance.descExpanded()).toBeFalse();
    fixture.componentInstance.toggleDescription();
    expect(fixture.componentInstance.descExpanded()).toBeTrue();
  });

  it('addToCart redirects to login when logged out', () => {
    authServiceSpy.isLoggedIn.and.returnValue(false);
    spyOn(router, 'navigate');
    const fixture = create();

    fixture.componentInstance.addToCart();

    expect(router.navigate).toHaveBeenCalledWith(['/login']);
    expect(cartServiceSpy.addToCart).not.toHaveBeenCalled();
  });

  it('addToCart adds the product to the cart quantity() times', () => {
    const fixture = create();
    fixture.componentInstance.increaseQty(); // quantity = 2

    fixture.componentInstance.addToCart();

    expect(cartServiceSpy.addToCart).toHaveBeenCalledTimes(2);
    expect(fixture.componentInstance.justAdded()).toBe('p1');
  });

  it('addToCart is a no-op when there is no product', () => {
    productServiceSpy.getProduct.and.returnValue(undefined);
    const fixture = create('missing');

    fixture.componentInstance.addToCart();

    expect(cartServiceSpy.addToCart).not.toHaveBeenCalled();
  });

  it('buyNow redirects to login when logged out', () => {
    authServiceSpy.isLoggedIn.and.returnValue(false);
    spyOn(router, 'navigate');
    const fixture = create();

    fixture.componentInstance.buyNow();

    expect(router.navigate).toHaveBeenCalledWith(['/login']);
    expect(checkoutServiceSpy.addItem).not.toHaveBeenCalled();
  });

  it('buyNow adds to checkout with the selected quantity and navigates', () => {
    spyOn(router, 'navigate');
    const fixture = create();
    fixture.componentInstance.increaseQty(); // quantity = 2

    fixture.componentInstance.buyNow();

    expect(checkoutServiceSpy.addItem).toHaveBeenCalledWith(product, 2);
    expect(router.navigate).toHaveBeenCalledWith(['/checkout']);
  });

  it('freeDeliveryUpToKm reads from delivery charges config', () => {
    deliveryChargesServiceSpy.config.set({
      id: 'c1',
      warehouseAddress: 'x',
      warehouseLatitude: 1,
      warehouseLongitude: 1,
      freeDeliveryUpToKm: 7,
      perKmChargeAfterFree: 10,
      isActive: true,
      createdAt: '',
      updatedAt: '',
    });
    const fixture = create();
    expect(fixture.componentInstance.freeDeliveryUpToKm()).toBe(7);
  });

  it('highlights include category-specific entries for Flour', () => {
    const fixture = create();
    const texts = fixture.componentInstance.highlights().map((h) => h.text);
    expect(texts).toContain('Traditional Stone-Ground');
  });

  it('onImgError swaps the broken image to the placeholder', () => {
    const fixture = create();
    const img = document.createElement('img');
    fixture.componentInstance.onImgError({ target: img } as unknown as Event);
    expect(img.src).toContain('/images/placeholder.svg');
  });
});
