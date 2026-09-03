import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  afterNextRender,
  effect,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { HeroParallaxDirective } from '../../directives/hero-parallax.directive';
import { WelcomeService } from '../../services/welcome.service';

/**
 * The beat between the last overlay leaving and the doors starting to swing. Without it the two
 * moments butt up against each other and read as one confused animation; with it the page
 * visibly hands over from the greeting to the hero.
 */
const HANDOVER_MS = 320;

/** How long the doors take to clear the stage, before the copy over them is allowed in. */
const DOORS_MS = 1500;

@Component({
  selector: 'app-home-hero',
  imports: [RouterLink, MatIconModule, HeroParallaxDirective],
  templateUrl: './home-hero.html',
  styleUrl: './home-hero.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeHero {
  private readonly welcome = inject(WelcomeService);
  private readonly destroyRef = inject(DestroyRef);

  /**
   * The doors swing apart. Starts closed on both server and client render so there is no
   * SSR/hydration mismatch.
   */
  readonly open = signal(false);

  /**
   * The copy over the artwork — CTAs, trust marks, scroll cue — only appears once the doors have
   * cleared. Revealing it underneath them means it animates where nobody can see it.
   */
  readonly revealed = signal(false);

  /** True once the browser has painted; nothing may animate before this. */
  private readonly painted = signal(false);
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor() {
    afterNextRender(() => this.painted.set(true));

    // THE HANDOVER. This is the whole point of the effect: the branded intro curtain, the
    // first-visit greeting, the post-auth welcome overlay and this hero are four separate
    // animations that all want the first two seconds of the page. Played together they overlap
    // and ask the visitor to watch several things at once. So the hero goes last — it waits for
    // the intro to lift, for any greeting holding the stage, and for any celebration to leave.
    // Whoever is on screen owns the moment and hands it on when they are done.
    effect(() => {
      if (!this.painted()) return;

      if (WelcomeService.prefersReducedMotion()) {
        this.open.set(true);
        this.revealed.set(true);
        return;
      }

      const someoneElsesTurn =
        !this.welcome.introDone() || !!this.welcome.celebration() || this.welcome.stageHeld();

      if (someoneElsesTurn) {
        // An overlay reclaimed the moment before the doors got going — a celebration can arrive
        // a beat after the page renders, once the session resolves. Stand the countdown down
        // rather than letting it fire underneath the greeting.
        if (!this.open()) this.cancelTimers();
        return;
      }

      if (this.open() || this.timers.length) return;

      this.timers.push(setTimeout(() => this.open.set(true), HANDOVER_MS));
      this.timers.push(setTimeout(() => this.revealed.set(true), HANDOVER_MS + DOORS_MS));
    });

    this.destroyRef.onDestroy(() => this.cancelTimers());
  }

  private cancelTimers(): void {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }
}
