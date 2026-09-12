import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { HomeHero } from './home-hero';
import { WelcomeService } from '../../services/welcome.service';
import { ProductService } from '../../services/product.service';
import { HeroSlideService } from '../../services/hero-slide.service';
import { Product } from '../../models/interfaces';

function product(id: string, category: string, isListed = true): Product {
  return {
    id,
    name: id,
    description: '',
    price: 50,
    discount: 0,
    category,
    imageUrl: '',
    galleryImageUrls: [],
    weight: '500g',
    isAvailable: true,
    isListed,
    stockQuantity: null,
    lowStockThreshold: 5,
    ingredients: '',
    benefits: '',
    storageInfo: '',
    createdAt: '',
    updatedAt: '',
  };
}

describe('HomeHero', () => {
  let products: ReturnType<typeof signal<Product[]>>;
  let loading: ReturnType<typeof signal<boolean>>;
  let introDone: ReturnType<typeof signal<boolean>>;

  function create(reducedMotion = false) {
    products = signal<Product[]>([]);
    loading = signal(true);
    introDone = signal(true);
    spyOn(WelcomeService, 'prefersReducedMotion').and.returnValue(reducedMotion);

    TestBed.configureTestingModule({
      imports: [HomeHero],
      providers: [
        provideRouter([]),
        { provide: ProductService, useValue: { products, loading } },
        {
          provide: HeroSlideService,
          useValue: {
            slides: signal([]).asReadonly(),
            loading: signal(false).asReadonly(),
            loaded: signal(false).asReadonly(),
            loadSlides: () => {},
          },
        },
        {
          provide: WelcomeService,
          useValue: {
            introDone: introDone.asReadonly(),
            celebration: signal(null).asReadonly(),
            stageHeld: () => false,
          },
        },
      ],
    });
    return TestBed.createComponent(HomeHero);
  }

  it('counts the categories of listed products, leaving out unlisted drafts', () => {
    const hero = create().componentInstance;

    products.set([
      product('a', 'Everyday Flours'),
      product('b', 'Everyday Flours'),
      product('c', 'Upwas'),
      product('draft', 'Spices & Essentials', false),
    ]);
    loading.set(false);

    expect(hero.catalogueReady()).toBeTrue();
    expect(hero.categoryCount()).toBe(2);
  });

  it('states the range as 30+ products, whatever is listed online today', () => {
    // The counter reads reduced motion straight from the browser. With it on, the figure is
    // written at once rather than counted up over a second and a half of animation frames.
    spyOn(window, 'matchMedia').and.returnValue({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as MediaQueryList);
    const fixture = create(true);
    products.set([product('a', 'Upwas')]);
    loading.set(false);
    fixture.detectChanges();
    TestBed.flushEffects();
    fixture.detectChanges();

    const first = fixture.nativeElement.querySelector('.hero-stats li b') as HTMLElement;
    expect(first.textContent).toBe('30+');
  });

  it('holds a placeholder rather than a category count until the whole catalogue is in', () => {
    const fixture = create();
    // A product page opened first fetches just its own product - that is not the catalogue.
    products.set([product('a', 'Upwas')]);
    fixture.detectChanges();

    expect(fixture.componentInstance.catalogueReady()).toBeFalse();
    expect(fixture.nativeElement.querySelectorAll('.hero-stat-wait').length).toBe(1);
  });

  it('waits for the intro to finish before bringing the copy in', () => {
    jasmine.clock().install();
    try {
      const fixture = create();
      introDone.set(false);
      fixture.detectChanges();
      TestBed.flushEffects();
      jasmine.clock().tick(1000);
      expect(fixture.componentInstance.revealed()).toBeFalse();

      introDone.set(true);
      TestBed.flushEffects();
      jasmine.clock().tick(400);
      expect(fixture.componentInstance.revealed()).toBeTrue();
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('shows everything at once for someone who has asked for reduced motion', () => {
    const fixture = create(true);
    fixture.detectChanges();
    TestBed.flushEffects();
    expect(fixture.componentInstance.revealed()).toBeTrue();
  });

  it("puts the owner's posters in the card's window, with the buttons below and nothing over them", () => {
    const fixture = create();
    fixture.detectChanges();
    const card = fixture.nativeElement.querySelector('.hero-card') as HTMLElement;
    const [first, second] = Array.from(card.children);

    expect(first.tagName.toLowerCase()).toBe('app-home-posters');
    expect(second.classList).toContain('hero-actions');
    // The posters are the only picture: no wall of packs, no written headline laid on the art.
    expect(fixture.nativeElement.querySelector('.hero-media, .hero-copy')).toBeNull();
  });

  it('still gives the page its one heading, for screen readers and search engines', () => {
    const fixture = create();
    fixture.detectChanges();
    const headings = fixture.nativeElement.querySelectorAll('h1');

    expect(headings.length).toBe(1);
    expect(headings[0].classList).toContain('visually-hidden');
    expect(headings[0].textContent).toContain('Pune');
  });

  it('keeps the trust line under the buttons', () => {
    const fixture = create();
    fixture.detectChanges();
    const items = Array.from(fixture.nativeElement.querySelectorAll('.hero-actions .trust-strip span')) as HTMLElement[];

    expect(items.map((s) => s.textContent?.replace(/^\s*\w+\s+/, '').trim())).toEqual([
      '100% Natural',
      'No Preservatives',
      'Fresh Delivery',
    ]);
  });

  it('keeps the two buttons it has always had', () => {
    const fixture = create();
    fixture.detectChanges();
    const links = Array.from(fixture.nativeElement.querySelectorAll('.hero-cta a')) as HTMLAnchorElement[];

    expect(links.map((a) => a.textContent?.trim())).toEqual([
      'Explore Products arrow_forward',
      'Join Our Journey',
    ]);
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/products', '/register']);
  });
});
