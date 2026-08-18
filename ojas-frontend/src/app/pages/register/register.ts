import { Component, ChangeDetectorRef, OnDestroy, OnInit, inject, viewChild } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  FormBuilder,
  FormGroup,
  FormsModule,
  Validators,
  ReactiveFormsModule,
  AbstractControl,
  AsyncValidatorFn,
} from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TurnstileWidget } from '../../components/turnstile-widget/turnstile-widget';
import { AuthService } from '../../services/auth.service';
import { WelcomeService } from '../../services/welcome.service';
import { timeout, of, switchMap, map, catchError, timer } from 'rxjs';

const RESEND_COOLDOWN_SECONDS = 30;

@Component({
  selector: 'app-register',
  imports: [
    ReactiveFormsModule,
    FormsModule,
    RouterLink,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    TurnstileWidget,
  ],
  templateUrl: './register.html',
  styleUrl: './register.scss',
})
export class Register implements OnInit, OnDestroy {
  private readonly welcome = inject(WelcomeService);
  private readonly route = inject(ActivatedRoute);
  private readonly turnstileWidget = viewChild(TurnstileWidget);

  registerForm: FormGroup;
  loading = false;
  hidePassword = true;
  serverError = '';
  turnstileToken: string | null = null;

  // Step 2: OTP entry. showOtpStep flips on once registration succeeds (or when arriving
  // from /login with a "verify your email" redirect for an account that never finished).
  showOtpStep = false;
  pendingEmail = '';
  // Only ever populated outside Production (see AuthController.Register) - lets the flow be
  // tested end-to-end before real email sending is configured.
  devCode: string | null = null;
  otpCode = '';
  otpError = '';
  verifying = false;
  resending = false;
  resendCooldown = 0;
  private resendTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private fb: FormBuilder,
    private auth: AuthService,
    private router: Router,
    private cdr: ChangeDetectorRef,
  ) {
    this.registerForm = this.fb.group({
      fullName: ['', [Validators.required, Validators.minLength(2)]],
      email: [
        '',
        {
          validators: [Validators.required, Validators.email],
          asyncValidators: [this.emailExistsValidator()],
          updateOn: 'blur',
        },
      ],
      phone: [
        '',
        {
          validators: [Validators.required, Validators.pattern(/^[6-9]\d{9}$/)],
          asyncValidators: [this.phoneExistsValidator()],
          updateOn: 'blur',
        },
      ],
      password: ['', [Validators.required, Validators.minLength(10)]],
    });
  }

  ngOnInit() {
    // Login redirects here with ?verify=<email> when the account exists but never
    // completed OTP verification, so they can pick the flow back up without re-registering.
    // Deferred to ngOnInit rather than done in the constructor because sendResend() calls
    // cdr.detectChanges(), which throws if the component's view hasn't been created yet -
    // the constructor runs before that, ngOnInit runs after.
    const verifyEmail = this.route.snapshot.queryParamMap.get('verify');
    if (verifyEmail) {
      this.pendingEmail = verifyEmail;
      this.showOtpStep = true;
      this.sendResend();
    }
  }

  private emailExistsValidator(): AsyncValidatorFn {
    return (control: AbstractControl) => {
      if (!control.value || control.hasError('email') || control.hasError('required')) {
        return of(null);
      }
      return timer(200).pipe(
        switchMap(() => this.auth.checkEmail(control.value)),
        map((res) => (res.exists ? { serverError: 'Email already registered' } : null)),
        catchError(() => of(null)),
      );
    };
  }

  private phoneExistsValidator(): AsyncValidatorFn {
    return (control: AbstractControl) => {
      if (!control.value || control.hasError('pattern') || control.hasError('required')) {
        return of(null);
      }
      return timer(200).pipe(
        switchMap(() => this.auth.checkPhone(control.value)),
        map((res) => (res.exists ? { serverError: 'Phone number already in use' } : null)),
        catchError(() => of(null)),
      );
    };
  }

  get emailChecking() {
    return this.registerForm.get('email')?.status === 'PENDING';
  }

  get phoneChecking() {
    return this.registerForm.get('phone')?.status === 'PENDING';
  }

  onTurnstileVerified(token: string) {
    this.turnstileToken = token;
  }

  onTurnstileExpired() {
    this.turnstileToken = null;
  }

  onSubmit() {
    this.registerForm.markAllAsTouched();
    if (this.registerForm.invalid || this.registerForm.pending || !this.turnstileToken) return;

    this.serverError = '';
    this.loading = true;
    this.cdr.detectChanges();

    this.auth
      .register({ ...this.registerForm.value, turnstileToken: this.turnstileToken })
      .pipe(timeout(8000))
      .subscribe({
        next: (res) => {
          this.loading = false;
          this.pendingEmail = res.email;
          this.devCode = res.devCode ?? null;
          this.showOtpStep = true;
          this.startResendCooldown();
          this.cdr.detectChanges();
        },
        error: (err) => {
          this.loading = false;
          // A Turnstile token is single-use - whatever happened, this one is spent.
          this.turnstileToken = null;
          this.turnstileWidget()?.reset();
          // 409 is a safety net — async validators should have caught this already
          if (err.status === 409) {
            const field = err.error?.field;
            if (field === 'email') {
              this.registerForm.get('email')?.setErrors({ serverError: 'Email already registered' });
            } else if (field === 'phone') {
              this.registerForm.get('phone')?.setErrors({ serverError: 'Phone number already in use' });
            } else {
              this.serverError = err.error?.message ?? 'This email or phone is already registered.';
            }
          } else if (err.status === 429) {
            this.serverError = 'Too many attempts. Please wait a minute and try again.';
          } else if (err.status === 0 || err.name === 'TimeoutError') {
            this.serverError = 'Server not reachable. Please check your connection and try again.';
          } else {
            this.serverError = err.error?.message ?? 'Registration failed. Please try again.';
          }
          this.cdr.detectChanges();
        },
      });
  }

  verifyOtp() {
    if (this.otpCode.trim().length !== 6 || this.verifying) return;

    this.otpError = '';
    this.verifying = true;
    this.cdr.detectChanges();

    this.auth
      .verifyEmailOtp({ email: this.pendingEmail, code: this.otpCode.trim() })
      .pipe(timeout(8000))
      .subscribe({
        next: (res) => {
          this.verifying = false;
          this.auth.saveAuth(res);
          this.welcome.celebrate('register', res.fullName);
          this.router.navigate(['/']);
        },
        error: (err) => {
          this.verifying = false;
          if (err.status === 429) {
            this.otpError = 'Too many attempts. Please wait a minute and try again.';
          } else if (err.status === 0 || err.name === 'TimeoutError') {
            this.otpError = 'Server not reachable. Please check your connection and try again.';
          } else {
            this.otpError = err.error?.message ?? "That code is invalid or has expired.";
          }
          this.cdr.detectChanges();
        },
      });
  }

  resendOtp() {
    if (this.resendCooldown > 0 || this.resending) return;
    this.sendResend();
  }

  private sendResend() {
    this.resending = true;
    this.otpError = '';
    this.cdr.detectChanges();

    this.auth
      .resendEmailOtp({ email: this.pendingEmail })
      .pipe(timeout(8000))
      .subscribe({
        next: (res) => {
          this.resending = false;
          this.devCode = res.devCode ?? null;
          this.startResendCooldown();
        },
        error: () => {
          this.resending = false;
          // Resend still starts a cooldown even on failure to avoid hammering the endpoint.
          this.startResendCooldown();
        },
      });
  }

  private startResendCooldown() {
    this.clearResendTimer();
    this.resendCooldown = RESEND_COOLDOWN_SECONDS;
    this.cdr.detectChanges();
    this.resendTimer = setInterval(() => {
      this.resendCooldown -= 1;
      if (this.resendCooldown <= 0) {
        this.clearResendTimer();
      }
      this.cdr.detectChanges();
    }, 1000);
  }

  private clearResendTimer() {
    if (this.resendTimer) {
      clearInterval(this.resendTimer);
      this.resendTimer = null;
    }
  }

  ngOnDestroy() {
    this.clearResendTimer();
  }
}
