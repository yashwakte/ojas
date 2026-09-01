import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { Register } from './register';
import { AuthService } from '../../services/auth.service';
import { Msg91WidgetService } from '../../services/msg91-widget.service';
import { AuthResponse, RegisterPendingResponse, RegistrationStepResponse } from '../../models/interfaces';

describe('Register', () => {
  let authServiceSpy: jasmine.SpyObj<AuthService>;
  let msg91WidgetServiceSpy: jasmine.SpyObj<Msg91WidgetService>;
  let router: Router;

  const authResponse: AuthResponse = {
    id: 'u1',
    fullName: 'Jane',
    email: 'jane@x.com',
    phone: '9876543210',
    role: 'customer',
  };

  // Registration no longer sends an email code, so devCode is null on this response.
  const pendingResponse: RegisterPendingResponse = {
    email: 'jane@x.com',
    message: 'Now verify your mobile number.',
    devCode: null,
  };

  /** Phone verified - which is what issues the session - with the address still unconfirmed.
   * This is the ordinary outcome for a real customer. */
  const phoneVerifiedStep: RegistrationStepResponse = {
    message: 'ok',
    emailVerified: false,
    phoneVerified: true,
    email: 'jane@x.com',
    phone: '9876543210',
    session: authResponse,
  };

  function makeAuthServiceSpy() {
    const spy = jasmine.createSpyObj('AuthService', [
      'register',
      'verifyEmailOtp',
      'resendEmailOtp',
      'verifyPhoneRegistration',
      'saveAuth',
      'checkEmail',
      'checkPhone',
    ]);
    spy.checkEmail.and.returnValue(of({ exists: false }));
    spy.checkPhone.and.returnValue(of({ exists: false }));
    spy.resendEmailOtp.and.returnValue(of({ message: 'ok', devCode: null }));
    spy.register.and.returnValue(of(pendingResponse));
    spy.verifyPhoneRegistration.and.returnValue(of(phoneVerifiedStep));
    return spy;
  }

  function makeWidgetSpy() {
    const spy = jasmine.createSpyObj('Msg91WidgetService', ['initialize', 'preload', 'sendOtp', 'verifyOtp'], {
      captchaElementId: 'msg91-phone-captcha',
    });
    spy.initialize.and.returnValue(Promise.resolve());
    spy.sendOtp.and.returnValue(Promise.resolve());
    return spy;
  }

  beforeEach(() => {
    authServiceSpy = makeAuthServiceSpy();
    msg91WidgetServiceSpy = makeWidgetSpy();

    TestBed.configureTestingModule({
      imports: [Register],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: authServiceSpy },
        { provide: Msg91WidgetService, useValue: msg91WidgetServiceSpy },
      ],
    });
    router = TestBed.inject(Router);
  });

  function create() {
    const fixture = TestBed.createComponent(Register);
    fixture.componentInstance.turnstileToken = 'test-turnstile-token';
    fixture.detectChanges();
    return { fixture };
  }

  function fillValidForm(fixture: ReturnType<typeof create>['fixture']) {
    const form = fixture.componentInstance.registerForm;
    form.get('fullName')?.setValue('Jane Doe');
    form.get('password')?.setValue('123456789A');
    form.get('email')?.setValue('jane@x.com');
    form.get('phone')?.setValue('9876543210');
  }

  /** Drives the form through to the verification screen. The async validators are debounced by
   * 200ms, so the clock has to be advanced past that before the form counts as valid. */
  function submitToVerifyStage(fixture: ReturnType<typeof create>['fixture']) {
    fillValidForm(fixture);
    jasmine.clock().tick(200);
    fixture.componentInstance.onSubmit();
    fixture.detectChanges();
  }

  it('should create with an invalid, empty form', () => {
    const { fixture } = create();
    expect(fixture.componentInstance.registerForm.invalid).toBeTrue();
  });

  it('starts downloading the widget script on load, not when the phone step is reached', () => {
    // The script is the slowest part of the flow; fetching it while the form is being filled in
    // is the only free window there is.
    create();
    expect(msg91WidgetServiceSpy.preload).toHaveBeenCalled();
  });

  it('fullName requires at least 2 characters', () => {
    const { fixture } = create();
    const control = fixture.componentInstance.registerForm.get('fullName')!;
    control.setValue('J');
    expect(control.hasError('minlength')).toBeTrue();
    control.setValue('Jo');
    expect(control.valid).toBeTrue();
  });

  it('phone requires a valid 10-digit Indian mobile pattern', () => {
    const { fixture } = create();
    const control = fixture.componentInstance.registerForm.get('phone')!;
    control.setValue('12345');
    expect(control.hasError('pattern')).toBeTrue();
  });

  it('emailChecking/phoneChecking report true while the async validators are pending', () => {
    const { fixture } = create();
    const form = fixture.componentInstance.registerForm;

    jasmine.clock().install();
    try {
      form.get('email')?.setValue('jane@x.com');
      form.get('phone')?.setValue('9876543210');

      expect(fixture.componentInstance.emailChecking).toBeTrue();
      expect(fixture.componentInstance.phoneChecking).toBeTrue();

      jasmine.clock().tick(200);
      expect(fixture.componentInstance.emailChecking).toBeFalse();
      expect(fixture.componentInstance.phoneChecking).toBeFalse();
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('flags the email control invalid when checkEmail reports it already exists', () => {
    authServiceSpy.checkEmail.and.returnValue(of({ exists: true }));
    const { fixture } = create();
    const control = fixture.componentInstance.registerForm.get('email')!;

    jasmine.clock().install();
    try {
      control.setValue('taken@x.com');
      jasmine.clock().tick(200);
      expect(control.hasError('serverError')).toBeTrue();
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('flags the phone control invalid when checkPhone reports it already exists', () => {
    authServiceSpy.checkPhone.and.returnValue(of({ exists: true }));
    const { fixture } = create();
    const control = fixture.componentInstance.registerForm.get('phone')!;

    jasmine.clock().install();
    try {
      control.setValue('9876543210');
      jasmine.clock().tick(200);
      expect(control.hasError('serverError')).toBeTrue();
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('onSubmit does nothing when the form is invalid', () => {
    const { fixture } = create();
    fixture.componentInstance.onSubmit();
    expect(authServiceSpy.register).not.toHaveBeenCalled();
  });

  it('onSubmit does nothing until the Turnstile widget has been solved', () => {
    const { fixture } = create();
    fillValidForm(fixture);
    fixture.componentInstance.turnstileToken = null;

    fixture.componentInstance.onSubmit();

    expect(authServiceSpy.register).not.toHaveBeenCalled();
  });

  it('onSubmit includes the Turnstile token in the register request', () => {
    const { fixture } = create();

    jasmine.clock().install();
    try {
      fillValidForm(fixture);
      jasmine.clock().tick(200);
      fixture.componentInstance.turnstileToken = 'solved-token';
      fixture.componentInstance.onSubmit();

      expect(authServiceSpy.register).toHaveBeenCalledWith(
        jasmine.objectContaining({ turnstileToken: 'solved-token' }),
      );
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('a failed submit clears the spent Turnstile token so the widget must be resolved again', () => {
    authServiceSpy.register.and.returnValue(throwError(() => ({ status: 500, error: {} })));
    const { fixture } = create();

    jasmine.clock().install();
    try {
      fillValidForm(fixture);
      jasmine.clock().tick(200);
      fixture.componentInstance.onSubmit();

      expect(fixture.componentInstance.turnstileToken).toBeNull();
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('registering goes straight to the verification screen and never asks for an email code', () => {
    const { fixture } = create();

    jasmine.clock().install();
    try {
      submitToVerifyStage(fixture);

      expect(fixture.componentInstance.stage).toBe('verify');
      expect(fixture.componentInstance.pendingEmail).toBe('jane@x.com');
      expect(fixture.componentInstance.pendingPhone).toBe('9876543210');
      // The whole point of the change: no email is sent unless the customer asks for one.
      expect(authServiceSpy.resendEmailOtp).not.toHaveBeenCalled();
      expect(authServiceSpy.saveAuth).not.toHaveBeenCalled();
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('arriving with ?verifyPhone=...&email=... opens the verification screen directly', () => {
    TestBed.resetTestingModule();
    authServiceSpy = makeAuthServiceSpy();
    msg91WidgetServiceSpy = makeWidgetSpy();

    TestBed.configureTestingModule({
      imports: [Register],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: authServiceSpy },
        { provide: Msg91WidgetService, useValue: msg91WidgetServiceSpy },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              queryParamMap: convertToParamMap({ verifyPhone: '9876543210', email: 'stuck@example.com' }),
            },
          },
        },
      ],
    });

    const fixture = TestBed.createComponent(Register);
    expect(() => fixture.detectChanges()).not.toThrow();

    expect(fixture.componentInstance.stage).toBe('verify');
    expect(fixture.componentInstance.pendingPhone).toBe('9876543210');
    expect(fixture.componentInstance.pendingEmail).toBe('stuck@example.com');
    expect(msg91WidgetServiceSpy.initialize).toHaveBeenCalled();
  });

  describe('phone verification', () => {
    it('holds the Send button back until the widget has actually initialised', async () => {
      // A customer who taps before initSendOTP has run gets a failure that reads like a bad code
      // when in fact nothing was ever sent - this is the guard against that.
      let resolveInit!: () => void;
      msg91WidgetServiceSpy.initialize.and.returnValue(new Promise<void>((r) => (resolveInit = r)));
      const { fixture } = create();

      jasmine.clock().install();
      submitToVerifyStage(fixture);
      jasmine.clock().uninstall();

      expect(fixture.componentInstance.widgetReady).toBeFalse();
      fixture.componentInstance.sendPhoneCode();
      expect(msg91WidgetServiceSpy.sendOtp).not.toHaveBeenCalled();

      resolveInit();
      await fixture.whenStable();

      expect(fixture.componentInstance.widgetReady).toBeTrue();
    });

    it('shows "not available" when the widget fails to initialise', async () => {
      msg91WidgetServiceSpy.initialize.and.returnValue(Promise.reject(new Error('script blocked')));
      const { fixture } = create();

      jasmine.clock().install();
      submitToVerifyStage(fixture);
      jasmine.clock().uninstall();
      await fixture.whenStable();

      expect(fixture.componentInstance.phoneUnavailable).toBeTrue();
      expect(fixture.componentInstance.widgetReady).toBeFalse();
    });

    it('sending a code advances to the code sub-stage', async () => {
      const { fixture } = create();

      jasmine.clock().install();
      submitToVerifyStage(fixture);
      jasmine.clock().uninstall();
      await fixture.whenStable();

      fixture.componentInstance.sendPhoneCode();
      await fixture.whenStable();

      expect(msg91WidgetServiceSpy.sendOtp).toHaveBeenCalledWith('9876543210');
      expect(fixture.componentInstance.phoneSubStage).toBe('code');
    });

    it('surfaces the widget failure message when sending fails', async () => {
      msg91WidgetServiceSpy.sendOtp.and.returnValue(
        Promise.reject(new Error('Too many attempts. Please wait a minute.')),
      );
      const { fixture } = create();

      jasmine.clock().install();
      submitToVerifyStage(fixture);
      jasmine.clock().uninstall();
      await fixture.whenStable();

      fixture.componentInstance.sendPhoneCode();
      // Zoneless: a bare Promise.reject() settled before .catch() attaches isn't tracked by
      // whenStable()'s pending-task signal, so flush the microtask queue explicitly.
      await Promise.resolve();
      await Promise.resolve();

      expect(fixture.componentInstance.phoneError).toBe('Too many attempts. Please wait a minute.');
      expect(fixture.componentInstance.phoneSubStage).toBe('send');
    });

    it('verifyPhoneCode does nothing until a full 4-digit code is entered', async () => {
      const { fixture } = create();

      jasmine.clock().install();
      submitToVerifyStage(fixture);
      jasmine.clock().uninstall();
      await fixture.whenStable();

      fixture.componentInstance.phoneCode = '12';
      fixture.componentInstance.verifyPhoneCode();

      expect(msg91WidgetServiceSpy.verifyOtp).not.toHaveBeenCalled();
      expect(authServiceSpy.verifyPhoneRegistration).not.toHaveBeenCalled();
    });

    it('a valid code finishes registration and signs the customer in, unverified email and all', async () => {
      msg91WidgetServiceSpy.verifyOtp.and.returnValue(Promise.resolve('widget-access-token'));
      spyOn(router, 'navigate');
      const { fixture } = create();

      jasmine.clock().install();
      submitToVerifyStage(fixture);
      jasmine.clock().uninstall();
      await fixture.whenStable();

      fixture.componentInstance.phoneCode = '2468';
      fixture.componentInstance.verifyPhoneCode();
      await fixture.whenStable();

      expect(authServiceSpy.verifyPhoneRegistration).toHaveBeenCalledWith({
        phone: '9876543210',
        widgetToken: 'widget-access-token',
      });
      expect(authServiceSpy.saveAuth).toHaveBeenCalledWith(authResponse);
      expect(router.navigate).toHaveBeenCalledWith(['/']);
    });

    it('shows the server message and stays put when the backend rejects the token', async () => {
      msg91WidgetServiceSpy.verifyOtp.and.returnValue(Promise.resolve('widget-access-token'));
      authServiceSpy.verifyPhoneRegistration.and.returnValue(
        throwError(() => ({ status: 400, error: { message: 'That code is invalid or has expired.' } })),
      );
      const { fixture } = create();

      jasmine.clock().install();
      submitToVerifyStage(fixture);
      jasmine.clock().uninstall();
      await fixture.whenStable();

      fixture.componentInstance.phoneCode = '0000';
      fixture.componentInstance.verifyPhoneCode();
      await fixture.whenStable();

      expect(fixture.componentInstance.phoneError).toBe('That code is invalid or has expired.');
      expect(authServiceSpy.saveAuth).not.toHaveBeenCalled();
    });
  });

  describe('optional email verification', () => {
    it('sends nothing until the customer presses Verify', async () => {
      const { fixture } = create();

      jasmine.clock().install();
      submitToVerifyStage(fixture);
      jasmine.clock().uninstall();
      await fixture.whenStable();

      expect(authServiceSpy.resendEmailOtp).not.toHaveBeenCalled();
      expect(fixture.componentInstance.emailStage).toBe('idle');
    });

    it('pressing Verify requests a code and opens the code entry', async () => {
      const { fixture } = create();

      jasmine.clock().install();
      submitToVerifyStage(fixture);
      fixture.componentInstance.startEmailVerification();

      expect(authServiceSpy.resendEmailOtp).toHaveBeenCalledWith({ email: 'jane@x.com' });
      expect(fixture.componentInstance.emailStage).toBe('code');
      expect(fixture.componentInstance.resendCooldown).toBeGreaterThan(0);
      jasmine.clock().uninstall();
      await fixture.whenStable();
    });

    it('a correct code marks the email verified without disturbing the phone step', async () => {
      authServiceSpy.verifyEmailOtp.and.returnValue(
        of({
          message: 'ok',
          emailVerified: true,
          phoneVerified: false,
          email: 'jane@x.com',
          phone: '9876543210',
          session: null,
        }),
      );
      const { fixture } = create();

      jasmine.clock().install();
      submitToVerifyStage(fixture);
      fixture.componentInstance.startEmailVerification();
      fixture.componentInstance.emailCode = '123456';
      fixture.componentInstance.verifyEmailCode();
      jasmine.clock().uninstall();

      expect(fixture.componentInstance.emailVerified).toBeTrue();
      expect(fixture.componentInstance.emailStage).toBe('idle');
      expect(authServiceSpy.saveAuth).not.toHaveBeenCalled();
    });

    it('verifying the email after the phone signs the customer in', async () => {
      authServiceSpy.verifyEmailOtp.and.returnValue(
        of({
          message: 'ok',
          emailVerified: true,
          phoneVerified: true,
          email: 'jane@x.com',
          phone: '9876543210',
          session: authResponse,
        }),
      );
      spyOn(router, 'navigate');
      const { fixture } = create();

      jasmine.clock().install();
      submitToVerifyStage(fixture);
      fixture.componentInstance.startEmailVerification();
      fixture.componentInstance.emailCode = '123456';
      fixture.componentInstance.verifyEmailCode();
      jasmine.clock().uninstall();

      expect(authServiceSpy.saveAuth).toHaveBeenCalledWith(authResponse);
      expect(router.navigate).toHaveBeenCalledWith(['/']);
    });

    it('surfaces a bad email code without clearing the screen', async () => {
      authServiceSpy.verifyEmailOtp.and.returnValue(
        throwError(() => ({ status: 400, error: { message: 'That code is invalid or has expired.' } })),
      );
      const { fixture } = create();

      jasmine.clock().install();
      submitToVerifyStage(fixture);
      fixture.componentInstance.startEmailVerification();
      fixture.componentInstance.emailCode = '000000';
      fixture.componentInstance.verifyEmailCode();
      jasmine.clock().uninstall();

      expect(fixture.componentInstance.emailError).toBe('That code is invalid or has expired.');
      expect(fixture.componentInstance.emailVerified).toBeFalse();
      expect(fixture.componentInstance.emailStage).toBe('code');
    });

    it('will not resend while the cooldown is running', async () => {
      const { fixture } = create();

      jasmine.clock().install();
      submitToVerifyStage(fixture);
      fixture.componentInstance.startEmailVerification();
      authServiceSpy.resendEmailOtp.calls.reset();

      fixture.componentInstance.resendEmailCode();

      expect(authServiceSpy.resendEmailOtp).not.toHaveBeenCalled();
      jasmine.clock().uninstall();
      await fixture.whenStable();
    });
  });

  it('sets a field-level error on 409 with field=email', () => {
    authServiceSpy.register.and.returnValue(throwError(() => ({ status: 409, error: { field: 'email' } })));
    const { fixture } = create();

    jasmine.clock().install();
    try {
      fillValidForm(fixture);
      jasmine.clock().tick(200);
      fixture.componentInstance.onSubmit();
      expect(fixture.componentInstance.registerForm.get('email')?.hasError('serverError')).toBeTrue();
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('sets a field-level error on 409 with field=phone', () => {
    authServiceSpy.register.and.returnValue(throwError(() => ({ status: 409, error: { field: 'phone' } })));
    const { fixture } = create();

    jasmine.clock().install();
    try {
      fillValidForm(fixture);
      jasmine.clock().tick(200);
      fixture.componentInstance.onSubmit();
      expect(fixture.componentInstance.registerForm.get('phone')?.hasError('serverError')).toBeTrue();
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('sets serverError text on 409 without a specific field', () => {
    authServiceSpy.register.and.returnValue(throwError(() => ({ status: 409, error: {} })));
    const { fixture } = create();

    jasmine.clock().install();
    try {
      fillValidForm(fixture);
      jasmine.clock().tick(200);
      fixture.componentInstance.onSubmit();
      expect(fixture.componentInstance.serverError).toBe('This email or phone is already registered.');
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('sets a rate-limit serverError on 429', () => {
    authServiceSpy.register.and.returnValue(throwError(() => ({ status: 429 })));
    const { fixture } = create();

    jasmine.clock().install();
    try {
      fillValidForm(fixture);
      jasmine.clock().tick(200);
      fixture.componentInstance.onSubmit();
      expect(fixture.componentInstance.serverError).toBe('Too many attempts. Please wait a minute and try again.');
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('sets a server-unreachable serverError on status 0', () => {
    authServiceSpy.register.and.returnValue(throwError(() => ({ status: 0 })));
    const { fixture } = create();

    jasmine.clock().install();
    try {
      fillValidForm(fixture);
      jasmine.clock().tick(200);
      fixture.componentInstance.onSubmit();
      expect(fixture.componentInstance.serverError).toBe(
        'Server not reachable. Please check your connection and try again.',
      );
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('falls back to a generic serverError for other failures', () => {
    authServiceSpy.register.and.returnValue(throwError(() => ({ status: 500, error: {} })));
    const { fixture } = create();

    jasmine.clock().install();
    try {
      fillValidForm(fixture);
      jasmine.clock().tick(200);
      fixture.componentInstance.onSubmit();
      expect(fixture.componentInstance.serverError).toBe('Registration failed. Please try again.');
    } finally {
      jasmine.clock().uninstall();
    }
  });
});
