import { Directive, ElementRef, OnDestroy, OnInit, computed, inject, input, signal } from '@angular/core';
import { observeOnce } from '../utils/reveal-observer';

/**
 * How an element makes its entrance. The motion itself lives in the global stylesheet (see
 * "ENTRANCE MOTION" in styles.scss); this only says which one.
 *
 * - `up`: rises and fades in. The default, for text and buttons.
 * - `fade`: fades only, for small print that should not travel.
 * - `blur`: sharpens out of a blur as it rises, for display type.
 * - `panel`: a coloured section settling into place, slightly scaled.
 * - `pill`: a tag chip popping in.
 * - `children`: the element stays put and its children rise one after another - a card grid.
 * - `row`: the same, sliding in from the right - a horizontal carousel.
 * - `window`: a picture opening like a window and settling from a slight zoom - a campaign banner.
 */
export type RevealVariant = 'up' | 'fade' | 'blur' | 'panel' | 'pill' | 'children' | 'row' | 'window';

/**
 * Plays an element's entrance the first time it scrolls into view, and then leaves it alone.
 *
 *   <p [appScrollReveal]="120">…</p>                          rises in, 120ms late
 *   <div appScrollReveal revealVariant="row">…cards…</div>    cards slide in one by one
 *
 * It used to re-hide an element on the way out and replay the animation on every pass. That is
 * why the home page read as mostly empty: with nine sections on a phone, everything above and
 * below the current screenful was sitting at `opacity: 0`, so scrolling back up showed blank
 * bands where content had already been read, and a fast flick left the page looking unloaded.
 * Revealing once is also the honest reading of what the effect is for: it is an entrance, and a
 * thing cannot enter twice.
 */
@Directive({
  selector: '[appScrollReveal]',
  exportAs: 'appScrollReveal',
  host: {
    class: 'reveal',
    '[class.reveal-group]': 'isGroup()',
    '[class.reveal-visible]': 'visible()',
    '[attr.data-reveal]': 'revealVariant()',
    '[style.--reveal-delay]': "appScrollReveal() + 'ms'",
  },
})
export class ScrollRevealDirective implements OnInit, OnDestroy {
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);
  private stopObserving?: () => void;

  /** Delay in ms before the entrance starts, e.g. [appScrollReveal]="120". A bare attribute is 0. */
  readonly appScrollReveal = input(0, { transform: (value: unknown) => Number(value) || 0 });
  readonly revealVariant = input<RevealVariant>('up');

  readonly visible = signal(false);
  protected readonly isGroup = computed(() => {
    const variant = this.revealVariant();
    return variant === 'children' || variant === 'row';
  });

  ngOnInit(): void {
    this.stopObserving = observeOnce(this.el.nativeElement, () => {
      if (this.isGroup()) this.numberChildren();
      this.visible.set(true);
    });
  }

  ngOnDestroy(): void {
    this.stopObserving?.();
  }

  /** Each child's place in the stagger, counted at the moment of the reveal so a row whose
   * products arrived after the page was built still goes in order. Capped, so the tenth card of
   * a long row does not keep a customer waiting for it. */
  private numberChildren(): void {
    Array.from(this.el.nativeElement.children).forEach((child, index) =>
      (child as HTMLElement).style.setProperty('--reveal-i', String(Math.min(index, 7))),
    );
  }
}
