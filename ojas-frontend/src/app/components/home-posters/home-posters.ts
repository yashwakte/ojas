import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  NgZone,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { HeroSlideService } from '../../services/hero-slide.service';
import { WelcomeService } from '../../services/welcome.service';

/** How long each poster holds before the carousel crossfades to the next. */
const AUTOPLAY_MS = 5000;

/** After a swipe or a tap on the dots, how long before the carousel resumes advancing itself. */
const RESUME_AFTER_INPUT_MS = 12000;

/** How far a finger must travel across a poster before it counts as a swipe rather than a tap. */
const SWIPE_THRESHOLD_PX = 45;

/** One poster, flattened to exactly what the template needs to draw it. */
export interface HeroSlideView {
  /** Stable identity for `track`. The document id for a managed slide, the filename for a shipped one. */
  key: string;
  src: string;
  /** The WebP ladder, for the shipped artwork only — an uploaded slide is a single stored file. */
  srcset: string | null;
  /** Intrinsic size, so the browser can reserve the right shape before the picture arrives. */
  width: number;
  height: number;
  alt: string;
  /** Empty means the picture is not a link. */
  link: string;
}

/** The WebP ladder tools/optimize-images.mjs publishes for a 2400x1200 shipped poster. */
function ladder(name: string): string {
  return [640, 960, 1280, 1600, 2400].map((w) => `/images/${name}-${w}.webp ${w}w`).join(', ');
}

/**
 * What the hero shows when the owner has not published posters of their own — the client's two
 * posters, reshaped to the 2:1 frame by tools/build-hero-posters.mjs and served as a WebP ladder.
 * Also what shows if the API cannot be reached, so the hero is never an empty box waiting on a
 * request.
 */
export const SHIPPED_HERO_SLIDES: readonly HeroSlideView[] = [
  {
    key: 'hero-banner',
    src: '/images/hero-banner-framed-1280.jpg',
    srcset: ladder('hero-banner-framed'),
    width: 2400,
    height: 1200,
    alt: 'Ojas - A Culinary Journey Through Generations',
    link: '',
  },
  {
    key: 'hero-upvas',
    src: '/images/hero-upvas-framed-1280.jpg',
    srcset: ladder('hero-upvas-framed'),
    width: 2400,
    height: 1200,
    alt:
      'आपली दर्जेदार शुद्ध व सात्विक उपवास पीठे — the Ojas fasting range: Bhagar (Barnyard) Flour, ' +
      'Buckwheat Flour, Upvas Bhajani, Shingada Flour, Rajgira (Amaranth) Flour and Himalayan Rock Salt',
    link: '/products',
  },
];

/** The window is the hero card's full width: 1304px at most on a wide screen, the screen less its margins below that. */
const POSTER_SIZES = '(min-width: 1368px) 1304px, 96vw';

/**
 * The owner's posters (Admin → Home Posters), in the window at the top of the home page's hero.
 *
 * They are finished artwork with their own headlines and wordmarks set into them, so nothing is
 * laid over them: the hero's buttons and figures sit below the window, never on it, and every
 * poster is shown whole.
 *
 * A DECK, not a filmstrip: every poster occupies the same cell and moving between them is a
 * crossfade. It advances on its own only while it is on screen and nobody is holding it.
 */
