import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { timeout } from 'rxjs';
import { UserService } from '../../services/user.service';
import { Msg91WidgetService } from '../../services/msg91-widget.service';
import { ScrollLockService } from '../../services/scroll-lock.service';
import { DigitsOnlyDirective } from '../../directives/digits-only.directive';
import { UserProfileResponse } from '../../models/interfaces';

export type ContactSheetMode = 'verify-email' | 'change-email' | 'change-phone';

const RESEND_COOLDOWN_SECONDS = 30;
const REQUEST_TIMEOUT_MS = 15_000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_PATTERN = /^[6-9]\d{9}$/;

/**
 * Confirming the account's email, or moving the account to a new email or mobile number.
 *
 * The profile form used to save both as typed, so a customer could put any number on their
 * account - someone else's, or one that does not exist - and every delivery call went to it.
 * Nothing is stored now until a code sent to the new detail comes back - the code alone, with no
 * password on top: the owner's call, since the customer is already signed in.
 *
 * Email codes are ours, sent by the API. Phone codes go through MSG91's widget, exactly as at
 * registration: the widget texts the code and hands back a token, and the API checks that token
 * with MSG91 and binds it to the number before storing it.
 *
 * Same surface as the quantity sheet and the address picker - bottom sheet on a phone, centred
 * card on a desktop - so this reads as part of the app, not a system dialog.
 */
@Component({
  selector: 'app-contact-verify-sheet',
  imports: [
    FormsModule,
    DigitsOnlyDirective,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './contact-verify-sheet.html',
  styleUrl: './contact-verify-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'close()',
  },
})
export class ContactVerifySheet implements OnInit, OnDestroy {
  readonly mode = input.required<ContactSheetMode>();
  readonly currentEmail = input.required<string>();
  readonly currentPhone = input.required<string>();

  /** Fires with the updated profile the moment the change is saved; the sheet then shows its
   * confirmation until the customer closes it. */
  readonly completed = output<UserProfileResponse>();
  readonly closed = output<void>();

