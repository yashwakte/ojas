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

  // Two stages: the signup form, then one verification screen carrying both the phone and the
  // email. Only the phone is required - it is what issues the session - so the email row is an
  // optional extra on the same screen rather than a second gate behind it. Registration sends no
  // email code at all; one is only requested if the customer asks for it here.
  stage: 'form' | 'verify' = 'form';
  pendingEmail = '';
  pendingPhone = '';

  // Phone verification, via the MSG91 OTP Widget.
  phoneSubStage: 'send' | 'code' = 'send';
  phoneCode = '';
  phoneError = '';
  phoneBusy = false;
  phoneUnavailable = false;
  phoneVerified = false;
  /** False until initSendOTP has actually run. The Send button stays disabled until then: the
   * widget's captcha is not armed before this point, so a customer who taps early gets a failure
   * that reads as "the code didn't work" when nothing was ever sent. */
  widgetReady = false;

  // Email verification - opt-in, from the same screen. Collapsed until the customer asks for it.
  emailVerified = false;
  emailStage: 'idle' | 'code' = 'idle';
  emailCode = '';
  emailError = '';
  emailBusy = false;
  devCode: string | null = null;
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
    // Start pulling the widget script now, while the form is being filled in. It is the slowest
    // part of the whole flow and this is the only genuinely free window to spend on it.
    this.msg91Widget.preload();

    // Login redirects here when an account exists but never verified its phone, as
    // ?verifyPhone=<phone>&email=<email>. Deferred to ngOnInit rather than the constructor
    // because openVerifyStage() touches the view, which does not exist yet in the constructor.
    const params = this.route.snapshot.queryParamMap;
    const verifyPhone = params.get('verifyPhone');
    const verifyEmail = params.get('verify');

    if (verifyPhone) {
      this.pendingPhone = verifyPhone;
      this.pendingEmail = params.get('email') ?? '';
      this.openVerifyStage();
    } else if (verifyEmail) {
      // An older link, from before registration stopped requiring an email code. The address is
      // all it carries, so there is no phone to verify from here - send them to sign in, which
      // will route them onward if the phone is genuinely outstanding.
      this.router.navigate(['/login']);
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
          this.openVerifyStage();
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

  private openVerifyStage() {
    this.stage = 'verify';
    this.phoneSubStage = 'send';
    this.phoneCode = '';
    this.phoneError = '';
    this.phoneUnavailable = false;
    this.widgetReady = false;
    // Flush this stage's template before initialising: MSG91 renders its captcha into an element
    // it looks up by id, so that element has to exist first. This app is zoneless and this can be
    // reached from a subscribe callback rather than a DOM event, so nothing else would schedule
    // the render in time.
    this.cdr.detectChanges();

    this.msg91Widget
      .initialize()
      .then(() => {
        this.widgetReady = true;
        this.cdr.detectChanges();
      })
      .catch(() => {
        this.phoneUnavailable = true;
        this.cdr.detectChanges();
      });
  }

  sendPhoneCode() {
    if (this.phoneBusy || !this.widgetReady) return;

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
            // Verifying the phone is what issues the session, so this is normally the end of
            // registration whether or not the address was ever confirmed. Leave the status flags
            // alone on that path - the screen is being navigated away from, and setting a binding
            // the template reads without a flush behind it is what NG0100 is complaining about.
            if (res.session) {
              this.completeRegistration(res.session);
              return;
            }
            this.phoneVerified = true;
            this.emailVerified = res.emailVerified;
            this.cdr.detectChanges();
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

  /** Opt-in: nothing is sent until the customer presses Verify on the email row. */
  startEmailVerification() {
    if (this.emailBusy || this.resendCooldown > 0) return;
    this.emailStage = 'code';
    this.sendEmailCode();
  }

  private sendEmailCode() {
    this.emailBusy = true;
    this.emailError = '';
    this.cdr.detectChanges();

    this.auth
      .resendEmailOtp({ email: this.pendingEmail })
      .pipe(timeout(8000))
      .subscribe({
        next: (res) => {
          this.emailBusy = false;
          this.devCode = res.devCode ?? null;
          this.startResendCooldown();
        },
        error: () => {
          this.emailBusy = false;
          this.emailError = "We couldn't send the code. Please try again in a moment.";
          // Cooldown starts even on failure, so a broken send cannot be hammered.
          this.startResendCooldown();
        },
      });
  }

  resendEmailCode() {
    if (this.resendCooldown > 0 || this.emailBusy) return;
    this.sendEmailCode();
  }

  verifyEmailCode() {
    if (this.emailCode.trim().length !== 6 || this.emailBusy) return;

    this.emailBusy = true;
    this.emailError = '';
    this.cdr.detectChanges();

    this.auth
      .verifyEmailOtp({ email: this.pendingEmail, code: this.emailCode.trim() })
      .pipe(timeout(8000))
      .subscribe({
        next: (res) => {
          this.emailBusy = false;
          // A session arrives here only when the phone was already verified - i.e. the customer
          // finished the required step first and then chose to confirm their address too. Same
          // reasoning as verifyPhoneCode: don't touch the status bindings on the path that
          // navigates away from the screen that renders them.
          if (res.session) {
            this.completeRegistration(res.session);
            return;
          }
          this.emailVerified = true;
          this.emailStage = 'idle';
          this.clearResendTimer();
          this.cdr.detectChanges();
        },
        error: (err) => {
          this.emailBusy = false;
          this.emailError = err.error?.message ?? 'That code is invalid or has expired.';
          this.cdr.detectChanges();
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

  private completeRegistration(session: AuthResponse) {
    this.clearResendTimer();
    this.auth.saveAuth(session);
    this.welcome.celebrate('register', session.fullName);
    this.router.navigate(['/']);
  }

  ngOnDestroy() {
    this.clearResendTimer();
  }
}
