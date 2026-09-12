import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { HomePosters, SHIPPED_HERO_SLIDES } from './home-posters';
import { HeroSlideService } from '../../services/hero-slide.service';
import { WelcomeService } from '../../services/welcome.service';
import { HeroSlideConfig } from '../../models/interfaces';

function slide(overrides: Partial<HeroSlideConfig> = {}): HeroSlideConfig {
  return {
    id: 's1',
    imageUrl: '/media/poster.webp',
    altText: 'A poster',
    linkUrl: '',
    isActive: true,
    sortOrder: 0,
    createdAt: '2026-09-01',
    updatedAt: '2026-09-01',
    ...overrides,
  };
}

describe('HomePosters', () => {
  let slides: ReturnType<typeof signal<HeroSlideConfig[]>>;
  let loaded: ReturnType<typeof signal<boolean>>;

  /** Must match AUTOPLAY_MS in home-posters.ts. */
  const AUTOPLAY_MS = 5000;

  function create() {
    slides = signal<HeroSlideConfig[]>([]);
    loaded = signal(false);

    // Pinned rather than read from the runner: autoplay is switched off under reduced motion, so a
    // headless browser that happened to report it would turn the autoplay tests into no-ops.
    spyOn(WelcomeService, 'prefersReducedMotion').and.returnValue(false);

    TestBed.configureTestingModule({
      imports: [HomePosters],
      providers: [
        provideRouter([]),
        {
          provide: HeroSlideService,
          useValue: {
            slides: slides.asReadonly(),
            loading: signal(false).asReadonly(),
            loaded: loaded.asReadonly(),
            loadSlides: () => {},
          },
        },
      ],
    });

    return TestBed.createComponent(HomePosters);
  }

  function setup() {
    return create().componentInstance;
  }

  it('shows the posters that ship with the site before the API has answered', () => {
    const posters = setup();
    expect(posters.slides()).toEqual(SHIPPED_HERO_SLIDES);
  });

  it('shows the shipped posters when the owner has published nothing', () => {
    const posters = setup();
    loaded.set(true);
    slides.set([]);
    expect(posters.slides()).toEqual(SHIPPED_HERO_SLIDES);
  });

  it("shows the shipped posters when every one of the owner's is switched off", () => {
    const posters = setup();
    loaded.set(true);
    slides.set([slide({ isActive: false }), slide({ id: 's2', isActive: false })]);
    expect(posters.slides()).toEqual(SHIPPED_HERO_SLIDES);
  });

  it("replaces the shipped posters with the owner's live ones", () => {
    const posters = setup();
    loaded.set(true);
    slides.set([
      slide({ id: 'a', imageUrl: '/media/a.webp', altText: 'A', linkUrl: '/products' }),
      slide({ id: 'b', imageUrl: '/media/b.webp', altText: 'B', isActive: false }),
      slide({ id: 'c', imageUrl: '/media/c.webp', altText: 'C' }),
    ]);

    const shown = posters.slides();
    expect(shown.map((s) => s.key)).toEqual(['a', 'c']);
    expect(shown[0].src).toBe('/media/a.webp');
    expect(shown[0].link).toBe('/products');
    expect(shown[0].srcset).toBeNull();
  });

  it('ignores a poster that has no picture', () => {
    const posters = setup();
    loaded.set(true);
    slides.set([slide({ id: 'a', imageUrl: '' }), slide({ id: 'b', imageUrl: '/media/b.webp' })]);
    expect(posters.slides().map((s) => s.key)).toEqual(['b']);
  });

  it('gives every shipped poster a description for screen readers', () => {
    expect(SHIPPED_HERO_SLIDES.length).toBe(2);
    for (const s of SHIPPED_HERO_SLIDES) {
      expect(s.alt.trim().length).toBeGreaterThan(10);
    }
  });

  it('wraps past the last poster back to the first, and backwards off the front', () => {
    const posters = setup();
    loaded.set(true);
    slides.set([slide({ id: 'a' }), slide({ id: 'b' })]);

    posters.goTo(1);
    expect(posters.activeIndex()).toBe(1);
    posters.goTo(2);
    expect(posters.activeIndex()).toBe(0);
    posters.goTo(-1);
    expect(posters.activeIndex()).toBe(1);
  });

  it('drops back to the first poster when the deck shrinks under the current index', () => {
    const fixture = create();
    const posters = fixture.componentInstance;
    loaded.set(true);
    slides.set([slide({ id: 'a' }), slide({ id: 'b' }), slide({ id: 'c' })]);
    fixture.detectChanges();

    posters.goTo(2);
    slides.set([slide({ id: 'a' })]);
    fixture.detectChanges();

    expect(posters.activeIndex()).toBe(0);
  });

  describe('what it downloads', () => {
    /** The posters themselves; each one's blurred light behind it is counted separately below. */
    const imgs = (el: HTMLElement) => el.querySelectorAll('.poster-picture img').length;

    it('asks for the first poster ahead of everything else, since it is the largest paint', () => {
      const fixture = create();
      loaded.set(true);
      slides.set([slide({ id: 'a' }), slide({ id: 'b' })]);
      fixture.detectChanges();
      fixture.componentInstance.onLoaded('a', 0);
      fixture.detectChanges();

      const posters = Array.from(fixture.nativeElement.querySelectorAll('.poster-picture img')) as HTMLImageElement[];
      expect(posters[0].getAttribute('fetchpriority')).toBe('high');
      expect(posters[1].getAttribute('fetchpriority')).toBeNull();
    });

    it('fetches no poster until the API has said which ones are live', () => {
      const fixture = create();
      fixture.detectChanges();
      expect(imgs(fixture.nativeElement)).toBe(0);
    });

    it('fetches only the first poster, then the next once it is about to be shown', () => {
      const fixture = create();
      loaded.set(true);
      slides.set([slide({ id: 'a' }), slide({ id: 'b' }), slide({ id: 'c' })]);
      fixture.detectChanges();
      expect(imgs(fixture.nativeElement)).toBe(1);

      fixture.componentInstance.goTo(1);
      fixture.detectChanges();
      // The one now shown, and the one after it.
      expect(imgs(fixture.nativeElement)).toBe(3);
    });

    it('asks for the second poster once the first has arrived', () => {
      const fixture = create();
      loaded.set(true);
      slides.set([slide({ id: 'a' }), slide({ id: 'b' })]);
      fixture.detectChanges();

      fixture.componentInstance.onLoaded('a', 0);
      fixture.detectChanges();

      expect(imgs(fixture.nativeElement)).toBe(2);
      expect(fixture.componentInstance.activeReady()).toBeTrue();
    });
  });

  describe('autoplay', () => {
    beforeEach(() => jasmine.clock().install());
    afterEach(() => jasmine.clock().uninstall());

    it('advances on its own while it is on screen', () => {
      const fixture = create();
      const posters = fixture.componentInstance;
      loaded.set(true);
      slides.set([slide({ id: 'a' }), slide({ id: 'b' })]);
      posters.inView.set(true);
      fixture.detectChanges();

      jasmine.clock().tick(AUTOPLAY_MS + 10);
      expect(posters.activeIndex()).toBe(1);
    });

    it('does not advance while it is scrolled out of sight', () => {
      const fixture = create();
      const posters = fixture.componentInstance;
      loaded.set(true);
      slides.set([slide({ id: 'a' }), slide({ id: 'b' })]);
      posters.inView.set(false);
      fixture.detectChanges();

      jasmine.clock().tick(AUTOPLAY_MS * 3);
      expect(posters.activeIndex()).toBe(0);
    });

    it('holds still after the visitor picks a poster themselves', () => {
      const fixture = create();
      const posters = fixture.componentInstance;
      loaded.set(true);
      slides.set([slide({ id: 'a' }), slide({ id: 'b' }), slide({ id: 'c' })]);
      posters.inView.set(true);
      fixture.detectChanges();

      posters.select(2);
      fixture.detectChanges();
      jasmine.clock().tick(AUTOPLAY_MS * 2);
      fixture.detectChanges();

      expect(posters.activeIndex()).toBe(2);
    });

    it('runs the dot clock only while it is advancing on its own', () => {
      const fixture = create();
      const posters = fixture.componentInstance;
      loaded.set(true);
      slides.set([slide({ id: 'a' }), slide({ id: 'b' })]);
      posters.inView.set(true);
      fixture.detectChanges();

      const band = () => fixture.nativeElement.querySelector('.posters') as HTMLElement;
      expect(band().classList).toContain('posters--playing');

      posters.select(1);
      fixture.detectChanges();
      expect(band().classList).not.toContain('posters--playing');
    });

    it('never advances a deck with only one poster in it', () => {
      const fixture = create();
      const posters = fixture.componentInstance;
      loaded.set(true);
      slides.set([slide({ id: 'a' })]);
      posters.inView.set(true);
      fixture.detectChanges();

      jasmine.clock().tick(AUTOPLAY_MS * 3);
      expect(posters.activeIndex()).toBe(0);
    });
  });
});
