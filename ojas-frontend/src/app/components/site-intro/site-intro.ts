import { ChangeDetectionStrategy, Component, DestroyRef, afterNextRender, inject } from '@angular/core';
import { NavigationCancel, NavigationEnd, NavigationError, Router } from '@angular/router';
import { filter, take } from 'rxjs';
import { WelcomeService } from '../../services/welcome.service';

/** How long after the address was opened the mark may leave, on the first page of a visit - long
 * enough to see it at full strength and the line drawing, not just catch it on its way in.
 * Usually the page itself takes longer, and that wins. */
const MIN_HOLD_MS = 1300;
/** The line finishing its draw, before the mark moves. */
const LINE_FINISH_MS = 220;
/** The mark's glide up into the header logo. */
const GLIDE_MS = 680;
/** The dark ground dissolving: starts just after the glide, done as the mark lands. */
const GROUND_DELAY_MS = 90;
const GROUND_MS = 560;
/** The header's own logo taking over from the mark; and the plain fade on any other load. */
const HANDOFF_MS = 180;
const QUICK_FADE_MS = 260;

/** Where the orange oval sits in logo.png (330 x 210), measured from its pixels: its box starts at
 * (56, 50) and is 217px wide. The arrival shows that oval alone (index.html), so it lands on the
 * oval inside the header's logo rather than on the whole image. */
const OVAL_LEFT = 56 / 330;
const OVAL_TOP = 50 / 210;
const OVAL_WIDTH = 217 / 330;

