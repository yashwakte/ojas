import { AfterViewInit, Directive, ElementRef, NgZone, OnDestroy, inject } from '@angular/core';

/**
 * Feeds the hero's stylesheet three numbers and nothing else:
 *
 *   --hero-p   0 → 1 as the hero scrolls up out of the viewport
 *   --hero-mx  -1 → 1, the pointer's distance from the stage centre, horizontally
 *   --hero-my  -1 → 1, the same vertically
 *
 * Every visual decision — how far the artwork drifts, how much the light shifts, how
 * fast the copy fades — stays in SCSS where it can be tuned by eye. Keeping the maths
 * here and the taste there is also what lets the whole effect be switched off for
 * reduced motion with one media query rather than a branch in this file.
 *
 * Listeners are bound outside Angular and coalesced into a single rAF, so a fast
 * scroll costs one style write per frame rather than one per event, and no change
 * detection at all. The pointer eases toward its target instead of tracking it
 * exactly: light that snaps to the cursor reads as a gimmick, light that lags a
 * frame or two behind reads as a room the page is sitting in.
 */
@Directive({
  selector: '[appHeroParallax]',
})
export class HeroParallaxDirective implements AfterViewInit, OnDestroy {
  private readonly el = inject(ElementRef<HTMLElement>);
  private readonly zone = inject(NgZone);

  private frame = 0;
  private settled = true;

  /** Where the pointer is, and where the rendered light has eased to so far. */
  private targetX = 0;
  private targetY = 0;
  private currentX = 0;
  private currentY = 0;

  private readonly reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  private readonly onScroll = (): void => this.schedule();

  private readonly onPointerMove = (event: PointerEvent): void => {
    // Touch already moves the page; tilting the art under a finger that is trying to
    // scroll fights the gesture rather than decorating it.
    if (event.pointerType !== 'mouse') return;
    const rect = this.el.nativeElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.targetX = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
    this.targetY = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
    this.schedule();
  };

  private readonly onPointerLeave = (): void => {
    this.targetX = 0;
    this.targetY = 0;
    this.schedule();
  };

  ngAfterViewInit(): void {
    if (this.reducedMotion) return;
    const host = this.el.nativeElement;

    this.zone.runOutsideAngular(() => {
      window.addEventListener('scroll', this.onScroll, { passive: true });
      window.addEventListener('resize', this.onScroll, { passive: true });
      host.addEventListener('pointermove', this.onPointerMove, { passive: true });
      host.addEventListener('pointerleave', this.onPointerLeave, { passive: true });
      this.schedule();
    });
  }

  ngOnDestroy(): void {
    const host = this.el.nativeElement;
    window.removeEventListener('scroll', this.onScroll);
    window.removeEventListener('resize', this.onScroll);
    host.removeEventListener('pointermove', this.onPointerMove);
    host.removeEventListener('pointerleave', this.onPointerLeave);
    cancelAnimationFrame(this.frame);
  }

  private schedule(): void {
    if (!this.settled) return;
    this.settled = false;
    this.frame = requestAnimationFrame(() => this.update());
  }

  private update(): void {
    const host = this.el.nativeElement;
    const rect = host.getBoundingClientRect();
    const height = rect.height || 1;

    // How far the hero has travelled up past the top of the viewport, as a fraction of
    // its own height. Reading the rect rather than scrollY means this stays correct no
    // matter what sits above the hero — a promo strip, a taller header, nothing at all.
    const progress = Math.min(1, Math.max(0, -rect.top / height));

    this.currentX += (this.targetX - this.currentX) * 0.09;
    this.currentY += (this.targetY - this.currentY) * 0.09;

    host.style.setProperty('--hero-p', progress.toFixed(4));
    host.style.setProperty('--hero-mx', this.currentX.toFixed(4));
    host.style.setProperty('--hero-my', this.currentY.toFixed(4));

    this.settled = true;

    // Keep driving frames only while the eased light is still catching up. Once it has
    // arrived the loop stops dead and the next scroll or move restarts it.
    const drift = Math.abs(this.targetX - this.currentX) + Math.abs(this.targetY - this.currentY);
    if (drift > 0.001) this.schedule();
  }
}
