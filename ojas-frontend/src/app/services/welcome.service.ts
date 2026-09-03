import { Injectable, computed, signal } from '@angular/core';

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
  private readonly _stageHolds = signal(0);

  readonly celebration = this._celebration.asReadonly();
  readonly introDone = this._introDone.asReadonly();

  /**
   * True while some welcome moment owns the visitor's attention and nothing else should be
   * animating underneath it. Arrival can stack up to four of these — the branded intro curtain,
   * the first-visit greeting, the post-auth celebration and the home page's own hero reveal —
   * and played together they ask the visitor to watch several things at once. A hold is claimed
   * the moment a component *decides* it will greet, not when it finally appears, because the
   * gap between those two is exactly long enough for something else to start in.
   */
  readonly stageHeld = computed(() => this._stageHolds() > 0);

  /** Counted rather than boolean so two holders releasing independently cannot clear each other. */
  holdStage(): void {
    this._stageHolds.update((n) => n + 1);
  }

  releaseStage(): void {
    this._stageHolds.update((n) => Math.max(0, n - 1));
  }

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
    // Every sign-in gets the moment, by the owner's decision. This used to play only once per
    // browser tab, which made it look broken rather than restrained: signing out and back in - or
    // simply returning to a tab left open - showed nothing at all, so whether a customer saw it
    // came down to how they happened to be using their browser. An acknowledgement that appears
    // unpredictably is worse than one that always appears.
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

    // Once per browser, not once per browser *session*. Session storage is per-tab and is thrown
    // away the moment the tab closes, so the curtain came back for anyone who opens the shop in a
    // new tab, or comes back later in the day — which is most people, and it reads as the site
    // replaying its own introduction at someone who has already been introduced.
    if (localStorage.getItem(this.INTRO_KEY)) return false;
    localStorage.setItem(this.INTRO_KEY, '1');
    return true;
  }
}
