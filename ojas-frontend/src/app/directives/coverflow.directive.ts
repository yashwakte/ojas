import { Directive, ElementRef, NgZone, OnDestroy, AfterViewInit, inject } from '@angular/core';

/**
 * Turns a horizontal-scroll row into a 3D "coverflow" stack: the card nearest the container's
 * centre sits square-on, while cards further away turn away from the viewer as if receding.
 * Recomputed on scroll/resize via rAF so it stays cheap, and applied as inline styles so it
 * always wins over the product card's own hover transform without a CSS specificity fight.
 *
 * Two rules keep it from turning a product row into a gimmick:
 *
 * A row that already fits gets NO coverflow at all. With three or four cards there is nothing
 * to scroll through, so rotating and shrinking the outer ones just makes two thirds of the
 * products look like damaged goods pushed to one side — every transform is cleared and the row
 * renders as a plain, even, centred set.
 *
 * And the effect is geometry only — never opacity, never saturation. Fading the neighbours dims
 * real products the shopper might want to buy, and a greyed-out card reads as unavailable rather
 * than as further away. Perspective alone carries the depth.
 */
@Directive({
  selector: '[appCoverflow]',
})
export class CoverflowDirective implements AfterViewInit, OnDestroy {
  private readonly el = inject(ElementRef<HTMLElement>);
  private readonly zone = inject(NgZone);
  private frame = 0;
  /** Whether the row is currently fanned, so transforms are cleared exactly once. */
  private fanned = false;
  private resizeObserver?: ResizeObserver;
  private readonly reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  private readonly onScroll = (): void => {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.update());
  };

  ngAfterViewInit(): void {
    if (this.reducedMotion) return;
    const host = this.el.nativeElement;
    this.zone.runOutsideAngular(() => {
      host.addEventListener('scroll', this.onScroll, { passive: true });
      this.resizeObserver = new ResizeObserver(this.onScroll);
      this.resizeObserver.observe(host);
      this.onScroll();
    });
  }

  ngOnDestroy(): void {
    this.el.nativeElement.removeEventListener('scroll', this.onScroll);
    this.resizeObserver?.disconnect();
    cancelAnimationFrame(this.frame);
  }

  private update(): void {
    const host = this.el.nativeElement;
    const hostRect = host.getBoundingClientRect();
    if (!hostRect.width) return;

    const children = Array.from(host.children) as HTMLElement[];

    // Nothing to scroll through means nothing to fan out. The few px of slack absorbs
    // sub-pixel rounding, which otherwise flips a row that visually fits into "scrollable".
    if (host.scrollWidth <= host.clientWidth + 4) {
      if (this.fanned) {
        for (const child of children) this.reset(child);
        this.fanned = false;
      }
      return;
    }
    this.fanned = true;

    const center = hostRect.left + hostRect.width / 2;

    for (const child of children) {
      const rect = child.getBoundingClientRect();
      const childCenter = rect.left + rect.width / 2;
      const delta = (childCenter - center) / (hostRect.width / 2);
      const clamped = Math.max(-1.5, Math.min(1.5, delta));
      const abs = Math.min(Math.abs(clamped), 1);

      child.style.transform = `perspective(1600px) rotateY(${(clamped * -14).toFixed(2)}deg) scale(${(1 - abs * 0.08).toFixed(3)}) translateZ(${(-abs * 40).toFixed(1)}px)`;
      child.style.zIndex = String(Math.round(30 - abs * 20));
    }
  }

  private reset(child: HTMLElement): void {
    child.style.transform = '';
    child.style.zIndex = '';
    // Cleared as well as unset: earlier builds of this directive dimmed and desaturated the
    // outer cards, and a stale inline opacity left behind on a row that no longer fans would
    // strand a product at half brightness with nothing to restore it.
    child.style.opacity = '';
    child.style.filter = '';
  }
}
