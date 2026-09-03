import { Directive, ElementRef, OnDestroy, OnInit, inject, input, signal } from '@angular/core';

/**
 * Fades and lifts an element into place the first time it scrolls into view, and then leaves it
 * alone. Pair with the `.reveal`/`.reveal-visible` classes in the host component's stylesheet.
 *
 * It used to re-hide an element on the way out and replay the animation on every pass. That is
 * why the home page read as mostly empty: with nine sections on a phone, everything above and
 * below the current screenful was sitting at `opacity: 0`, so scrolling back up showed blank
 * bands where content had already been read, and a fast flick left the page looking unloaded.
 * Measured on a 390px viewport, seventeen elements were still invisible after scrolling the
 * whole page top to bottom.
 *
 * Revealing once is also the honest reading of what the effect is for: it is an entrance, and a
 * thing cannot enter twice. The observer disconnects as soon as it fires, so a long page stops
 * paying for observers it can never use again.
 */
@Directive({
  selector: '[appScrollReveal]',
  host: {
    class: 'reveal',
    '[class.reveal-visible]': 'visible()',
    '[style.transition-delay.ms]': 'appScrollReveal()',
  },
})
export class ScrollRevealDirective implements OnInit, OnDestroy {
  private readonly el = inject(ElementRef<HTMLElement>);
  private observer?: IntersectionObserver;

  // Optional stagger delay in ms, e.g. [appScrollReveal]="i * 60".
  readonly appScrollReveal = input(0);

  readonly visible = signal(false);

  ngOnInit(): void {
    if (typeof IntersectionObserver === 'undefined') {
      this.visible.set(true);
      return;
    }
    this.observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        this.visible.set(true);
        this.observer?.disconnect();
        this.observer = undefined;
      },
      // The negative bottom inset holds the reveal back until the element is properly on screen
      // rather than peeking over the fold. No top inset: an element scrolled to from a deep link
      // is already past the fold and must still be allowed to show itself.
      { threshold: 0.15, rootMargin: '0px 0px -60px 0px' },
    );
    this.observer.observe(this.el.nativeElement);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }
}
