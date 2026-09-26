import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  afterNextRender,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { timeout } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { Msg91WidgetService } from '../../services/msg91-widget.service';
import { DigitsOnlyDirective } from '../../directives/digits-only.directive';
import { PhoneSignInResponse } from '../../models/interfaces';

const PHONE_PATTERN = /^[6-9]\d{9}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** The registration page's rule - this opens the same kind of account. */
const MIN_PASSWORD_LENGTH = 10;
const RESEND_COOLDOWN_SECONDS = 30;
/** Generous for the same reason as login's: a cold API instance can take a while to answer. */
const REQUEST_TIMEOUT_MS = 35_000;

/** Whether the number typed already has an account - asked before a code is sent, because the
 * answer decides whether the account details are needed at all. */
type NumberStatus = 'unknown' | 'checking' | 'existing' | 'new';

/**
 * Step one of checkout for a customer who is not signed in: the registration page's fields - name,
 * mobile, email and password - and a text code to prove the mobile is theirs.
 *
 * A number that already has an Ojas account opens it; a new number creates one from what is typed
 * here, with the email left unverified for the customer to confirm whenever they like. There is no separate "guest order" - verifying the number is what makes the
 * customer somebody we can deliver to, show their orders to and refund.
 *
 * Only checkout sends these codes. Each one costs money, so signing in anywhere else stays on the
 * password, and a returning customer here is offered their password as the free alternative.
 *
 * The code itself is sent and checked by MSG91's widget in the browser; the API then checks the
 * widget's token with MSG91, binds it to this number and redeems it once (see
 * AuthController.PhoneSignIn).
 */
