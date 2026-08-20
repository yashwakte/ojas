import { Injectable, signal } from '@angular/core';

export interface ChatbotBubblePosition {
  /** Distance from the right/bottom viewport edges, in px - anchoring to edges (rather than
   * raw x/y from the top-left) keeps a dragged position sane if the viewport itself resizes
   * mid-session (e.g. rotating a phone), instead of the bubble ending up stranded off-screen. */
  right: number;
  bottom: number;
}

const REMOVED_KEY = 'ojas_chatbot_removed';

// Matches header.scss's .mobile-bottom-nav breakpoint - below this width there's a fixed,
// full-width bottom nav bar the bubble needs real clearance above; at or above it there's no
// nav to clear, so it can sit close to the corner.
const MOBILE_BREAKPOINT_PX = 900;

function defaultPosition(): ChatbotBubblePosition {
  const isMobile = typeof window !== 'undefined' && window.innerWidth <= MOBILE_BREAKPOINT_PX;
  return isMobile ? { right: 20, bottom: 180 } : { right: 20, bottom: 20 };
}

/**
 * Shared state for the single, app-wide chatbot widget instance (declared once in app.html) -
 * lets other entry points (the hamburger menu, a "need help?" link on My Orders) open the same
 * widget rather than each embedding their own copy.
 *
 * Only "removed" persists across page loads (via localStorage) - deliberately hiding the bubble
 * is a real choice worth remembering. Position is session-only: a drag lasts until the next full
 * page reload, then resets to the viewport-appropriate default, rather than a stale drag from a
 * different screen size (or an accidental one-off drag) sticking around forever.
 */
@Injectable({ providedIn: 'root' })
export class ChatbotUiService {
  private readonly _removed = signal(this.loadRemoved());
  private readonly _open = signal(false);
  private readonly _position = signal<ChatbotBubblePosition>(defaultPosition());

  readonly removed = this._removed.asReadonly();
  readonly open = this._open.asReadonly();
  readonly position = this._position.asReadonly();

  /** Un-hides the bubble if it had been removed, then opens the panel - the entry point every
   * "talk to support" link outside the bubble itself should call. */
  openChat(): void {
    if (this._removed()) this.setRemoved(false);
    this._open.set(true);
  }

  closeChat(): void {
    this._open.set(false);
  }

  remove(): void {
    this.setRemoved(true);
    this._open.set(false);
  }

  setPosition(position: ChatbotBubblePosition): void {
    this._position.set(position);
  }

  private setRemoved(removed: boolean): void {
    this._removed.set(removed);
    try {
      localStorage.setItem(REMOVED_KEY, removed ? '1' : '0');
    } catch {
      // Storage can be unavailable (private browsing, quota exceeded) - non-fatal, it just
      // won't be remembered next visit.
    }
  }

  private loadRemoved(): boolean {
    try {
      return localStorage.getItem(REMOVED_KEY) === '1';
    } catch {
      return false;
    }
  }
}
