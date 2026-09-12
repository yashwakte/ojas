import { Directive, ElementRef, NgZone, effect, inject, input, untracked } from '@angular/core';

/**
 * Counts a number up to its value, once it is allowed to.
 *
 *   <b [appCountUp]="productCount()" [countUpActive]="revealed()"></b>
 *
 * The text is written straight to the element from an animation frame, outside Angular, so a
 * second and a half of counting costs no change detection. Before it is active the element shows
 * 0; under reduced motion it shows the real figure at once. If the value changes later - the
 * owner lists another product while the page is open - it counts on from where it is.
 */
@Directive({ selector: '[appCountUp]' })
export class CountUpDirective {
  readonly appCountUp = input.required<number>();
  readonly countUpActive = input(true);
  readonly countUpDuration = input(1300);
  /** Written after the number, e.g. "+" for "30+". */
  readonly countUpSuffix = input('');

  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly zone = inject(NgZone);

  private shown: number | null = null;
  private frame = 0;

  private readonly reducedMotion =
    typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  constructor() {
    effect((onCleanup) => {
      const target = this.appCountUp();
      const active = this.countUpActive();

      untracked(() => {
        if (!active) {
          if (this.shown === null) this.write(0);
          return;
        }
        if (this.reducedMotion || typeof requestAnimationFrame === 'undefined') {
          this.write(target);
          return;
        }
        this.animate(this.shown ?? 0, target);
      });

      onCleanup(() => cancelAnimationFrame(this.frame));
    });
  }

  private animate(from: number, to: number): void {
    if (from === to) {
      this.write(to);
      return;
    }
    const duration = this.countUpDuration();
    this.zone.runOutsideAngular(() => {
      let start: number | null = null;
      const tick = (now: number) => {
        start ??= now;
        const k = Math.min(1, (now - start) / duration);
        // Ease out: it races at first and settles onto the figure, which is what makes the last
        // number land rather than just stop.
        const eased = 1 - Math.pow(1 - k, 3);
        this.write(Math.round(from + (to - from) * eased));
        if (k < 1) this.frame = requestAnimationFrame(tick);
      };
      this.frame = requestAnimationFrame(tick);
    });
  }

  private write(value: number): void {
    this.shown = value;
    this.el.nativeElement.textContent = `${value}${untracked(this.countUpSuffix)}`;
  }
}
