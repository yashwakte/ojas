import { Injectable, Injector, inject } from '@angular/core';
import { AuthService } from './auth.service';

/**
 * Every "Log out" a person can press goes through here, so it always asks first.
 *
 * The header menu, the phone drawer, the profile page and the admin console each had their own
 * button wired straight to `auth.logout()`, and on a phone the drawer's Log out row sits a thumb's
 * width from Wallet. One stray tap ended the session with no way back but signing in again.
 *
 * Only a person's own tap is confirmed. The sign-outs the app does by itself (a session that has
 * expired, another tab signing out) still call `auth.logout()` directly, because there is nobody
 * to ask and the session is already gone.
 *
 * The dialog and Material's dialog machinery are loaded on the first tap rather than with the
 * app. The header is in every page's first download, and nobody needs a logout dialog to see the
 * shop.
 */
@Injectable({ providedIn: 'root' })
export class LogoutConfirmService {
  private readonly injector = inject(Injector);
  private readonly auth = inject(AuthService);

  /** True while the question is on its way or on screen, so a double tap cannot stack two. */
  private asking = false;

  request(): void {
    if (this.asking) return;
    this.asking = true;
    this.ask()
      .then((confirmed) => {
        if (confirmed) this.auth.logout();
      })
      .catch(() => {
        // The dialog code could not be fetched (a flaky connection mid-deploy). Asking is a
        // courtesy; a person must never be stuck signed in because of it.
        this.auth.logout();
      })
      .finally(() => (this.asking = false));
  }

  private async ask(): Promise<boolean> {
    const [{ MatDialog }, dialogModule] = await Promise.all([
      import('@angular/material/dialog'),
      import('../components/confirm-dialog/confirm-dialog'),
    ]);
    const { ConfirmDialog, CONFIRM_DIALOG_TITLE_ID, CONFIRM_DIALOG_MESSAGE_ID } = dialogModule;

    const ref = this.injector.get(MatDialog).open(ConfirmDialog, {
      data: {
        title: 'Log out of Ojas?',
        message: "You'll need to sign in again to get back to your account.",
        confirmLabel: 'Log out',
        cancelLabel: 'Cancel',
        icon: 'logout',
        tone: 'danger',
      },
      width: 'min(400px, calc(100vw - 32px))',
      maxWidth: '400px',
      autoFocus: 'first-tabbable',
      restoreFocus: true,
      ariaLabelledBy: CONFIRM_DIALOG_TITLE_ID,
      ariaDescribedBy: CONFIRM_DIALOG_MESSAGE_ID,
      panelClass: 'ojas-confirm-panel',
      backdropClass: 'ojas-confirm-backdrop',
    });

    return new Promise<boolean>((resolve) =>
      ref.afterClosed().subscribe((answer) => resolve(answer === true)),
    );
  }
}
