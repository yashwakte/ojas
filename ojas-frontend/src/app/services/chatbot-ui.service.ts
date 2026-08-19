import { Injectable, signal } from '@angular/core';

export interface ChatbotBubblePosition {
  /** Distance from the right/bottom viewport edges, in px - anchoring to edges (rather than
   * raw x/y from the top-left) keeps a dragged position sane after the viewport itself resizes
   * (e.g. rotating a phone), instead of the bubble ending up stranded off-screen. */
  right: number;
  bottom: number;
}

const REMOVED_KEY = 'ojas_chatbot_removed';
const POSITION_KEY = 'ojas_chatbot_position';
// Clear of the mobile bottom nav by default, with visible breathing room above it - a user can
// always drag it wherever they actually want, this just governs where it starts out.
const DEFAULT_POSITION: ChatbotBubblePosition = { right: 20, bottom: 180 };

/**
 * Shared state for the single, app-wide chatbot widget instance (declared once in app.html) -
 * lets other entry points (the hamburger menu, a "need help?" link on My Orders) open the same
 * widget rather than each embedding their own copy. Position and the "removed" flag persist
 * across page loads via localStorage; the open/closed state deliberately does not, so the panel
 * doesn't reappear unexpectedly on a fresh visit.
 */
@Injectable({ providedIn: 'root' })
export class ChatbotUiService {
  private readonly _removed = signal(this.loadRemoved());
  private readonly _open = signal(false);
  private readonly _position = signal<ChatbotBubblePosition>(this.loadPosition());

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
    this.trySet(POSITION_KEY, JSON.stringify(position));
  }

  private setRemoved(removed: boolean): void {
    this._removed.set(removed);
    this.trySet(REMOVED_KEY, removed ? '1' : '0');
  }

  private loadRemoved(): boolean {
    try {
      return localStorage.getItem(REMOVED_KEY) === '1';
    } catch {
      return false;
    }
  }

  private loadPosition(): ChatbotBubblePosition {
    try {
      const raw = localStorage.getItem(POSITION_KEY);
      if (!raw) return DEFAULT_POSITION;
      const parsed = JSON.parse(raw);
      if (typeof parsed?.right === 'number' && typeof parsed?.bottom === 'number') return parsed;
    } catch {
      // Corrupt/unavailable storage - fall through to the default rather than throwing.
    }
    return DEFAULT_POSITION;
  }

  // Storage can be unavailable (private browsing, quota exceeded) - persistence failing silently
  // just means the position/removed state resets next visit, never something to crash over.
  private trySet(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* non-fatal */
    }
  }
}
