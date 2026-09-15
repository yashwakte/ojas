import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { AuthService } from './auth.service';

export interface ChatbotBubblePosition {
  /** Distance from the right/bottom viewport edges, in px - anchoring to edges (rather than
   * raw x/y from the top-left) keeps a dragged position sane if the viewport itself resizes
   * mid-session (e.g. rotating a phone), instead of the bubble ending up stranded off-screen. */
  right: number;
  bottom: number;
}

/** Where removing the bubble used to be remembered. Only ever read now to delete it. */
const LEGACY_REMOVED_KEY = 'ojas_chatbot_removed';

// Matches header.scss's .mobile-bottom-nav breakpoint - below this width there's a fixed,
// full-width bottom nav bar. The mobile default below is the user's own dragged position,
// read directly from DevTools and pinned as the starting point rather than estimated from a
// screenshot; at or above this width there's no nav, so it can sit close to the corner instead.
const MOBILE_BREAKPOINT_PX = 900;

function defaultPosition(): ChatbotBubblePosition {
  const isMobile = typeof window !== 'undefined' && window.innerWidth <= MOBILE_BREAKPOINT_PX;
  return isMobile ? { right: 8, bottom: 70 } : { right: 20, bottom: 20 };
}

/**
 * Shared state for the single, app-wide chatbot widget instance (declared once in app.html) -
 * lets other entry points (the hamburger menu, a "need help?" link on My Orders) open the same
 * widget rather than each embedding their own copy.
 *
 * Nothing here outlives the page. Dragging the bubble onto the cross hides it until the next page
 * load, or until someone signs in or out, and then it is back. It used to be remembered in
 * localStorage, which turned one flick of a thumb into the chat disappearing for good: on a phone
 * it is easy to do by accident while scrolling, the bubble is the way to reach support from most
 * screens, and there was no way to bring it back short of clearing site data. Position is
 * page-only for a similar reason - a drag lasts until the next reload, then resets to the
 * viewport-appropriate default, rather than a stale drag from a different screen size sticking
 * around forever.
 */
@Injectable({ providedIn: 'root' })
export class ChatbotUiService {
  private readonly auth = inject(AuthService);
  private readonly _removed = signal(false);
  private readonly _open = signal(false);
  private readonly _position = signal<ChatbotBubblePosition>(defaultPosition());

  readonly removed = this._removed.asReadonly();
  readonly open = this._open.asReadonly();
  readonly position = this._position.asReadonly();

  constructor() {
    // Retire the flag the old behaviour left behind. Without this, a phone that removed the
    // bubble before this change would carry the key forever, doing nothing.
    try {
      localStorage.removeItem(LEGACY_REMOVED_KEY);
    } catch {
      // Storage unavailable (private browsing) - then there is nothing stored to retire either.
    }

    // Signing in or out brings the bubble back too. It may be a different person at the device
    // now, and "I can't find the chat since I logged in" is exactly the complaint this avoids.
    let lastUserId: string | null | undefined;
    effect(() => {
      const userId = this.auth.user()?.id ?? null;
      if (lastUserId !== undefined && userId !== lastUserId) {
        untracked(() => this._removed.set(false));
      }
      lastUserId = userId;
    });
  }

  /** Un-hides the bubble if it had been removed, then opens the panel - the entry point every
   * "talk to support" link outside the bubble itself should call. */
  openChat(): void {
    this._removed.set(false);
    this._open.set(true);
  }

  closeChat(): void {
    this._open.set(false);
  }

  remove(): void {
    this._removed.set(true);
    this._open.set(false);
  }

  setPosition(position: ChatbotBubblePosition): void {
    this._position.set(position);
  }
}
