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
import { PhoneSignInRequest, PhoneSignInResponse } from '../../models/interfaces';

const PHONE_PATTERN = /^[6-9]\d{9}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** The registration page's rule - this opens the same kind of account. */
const MIN_PASSWORD_LENGTH = 10;
const RESEND_COOLDOWN_SECONDS = 30;
/** Generous for the same reason as login's: a cold API instance can take a while to answer. */
const REQUEST_TIMEOUT_MS = 35_000;

/**
 * Step one of checkout for a customer who is not signed in: the mobile number, a text code to
 * prove it is theirs, and - only for a number with no Ojas account - the registration page's
 * name, email and password.
 *
 * Nothing says whether a number has an account until its code is verified. Asking first let
 * anyone test any number (and any email) against the customer list, so the page now learns it
 * from the verified sign-in itself: a known number is signed straight in, and a new one is asked
 * for its details. The API hands the browser an HttpOnly ticket for that second request, so a
 * mistyped email never costs a second text.
 *
 * A new number's account has its email left unverified for the customer to confirm whenever they
 * like. There is no separate "guest order" - verifying the number is what makes the
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

  protected readonly step = signal<'phone' | 'code' | 'details'>('phone');
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

  protected readonly canSend = computed(() => !this.busy() && this.phoneValid() && this.widgetReady());

  protected readonly canCreate = computed(
    () => !this.busy() && this.nameValid() && this.emailValid() && !this.emailTaken() && this.passwordValid(),
  );

  private cooldownTimer: ReturnType<typeof setInterval> | null = null;

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
    this.phone.set(value.replace(/\D/g, '').slice(-10));
    this.error.set('');
  }

  protected onEmailChange(value: string): void {
    this.email.set(value);
    this.emailTaken.set(false);
  }

  protected sendCode(): void {
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
      (widgetToken) => this.submit({ phone: this.phone(), widgetToken }),
      (e: Error) => this.fail(e.message || 'That code is invalid or has expired.'),
    );
  }

  /** A proved new number's details. No code goes with them - the ticket cookie the verified
   * request set stands in for it. */
  protected createAccount(): void {
    this.nameTouched.set(true);
    this.emailTouched.set(true);
    this.passwordTouched.set(true);
    if (!this.canCreate()) return;

    this.busy.set(true);
    this.error.set('');
    this.submit({
      phone: this.phone(),
      fullName: this.fullName().trim(),
      email: this.email().trim().toLowerCase(),
      password: this.password(),
    });
  }

  /** Back to the number, keeping what was typed - for a mistyped number, or a text that never came. */
  protected changeNumber(): void {
    this.code = '';
    this.error.set('');
    this.clearCooldown();
    this.step.set('phone');
    this.focus('input[name="phone"]');
  }

  private submit(request: PhoneSignInRequest): void {
    this.auth
      .phoneSignIn(request)
      .pipe(timeout(REQUEST_TIMEOUT_MS))
      .subscribe({
        next: (res) => {
          this.busy.set(false);
          this.clearCooldown();
          this.auth.saveAuth(res.session);
          this.signedIn.emit(res);
        },
        error: (err) => this.onSignInRefused(err),
      });
  }

  private onSignInRefused(err: {
    status?: number;
    name?: string;
    error?: { message?: string; field?: string; needsDetails?: boolean; verifyAgain?: boolean };
  }): void {
    const message = err.error?.message;

    // The number is proved and new. Asking for the details is the expected next step, not an
    // error - unless they were already being asked for, in which case the API says what is wrong.
    if (err.status === 400 && err.error?.needsDetails) {
      const firstAsk = this.step() !== 'details';
      this.busy.set(false);
      this.clearCooldown();
      this.step.set('details');
      if (firstAsk) this.focus('input[name="fullName"]');
      else this.fail(message ?? 'Please check your details.');
      return;
    }
    if (err.status === 409 && err.error?.field === 'email') {
      this.busy.set(false);
      this.step.set('details');
      this.emailTaken.set(true);
      return;
    }
    // The ticket ran out (fifteen minutes, or too many tries): the number has to be proved again.
    if (err.status === 400 && err.error?.verifyAgain) {
      this.changeNumber();
      this.fail(message ?? 'Please verify your mobile number again.');
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
