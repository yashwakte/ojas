import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, ActivatedRoute, convertToParamMap } from '@angular/router';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { Products } from './products';
import { ProductService } from '../../services/product.service';
import { CartService } from '../../services/cart.service';
import { CheckoutService } from '../../services/checkout.service';
import { AuthService } from '../../services/auth.service';
import { Product } from '../../models/interfaces';

describe('Products', () => {
  const flourProduct: Product = {
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
  const grainProduct: Product = { ...flourProduct, id: 'p2', category: 'Grains' };

  let productServiceSpy: any;
  let cartServiceSpy: jasmine.SpyObj<CartService>;
  let checkoutServiceSpy: jasmine.SpyObj<CheckoutService>;
  let authServiceSpy: any;
  let router: Router;

  function configure(queryParam: string | null) {
    productServiceSpy = { products: signal<Product[]>([flourProduct, grainProduct]) };
    cartServiceSpy = jasmine.createSpyObj('CartService', ['addToCart']);
    checkoutServiceSpy = jasmine.createSpyObj('CheckoutService', ['addItem']);
    authServiceSpy = jasmine.createSpyObj('AuthService', ['isLoggedIn']);
    authServiceSpy.isLoggedIn.and.returnValue(true);

    TestBed.configureTestingModule({
      imports: [Products],
      providers: [
        provideRouter([]),
        { provide: ProductService, useValue: productServiceSpy },
        { provide: CartService, useValue: cartServiceSpy },
        { provide: CheckoutService, useValue: checkoutServiceSpy },
        { provide: AuthService, useValue: authServiceSpy },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { queryParamMap: convertToParamMap(queryParam ? { category: queryParam } : {}) },
            // The component subscribes to the live stream (not the snapshot) so
            // that re-navigating to /products?category=… updates the list.
            queryParamMap: of(convertToParamMap(queryParam ? { category: queryParam } : {})),
          },
        },
      ],
    });
    router = TestBed.inject(Router);
  }

  function create() {
    const fixture = TestBed.createComponent(Products);
    fixture.detectChanges();
    return fixture;
  }

  it('should create with "All" selected by default', () => {
    configure(null);
    const fixture = create();
    expect(fixture.componentInstance.selectedCategory()).toBe('All');
    expect(fixture.componentInstance.filteredProducts().length).toBe(2);
  });

  it('pre-selects the category from the query param when valid', () => {
    configure('Flour');
    const fixture = create();
    expect(fixture.componentInstance.selectedCategory()).toBe('Flour');
    expect(fixture.componentInstance.filteredProducts()).toEqual([flourProduct]);
  });

  it('ignores an invalid category query param', () => {
    configure('NotACategory');
    const fixture = create();
    expect(fixture.componentInstance.selectedCategory()).toBe('All');
  });

  // selectCategory deliberately does not set the signal itself: it navigates, and
  // the query-param subscription is the single source of truth for the selection.
  it('selectCategory navigates with the category query param', () => {
    configure(null);
    spyOn(router, 'navigate');
    const fixture = create();

    fixture.componentInstance.selectCategory('Grains');

    expect(router.navigate).toHaveBeenCalledWith(
      [],
      jasmine.objectContaining({ queryParams: { category: 'Grains' } }),
    );
  });

  it('selectCategory clears the query param when selecting All', () => {
    configure('Grains');
    spyOn(router, 'navigate');
    const fixture = create();

    fixture.componentInstance.selectCategory('All');

    expect(router.navigate).toHaveBeenCalledWith(
      [],
      jasmine.objectContaining({ queryParams: { category: null } }),
    );
  });

  it('filters the list to the category carried by the query param', () => {
    configure('Grains');
    const fixture = create();
    expect(fixture.componentInstance.filteredProducts()).toEqual([grainProduct]);
  });

  it('addToCart works when logged out so guests can build a cart', () => {
    configure(null);
    authServiceSpy.isLoggedIn.and.returnValue(false);
    spyOn(router, 'navigate');
    const fixture = create();

    fixture.componentInstance.addToCart(flourProduct);

    expect(cartServiceSpy.addToCart).toHaveBeenCalledWith(flourProduct);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('addToCart adds the product and sets justAdded when logged in', () => {
    configure(null);
    const fixture = create();
    fixture.componentInstance.addToCart(flourProduct);
    expect(cartServiceSpy.addToCart).toHaveBeenCalledWith(flourProduct);
    expect(fixture.componentInstance.justAdded()).toBe(flourProduct.id);
  });

  it('buyNow sends a logged-out guest to checkout, where the auth guard takes over', () => {
    configure(null);
    authServiceSpy.isLoggedIn.and.returnValue(false);
    spyOn(router, 'navigate');
    const fixture = create();

    fixture.componentInstance.buyNow(flourProduct);

    expect(checkoutServiceSpy.addItem).toHaveBeenCalledWith(flourProduct);
    expect(router.navigate).toHaveBeenCalledWith(['/checkout']);
  });

  it('buyNow adds to checkout and navigates when logged in', () => {
    configure(null);
    spyOn(router, 'navigate');
    const fixture = create();

    fixture.componentInstance.buyNow(flourProduct);

    expect(checkoutServiceSpy.addItem).toHaveBeenCalledWith(flourProduct);
    expect(router.navigate).toHaveBeenCalledWith(['/checkout']);
  });

  it('onImgError swaps the broken image to the placeholder', () => {
    configure(null);
    const fixture = create();
    const img = document.createElement('img');
    fixture.componentInstance.onImgError({ target: img } as unknown as Event);
    expect(img.src).toContain('/images/placeholder.svg');
  });
});
