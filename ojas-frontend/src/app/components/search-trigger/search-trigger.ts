import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
  signal,
} from '@angular/core';
import { SearchUiService } from '../../services/search-ui.service';

const INTRO_KEY = 'ojas_search_intro';
/** How long after the page settles the one-time cue plays, and how long it lasts. */
const INTRO_DELAY_MS = 900;
const INTRO_MS = 2200;

/**
 * The search button in the header - a drawn lens rather than a stock icon.
 *
 * Once per visit, a beat after the page settles, the lens draws itself and sends out a single
 * ring, so a customer notices there is search without anything moving for the rest of the visit.
 * On hover the lens tips and lights up; on press it gives. And it hands the overlay its own
 * position, so the search opens out of the icon itself and fills the screen from there.
 */
@Component({
  selector: 'app-search-trigger',
  templateUrl: './search-trigger.html',
  styleUrl: './search-trigger.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.st--intro]': 'intro()' },
})
export class SearchTrigger {
  private readonly search = inject(SearchUiService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly intro = signal(false);

  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor() {
    afterNextRender(() => {
      // The header has one of these for phones and one for desktops, and only one is ever
      // displayed. The hidden one must not claim the once-per-visit cue.
      if (!this.host.nativeElement.offsetParent) return;
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
      try {
        if (sessionStorage.getItem(INTRO_KEY)) return;
        sessionStorage.setItem(INTRO_KEY, '1');
      } catch {
        return;
      }
      this.timers.push(setTimeout(() => this.intro.set(true), INTRO_DELAY_MS));
      this.timers.push(setTimeout(() => this.intro.set(false), INTRO_DELAY_MS + INTRO_MS));
    });
    inject(DestroyRef).onDestroy(() => this.timers.forEach(clearTimeout));
  }

  open(): void {
    const r = this.host.nativeElement.getBoundingClientRect();
    this.search.open('', { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
  }
}
