import { Injectable } from '@angular/core';

/**
 * Stops the page scrolling behind a drawer, sheet or overlay.
 *
 * Counted rather than a plain on/off, because two of these can overlap for a moment - the menu
 * drawer closing as the search it opened comes up. With a simple toggle, whichever finished last
 * decided, and the page could be left locked with nothing on screen or unlocked under a sheet.
 *
 * The scrollbar's width is put back as padding while locked, so the page does not jump sideways
 * on a desktop when the bar disappears.
 */
@Injectable({ providedIn: 'root' })
export class ScrollLockService {
  private holds = 0;

  /** Locks, and returns the function that releases this hold. Releasing twice is harmless. */
  lock(): () => void {
    if (typeof document === 'undefined') return () => {};

    if (this.holds++ === 0) {
      const gap = window.innerWidth - document.documentElement.clientWidth;
      document.body.style.overflow = 'hidden';
      if (gap > 0) document.body.style.paddingRight = `${gap}px`;
    }

    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--this.holds === 0) {
        document.body.style.overflow = '';
        document.body.style.paddingRight = '';
      }
    };
  }
}
