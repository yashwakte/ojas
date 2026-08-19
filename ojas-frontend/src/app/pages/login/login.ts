import { Component, ChangeDetectorRef, OnDestroy, inject, viewChild } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TurnstileWidget } from '../../components/turnstile-widget/turnstile-widget';
import { AuthService } from '../../services/auth.service';
import { WelcomeService } from '../../services/welcome.service';
import { timeout } from 'rxjs';

@Component({
  selector: 'app-login',
  imports: [
    ReactiveFormsModule,
    FormsModule,
    RouterLink,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
    TurnstileWidget,
  ],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login implements OnDestroy {
  private readonly welcome = inject(WelcomeService);
  private readonly route = inject(ActivatedRoute);
  private readonly turnstileWidget = viewChild(TurnstileWidget);

  loginForm: FormGroup;
  loading = false;
  slowConnection = false;
  hidePassword = true;
  turnstileToken: string | null = null;
  private slowTimer: ReturnType<typeof setTimeout> | null = null;

  // Forgot-password flow. 'request' collects the email, 'reset' takes the code + new password;
  // both live on this card rather than a separate route so the user never loses their place.
  resetStage: 'none' | 'request' | 'reset' = 'none';
  resetEmail = '';
  resetCode = '';
  resetNewPassword = '';
  resetDevCode: string | null = null;
  resetError = '';
  resetNotice = '';
  resetBusy = false;
  hideResetPassword = true;

  // Device-approval step, shown only to staff signing in from an unrecognised browser.
  showDeviceStep = false;
  deviceCode = '';
  deviceEmail = '';
  deviceDevCode: string | null = null;
  deviceError = '';
  enrolling = false;
  resendingDeviceCode = false;
  // True when an admin already cleared this account's next device - enrollment completes
  // automatically with no code to enter.
  devicePreApproved = false;

  // Phone-number sign-in - a second, customer-only login method alongside email+password.
  // 'enter' collects the number, 'code' takes the OTP; both live on this card like the
  // reset/device flows above. Inert (503) until MSG91 is configured server-side.
  loginMode: 'email' | 'phone' = 'email';
  phoneStage: 'enter' | 'code' = 'enter';
  phoneNumber = '';
  phoneCode = '';
  phoneDevCode: string | null = null;
  phoneError = '';
  phoneBusy = false;
  phoneUnavailable = false;

  constructor(
    private fb: FormBuilder,
    private auth: AuthService,
    private router: Router,
    private snackBar: MatSnackBar,
    private cdr: ChangeDetectorRef,
  ) {
    this.loginForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
    });
  }

  onTurnstileVerified(token: string) {
    this.turnstileToken = token;
  }

  onTurnstileExpired() {
    this.turnstileToken = null;
  }

  onSubmit() {
    if (this.loginForm.invalid || !this.turnstileToken) return;

    this.loading = true;
    this.slowConnection = false;

    // Show warm-up hint after 5s (Render free tier cold starts can take ~30s)
    this.slowTimer = setTimeout(() => {
      this.slowConnection = true;
      this.cdr.detectChanges();
    }, 5000);

    this.auth
      .login({ ...this.loginForm.value, turnstileToken: this.turnstileToken })
      .pipe(timeout(35000))
      .subscribe({
        next: (res) => {
          this.clearSlowTimer();
          this.loading = false;
          this.slowConnection = false;
          this.cdr.detectChanges();
          this.auth.saveAuth(res);
          this.welcome.celebrate('login', res.fullName);

          // Guards park the intended destination here (e.g. a guest sent to log
          // in from checkout), so return them to it rather than the role home.
          const redirect = this.route.snapshot.queryParamMap.get('redirect');
          const target =
            redirect && res.role === 'customer'
              ? redirect
              : this.auth.getDefaultRouteForRole(res.role);
          this.router.navigateByUrl(target);
        },
        error: (err) => {
          this.clearSlowTimer();
          this.loading = false;
          this.slowConnection = false;
          // A Turnstile token is single-use - whatever happened, this one is spent.
          this.turnstileToken = null;
          this.turnstileWidget()?.reset();
          this.cdr.detectChanges();

          if (err.status === 403 && err.error?.needsEmailVerification) {
            this.router.navigate(['/register'], { queryParams: { verify: err.error.email } });
            return;
          }

          // The password was right, but this staff account is bound to a different device.
          if (err.status === 403 && err.error?.needsDeviceEnrollment) {
            this.startDeviceEnrollment(err.error.email);
            return;
          }

          let msg = 'Something went wrong. Please try again.';
          if (err.status === 429) {
            msg = 'Too many attempts. Please wait a minute.';
          } else if (err.status === 401) {
            msg = 'Invalid email or password';
          } else if (err.status === 400) {
            // Distinct from a credentials failure (401) - this is Turnstile verification failing.
            msg = err.error?.message ?? 'Verification failed. Please try again.';
          } else if (err.status === 0 || err.name === 'TimeoutError') {
            msg = 'Server is taking too long. Please try again.';
          }
          this.snackBar.open(msg, 'Close', {
            duration: 5000,
            panelClass: 'snack-error',
          });
        },
      });
  }

  startPasswordReset() {
    this.resetStage = 'request';
    // Carry across whatever they already typed - they usually got here after a failed attempt.
    this.resetEmail = this.loginForm.value.email ?? '';
    this.resetCode = '';
    this.resetNewPassword = '';
    this.resetError = '';
    this.resetNotice = '';
    this.resetDevCode = null;
  }

  cancelPasswordReset() {
    this.resetStage = 'none';
    this.resetError = '';
    this.resetNotice = '';
    this.resetDevCode = null;
  }

  requestResetCode() {
    if (!this.resetEmail.trim() || !this.turnstileToken) return;

    this.resetBusy = true;
    this.resetError = '';

    this.auth
      .forgotPassword({ email: this.resetEmail.trim(), turnstileToken: this.turnstileToken })
      .subscribe({
        next: (res) => {
          this.resetBusy = false;
          this.resetDevCode = res.devCode ?? null;
          this.resetNotice = res.message;
          this.resetStage = 'reset';
          // The token is spent whether or not the address was registered.
          this.turnstileToken = null;
          this.turnstileWidget()?.reset();
          this.cdr.detectChanges();
        },
        error: (err) => {
          this.resetBusy = false;
          this.turnstileToken = null;
          this.turnstileWidget()?.reset();
          this.resetError =
            err.status === 429
              ? 'Too many attempts. Please wait a minute.'
              : (err.error?.message ?? 'Something went wrong. Please try again.');
          this.cdr.detectChanges();
        },
      });
  }

  submitNewPassword() {
    if (this.resetCode.trim().length !== 6 || this.resetNewPassword.length < 10) return;

    this.resetBusy = true;
    this.resetError = '';

    this.auth
      .resetPassword({
        email: this.resetEmail.trim(),
        code: this.resetCode.trim(),
        newPassword: this.resetNewPassword,
      })
      .subscribe({
        next: () => {
          this.resetBusy = false;
          this.resetStage = 'none';
          this.resetDevCode = null;
          // No session is issued by design, so drop them back on the sign-in form with the
          // email prefilled rather than pretending they're logged in.
          this.loginForm.patchValue({ email: this.resetEmail.trim(), password: '' });
          this.cdr.detectChanges();
          this.snackBar.open('Password updated. Please sign in.', 'Close', { duration: 5000 });
        },
        error: (err) => {
          this.resetBusy = false;
          this.resetError = err.error?.message ?? 'That code is invalid or has expired.';
          this.cdr.detectChanges();
        },
      });
  }

  // Switches the card over to the code entry step and immediately requests a code, so the
  // staff member doesn't have to ask for one before they can do anything.
  private startDeviceEnrollment(email: string) {
    this.showDeviceStep = true;
    this.deviceEmail = email;
    this.deviceCode = '';
    this.deviceError = '';
    this.devicePreApproved = false;
    this.sendDeviceCode();
  }

  sendDeviceCode() {
    const password = this.loginForm.value.password;
    if (!password) return;

    this.resendingDeviceCode = true;
    this.deviceDevCode = null;
    this.cdr.detectChanges();

    this.auth.sendDeviceOtp({ email: this.deviceEmail, password }).subscribe({
      next: (res) => {
        this.resendingDeviceCode = false;
        this.deviceDevCode = res.devCode ?? null;
        this.cdr.detectChanges();

        if (res.preApproved) {
          this.devicePreApproved = true;
          this.completePreApprovedEnrollment(password);
        }
      },
      error: () => {
        this.resendingDeviceCode = false;
        this.deviceError = "We couldn't send a code. Please try again.";
        this.cdr.detectChanges();
      },
    });
  }

  // No code to enter here - the trust comes from an admin's own prior approval rather than
  // proof of email control, so this fires as soon as sendDeviceCode reports preApproved.
  private completePreApprovedEnrollment(password: string) {
    this.enrolling = true;
    this.deviceError = '';
    this.cdr.detectChanges();

    this.auth.enrollPreApprovedDevice({ email: this.deviceEmail, password }).subscribe({
      next: (res) => {
        this.enrolling = false;
        this.cdr.detectChanges();
        this.auth.saveAuth(res);
        this.welcome.celebrate('login', res.fullName);
        this.router.navigateByUrl(this.auth.getDefaultRouteForRole(res.role));
      },
      error: (err) => {
        this.enrolling = false;
        this.devicePreApproved = false;
        this.deviceError =
          err.status === 400
            ? (err.error?.message ?? 'That approval is no longer valid. Please try again.')
            : 'Something went wrong. Please try again.';
        this.cdr.detectChanges();
      },
    });
  }

  enrollDevice() {
    if (this.deviceCode.trim().length !== 6) return;

    this.enrolling = true;
    this.deviceError = '';

    this.auth
      .enrollDevice({
        email: this.deviceEmail,
        password: this.loginForm.value.password,
        code: this.deviceCode.trim(),
      })
      .subscribe({
        next: (res) => {
          this.enrolling = false;
          this.cdr.detectChanges();
          this.auth.saveAuth(res);
          this.welcome.celebrate('login', res.fullName);
          this.router.navigateByUrl(this.auth.getDefaultRouteForRole(res.role));
        },
        error: (err) => {
          this.enrolling = false;
          this.deviceError =
            err.status === 400
              ? (err.error?.message ?? 'That code is invalid or has expired.')
              : 'Something went wrong. Please try again.';
          this.cdr.detectChanges();
        },
      });
  }

  cancelDeviceEnrollment() {
    this.showDeviceStep = false;
    this.deviceCode = '';
    this.deviceError = '';
    this.deviceDevCode = null;
    this.devicePreApproved = false;
  }

  switchToPhoneLogin() {
    this.loginMode = 'phone';
    this.phoneStage = 'enter';
    this.phoneNumber = '';
    this.phoneCode = '';
    this.phoneError = '';
    this.phoneDevCode = null;
    this.phoneUnavailable = false;
  }

  switchToEmailLogin() {
    this.loginMode = 'email';
    this.phoneError = '';
    this.phoneUnavailable = false;
  }

  sendPhoneLoginCode() {
    if (!this.phoneNumber.trim() || !this.turnstileToken) return;

    this.phoneBusy = true;
    this.phoneError = '';

    this.auth
      .sendPhoneLoginOtp({ phone: this.phoneNumber.trim(), turnstileToken: this.turnstileToken })
      .subscribe({
        next: (res) => {
          this.phoneBusy = false;
          this.phoneDevCode = res.devCode ?? null;
          this.phoneStage = 'code';
          this.turnstileToken = null;
          this.turnstileWidget()?.reset();
          this.cdr.detectChanges();
        },
        error: (err) => {
          this.phoneBusy = false;
          this.turnstileToken = null;
          this.turnstileWidget()?.reset();
          if (err.status === 503) {
            this.phoneUnavailable = true;
          } else {
            this.phoneError =
              err.status === 429
                ? 'Too many attempts. Please wait a minute.'
                : (err.error?.message ?? 'Something went wrong. Please try again.');
          }
          this.cdr.detectChanges();
        },
      });
  }

  verifyPhoneLoginCode() {
    if (this.phoneCode.trim().length !== 6) return;

    this.phoneBusy = true;
    this.phoneError = '';

    this.auth
      .verifyPhoneLogin({ phone: this.phoneNumber.trim(), code: this.phoneCode.trim() })
      .subscribe({
        next: (res) => {
          this.phoneBusy = false;
          this.cdr.detectChanges();
          this.auth.saveAuth(res);
          this.welcome.celebrate('login', res.fullName);

          const redirect = this.route.snapshot.queryParamMap.get('redirect');
          const target =
            redirect && res.role === 'customer'
              ? redirect
              : this.auth.getDefaultRouteForRole(res.role);
          this.router.navigateByUrl(target);
        },
        error: (err) => {
          this.phoneBusy = false;
          this.phoneError = err.error?.message ?? 'That code is invalid or has expired.';
          this.cdr.detectChanges();
        },
      });
  }

  private clearSlowTimer() {
    if (this.slowTimer) {
      clearTimeout(this.slowTimer);
      this.slowTimer = null;
    }
  }

  ngOnDestroy() {
    this.clearSlowTimer();
  }
}
