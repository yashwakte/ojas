import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { HomeHero, SHIPPED_HERO_SLIDES } from './home-hero';
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

describe('HomeHero', () => {
  let slides: ReturnType<typeof signal<HeroSlideConfig[]>>;
  let loaded: ReturnType<typeof signal<boolean>>;

  /** Must match AUTOPLAY_MS in home-hero.ts. */
  const AUTOPLAY_MS = 5000;

  /** The fixture, for tests that need to run change detection so the effects flush. */
  function create() {
    slides = signal<HeroSlideConfig[]>([]);
    loaded = signal(false);

    // Pinned rather than read from the runner: the whole carousel is switched off under reduced
    // motion, so a headless browser that happened to report it would turn the autoplay tests
    // into no-ops that still pass.
    spyOn(WelcomeService, 'prefersReducedMotion').and.returnValue(false);

    TestBed.configureTestingModule({
      imports: [HomeHero],
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
        {
          provide: WelcomeService,
          useValue: {
            introDone: signal(true).asReadonly(),
            celebration: signal(null).asReadonly(),
            stageHeld: () => false,
          },
        },
      ],
    });

    return TestBed.createComponent(HomeHero);
  }

  function setup() {
    return create().componentInstance;
  }

  it('shows the artwork that ships with the site before the API has answered', () => {
    const hero = setup();

    expect(loaded()).toBeFalse();
    expect(hero.slides()).toEqual(SHIPPED_HERO_SLIDES);
  });

  it('shows the shipped artwork when the owner has published nothing', () => {
    const hero = setup();

    loaded.set(true);
    slides.set([]);

    // The hero is the biggest thing in the first screenful and is never allowed to be empty.
    expect(hero.slides()).toEqual(SHIPPED_HERO_SLIDES);
  });

  it("shows the shipped artwork when every one of the owner's slides is switched off", () => {
    const hero = setup();

    loaded.set(true);
    slides.set([slide({ isActive: false }), slide({ id: 's2', isActive: false })]);

    expect(hero.slides()).toEqual(SHIPPED_HERO_SLIDES);
  });

  it("replaces the shipped artwork with the owner's live slides", () => {
    const hero = setup();

    loaded.set(true);
    slides.set([
      slide({ id: 'a', imageUrl: '/media/a.webp', altText: 'A', linkUrl: '/products' }),
      slide({ id: 'b', imageUrl: '/media/b.webp', altText: 'B', isActive: false }),
      slide({ id: 'c', imageUrl: '/media/c.webp', altText: 'C' }),
    ]);

    const shown = hero.slides();
    expect(shown.length).toBe(2);
    expect(shown.map((s) => s.key)).toEqual(['a', 'c']);
    expect(shown[0].src).toBe('/media/a.webp');
    expect(shown[0].alt).toBe('A');
    expect(shown[0].link).toBe('/products');
    // An uploaded slide is one stored file, not a ladder — the ladder is only for the shipped set.
    expect(shown[0].srcset).toBeNull();
  });

  it('ignores a slide that has no picture', () => {
    const hero = setup();

    loaded.set(true);
    slides.set([slide({ id: 'a', imageUrl: '' }), slide({ id: 'b', imageUrl: '/media/b.webp' })]);

    expect(hero.slides().map((s) => s.key)).toEqual(['b']);
  });

  it('ships the fasting poster alongside the original banner', () => {
    // Both shipped posters must reach the rail; the second one arriving is the whole point of
    // the carousel existing.
    expect(SHIPPED_HERO_SLIDES.length).toBe(2);
    expect(SHIPPED_HERO_SLIDES[1].src).toContain('hero-upvas');
    expect(SHIPPED_HERO_SLIDES[1].srcset).toContain('hero-upvas-640.webp 640w');
  });

  it('gives every shipped slide a description for screen readers', () => {
    for (const s of SHIPPED_HERO_SLIDES) {
      expect(s.alt.trim().length).toBeGreaterThan(10);
    }
  });

  describe('the deck', () => {
    it('wraps past the last slide back to the first', () => {
      const hero = setup();
      loaded.set(true);
      slides.set([slide({ id: 'a' }), slide({ id: 'b' })]);

      hero.goTo(1);
      expect(hero.activeIndex()).toBe(1);

      hero.goTo(2);
      expect(hero.activeIndex()).toBe(0);

      // ...and backwards off the front, to the end.
      hero.goTo(-1);
      expect(hero.activeIndex()).toBe(1);
    });

    it('drops back to the first slide when the deck shrinks under the current index', () => {
      const fixture = create();
      const hero = fixture.componentInstance;

      loaded.set(true);
      slides.set([slide({ id: 'a' }), slide({ id: 'b' }), slide({ id: 'c' })]);
      fixture.detectChanges();

      hero.goTo(2);
      expect(hero.activeIndex()).toBe(2);

      // The owner deletes two of them.
      slides.set([slide({ id: 'a' })]);
      fixture.detectChanges();

      expect(hero.activeIndex()).toBe(0);
    });
  });

  describe('autoplay', () => {
    beforeEach(() => jasmine.clock().install());
    afterEach(() => jasmine.clock().uninstall());

    /**
     * THE REGRESSION THIS PINS: on a first load the hero used to sit on its opening picture and
     * never move. Advancing went through scrolling a container, so it could only happen once a
     * viewChild had resolved and the element had a measurable width — and when that did not line
     * up there was nothing on screen to say why. Advancing is a signal write now, so the only
     * thing it waits for is the door reveal.
     */
    it('advances on its own after the doors clear, with nothing else touched', () => {
      const fixture = create();
      const hero = fixture.componentInstance;

      loaded.set(true);
      slides.set([slide({ id: 'a' }), slide({ id: 'b' })]);

      // The doors finish; this is the whole of what autoplay is allowed to wait on.
      hero.revealed.set(true);
      fixture.detectChanges();

      expect(hero.activeIndex()).toBe(0);

      jasmine.clock().tick(AUTOPLAY_MS + 10);
      expect(hero.activeIndex()).toBe(1);

      jasmine.clock().tick(AUTOPLAY_MS + 10);
      expect(hero.activeIndex()).toBe(0);
    });

    it('does not advance while the doors are still shut', () => {
      const fixture = create();
      const hero = fixture.componentInstance;

      loaded.set(true);
      slides.set([slide({ id: 'a' }), slide({ id: 'b' })]);
      fixture.detectChanges();

      // A hero that advances behind a closed door has spent a slide nobody saw.
      jasmine.clock().tick(AUTOPLAY_MS * 3);
      expect(hero.activeIndex()).toBe(0);
    });

    it('holds still after the visitor picks a slide themselves', () => {
      const fixture = create();
      const hero = fixture.componentInstance;

      loaded.set(true);
      slides.set([slide({ id: 'a' }), slide({ id: 'b' }), slide({ id: 'c' })]);
      hero.revealed.set(true);
      fixture.detectChanges();

      hero.select(2);
      fixture.detectChanges();
      expect(hero.activeIndex()).toBe(2);

      // Moving it out from under someone who has just chosen a picture is the single most
      // irritating thing a carousel can do.
      jasmine.clock().tick(AUTOPLAY_MS * 2);
      fixture.detectChanges();
      expect(hero.activeIndex()).toBe(2);
    });

    it('never advances a deck with only one picture in it', () => {
      const fixture = create();
      const hero = fixture.componentInstance;

      loaded.set(true);
      slides.set([slide({ id: 'a' })]);
      hero.revealed.set(true);
      fixture.detectChanges();

      jasmine.clock().tick(AUTOPLAY_MS * 3);
      expect(hero.activeIndex()).toBe(0);
    });
  });
});
