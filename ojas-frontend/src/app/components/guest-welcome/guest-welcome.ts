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

  protected readonly open = signal(false);
  protected readonly closing = signal(false);

  constructor() {
    effect(() => {
      // Waits on the intro so a first-time visitor gets one moment, then the next.
      if (!this.welcome.introDone() || this.scheduled) return;
      if (!this.shouldGreet()) return;

      this.scheduled = true;
      this.welcome.markVisited();
      this.timers.push(setTimeout(() => this.reveal(), REVEAL_DELAY_MS));
    });

    this.destroyRef.onDestroy(() => this.timers.forEach(clearTimeout));
  }

  protected close(): void {
    if (this.closing()) return;
    this.closing.set(true);
    this.timers.push(
      setTimeout(() => {
        this.dialogRef()?.nativeElement.close();
        this.open.set(false);
        this.closing.set(false);
      }, CLOSE_MS),
    );
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
    this.open.set(true);
    // The dialog element only exists once `open` flips, so show it next tick.
    this.timers.push(setTimeout(() => this.dialogRef()?.nativeElement.showModal(), 0));
  }
}
