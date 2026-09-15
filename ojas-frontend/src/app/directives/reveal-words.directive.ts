import {
  Directive,
  ElementRef,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { observeOnce } from '../utils/reveal-observer';

/**
 * A heading whose words rise into view one after another from behind a mask - the line reveal
 * the owner pointed at on zerotoone.ai, which that site does with GSAP's SplitText. This is the
 * same effect with a few spans and one CSS keyframe, because the storefront's initial bundle has
 * no room for a 70 kB animation library.
 *
 *   <h2 class="stitle" appRevealWords="Most Loved by Our *Customers*"></h2>
 *
 * The directive owns the element's content, so the text is handed to it rather than written
 * inside the tag. That is what lets it split the text again whenever it changes; a directive
 * that rewrote children Angular had put there would detach Angular's own binding and silently
 * stop updating. A word in *asterisks* gets the accent colour.
 *
 * The whole sentence is the heading's accessible name and the split pieces are hidden from
 * assistive technology, so a screen reader hears one heading, not a list of separate words.
 */
@Directive({
  selector: '[appRevealWords]',
  host: {
    class: 'rw-host',
    '[class.rw-in]': 'visible()',
    '[attr.aria-label]': 'plainText()',
    '[style.--rw-delay]': "revealDelay() + 'ms'",
  },
})
export class RevealWordsDirective implements OnInit, OnDestroy {
  readonly appRevealWords = input.required<string>();
  /** Delay in ms before the first word moves. */
  readonly revealDelay = input(0);

  readonly visible = signal(false);
  protected readonly plainText = computed(() => this.appRevealWords().replace(/\*/g, ''));

  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);
  private stopObserving?: () => void;

  constructor() {
    effect(() => this.render(this.appRevealWords()));
  }

  ngOnInit(): void {
    this.stopObserving = observeOnce(this.el.nativeElement, () => this.visible.set(true));
  }

  ngOnDestroy(): void {
    this.stopObserving?.();
  }

  private render(text: string): void {
    const host = this.el.nativeElement;
    host.replaceChildren();

    const words = text.trim().split(/\s+/).filter(Boolean);
    words.forEach((raw, index) => {
      // "*purity*?" is the accented word "purity" followed by its punctuation.
      const accent = /^\*(.+)\*(\W*)$/.exec(raw);

      const mask = document.createElement('span');
      mask.className = 'rw';
      mask.setAttribute('aria-hidden', 'true');

      const word = document.createElement('span');
      word.className = accent ? 'rw-i rw-accent' : 'rw-i';
      word.style.setProperty('--rw-i', String(index));
      word.textContent = accent ? accent[1] + accent[2] : raw;

      mask.appendChild(word);
      host.appendChild(mask);
      // Real spaces between the pieces, so the text still reads and wraps as a sentence.
      if (index < words.length - 1) host.appendChild(document.createTextNode(' '));
    });
  }
}