@Component({
  selector: 'app-phone-signin',
  imports: [FormsModule, RouterLink, MatIconModule, MatProgressSpinnerModule, DigitsOnlyDirective],
  templateUrl: './phone-signin.html',
  styleUrl: './phone-signin.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PhoneSignIn implements OnDestroy {
  /** Fires once the session is saved. The page decides where the customer goes next. */
  readonly signedIn = output<PhoneSignInResponse>();

  private readonly auth = inject(AuthService);
  private readonly msg91 = inject(Msg91WidgetService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly captchaId = this.msg91.captchaElementId;
  /** Local development only: no text is sent and the code is always the same. */
  protected readonly devCode = this.msg91.devBypassCode;

  protected readonly phone = signal('');
  protected readonly fullName = signal('');
  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly hidePassword = signal(true);
  protected readonly minPasswordLength = MIN_PASSWORD_LENGTH;
  protected code = '';

  protected readonly step = signal<'details' | 'code'>('details');
  protected readonly numberStatus = signal<NumberStatus>('unknown');
  protected readonly emailTaken = signal(false);
  protected readonly emailTouched = signal(false);
  protected readonly nameTouched = signal(false);
  protected readonly passwordTouched = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly widgetReady = signal(false);
  protected readonly widgetUnavailable = signal(false);
  protected readonly cooldown = signal(0);

  protected readonly phoneValid = computed(() => PHONE_PATTERN.test(this.phone()));
  protected readonly nameValid = computed(() => this.fullName().trim().length >= 2);
  protected readonly emailValid = computed(() => EMAIL_PATTERN.test(this.email().trim()));
  protected readonly passwordValid = computed(() => this.password().length >= MIN_PASSWORD_LENGTH);

  /** Name, email and password - what the registration page asks for - are only asked of a
   * number with no account. While the check is still out, or could not be made, they are asked
   * for anyway: a returning customer who fills them in loses nothing, since the API ignores them
   * for a number it already knows. */
  protected readonly needsDetails = computed(() => this.numberStatus() !== 'existing');

  protected readonly canSend = computed(() => {
    if (this.busy() || !this.phoneValid() || !this.widgetReady()) return false;
    if (this.numberStatus() === 'checking') return false;
    if (!this.needsDetails()) return true;
    return this.nameValid() && this.emailValid() && !this.emailTaken() && this.passwordValid();
  });

  private cooldownTimer: ReturnType<typeof setInterval> | null = null;
  /** The number the latest existence check was for, so a slower answer about a number the
   * customer has since changed is ignored rather than applied to the new one. */
  private checkingFor = '';

  constructor() {
    this.msg91.preload();
    // MSG91 renders its captcha into an element it finds by id, so it can only be set up once
    // this component's template - which holds that element - is on the page.
    afterNextRender(() =>
      this.msg91.initialize().then(
        () => this.widgetReady.set(true),
        () => this.widgetUnavailable.set(true),
      ),
    );
  }

  ngOnDestroy(): void {
    this.clearCooldown();
  }

  protected onPhoneChange(value: string): void {
    const digits = value.replace(/\D/g, '').slice(-10);
    this.phone.set(digits);
    this.error.set('');

    if (!PHONE_PATTERN.test(digits)) {
      this.numberStatus.set('unknown');
      this.checkingFor = '';
      return;
    }
    if (digits === this.checkingFor) return;

    this.checkingFor = digits;
    this.numberStatus.set('checking');
    this.auth.checkPhone(digits).subscribe({
      next: (res) => {
        if (this.checkingFor !== digits) return;
        this.numberStatus.set(res.exists ? 'existing' : 'new');
        if (!res.exists) this.checkEmail();
      },
      // Could not tell. Asking for the details anyway is the safe side: the API will say if
      // anything was wrong, and a returning customer is merely asked for two fields it ignores.
      error: () => {
        if (this.checkingFor === digits) this.numberStatus.set('new');
      },
    });
  }

  protected onEmailChange(value: string): void {
    this.email.set(value);
    this.emailTaken.set(false);
  }

  /** Runs on blur, and once the number is known to be new. An email on another account cannot
   * be used to open a new one, and saying so before the text goes out saves the customer a code. */
  protected checkEmail(): void {
    const email = this.email().trim().toLowerCase();
    if (!EMAIL_PATTERN.test(email) || this.numberStatus() === 'existing') return;

    this.auth.checkEmail(email).subscribe({
      next: (res) => {
        if (this.email().trim().toLowerCase() === email) this.emailTaken.set(res.exists);
      },
      error: () => {},
    });
  }

  protected sendCode(): void {
    this.emailTouched.set(true);
    this.nameTouched.set(true);
    this.passwordTouched.set(true);
    if (!this.canSend()) return;

    this.busy.set(true);
    this.error.set('');

    this.msg91.sendOtp(this.phone()).then(
      () => {
        this.busy.set(false);
        this.code = '';
        this.step.set('code');
        this.startCooldown();
        this.focus('input[name="otp"]');
      },
      (e: Error) => this.fail(e.message || 'Could not send the code. Please try again.'),
    );
  }

  protected resendCode(): void {
    if (this.cooldown() > 0 || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.msg91.sendOtp(this.phone()).then(
      () => {
        this.busy.set(false);
        this.startCooldown();
      },
      (e: Error) => {
        this.fail(e.message || 'Could not send the code. Please try again.');
        this.startCooldown();
      },
    );
  }

  protected verifyCode(): void {
    const code = this.code.trim();
    if (this.busy() || code.length !== 4) return;

    this.busy.set(true);
    this.error.set('');

    this.msg91.verifyOtp(code).then(
      (widgetToken) =>
        this.auth
          .phoneSignIn({
            phone: this.phone(),
            widgetToken,
            fullName: this.needsDetails() ? this.fullName().trim() : undefined,
            email: this.needsDetails() ? this.email().trim().toLowerCase() : undefined,
            password: this.needsDetails() ? this.password() : undefined,
          })
          .pipe(timeout(REQUEST_TIMEOUT_MS))
          .subscribe({
            next: (res) => {
              this.busy.set(false);
              this.clearCooldown();
              this.auth.saveAuth(res.session);
              this.signedIn.emit(res);
            },
            error: (err) => this.onSignInRefused(err),
          }),
      (e: Error) => this.fail(e.message || 'That code is invalid or has expired.'),
    );
  }

  /** Back to the form, keeping what was typed - for a mistyped number, or a text that never came. */
  protected changeDetails(): void {
    this.code = '';
    this.error.set('');
    this.clearCooldown();
    this.step.set('details');
    this.focus('input[name="phone"]');
  }

  private onSignInRefused(err: { status?: number; name?: string; error?: { message?: string; field?: string; needsDetails?: boolean } }): void {
    const message = err.error?.message;

    // Both of these are about what was typed, so they go back to the form with it intact.
    if (err.status === 409 && err.error?.field === 'email') {
      this.emailTaken.set(true);
      this.changeDetails();
      return;
    }
    if (err.status === 400 && err.error?.needsDetails) {
      this.numberStatus.set('new');
      this.changeDetails();
      this.fail(message ?? 'Please enter your name and a valid email address.');
      return;
    }

    if (err.status === 429) {
      this.fail('Too many attempts. Please wait a minute and try again.');
    } else if (err.status === 0 || err.name === 'TimeoutError') {
      this.fail('We could not reach Ojas. Please check your connection and try again.');
    } else {
      this.fail(message ?? 'That code is invalid or has expired.');
    }
  }

  private fail(message: string): void {
    this.busy.set(false);
    this.error.set(message);
  }

  private focus(selector: string): void {
    setTimeout(() => this.host.nativeElement.querySelector<HTMLInputElement>(selector)?.focus());
  }

  private startCooldown(): void {
    this.clearCooldown();
    this.cooldown.set(RESEND_COOLDOWN_SECONDS);
    this.cooldownTimer = setInterval(() => {
      this.cooldown.update((s) => s - 1);
      if (this.cooldown() <= 0) this.clearCooldown();
    }, 1000);
  }

  private clearCooldown(): void {
    if (this.cooldownTimer) clearInterval(this.cooldownTimer);
    this.cooldownTimer = null;
    this.cooldown.set(0);
  }
}