/** Slow out of rest, slow into place - the same curve as cubic-bezier(0.65, 0, 0.35, 1), close
 * enough, as a function so the glide can be driven frame by frame. */
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * Ends the arrival.
 *
 * The arrival itself is drawn by index.html (#ojas-arrival) - a dark ground, the Ojas mark and a
 * single line drawing out - so it is on screen before any of the app has downloaded. This takes
 * that same screen over once the first page has actually been drawn underneath it, so the dark
 * never dissolves onto a half-built page:
 *
 * - On the first page of a visit (WelcomeService.playIntro): the line completes, the mark glides
 *   up and shrinks into the header logo's exact place while the dark dissolves, and the header's
 *   own logo takes over as it lands. Then the hero makes its entrance.
 * - On any other load - a refresh, staff screens, the way back from paying: it just fades.
 *
 * This replaced a separate intro drawn on top of index.html's old splash, which made a visitor
 * sit through two welcome screens in a row. A tap or any key cuts the hold short.
 */
@Component({
  selector: 'app-site-intro',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown)': 'skip()',
    '(document:pointerdown)': 'skip()',
  },
})
export class SiteIntro {
  private readonly welcome = inject(WelcomeService);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private frame = 0;
  private screen: HTMLElement | null = null;
  private leaving = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      if (this.timer) clearTimeout(this.timer);
      cancelAnimationFrame(this.frame);
    });

    // Both the app shell and the first route have to be on screen: the shell for the header logo
    // the mark lands on, the route so the page being uncovered is really there. A route that
    // failed counts too - the recovery message is what the customer then needs to see.
    let shellDrawn = false;
    let routeDrawn = false;
    const whenBoth = () => {
      if (shellDrawn && routeDrawn) this.begin();
    };
    afterNextRender(() => {
      shellDrawn = true;
      whenBoth();
    });
    inject(Router)
      .events.pipe(
        filter((e) => e instanceof NavigationEnd || e instanceof NavigationCancel || e instanceof NavigationError),
        take(1),
      )
      .subscribe(() =>
        // A frame later, so the route's own first render is painted underneath.
        requestAnimationFrame(() => {
          routeDrawn = true;
          whenBoth();
        }),
      );
  }

  /** Public for the host listeners. Only does anything while the mark is holding. */
  skip(): void {
    if (!this.screen || this.leaving || !this.welcome.playIntro) return;
    if (this.timer) clearTimeout(this.timer);
    this.leave();
  }

  private begin(): void {
    const screen = document.getElementById('ojas-arrival');
    if (!screen) {
      // A page without the screen (an old cached copy of index.html, a test): nothing to end.
      this.welcome.completeIntro();
      return;
    }
    this.screen = screen;

    if (!this.welcome.playIntro) {
      this.fadeAway(screen);
      return;
    }

    document.body.classList.add('intro-locked');
    this.timer = setTimeout(() => this.leave(), Math.max(0, MIN_HOLD_MS - performance.now()));
  }

  private fadeAway(screen: HTMLElement): void {
    this.leaving = true;
    screen.style.pointerEvents = 'none';
    screen
      .animate([{ opacity: 1 }, { opacity: 0 }], { duration: QUICK_FADE_MS, easing: 'ease', fill: 'forwards' })
      .finished.finally(() => screen.remove());
  }

  private leave(): void {
    const screen = this.screen;
    if (!screen) return;
    this.leaving = true;
    this.timer = null;
    screen.style.pointerEvents = 'none';

    const mark = screen.querySelector<HTMLElement>('.arrival-mark');
    const line = screen.querySelector<HTMLElement>('.arrival-line');
    const ground = screen.querySelector<HTMLElement>('.arrival-ground');
    const logo = document.querySelector<HTMLElement>('app-header .logo-img');

    // The line finishes its draw, then dims.
    line?.animate(
      [
        { transform: getComputedStyle(line).transform, opacity: 1 },
        { transform: 'scaleX(1)', opacity: 1, offset: 0.55 },
        { transform: 'scaleX(1)', opacity: 0 },
      ],
      { duration: LINE_FINISH_MS * 2, easing: 'ease-out', fill: 'forwards' },
    );

    this.timer = setTimeout(() => {
      this.timer = null;
      const from = mark?.getBoundingClientRect();
      const canLand = !!(mark && from && from.width > 0 && logo && logo.getBoundingClientRect().width > 0);

      ground?.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: GROUND_MS,
        delay: GROUND_DELAY_MS,
        easing: 'ease-in-out',
        fill: 'forwards',
      });

      // The page is being uncovered from here, so it is the hero's turn.
      document.body.classList.remove('intro-locked');
      this.welcome.completeIntro();

      if (!canLand) {
        mark?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: GLIDE_MS / 2, fill: 'forwards' });
        this.timer = setTimeout(() => screen.remove(), GLIDE_MS);
        return;
      }

      // Two logos must never be on screen at once: the header's waits until the mark lands.
      logo!.style.opacity = '0';
      const start = performance.now();
      const step = (now: number) => {
        const k = Math.min(1, (now - start) / GLIDE_MS);
        const e = easeInOutCubic(k);
        // The header logo is re-read every frame rather than once at the start. The page is still
        // settling under the dissolving screen - scrolling unlocks, fonts arrive - and a target
        // measured once was 12px off on a phone by the time the mark got there.
        const box = logo!.getBoundingClientRect();
        const dx = box.left + box.width * OVAL_LEFT - from!.left;
        const dy = box.top + box.height * OVAL_TOP - from!.top;
        const scale = (box.width * OVAL_WIDTH) / from!.width;
        mark!.style.transform = `translate(${dx * e}px, ${dy * e}px) scale(${1 + (scale - 1) * e})`;
        if (k < 1) {
          this.frame = requestAnimationFrame(step);
        } else {
          this.handOff(screen, mark!, logo!);
        }
      };
      this.frame = requestAnimationFrame(step);
    }, LINE_FINISH_MS);
  }

  /** The mark has landed: the header's own logo takes over and the screen goes. */
  private handOff(screen: HTMLElement, mark: HTMLElement, logo: HTMLElement): void {
    logo
      .animate([{ opacity: 0 }, { opacity: 1 }], { duration: HANDOFF_MS, easing: 'ease-out' })
      .finished.finally(() => (logo.style.opacity = ''));
    mark
      .animate([{ opacity: 1 }, { opacity: 0 }], { duration: HANDOFF_MS, fill: 'forwards' })
      .finished.finally(() => screen.remove());
  }
}
