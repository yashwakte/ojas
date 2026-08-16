import { Injectable, signal } from '@angular/core';

export type CelebrationKind = 'login' | 'register';

export interface Celebration {
  kind: CelebrationKind;
  /** First name only — the overlay addresses people personally, not formally. */
  name: string;
}

/**
 * Owns the "you are welcome here" moments: the branded intro curtain on site
 * load, the one-time first-visit greeting, and the post-auth celebration.
 * Kept separate from AuthService so auth stays about auth.
 */
@Injectable({ providedIn: 'root' })
export class WelcomeService {
  private readonly VISITED_KEY = 'ojas_visited';
  private readonly INTRO_KEY = 'ojas_intro_shown';

  /** Decided once at startup so the storage write doesn't change the answer mid-session. */
  readonly playIntro = this.decideIntro();

  private readonly _celebration = signal<Celebration | null>(null);
  private readonly _introDone = signal(!this.playIntro);

  readonly celebration = this._celebration.asReadonly();
  readonly introDone = this._introDone.asReadonly();

  completeIntro(): void {
    this._introDone.set(true);
  }

  isFirstVisit(): boolean {
    return !localStorage.getItem(this.VISITED_KEY);
  }

  markVisited(): void {
    localStorage.setItem(this.VISITED_KEY, '1');
  }

  celebrate(kind: CelebrationKind, fullName: string): void {
    const first = fullName?.trim().split(/\s+/)[0] ?? '';
    this._celebration.set({ kind, name: first });
  }

  dismissCelebration(): void {
    this._celebration.set(null);
  }

  static prefersReducedMotion(): boolean {
    return (
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  private decideIntro(): boolean {
    if (WelcomeService.prefersReducedMotion()) return false;
    // Once per browser session — a full curtain on every route change would grate.
    if (sessionStorage.getItem(this.INTRO_KEY)) return false;
    sessionStorage.setItem(this.INTRO_KEY, '1');
    return true;
  }
}
