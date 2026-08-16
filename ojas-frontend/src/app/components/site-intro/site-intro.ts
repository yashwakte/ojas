import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { WelcomeService } from '../../services/welcome.service';

/** Choreography timings (ms) — the curtain begins lifting at LIFT_AT. */
const LIFT_AT = 1450;
const LIFT_MS = 900;

@Component({
  selector: 'app-site-intro',
  templateUrl: './site-intro.html',
  styleUrl: './site-intro.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SiteIntro implements OnInit {
  private readonly welcome = inject(WelcomeService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly timers: ReturnType<typeof setTimeout>[] = [];

  protected readonly active = signal(false);
  protected readonly lifting = signal(false);
  protected readonly letters = ['O', 'j', 'a', 's'];

  constructor() {
    this.destroyRef.onDestroy(() => this.timers.forEach(clearTimeout));
  }

  ngOnInit(): void {
    if (!this.welcome.playIntro) return;

    this.active.set(true);
    document.body.classList.add('intro-locked');

    this.timers.push(setTimeout(() => this.lifting.set(true), LIFT_AT));
    this.timers.push(
      setTimeout(() => {
        this.active.set(false);
        document.body.classList.remove('intro-locked');
        this.welcome.completeIntro();
      }, LIFT_AT + LIFT_MS),
    );
  }
}
