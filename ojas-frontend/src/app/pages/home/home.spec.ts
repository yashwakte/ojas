import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { Home } from './home';
import { ProductService } from '../../services/product.service';
import { CartService } from '../../services/cart.service';
import { CheckoutService } from '../../services/checkout.service';
import { AuthService } from '../../services/auth.service';
import { CampaignBannerService } from '../../services/campaign-banner.service';
import { Product, CampaignBannerConfig } from '../../models/interfaces';

describe('Home', () => {
  const product: Product = {
    id: 'p1',
    name: 'Bajra Flour',
    description: 'desc',
    price: 100,
    discount: 20,
    category: 'Flour',
    imageUrl: '/images/p1.jpg',
    galleryImageUrls: [],
    weight: '500g',
    isAvailable: true,
    ingredients: '',
    benefits: '',
    storageInfo: '',
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
  };
  const upwasProduct: Product = { ...product, id: 'p2', category: 'Upwas', discount: 0 };

  let productsSignal: ReturnType<typeof signal<Product[]>>;
  let campaignsSignal: ReturnType<typeof signal<CampaignBannerConfig[]>>;
  let productServiceSpy: jasmine.SpyObj<ProductService>;
  let cartServiceSpy: jasmine.SpyObj<CartService>;
  let checkoutServiceSpy: jasmine.SpyObj<CheckoutService>;
  let authServiceSpy: any;
  let campaignBannerServiceSpy: any;
  let router: Router;

  beforeEach(() => {
    productsSignal = signal<Product[]>([product, upwasProduct]);
    campaignsSignal = signal<CampaignBannerConfig[]>([]);

    productServiceSpy = jasmine.createSpyObj('ProductService', ['getBestsellers'], {
      products: productsSignal,
    });
    productServiceSpy.getBestsellers.and.returnValue(of([product]));

    cartServiceSpy = jasmine.createSpyObj('CartService', ['addToCart']);
    checkoutServiceSpy = jasmine.createSpyObj('CheckoutService', ['addItem']);
    authServiceSpy = jasmine.createSpyObj('AuthService', ['isLoggedIn']);
    authServiceSpy.isLoggedIn.and.returnValue(true);
    campaignBannerServiceSpy = { campaigns: campaignsSignal };

    TestBed.configureTestingModule({
      imports: [Home],
      providers: [
        provideRouter([]),
        { provide: ProductService, useValue: productServiceSpy },
        { provide: CartService, useValue: cartServiceSpy },
        { provide: CheckoutService, useValue: checkoutServiceSpy },
        { provide: AuthService, useValue: authServiceSpy },
        { provide: CampaignBannerService, useValue: campaignBannerServiceSpy },
      ],
    });
    router = TestBed.inject(Router);
  });

  function create() {
    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();
    return fixture;
  }

  it('should create and load bestsellers on init', () => {
    const fixture = create();
    expect(fixture.componentInstance).toBeTruthy();
    expect(fixture.componentInstance.bestsellers()).toEqual([product]);
    expect(fixture.componentInstance.bestsellersLoading()).toBeFalse();
  });

  it('stops the bestsellers loading flag on error', () => {
    productServiceSpy.getBestsellers.and.returnValue(throwError(() => new Error('fail')));
    const fixture = create();
    expect(fixture.componentInstance.bestsellersLoading()).toBeFalse();
    expect(fixture.componentInstance.bestsellers()).toEqual([]);
  });

  it('festiveSavings filters discounted, available products', () => {
    const fixture = create();
    expect(fixture.componentInstance.festiveSavings()).toEqual([product]);
  });

  it('upwasSpecials filters by Upwas category', () => {
    const fixture = create();
    expect(fixture.componentInstance.upwasSpecials()).toEqual([upwasProduct]);
  });

  const makeCampaign = (overrides: Partial<CampaignBannerConfig> = {}): CampaignBannerConfig => ({
    id: 'b1',
    title: 'Sale',
    subtitle: '',
    ctaText: 'Shop',
    ctaLink: '/products',
    backgroundImageUrl: '',
    isActive: true,
    featuredSectionTitle: 'This Campaign',
    featuredProductIds: [],
    fallbackBestsellerProductIds: [],
    createdAt: '',
    updatedAt: '',
    ...overrides,
  });

  it('activeCampaigns only includes campaigns with isActive true', () => {
    campaignsSignal.set([makeCampaign({ id: 'b1', isActive: true }), makeCampaign({ id: 'b2', isActive: false })]);
    const fixture = create();
    expect(fixture.componentInstance.activeCampaigns().map((c) => c.id)).toEqual(['b1']);
  });

  it('featuredProductsFor resolves a campaign\'s ids against available products', () => {
    const campaign = makeCampaign({ featuredProductIds: ['p1', 'missing'] });
    const fixture = create();
    expect(fixture.componentInstance.featuredProductsFor(campaign)).toEqual([product]);
  });

  it('addToCart redirects to /login when logged out', () => {
    authServiceSpy.isLoggedIn.and.returnValue(false);
    spyOn(router, 'navigate');
    const fixture = create();

    fixture.componentInstance.addToCart(product);

    expect(router.navigate).toHaveBeenCalledWith(['/login']);
    expect(cartServiceSpy.addToCart).not.toHaveBeenCalled();
  });

  it('addToCart adds the product and flags justAdded when logged in', () => {
    const fixture = create();
    fixture.componentInstance.addToCart(product);
    expect(cartServiceSpy.addToCart).toHaveBeenCalledWith(product);
    expect(fixture.componentInstance.justAdded()).toBe(product.id);
  });

  it('buyNow redirects to /login when logged out', () => {
    authServiceSpy.isLoggedIn.and.returnValue(false);
    spyOn(router, 'navigate');
    const fixture = create();

    fixture.componentInstance.buyNow(product);

    expect(router.navigate).toHaveBeenCalledWith(['/login']);
    expect(checkoutServiceSpy.addItem).not.toHaveBeenCalled();
  });

  it('buyNow adds to checkout and navigates to /checkout when logged in', () => {
    spyOn(router, 'navigate');
    const fixture = create();

    fixture.componentInstance.buyNow(product);

    expect(checkoutServiceSpy.addItem).toHaveBeenCalledWith(product);
    expect(router.navigate).toHaveBeenCalledWith(['/checkout']);
  });

});