@Component({
  selector: 'app-home-posters',
  imports: [RouterLink, MatIconModule],
  templateUrl: './home-posters.html',
  styleUrl: './home-posters.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomePosters {
  private readonly heroSlides = inject(HeroSlideService);
  private readonly zone = inject(NgZone);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  private readonly deckRef = viewChild<ElementRef<HTMLElement>>('deck');

  /**
   * Whatever the owner has published, or the shipped posters until we know. `loaded()` is the
   * guard that stops the band painting the shipped artwork and then jumping to the owner's.
   */
  readonly slides = computed<readonly HeroSlideView[]>(() => {
    if (!this.heroSlides.loaded()) return SHIPPED_HERO_SLIDES;

    const managed = this.heroSlides
      .slides()
      .filter((s) => s.isActive && !!s.imageUrl)
      .map<HeroSlideView>((s) => ({
        key: s.id,
        src: s.imageUrl,
        srcset: null,
        width: 0,
        height: 0,
        alt: s.altText,
        link: s.linkUrl,
      }));

    return managed.length > 0 ? managed : SHIPPED_HERO_SLIDES;
  });

  /** Which poster is on top. The deck crossfades in place, so this signal IS the position. */
  readonly activeIndex = signal(0);

  /**
   * Which posters may be fetched: the first, then each one as it is about to be shown.
   *
   * The owner's posters are 200-300KB each. Stacked in one cell, every <img> counts as "in view",
   * so lazy loading alone fetched all of them at once - on a 3G phone, half a megabyte competing
   * with the page. Now the second is only asked for once the first has arrived.
   */
  readonly primed = signal<ReadonlySet<number>>(new Set([0]));

  /** Which posters have arrived, so each fades in over a placeholder instead of painting in strips. */
  readonly ready = signal<ReadonlySet<string>>(new Set());

  /**
   * Nothing is fetched until the API has said which posters are live. Drawing the shipped poster
   * while it answers meant downloading a picture that was replaced a moment later.
   */
  readonly settled = this.heroSlides.loaded;

  readonly activeReady = computed(() => {
    const slide = this.slides()[this.activeIndex()];
    return !!slide && this.ready().has(slide.key);
  });

  /** The band is on screen. A carousel advancing where nobody can see it has spent a slide. */
  readonly inView = signal(false);

  /** Someone is hovering, focusing or swiping it; nothing may move it out from under them. */
  private readonly engaged = signal(false);

  /** It is advancing on its own. The active dot fills up as a clock while this holds. */
  readonly playing = computed(
    () =>
      this.inView() &&
      this.slides().length > 1 &&
      !this.engaged() &&
      !WelcomeService.prefersReducedMotion(),
  );

  readonly sizes = POSTER_SIZES;

  private autoplay: ReturnType<typeof setInterval> | null = null;
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;
  private observer: IntersectionObserver | null = null;
  private swipeFrom: { x: number; y: number } | null = null;

  constructor() {
    afterNextRender(() => {
      this.attachDeck();
      this.watchVisibility();
    });

    effect(() => {
      if (this.playing()) this.startAutoplay();
      else this.stopAutoplay();
    });

    // The owner publishing their own posters replaces the deck wholesale. Put it back to the
    // first rather than leaving an index into a set that no longer exists.
    effect(() => {
      const count = this.slides().length;
      if (this.activeIndex() >= count) this.activeIndex.set(0);
    });

    inject(DestroyRef).onDestroy(() => {
      this.stopAutoplay();
      this.detachDeck();
      this.observer?.disconnect();
      if (this.resumeTimer) clearTimeout(this.resumeTimer);
    });
  }

  // ----- Commands -----

  goTo(index: number): void {
    const count = this.slides().length;
    if (count === 0) return;
    const i = ((index % count) + count) % count;
    this.activeIndex.set(i);
    // The one being shown, and the one after it, so the next crossfade has its picture ready.
    this.prime(i);
    this.prime(i + 1);
  }

  /** A poster finished loading (or failed - either way, stop showing the placeholder). */
  onLoaded(key: string, index: number): void {
    this.ready.update((s) => new Set(s).add(key));
    // With the shown poster in, fetch the next one in the background, so the first advance does
    // not land on a placeholder. Not before: on 3G the two would share the connection.
    if (index === this.activeIndex()) this.prime(index + 1);
  }

  private prime(index: number): void {
    const count = this.slides().length;
    if (count === 0) return;
    const i = ((index % count) + count) % count;
    if (!this.primed().has(i)) this.primed.update((s) => new Set(s).add(i));
  }

  /** A dot, an arrow or a swipe: move, and hold the autoplay off for a while afterwards. */
  select(index: number): void {
    this.goTo(index);
    this.holdAutoplay();
  }

  next(): void {
    this.select(this.activeIndex() + 1);
  }

  previous(): void {
    this.select(this.activeIndex() - 1);
  }

  // ----- The deck -----

  private watchVisibility(): void {
    if (typeof IntersectionObserver === 'undefined') {
      this.inView.set(true);
      return;
    }
    this.observer = new IntersectionObserver(
      ([entry]) => this.inView.set(entry.isIntersecting),
      { threshold: 0.35 },
    );
    this.observer.observe(this.host.nativeElement);
  }

  private attachDeck(): void {
    const deck = this.deckRef()?.nativeElement;
    if (!deck) return;

    // Bound outside Angular: a drag is a stream of pointermove events and none of them should
    // cost a round of change detection. Only the decision at the end of one writes a signal.
    this.zone.runOutsideAngular(() => {
      deck.addEventListener('pointerenter', this.onEngage);
      deck.addEventListener('pointerleave', this.onDisengage);
      deck.addEventListener('focusin', this.onEngage);
      deck.addEventListener('focusout', this.onDisengage);
      deck.addEventListener('pointerdown', this.onPointerDown, { passive: true });
      deck.addEventListener('pointermove', this.onPointerMove, { passive: true });
      deck.addEventListener('pointerup', this.onPointerUp, { passive: true });
      deck.addEventListener('pointercancel', this.onPointerUp, { passive: true });
      document.addEventListener('visibilitychange', this.onVisibilityChange);
    });
  }

  private detachDeck(): void {
    const deck = this.deckRef()?.nativeElement;
    if (deck) {
      deck.removeEventListener('pointerenter', this.onEngage);
      deck.removeEventListener('pointerleave', this.onDisengage);
      deck.removeEventListener('focusin', this.onEngage);
      deck.removeEventListener('focusout', this.onDisengage);
      deck.removeEventListener('pointerdown', this.onPointerDown);
      deck.removeEventListener('pointermove', this.onPointerMove);
      deck.removeEventListener('pointerup', this.onPointerUp);
      deck.removeEventListener('pointercancel', this.onPointerUp);
    }
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }

  private readonly onEngage = (): void => this.engaged.set(true);

  /** Releases a hover hold - but never a deliberate one; the resume timer decides that. */
  private readonly onDisengage = (): void => {
    if (this.resumeTimer) return;
    this.engaged.set(false);
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    this.swipeFrom = { x: event.clientX, y: event.clientY };
  };

  /** Decided mid-gesture; a movement more down than across is the page scrolling, not a swipe. */
  private readonly onPointerMove = (event: PointerEvent): void => {
    const from = this.swipeFrom;
    if (!from) return;

    const dx = event.clientX - from.x;
    const dy = event.clientY - from.y;

    if (Math.abs(dy) > Math.abs(dx)) {
      this.swipeFrom = null;
      return;
    }
    if (Math.abs(dx) < SWIPE_THRESHOLD_PX) return;

    this.swipeFrom = null;
    this.zone.run(() => (dx < 0 ? this.next() : this.previous()));
  };

  private readonly onPointerUp = (): void => {
    this.swipeFrom = null;
  };

  private readonly onVisibilityChange = (): void => this.engaged.set(document.hidden);

  // ----- Autoplay -----

  private startAutoplay(): void {
    if (this.autoplay) return;
    this.zone.runOutsideAngular(() => {
      this.autoplay = setInterval(() => this.goTo(this.activeIndex() + 1), AUTOPLAY_MS);
    });
  }

  private stopAutoplay(): void {
    if (!this.autoplay) return;
    clearInterval(this.autoplay);
    this.autoplay = null;
  }

  private holdAutoplay(): void {
    this.engaged.set(true);
    if (this.resumeTimer) clearTimeout(this.resumeTimer);
    this.resumeTimer = setTimeout(() => {
      this.resumeTimer = null;
      this.engaged.set(false);
    }, RESUME_AFTER_INPUT_MS);
  }
}
