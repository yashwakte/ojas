import { Injectable, computed, signal } from '@angular/core';

/**
 * Owns the "you are welcome here" moments: the branded intro curtain on site
 * load and the one-time first-visit greeting. Kept separate from AuthService
 * so auth stays about auth.
 *
 * Signing in used to be greeted with a full-screen celebration as well. The
 * owner asked for it to go (September 2026): someone who has just signed in
 * wants the page they were going to, not an overlay between them and it.
 */
@Injectable({ providedIn: 'root' })
export class WelcomeService {
  private readonly VISITED_KEY = 'ojas_visited';
  private readonly INTRO_KEY = 'ojas_intro_shown';

  /** Decided once at startup so the storage write doesn't change the answer mid-session. */
  readonly playIntro = this.decideIntro();

  private readonly _introDone = signal(!this.playIntro);
  private readonly _stageHolds = signal(0);

  readonly introDone = this._introDone.asReadonly();

  /**
   * True while some welcome moment owns the visitor's attention and nothing else should be
   * animating underneath it. Arrival can stack up to three of these — the branded intro curtain,
   * the first-visit greeting and the home page's own hero reveal — and played together they ask
   * the visitor to watch several things at once. A hold is claimed
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

  static prefersReducedMotion(): boolean {
    return (
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  private decideIntro(): boolean {
    if (typeof window === 'undefined' || WelcomeService.prefersReducedMotion()) return false;

    // Staff open the app to work, many times a day, and a customer coming back from paying is
    // waiting to hear whether it went through. Neither is a visit to be welcomed.
    const { pathname, search } = window.location;
    if (/^\/(admin|delivery|accept-invite)(\/|$)/.test(pathname)) return false;
    if (search.includes('cashfreeOrderId=')) return false;
    if (WelcomeService.signedInAsStaff()) return false;

    // Once per visit - the owner's call (September 2026): each time someone opens Ojas in a new
    // tab or comes back another day, but not again on every page or refresh while they shop.
    // Session storage is exactly that span: one tab, gone when it closes. It was once per
    // browser, ever, before; the owner wants the arrival to greet every visit.
    try {
      if (sessionStorage.getItem(this.INTRO_KEY)) return false;
      sessionStorage.setItem(this.INTRO_KEY, '1');
      return true;
    } catch {
      // Storage refused (a locked-down browser): skip it rather than replay it on every page.
      return false;
    }
  }

  /** Read from the cached sign-in, since this is decided before AuthService has settled. */
  private static signedInAsStaff(): boolean {
    try {
      const role = JSON.parse(localStorage.getItem('ojas_user') ?? 'null')?.role;
      return role === 'admin' || role === 'delivery';
    } catch {
      return false;
    }
  }
}
