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
import { HeroParallaxDirective } from '../../directives/hero-parallax.directive';
import { WelcomeService } from '../../services/welcome.service';
import { HeroSlideService } from '../../services/hero-slide.service';

/**
 * The beat between the last overlay leaving and the doors starting to swing. Without it the two
 * moments butt up against each other and read as one confused animation; with it the page
 * visibly hands over from the greeting to the hero.
 */
const HANDOVER_MS = 320;

/** How long the doors take to clear the stage, before the copy over them is allowed in. */
const DOORS_MS = 1500;

/** How long each slide holds before the carousel crossfades to the next. */
const AUTOPLAY_MS = 5000;

/** After a swipe or a tap on the dots, how long before the carousel resumes advancing itself. */
const RESUME_AFTER_INPUT_MS = 12000;

/** How far a finger must travel across the artwork before it counts as a swipe rather than a tap. */
const SWIPE_THRESHOLD_PX = 45;

/** One picture in the hero, flattened to exactly what the template needs to draw it. */
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

/**
 * What the hero shows when the owner has not added any slides of their own — the client's two
 * composed posters, committed to the repository and served as a WebP ladder.
 *
 * These are also what shows if the API cannot be reached at all. The hero is the largest thing
 * in the first screenful and it is never allowed to be empty, so there is always artwork here to
 * fall back to rather than a blank stage waiting on a request.
 */
export const SHIPPED_HERO_SLIDES: readonly HeroSlideView[] = [
  {
    key: 'hero-banner',
    src: '/images/hero-banner-1280.jpg',
    srcset:
      '/images/hero-banner-640.webp 640w, /images/hero-banner-960.webp 960w, ' +
      '/images/hero-banner-1280.webp 1280w, /images/hero-banner-1600.webp 1600w',
    width: 1699,
    height: 926,
    alt: 'Ojas - A Culinary Journey Through Generations',
    link: '',
  },
  {
    key: 'hero-upvas',
    src: '/images/hero-upvas-1280.jpg',
    srcset:
      '/images/hero-upvas-640.webp 640w, /images/hero-upvas-960.webp 960w, ' +
      '/images/hero-upvas-1280.webp 1280w, /images/hero-upvas-1600.webp 1600w',
    width: 1600,
    height: 1066,
    alt:
      'आपली दर्जेदार शुद्ध व सात्विक उपवास पीठे — the Ojas fasting range: Bhagar (Barnyard) Flour, ' +
      'Buckwheat Flour, Upvas Bhajani, Shingada Flour, Rajgira (Amaranth) Flour and Himalayan Rock Salt',
    link: '/products',
  },
];