  private readonly userService = inject(UserService);
  private readonly msg91 = inject(Msg91WidgetService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly releaseScroll = inject(ScrollLockService).lock();

  protected readonly captchaId = this.msg91.captchaElementId;

  protected readonly step = signal<'details' | 'code' | 'done'>('details');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly devCode = signal<string | null>(null);
  protected readonly cooldown = signal(0);
  protected readonly widgetReady = signal(false);
  protected readonly widgetUnavailable = signal(false);
  /** Where the code went: the new address or number, or the current email when confirming it. */
  protected readonly target = signal('');

  protected newValue = '';
  protected code = '';

  private cooldownTimer: ReturnType<typeof setInterval> | null = null;

  protected readonly isPhone = computed(() => this.mode() === 'change-phone');
  protected readonly codeLength = computed(() => (this.isPhone() ? 4 : 6));

  protected readonly title = computed(() => {
    switch (this.mode()) {
      case 'verify-email':
        return 'Verify your email';
      case 'change-email':
        return 'Change your email';
      case 'change-phone':
        return 'Change your mobile number';
    }
  });

  protected readonly subtitle = computed(() =>
    this.mode() === 'change-phone'
      ? `Currently +91 ${this.currentPhone()}`
      : this.mode() === 'change-email'
        ? `Currently ${this.currentEmail()}`
        : this.currentEmail(),
  );

  protected readonly doneTitle = computed(() => {
    switch (this.mode()) {
      case 'verify-email':
        return 'Email verified';
      case 'change-email':
        return 'Email updated';
      case 'change-phone':
        return 'Number updated';
    }
  });

  protected readonly doneText = computed(() => {
    switch (this.mode()) {
      case 'verify-email':
        return 'Order receipts and password resets will reach you here.';
      case 'change-email':
        return `Your account now uses ${this.target()}, and it is verified.`;
      case 'change-phone':
        return `Deliveries and order updates will now come to +91 ${this.target()}.`;
    }
  });

  constructor() {
    // MSG91 renders its captcha into an element it looks up by id, so the widget can only be set
    // up once this sheet's template - which holds that element - is on the page.
    afterNextRender(() => {
      if (this.isPhone()) this.initWidget();
      this.focusFirstField();
    });
  }

  ngOnInit(): void {
    if (this.mode() === 'verify-email') {
      // Nothing to type but the code, so the sheet opens on it and sends straight away.
      this.target.set(this.currentEmail());
      this.step.set('code');
      this.sendEmailCode();
    } else if (this.isPhone()) {
      this.msg91.preload();
    }
  }

  ngOnDestroy(): void {
    this.releaseScroll();
    this.clearCooldown();
  }

  /** The new detail as it will be sent: digits only for a number (so "+91 98765 43210" works),
   * trimmed and lower-cased for an address, as the API stores it. */
  private normalizedNewValue(): string {
    return this.isPhone()
      ? this.newValue.replace(/\D/g, '').slice(-10)
      : this.newValue.trim().toLowerCase();
  }

  protected get sameAsCurrent(): boolean {
    const value = this.normalizedNewValue();
    return this.isPhone()
      ? value === this.currentPhone()
      : value === this.currentEmail().trim().toLowerCase();
  }

  protected get detailsValid(): boolean {
    const value = this.normalizedNewValue();
    const valid = this.isPhone() ? PHONE_PATTERN.test(value) : EMAIL_PATTERN.test(value);
    return valid && !this.sameAsCurrent;
  }

  protected submitDetails(): void {
    if (this.busy() || !this.detailsValid) return;
    if (this.isPhone() && !this.widgetReady()) return;

    const value = this.normalizedNewValue();
    this.error.set('');

    if (!this.isPhone()) {
      this.target.set(value);
      this.sendEmailCode(() => this.showCodeStep());
      return;
    }

    this.busy.set(true);
    this.userService
      .startPhoneChange({ phone: value })
      .pipe(timeout(REQUEST_TIMEOUT_MS))
      .subscribe({
        next: () =>
          this.msg91.sendOtp(value).then(
            () => {
              this.busy.set(false);
              this.target.set(value);
              this.showCodeStep();
            },
            (e: Error) => this.fail(e.message || 'Could not send the code. Please try again.'),
          ),
        error: (err) => this.fail(messageFor(err, "We couldn't start the change. Please try again.")),
      });
  }

  protected submitCode(): void {
    const code = this.code.trim();
    if (this.busy() || code.length !== this.codeLength()) return;

    this.busy.set(true);
    this.error.set('');

    if (this.isPhone()) {
      this.msg91.verifyOtp(code).then(
        (widgetToken) =>
          this.userService
            .verifyPhoneChange({ phone: this.target(), widgetToken })
            .pipe(timeout(REQUEST_TIMEOUT_MS))
            .subscribe({
              next: (profile) => this.finish(profile),
              error: (err) => this.fail(messageFor(err, 'That code is invalid or has expired.')),
            }),
        (e: Error) => this.fail(e.message || 'That code is invalid or has expired.'),
      );
      return;
    }

    this.userService
      .verifyEmailCode({ email: this.target(), code })
      .pipe(timeout(REQUEST_TIMEOUT_MS))
      .subscribe({
        next: (profile) => this.finish(profile),
        error: (err) => this.fail(messageFor(err, 'That code is invalid or has expired.')),
      });
  }

  protected resendEmailCode(): void {
    if (this.cooldown() > 0 || this.busy()) return;
    this.code = '';
    this.sendEmailCode();
  }

  /** Back to the form, keeping what was typed - for a mistyped address, or a text that never
   * came (sending again goes through the password check and the widget afresh). */
  protected backToDetails(): void {
    this.code = '';
    this.error.set('');
    this.step.set('details');
    this.focusFirstField();
  }

  close(): void {
    this.closed.emit();
  }

  private sendEmailCode(onSent?: () => void): void {
    this.busy.set(true);
    this.error.set('');

    this.userService
      .sendEmailCode({ email: this.target() })
      .pipe(timeout(REQUEST_TIMEOUT_MS))
      .subscribe({
        next: (res) => {
          this.busy.set(false);
          this.devCode.set(res.devCode ?? null);
          this.startCooldown();
          onSent?.();
        },
        error: (err) => {
          this.fail(messageFor(err, "We couldn't send the code. Please try again in a moment."));
          // Starts even on failure when a resend is on offer, so a broken send cannot be hammered.
          if (this.step() === 'code') this.startCooldown();
        },
      });
  }

  private initWidget(): void {
    this.msg91.initialize().then(
      () => this.widgetReady.set(true),
      () => this.widgetUnavailable.set(true),
    );
  }

  private showCodeStep(): void {
    this.code = '';
    this.step.set('code');
    this.focusFirstField();
  }

  private finish(profile: UserProfileResponse): void {
    this.busy.set(false);
    this.clearCooldown();
    this.step.set('done');
    this.completed.emit(profile);
  }

  private fail(message: string): void {
    this.busy.set(false);
    this.error.set(message);
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

  /** The step's first field, once the step has been drawn. */
  private focusFirstField(): void {
    setTimeout(() => this.host.nativeElement.querySelector<HTMLInputElement>('.cv-step input')?.focus(), 60);
  }
}

function messageFor(err: unknown, fallback: string): string {
  const e = err as { name?: string; status?: number; error?: { message?: string } };
  if (e?.name === 'TimeoutError') return 'That is taking too long. Please try again.';
  if (e?.status === 0) return 'You seem to be offline. Check your connection and try again.';
  if (e?.status === 429) return 'Too many attempts. Please wait a few minutes and try again.';
  return e?.error?.message ?? fallback;
}
