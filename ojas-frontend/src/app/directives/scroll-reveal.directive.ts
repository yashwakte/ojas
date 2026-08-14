import { Directive, ElementRef, OnDestroy, OnInit, inject, input, signal } from '@angular/core';

/**
 * Fades/slides an element in whenever it scrolls into view, and back out
 * when it leaves — a lightweight version of the reveal-on-scroll effect
 * used on Zomato/Swiggy-style pages. Replays every pass (scrolling down,
 * back up, and down again), unlike a one-shot "reveal once" observer. Pair
 * with the `.reveal`/`.reveal-visible` classes defined in the host
 * component's stylesheet.
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
        for (const entry of entries) {
          this.visible.set(entry.isIntersecting);
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -60px 0px' },
    );
    this.observer.observe(this.el.nativeElement);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }
}