@Component({
  selector: 'app-home-hero',
  imports: [RouterLink, MatIconModule, HeroParallaxDirective],
  templateUrl: './home-hero.html',
  styleUrl: './home-hero.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeHero {
  private readonly welcome = inject(WelcomeService);
  private readonly heroSlides = inject(HeroSlideService);
  private readonly zone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);

  private readonly deckRef = viewChild<ElementRef<HTMLElement>>('deck');

  /**
   * The dwell, published to the stylesheet so the slow push-in on the active picture lasts
   * exactly as long as the slide is on screen. Two places holding the same number is how a
   * timing change ends up half-applied.
   */
  readonly dwellMs = AUTOPLAY_MS;

  /**
   * The doors swing apart. Starts closed on both server and client render so there is no
   * SSR/hydration mismatch.
   */
  readonly open = signal(false);

  /**
   * The copy over the artwork — CTAs, trust marks, scroll cue — only appears once the doors have
   * cleared. Revealing it underneath them means it animates where nobody can see it.
   */
  readonly revealed = signal(false);

  /**
   * The pictures in the deck: whatever the owner has published, or the shipped posters until we
   * know. `loaded()` is the guard that stops the hero painting its own artwork and then jumping
   * to somebody else's a beat later.
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
        // An uploaded slide's dimensions are not known here, and guessing them would reserve the
        // wrong shape and shift the page. The deck gives every slide the same box instead, so
        // nothing below the hero depends on this number.
        width: 0,
        height: 0,
        alt: s.altText,
        link: s.linkUrl,
      }));

    return managed.length > 0 ? managed : SHIPPED_HERO_SLIDES;
  });

  /**
   * Which slide is on top of the deck. Unlike the scroll rail this replaced, this signal IS the
   * carousel's position rather than a reading taken off the DOM — the pictures are stacked and
   * crossfade in place, so there is no scroll offset to derive it from and nothing that can
   * disagree with it mid-transition.
   */
  readonly activeIndex = signal(0);

  /** True once the browser has painted; nothing may animate before this. */
  private readonly painted = signal(false);

  /**
   * The visitor is hovering, focusing or swiping the carousel. Nothing may move it out from
   * under them while this is true.
   */
  private readonly engaged = signal(false);

  private timers: ReturnType<typeof setTimeout>[] = [];
  private autoplay: ReturnType<typeof setInterval> | null = null;
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;

  /** Where a drag began, while one is in progress. */
  private swipeFrom: { x: number; y: number } | null = null;

  constructor() {
    afterNextRender(() => {
      this.painted.set(true);
      this.attachDeck();
    });

    // THE HANDOVER. This is the whole point of the effect: the branded intro curtain, the
    // first-visit greeting, the post-auth welcome overlay and this hero are four separate
    // animations that all want the first two seconds of the page. Played together they overlap
    // and ask the visitor to watch several things at once. So the hero goes last — it waits for
    // the intro to lift, for any greeting holding the stage, and for any celebration to leave.
    // Whoever is on screen owns the moment and hands it on when they are done.
    effect(() => {
      if (!this.painted()) return;

      if (WelcomeService.prefersReducedMotion()) {
        this.open.set(true);
        this.revealed.set(true);
        return;
      }

      const someoneElsesTurn =
        !this.welcome.introDone() || !!this.welcome.celebration() || this.welcome.stageHeld();

      if (someoneElsesTurn) {
        // An overlay reclaimed the moment before the doors got going — a celebration can arrive
        // a beat after the page renders, once the session resolves. Stand the countdown down
        // rather than letting it fire underneath the greeting.
        if (!this.open()) this.cancelTimers();
        return;
      }

      if (this.open() || this.timers.length) return;

      this.timers.push(setTimeout(() => this.open.set(true), HANDOVER_MS));
      this.timers.push(setTimeout(() => this.revealed.set(true), HANDOVER_MS + DOORS_MS));
    });

    // The carousel starts as soon as the doors are gone and keeps going unless the visitor is
    // holding it. A hero that advances behind a closed door has already spent a slide nobody saw.
    //
    // This deliberately does NOT depend on anything having rendered beyond that: the previous
    // version drove the carousel by scrolling a container, so it could only advance once a
    // viewChild had resolved and the element had a measurable width — and when that did not
    // line up, the hero simply sat on its first picture forever with nothing to indicate why.
    // Advancing is now a signal write, so the only things it can wait on are the ones named here.
    effect(() => {
      const shouldRun =
        this.revealed() &&
        this.slides().length > 1 &&
        !this.engaged() &&
        !WelcomeService.prefersReducedMotion();

      if (shouldRun) this.startAutoplay();
      else this.stopAutoplay();
    });

    // The owner publishing their own slides replaces the deck wholesale. Put it back to the
    // first picture rather than leaving an index into a set that no longer exists.
    effect(() => {
      const count = this.slides().length;
      if (this.activeIndex() >= count) this.activeIndex.set(0);
    });

    this.destroyRef.onDestroy(() => {
      this.cancelTimers();
      this.stopAutoplay();
      this.detachDeck();
      if (this.resumeTimer) clearTimeout(this.resumeTimer);
    });
  }

  // ----- Commands -----

  /**
   * Brings a slide to the top of the deck. The stylesheet does the rest: the outgoing picture
   * fades back and softens while the incoming one arrives, so the two are briefly in the same
   * space rather than one shoving the other aside.
   */
  goTo(index: number): void {
    const count = this.slides().length;
    if (count === 0) return;
    this.activeIndex.set(((index % count) + count) % count);
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

  /**
   * The pointer left, or focus did. That releases a hover hold — but never a deliberate one:
   * somebody who just tapped a dot and moved their mouse away has still chosen a slide, and the
   * resume timer, not the pointer, decides when the carousel may move again.
   */
  private readonly onDisengage = (): void => {
    if (this.resumeTimer) return;
    this.engaged.set(false);
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    this.swipeFrom = { x: event.clientX, y: event.clientY };
  };

  /**
   * A swipe is decided mid-gesture rather than on release, so the picture changes under the
   * finger that is asking for it.
   *
   * The vertical check is what keeps this from stealing the page's own scroll: a thumb dragging
   * up the page crosses the hero and would otherwise flick it. Only a movement that is more
   * across than down counts.
   */
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
    if (dx < 0) this.next();
    else this.previous();
  };

  private readonly onPointerUp = (): void => {
    this.swipeFrom = null;
  };

  /**
   * A carousel that keeps advancing in a background tab has spent every slide by the time anyone
   * looks at it — and on a phone it is burning battery to do it.
   */
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

  /**
   * Somebody moved the carousel themselves. Leave it alone for a good while — advancing a slide
   * out from under a visitor who has just chosen one is the single most irritating thing a
   * carousel can do.
   */
  private holdAutoplay(): void {
    this.engaged.set(true);
    if (this.resumeTimer) clearTimeout(this.resumeTimer);
    this.resumeTimer = setTimeout(() => {
      this.resumeTimer = null;
      this.engaged.set(false);
    }, RESUME_AFTER_INPUT_MS);
  }

  private cancelTimers(): void {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }
}
