import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, ActivatedRoute, convertToParamMap, Params } from '@angular/router';
import { signal } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { Products } from './products';
import { ProductService } from '../../services/product.service';
import { CartService } from '../../services/cart.service';
import { CheckoutService } from '../../services/checkout.service';
import { AuthService } from '../../services/auth.service';
import { Product } from '../../models/interfaces';
import { PRODUCT_CATEGORIES, ProductCategory } from '../../constants/product-categories';

describe('Products', () => {
  const base: Product = {
    id: 'p1',
    name: 'Bajra Flour',
    description: 'desc',
    price: 45,
    discount: 0,
    category: 'Everyday Flours',
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
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  };
  const bajra = base;
  const modak: Product = { ...base, id: 'p2', name: 'Modak Pith', price: 65, category: 'Traditional & Festive', createdAt: '2026-03-01' };
  const custard: Product = { ...base, id: 'p3', name: 'Custard Powder - Mango Flavour', price: 40, discount: 10, category: 'Baking & Desserts', weight: '100g' };
  const rajgira: Product = { ...base, id: 'p4', name: 'Rajgira (Amaranth) Flour', price: 65, category: 'Upwas', weight: '200g', stockQuantity: 0 };
  const sattu: Product = { ...base, id: 'p5', name: 'Chana Sattu', price: 55, category: 'Health & Breakfast', weight: '200 g', createdAt: '2026-05-01' };
  const anarasa: Product = { ...base, id: 'p6', name: 'Anarasa Flour', price: 115, category: 'Traditional & Festive' };
  const catalogue = [bajra, modak, custard, rajgira, sattu, anarasa];

  let params$: BehaviorSubject<Params>;
  let products: ReturnType<typeof signal<Product[]>>;
  let loading: ReturnType<typeof signal<boolean>>;
  let categoriesInUse: ReturnType<typeof signal<readonly ProductCategory[]>>;
  let cartServiceSpy: jasmine.SpyObj<CartService>;
  let checkoutServiceSpy: jasmine.SpyObj<CheckoutService>;
  let productServiceSpy: any;
  let router: Router;

  function configure(initial: Params = {}) {
    params$ = new BehaviorSubject<Params>(initial);
    products = signal<Product[]>(catalogue);
    loading = signal(false);
    categoriesInUse = signal<readonly ProductCategory[]>(
      PRODUCT_CATEGORIES.filter((c) => c !== 'Spices & Essentials'),
    );
    productServiceSpy = {
      products,
      loading,
      error: signal<string | null>(null),
      categoriesInUse,
      loadProducts: jasmine.createSpy('loadProducts'),
    };
    cartServiceSpy = jasmine.createSpyObj('CartService', ['addToCart']);
    checkoutServiceSpy = jasmine.createSpyObj('CheckoutService', ['addItem']);
    const authServiceSpy = jasmine.createSpyObj('AuthService', ['isLoggedIn']);
    authServiceSpy.isLoggedIn.and.returnValue(true);

    const paramMap$ = new BehaviorSubject(convertToParamMap(initial));
    params$.subscribe((p) => paramMap$.next(convertToParamMap(p)));

    TestBed.configureTestingModule({
      imports: [Products],
      providers: [
        provideRouter([]),
        { provide: ProductService, useValue: productServiceSpy },
        { provide: CartService, useValue: cartServiceSpy },
        { provide: CheckoutService, useValue: checkoutServiceSpy },
        { provide: AuthService, useValue: authServiceSpy },
        { provide: ActivatedRoute, useValue: { queryParamMap: paramMap$.asObservable() } },
      ],
    });
    router = TestBed.inject(Router);
  }

  function create() {
    const fixture = TestBed.createComponent(Products);
    fixture.detectChanges();
    return fixture;
  }

  const names = (list: Product[]) => list.map((p) => p.name);

  describe('categories', () => {
    it('starts on All, showing everything with the out-of-stock pack moved to the end', () => {
      configure();
      const page = create().componentInstance;

      expect(page.selectedCategory()).toBe('All');
      expect(page.filteredProducts().length).toBe(6);
      expect(page.filteredProducts().at(-1)).toBe(rajgira);
    });

    it('opens on the category in the link', () => {
      configure({ category: 'Traditional & Festive' });
      const page = create().componentInstance;

      expect(page.selectedCategory()).toBe('Traditional & Festive');
      expect(names(page.filteredProducts())).toEqual(['Modak Pith', 'Anarasa Flour']);
    });

    it('sends a link to a retired category to its new aisle', () => {
      // A campaign button or bookmark from before the September 2026 change.
      configure({ category: 'Flour' });
      const page = create().componentInstance;

      expect(page.selectedCategory()).toBe('Everyday Flours');
      expect(names(page.filteredProducts())).toEqual(['Bajra Flour']);
    });

    it('ignores a category that does not exist', () => {
      configure({ category: 'NotACategory' });
      expect(create().componentInstance.selectedCategory()).toBe('All');
    });

    it('only offers categories that have something in them', () => {
      configure();
      const page = create().componentInstance;
      expect(page.categories()).not.toContain('Spices & Essentials');
      expect(page.categories()[0]).toBe('All');
    });

    it('selectCategory navigates, and All clears the parameter', () => {
      configure();
      spyOn(router, 'navigate');
      const page = create().componentInstance;

      page.selectCategory('Upwas');
      expect(router.navigate).toHaveBeenCalledWith(
        [],
        jasmine.objectContaining({ queryParams: { category: 'Upwas' }, queryParamsHandling: 'merge' }),
      );

      page.selectCategory('All');
      expect(router.navigate).toHaveBeenCalledWith(
        [],
        jasmine.objectContaining({ queryParams: { category: null } }),
      );
    });

    it('counts each category within the current search', () => {
      configure({ q: 'flour' });
      const page = create().componentInstance;

      // Bajra, Rajgira and Anarasa by name, and Modak Pith because "pith" is flour.
      expect(page.categoryCount('All')).toBe(4);
      expect(page.categoryCount('Traditional & Festive')).toBe(2);
      expect(page.categoryCount('Baking & Desserts')).toBe(0);
    });
  });

  describe('search', () => {
    it('finds a product by the name customers use for it', () => {
      configure({ q: 'bajri' });
      expect(names(create().componentInstance.filteredProducts())).toEqual(['Bajra Flour']);
    });

    describe('while typing', () => {
      beforeEach(() => jasmine.clock().install());
      afterEach(() => jasmine.clock().uninstall());

      it('commits to the URL after a pause, replacing rather than pushing history', () => {
        configure();
        spyOn(router, 'navigate');
        const page = create().componentInstance;

        page.onSearchInput('mod');
        page.onSearchInput('moda');
        jasmine.clock().tick(299);
        expect(router.navigate).not.toHaveBeenCalled();

        jasmine.clock().tick(1);
        expect(router.navigate).toHaveBeenCalledOnceWith(
          [],
          jasmine.objectContaining({ queryParams: { q: 'moda' }, replaceUrl: true }),
        );
      });

      it('does not overwrite what is being typed when its own commit comes back', () => {
        configure();
        spyOn(router, 'navigate');
        const page = create().componentInstance;

        page.onSearchInput('mod');
        jasmine.clock().tick(300);
        page.onSearchInput('modak');
        params$.next({ q: 'mod' });

        expect(page.searchDraft()).toBe('modak');
        jasmine.clock().tick(300);
      });
    });

    it('takes the box text from the URL when a search arrives from elsewhere', () => {
      configure();
      const page = create().componentInstance;

      params$.next({ q: 'custard' });

      expect(page.searchDraft()).toBe('custard');
      expect(page.eyebrow()).toBe('Search results');
      expect(page.title()).toBe('“custard”');
      expect(page.subtitle()).toBe('1 product matches your search.');
    });
  });

  describe('sorting', () => {
    function sortedBy(sort: string) {
      configure({ sort, stock: '1' });
      return names(create().componentInstance.filteredProducts());
    }

    it('by the price actually charged, low to high', () => {
      expect(sortedBy('price-asc')).toEqual([
        'Custard Powder - Mango Flavour', // ₹36 after its 10% off
        'Bajra Flour',
        'Chana Sattu',
        'Modak Pith',
        'Anarasa Flour',
      ]);
    });

    it('high to low', () => {
      expect(sortedBy('price-desc')[0]).toBe('Anarasa Flour');
    });

    it('by biggest discount', () => {
      expect(sortedBy('discount')[0]).toBe('Custard Powder - Mango Flavour');
    });

    it('newest first', () => {
      expect(sortedBy('newest').slice(0, 2)).toEqual(['Chana Sattu', 'Modak Pith']);
    });

    it('falls back to Recommended for an unknown sort', () => {
      configure({ sort: 'bogus' });
      expect(create().componentInstance.sort()).toBe('relevance');
    });
  });

  describe('filters', () => {
    it('by price band', () => {
      configure({ price: 'under-50' });
      expect(names(create().componentInstance.filteredProducts())).toEqual([
        'Bajra Flour',
        'Custard Powder - Mango Flavour',
      ]);
    });

    it('by pack size, treating "200 g" and "200g" as the same pack', () => {
      configure({ size: '200g' });
      expect(names(create().componentInstance.filteredProducts())).toEqual([
        'Chana Sattu',
        'Rajgira (Amaranth) Flour',
      ]);
    });

    it('to what is in stock', () => {
      configure({ stock: '1' });
      expect(create().componentInstance.filteredProducts()).not.toContain(rajgira);
    });

    it('to what is on offer', () => {
      configure({ offer: '1' });
      expect(names(create().componentInstance.filteredProducts())).toEqual([
        'Custard Powder - Mango Flavour',
      ]);
    });

    it('lists pack sizes smallest first', () => {
      configure();
      expect(create().componentInstance.sizeOptions().map((s) => s.label)).toEqual([
        '100 g',
        '200 g',
        '500 g',
      ]);
    });

    it("counts each price band without applying the price filter's own choice", () => {
      configure({ price: 'under-50' });
      const bands = create().componentInstance.priceOptions();
      expect(bands.find((b) => b.id === 'over-100')?.count).toBe(1);
    });

    it('shows what is applied as pills, and taking one off drops only that filter', () => {
      configure({ category: 'Upwas', size: '200g,500g', stock: '1' });
      spyOn(router, 'navigate');
      const page = create().componentInstance;

      expect(page.activeFilterCount()).toBe(4);
      expect(page.activePills().map((p) => p.label)).toEqual(['Upwas', '200 g', '500 g', 'In stock']);

      page.removePill(page.activePills()[1]);
      expect(router.navigate).toHaveBeenCalledWith(
        [],
        jasmine.objectContaining({ queryParams: { size: '500g' } }),
      );
    });

    it('Clear all removes every filter and the search, but keeps the sort', () => {
      configure({ category: 'Upwas', q: 'flour', sort: 'name' });
      spyOn(router, 'navigate');
      const page = create().componentInstance;

      page.clearAll();

      expect(router.navigate).toHaveBeenCalledWith(
        [],
        jasmine.objectContaining({
          queryParams: { category: null, q: null, price: null, size: null, stock: null, offer: null },
        }),
      );
      expect(page.searchDraft()).toBe('');
    });
  });

  describe('states', () => {
    it('says so, and offers a way out, when nothing matches', () => {
      configure({ q: 'zzzz' });
      const fixture = create();
      const el: HTMLElement = fixture.nativeElement;

      expect(el.querySelector('.state h3')?.textContent).toContain('“zzzz”');
      expect(el.querySelector('.state-btn')?.textContent).toContain('Clear all filters');
    });

    it('shows skeleton cards while the catalogue is on its way', () => {
      configure();
      products.set([]);
      loading.set(true);
      const fixture = create();

      expect(fixture.nativeElement.querySelectorAll('.sk-card').length).toBe(8);
    });

    it('opens and closes the phone filter sheet', () => {
      configure();
      const fixture = create();
      const page = fixture.componentInstance;

      page.openFilterSheet();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.sheet')).not.toBeNull();

      page.closeSheets();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.sheet')).toBeNull();
    });
  });

  it('addToCart adds the product and marks it just added', () => {
    configure();
    const page = create().componentInstance;
    page.addToCart(bajra);
    expect(cartServiceSpy.addToCart).toHaveBeenCalledWith(bajra);
    expect(page.justAdded()).toBe(bajra.id);
  });

  it('buyNow sends the product to checkout, where the auth guard takes over for guests', () => {
    configure();
    spyOn(router, 'navigate');
    const page = create().componentInstance;

    page.buyNow(bajra);

    expect(checkoutServiceSpy.addItem).toHaveBeenCalledWith(bajra);
    expect(router.navigate).toHaveBeenCalledWith(['/checkout']);
  });

  it('onImgError swaps the broken image to the placeholder', () => {
    configure();
    const page = create().componentInstance;
    const img = document.createElement('img');
    page.onImgError({ target: img } as unknown as Event);
    expect(img.src).toContain('/images/placeholder.svg');
  });
});
