import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { WelcomeService } from '../../services/welcome.service';

/** Let the page settle (and the intro curtain clear) before greeting anyone. */
const REVEAL_DELAY_MS = 700;
const CLOSE_MS = 420;

@Component({
  selector: 'app-guest-welcome',
  imports: [RouterLink],
  templateUrl: './guest-welcome.html',
  styleUrl: './guest-welcome.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GuestWelcome {
  private readonly auth = inject(AuthService);
  private readonly welcome = inject(WelcomeService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialogRef = viewChild<ElementRef<HTMLDialogElement>>('welcomeDialog');

  private readonly timers: ReturnType<typeof setTimeout>[] = [];
  private scheduled = false;
  private holding = false;

  protected readonly open = signal(false);
  protected readonly closing = signal(false);

  constructor() {
    effect(() => {
      // Waits on the intro so a first-time visitor gets one moment, then the next.
      if (!this.welcome.introDone() || this.scheduled) return;
      if (!this.shouldGreet()) return;

      this.scheduled = true;
      // Claimed here rather than in reveal(): between deciding to greet and actually appearing
      // there is most of a second, and that is precisely long enough for the home page's hero
      // to start its own entrance underneath the dialog that is about to cover it.
      this.holding = true;
      this.welcome.holdStage();
      this.timers.push(setTimeout(() => this.reveal(), REVEAL_DELAY_MS));
    });

    this.destroyRef.onDestroy(() => {
      this.timers.forEach(clearTimeout);
      if (this.holding) this.welcome.releaseStage();
    });
  }

  protected close(): void {
    if (this.closing()) return;
    this.closing.set(true);
    this.timers.push(
      setTimeout(() => {
        this.dialogRef()?.nativeElement.close();
        this.open.set(false);
        this.closing.set(false);
        this.release();
      }, CLOSE_MS),
    );
  }

  /** Idempotent — the greeting can be stood down before it ever opens. */
  private release(): void {
    if (!this.holding) return;
    this.holding = false;
    this.welcome.releaseStage();
  }

  protected onBackdropClick(event: MouseEvent): void {
    if (event.target === this.dialogRef()?.nativeElement) {
      this.close();
    }
  }

  /** Escape fires the dialog's own cancel — animate out instead of snapping shut. */
  protected onCancel(event: Event): void {
    event.preventDefault();
    this.close();
  }

  private shouldGreet(): boolean {
    if (this.auth.isLoggedIn()) return false;
    if (!this.welcome.isFirstVisit()) return false;
    const url = this.router.url;
    return !url.startsWith('/login') && !url.startsWith('/register');
  }

  private reveal(): void {
    // Checked again here, not just when this was scheduled, because `router.url` is not
    // reactive and the answer can have changed in between: the effect above runs on the auth
    // signal, which flips during a sign-out while the navigation to /login is still pending, so
    // the URL it read was the page being left. Without this, a modal dialog opens on top of the
    // sign-in form and silently swallows every click on it.
    if (!this.shouldGreet()) {
      this.release();
      return;
    }

    this.welcome.markVisited();
    this.open.set(true);
    // The dialog element only exists once `open` flips, so show it next tick.
    this.timers.push(setTimeout(() => this.dialogRef()?.nativeElement.showModal(), 0));
  }
}
