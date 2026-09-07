import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HeroSlideService } from './hero-slide.service';
import { environment } from '../../environments/environment';
import { HeroSlideConfig } from '../models/interfaces';

function slide(overrides: Partial<HeroSlideConfig> = {}): HeroSlideConfig {
  return {
    id: 's1',
    imageUrl: '/media/poster.webp',
    altText: 'A poster',
    linkUrl: '',
    isActive: true,
    sortOrder: 0,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

describe('HeroSlideService', () => {
  const url = `${environment.apiUrl}/hero-slides`;
  let service: HeroSlideService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(HeroSlideService);
    http = TestBed.inject(HttpTestingController);

    // The constructor fetches on its own.
    http.expectOne((r) => r.url === url).flush([]);
  });

  afterEach(() => http.verify());

  it('does not bust the cache for ordinary storefront loads', () => {
    service.loadSlides();

    // Customers are the traffic the cache exists for, and a hero five minutes stale is fine.
    const req = http.expectOne((r) => r.url === url);
    expect(req.request.params.has('_')).toBeFalse();
    req.flush([]);
  });

  it("busts the cache when asked, so an admin's read reaches the origin", () => {
    // THE REGRESSION THIS PINS: this service fetches anonymously at app boot, and that response
    // is stored `public, max-age=300, stale-while-revalidate=3600`. Without a distinct cache key
    // an admin's later read is answered from their own browser cache, the origin is never asked,
    // and the `no-store` the API sends admins never gets the chance to apply — so a slide they
    // just added disappears from the list and cannot be edited or deleted.
    service.loadSlides({ bypassCache: true });

    const req = http.expectOne((r) => r.url === url);
    expect(req.request.params.has('_')).toBeTrue();
    req.flush([]);
  });

  it('marks itself loaded even when the API cannot be reached', () => {
    service.loadSlides();
    http.expectOne((r) => r.url === url).error(new ProgressEvent('network'));

    // The hero decides whether to show the shipped artwork off `loaded()`, so a failed request
    // must still resolve it — otherwise the hero waits forever on a request that will never come.
    expect(service.loaded()).toBeTrue();
    expect(service.slides()).toEqual([]);
    expect(service.loading()).toBeFalse();
  });

  it('adds a created slide to the list without re-fetching it', () => {
    service.createSlide({ imageUrl: '/media/a.webp', altText: 'A' }).subscribe();
    http.expectOne((r) => r.method === 'POST').flush(slide({ id: 'a' }));

    expect(service.slides().map((s) => s.id)).toEqual(['a']);
    // Deliberately no follow-up GET: the POST response IS the saved slide, and a re-fetch here is
    // exactly what the cache would answer with a pre-save body.
    http.verify();
  });

  it('keeps the list in the order the API would return it after a save', () => {
    service.createSlide({ imageUrl: '/media/b.webp' }).subscribe();
    http.expectOne((r) => r.method === 'POST').flush(slide({ id: 'b', sortOrder: 5 }));

    service.createSlide({ imageUrl: '/media/a.webp' }).subscribe();
    http.expectOne((r) => r.method === 'POST').flush(slide({ id: 'a', sortOrder: 1 }));

    expect(service.slides().map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('swaps an updated slide in place', () => {
    service.createSlide({ imageUrl: '/media/a.webp' }).subscribe();
    http.expectOne((r) => r.method === 'POST').flush(slide({ id: 'a', altText: 'Before' }));

    service.updateSlide('a', { altText: 'After' }).subscribe();
    http.expectOne((r) => r.method === 'PATCH').flush(slide({ id: 'a', altText: 'After' }));

    expect(service.slides().length).toBe(1);
    expect(service.slides()[0].altText).toBe('After');
  });

  it('drops a deleted slide from the list', () => {
    service.createSlide({ imageUrl: '/media/a.webp' }).subscribe();
    http.expectOne((r) => r.method === 'POST').flush(slide({ id: 'a' }));

    service.deleteSlide('a').subscribe();
    http.expectOne((r) => r.method === 'DELETE').flush(null, { status: 204, statusText: 'No Content' });

    expect(service.slides()).toEqual([]);
  });
});
