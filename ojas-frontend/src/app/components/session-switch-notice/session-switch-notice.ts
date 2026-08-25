import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { AuthService } from '../../services/auth.service';

/**
 * Covers the page while this tab resynchronises onto a session that changed in another one.
 *
 * The covering is the point, not the message. The moment a second account signs in, this tab's
 * cached user is describing someone the cookie no longer refers to - so everything already
 * painted (the name in the header, the orders below it, the addresses on the checkout form) is
 * either about to be wrong or already is. This goes over all of it immediately and says what
 * happened, rather than letting a stale identity sit on screen for the second it takes to
 * rebuild.
 */
@Component({
  selector: 'app-session-switch-notice',
  templateUrl: './session-switch-notice.html',
  styleUrl: './session-switch-notice.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionSwitchNotice {
  private readonly auth = inject(AuthService);

  protected readonly change = this.auth.sessionChange;

  protected readonly title = computed(() => {
    const change = this.change();
    if (!change) return '';
    if (change.kind === 'signed-out') return 'Signed out';
    return change.name ? `Switching to ${change.name}` : 'Switching accounts';
  });

  protected readonly detail = computed(() => {
    const change = this.change();
    if (!change) return '';
    return change.kind === 'signed-out'
      ? 'You signed out in another tab, so this one is signing out too.'
      : 'A different account signed in on this browser. Bringing this tab up to date.';
  });
}
