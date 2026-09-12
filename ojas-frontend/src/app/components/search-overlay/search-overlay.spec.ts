import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { signal } from '@angular/core';
import { SEARCH_CLOSE_MS, SearchOverlay } from './search-overlay';
import { SearchUiService } from '../../services/search-ui.service';
import { ProductService } from '../../services/product.service';
import { AuthService } from '../../services/auth.service';
import { Product } from '../../models/interfaces';
import { PRODUCT_CATEGORIES } from '../../constants/product-categories';

function product(id: string, name: string, category: string): Product {
  return {
    id,
    name,
    description: 'desc',
    price: 50,
    discount: 0,
    category,
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
    createdAt: '',
    updatedAt: '',
  };
}

describe('SearchOverlay', () => {
  let ui: SearchUiService;
  let router: Router;
  let role: ReturnType<typeof signal<string | null>>;

  beforeEach(() => {
    localStorage.removeItem('ojas_recent_searches');
    role = signal<string | null>(null);

    TestBed.configureTestingModule({
      imports: [SearchOverlay],
      providers: [
        provideRouter([]),
        {
          provide: ProductService,
          useValue: {
            products: signal([
              product('p1', 'Sorghum Flour', 'Everyday Flours'),
              product('p2', 'Ragi Flour', 'Everyday Flours'),
              product('p3', 'Rajgira (Amaranth) Flour', 'Upwas'),
            ]),
            categoriesInUse: signal(PRODUCT_CATEGORIES.slice(0, 3)),
          },
        },
        {
          provide: AuthService,
          useValue: { isLoggedIn: () => role() !== null, role: () => role() ?? 'customer' },
        },
      ],
    });
    ui = TestBed.inject(SearchUiService);
    router = TestBed.inject(Router);
    spyOn(router, 'navigate');
  });

  afterEach(() => {
    ui.close();
    localStorage.removeItem('ojas_recent_searches');
  });

  function create(): ComponentFixture<SearchOverlay> {
    const fixture = TestBed.createComponent(SearchOverlay);
    fixture.detectChanges();
    return fixture;
  }

  function open(fixture: ComponentFixture<SearchOverlay>, query = '') {
    ui.open(query);
    fixture.detectChanges();
    TestBed.flushEffects();
    fixture.detectChanges();
  }

  const el = (f: ComponentFixture<SearchOverlay>) => f.nativeElement as HTMLElement;
  const key = (k: string) => new KeyboardEvent('keydown', { key: k, cancelable: true });

  it('draws nothing while closed', () => {
    const fixture = create();
    expect(el(fixture).querySelector('.search-panel')).toBeNull();
  });

  it('opens on suggestions and the aisles in use', () => {
    const fixture = create();
    open(fixture);

    expect(el(fixture).textContent).toContain('Popular searches');
    expect(el(fixture).querySelectorAll('.search-aisle').length).toBe(3);
  });

  it('shows matches as someone types, including by the local name', () => {
    const fixture = create();
    open(fixture);

    fixture.componentInstance.onInput('jowar');
    fixture.detectChanges();

    const results = el(fixture).querySelectorAll('.search-result');
    expect(results.length).toBe(1);
    expect(results[0].textContent).toContain('Sorghum Flour');
    expect(el(fixture).querySelector('.search-all')?.textContent).toContain('See all 1 results');
  });

  it('Enter with nothing highlighted shows every result on the products page', () => {
    const fixture = create();
    open(fixture, 'flour');

    fixture.componentInstance.onInputKeydown(key('Enter'));

    expect(router.navigate).toHaveBeenCalledWith(['/products'], { queryParams: { q: 'flour' } });
    expect(ui.isOpen()).toBeFalse();
  });

  it('arrow keys pick a result and Enter opens it', () => {
    const fixture = create();
    open(fixture, 'flour');

    fixture.componentInstance.onInputKeydown(key('ArrowDown'));
    fixture.componentInstance.onInputKeydown(key('ArrowDown'));
    const second = fixture.componentInstance.preview()[1];
    fixture.componentInstance.onInputKeydown(key('Enter'));

    expect(router.navigate).toHaveBeenCalledWith(['/products', second.id]);
  });

  it('remembers what was searched for, and can forget it', () => {
    const fixture = create();
    open(fixture, 'ragi');
    fixture.componentInstance.seeAll();

    open(fixture);
    expect(el(fixture).textContent).toContain('Recent searches');
    expect(fixture.componentInstance.recent()).toEqual(['ragi']);

    fixture.componentInstance.forgetRecent();
    expect(fixture.componentInstance.recent()).toEqual([]);
  });

  it('says so when nothing matches', () => {
    const fixture = create();
    open(fixture, 'zzzz');
    expect(el(fixture).querySelector('.search-empty h3')?.textContent).toContain('“zzzz”');
  });

  it('Escape plays it out, then closes it', () => {
    const fixture = create();
    open(fixture);
    jasmine.clock().install();
    try {
      fixture.componentInstance.onDocumentKeydown(key('Escape'));
      expect(fixture.componentInstance.closing()).toBeTrue();
      expect(ui.isOpen()).toBeTrue();

      jasmine.clock().tick(SEARCH_CLOSE_MS + 5);
      expect(ui.isOpen()).toBeFalse();
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('opens out of the icon it was opened from', () => {
    const fixture = create();
    ui.open('', { x: 311, y: 32 });
    fixture.detectChanges();
    TestBed.flushEffects();
    fixture.detectChanges();

    const panel = el(fixture).querySelector('.search-panel') as HTMLElement;
    expect(panel.style.getPropertyValue('--sx')).toBe('311px');
    expect(panel.style.getPropertyValue('--sy')).toBe('32px');
  });
});
