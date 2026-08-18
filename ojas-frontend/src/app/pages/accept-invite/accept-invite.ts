import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../services/auth.service';
import { WelcomeService } from '../../services/welcome.service';
import { InvitePreviewResponse } from '../../models/interfaces';

/**
 * Where a staff member lands from their invite email. Setting a password here also binds this
 * browser as the one device their account may sign in from, so the copy is explicit that the
 * device they open the link on is the one they're committing to.
 */
@Component({
  selector: 'app-accept-invite',
  imports: [
    FormsModule,
    RouterLink,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './accept-invite.html',
  styleUrl: './accept-invite.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AcceptInvite {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly welcome = inject(WelcomeService);

  readonly loading = signal(true);
  readonly invite = signal<InvitePreviewResponse | null>(null);
  readonly linkError = signal('');
  readonly submitError = signal('');
  readonly submitting = signal(false);

  password = '';
  confirmPassword = '';
  hidePassword = true;

  private token = '';

  constructor() {
    this.token = this.route.snapshot.queryParamMap.get('token') ?? '';

    if (!this.token) {
      this.linkError.set('This invite link is missing its token. Please use the link from your email.');
      this.loading.set(false);
      return;
    }

    this.auth.getInvite(this.token).subscribe({
      next: (invite) => {
        this.invite.set(invite);
        this.loading.set(false);
      },
      error: () => {
        this.linkError.set(
          'This invite link is invalid or has expired. Ask your administrator to send a new one.',
        );
        this.loading.set(false);
      },
    });
  }

  get passwordsMatch(): boolean {
    return this.password.length > 0 && this.password === this.confirmPassword;
  }

  get canSubmit(): boolean {
    return !this.submitting() && this.password.length >= 10 && this.passwordsMatch;
  }

  onSubmit() {
    if (!this.canSubmit) return;

    this.submitting.set(true);
    this.submitError.set('');

    this.auth.acceptInvite({ token: this.token, password: this.password }).subscribe({
      next: (res) => {
        this.submitting.set(false);
        // Accepting the invite issues a session outright - no separate sign-in needed, and the
        // device is already bound.
        this.auth.saveAuth(res);
        this.welcome.celebrate('login', res.fullName);
        this.router.navigateByUrl(this.auth.getDefaultRouteForRole(res.role));
      },
      error: (err) => {
        this.submitting.set(false);
        this.submitError.set(
          err.status === 429
            ? 'Too many attempts. Please wait a minute.'
            : (err.error?.message ?? 'Something went wrong. Please try again.'),
        );
      },
    });
  }
}
