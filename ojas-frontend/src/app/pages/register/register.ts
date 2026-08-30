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
import { Msg91WidgetService } from '../../services/msg91-widget.service';
import { AuthResponse } from '../../models/interfaces';
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
  private readonly msg91Widget = inject(Msg91WidgetService);
  readonly phoneCaptchaElementId = this.msg91Widget.captchaElementId;

  registerForm: FormGroup;
  loading = false;
  hidePassword = true;
  serverError = '';
  turnstileToken: string | null = null;

  // Registration is three stages now: the form, then email verification, then phone
  // verification - completable in either order once past the form, but this component always
  // does email first, then phone. 'stage' starts at 'form' and only ever moves forward; resuming
  // via a link from login (an account that verified one step and came back later) can start
  // straight at 'email' or 'phone' - see ngOnInit.
  stage: 'form' | 'email' | 'phone' = 'form';
  pendingEmail = '';
  pendingPhone = '';

  // Email step. Only ever populated outside Production (see AuthController.Register) - lets the
  // flow be tested end-to-end before real email sending is configured.
  devCode: string | null = null;
  otpCode = '';
  otpError = '';
  verifying = false;
  resending = false;
  resendCooldown = 0;
  private resendTimer: ReturnType<typeof setInterval> | null = null;

  // Phone step, via the MSG91 OTP Widget - same service and pattern login's phone flow uses.
  // 'send' shows the captcha and a Send button; 'code' takes the 4-digit code once sent.
  phoneSubStage: 'send' | 'code' = 'send';
  phoneCode = '';
  phoneError = '';
  phoneBusy = false;
  phoneUnavailable = false;

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
    // Login redirects here when an account exists but hasn't finished registration - either
    // ?verify=<email> (email still outstanding) or ?verifyPhone=<phone>&email=<email> (email
    // already done, only phone left). Deferred to ngOnInit rather than the constructor because
    // sendResend()/switchToPhoneStage() touch the view, which doesn't exist yet in the
    // constructor.
    const params = this.route.snapshot.queryParamMap;
    const verifyEmail = params.get('verify');
    const verifyPhone = params.get('verifyPhone');

    if (verifyPhone) {
      this.pendingPhone = verifyPhone;
      this.pendingEmail = params.get('email') ?? '';
      this.switchToPhoneStage();
    } else if (verifyEmail) {
      this.pendingEmail = verifyEmail;
      this.stage = 'email';
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
          this.pendingPhone = this.registerForm.value.phone;
          this.devCode = res.devCode ?? null;
          this.stage = 'email';
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
          this.pendingPhone = res.phone;
          if (res.session) {
            this.completeRegistration(res.session);
          } else {
            this.switchToPhoneStage();
          }
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

  private switchToPhoneStage() {
    // The email step's resend cooldown is meaningless once we've moved past it - left running,
    // it keeps firing every second, patching resendCooldown and calling cdr.detectChanges() on a
    // component that no longer shows it, for as long as the tab stays on this page.
    this.clearResendTimer();
    this.stage = 'phone';
    this.phoneSubStage = 'send';
    this.phoneCode = '';
    this.phoneError = '';
    this.phoneUnavailable = false;
    // Kicked off here, not eagerly - most visits never reach this step. The captcha's target div
    // only exists once this stage has rendered, so force that render before calling initialize()
    // (async: it loads a script) rather than relying on some other trigger to have flushed it -
    // this can run from a plain method call, not just a DOM event binding, and zoneless Angular
    // does not auto-schedule a check for either kind of caller.
    this.cdr.detectChanges();
    this.msg91Widget.initialize().catch(() => {
      this.phoneUnavailable = true;
      this.cdr.detectChanges();
    });
  }

  sendPhoneCode() {
    if (this.phoneBusy) return;

    this.phoneBusy = true;
    this.phoneError = '';

    this.msg91Widget
      .sendOtp(this.pendingPhone)
      .then(() => {
        this.phoneBusy = false;
        this.phoneSubStage = 'code';
        this.cdr.detectChanges();
      })
      .catch((error: Error) => {
        this.phoneBusy = false;
        this.phoneError = error.message || 'Something went wrong. Please try again.';
        this.cdr.detectChanges();
      });
  }

  verifyPhoneCode() {
    if (this.phoneCode.trim().length !== 4 || this.phoneBusy) return;

    this.phoneBusy = true;
    this.phoneError = '';

    this.msg91Widget
      .verifyOtp(this.phoneCode.trim())
      .then((widgetToken) =>
        this.auth.verifyPhoneRegistration({ phone: this.pendingPhone, widgetToken }).subscribe({
          next: (res) => {
            this.phoneBusy = false;
            if (res.session) {
              this.completeRegistration(res.session);
            } else {
              // Phone verified but email still isn't (arrived here via ?verifyPhone without
              // ever doing the email step) - send them to finish that instead.
              this.pendingEmail = res.email;
              this.stage = 'email';
              this.sendResend();
            }
          },
          error: (err) => {
            this.phoneBusy = false;
            this.phoneError = err.error?.message ?? 'That code is invalid or has expired.';
            this.cdr.detectChanges();
          },
        }),
      )
      .catch((error: Error) => {
        this.phoneBusy = false;
        this.phoneError = error.message || 'That code is invalid or has expired.';
        this.cdr.detectChanges();
      });
  }

  private completeRegistration(session: AuthResponse) {
    this.auth.saveAuth(session);
    this.welcome.celebrate('register', session.fullName);
    this.router.navigate(['/']);
  }

  ngOnDestroy() {
    this.clearResendTimer();
  }
}
