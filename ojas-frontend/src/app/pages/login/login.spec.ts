import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject, of, throwError } from 'rxjs';
import { Login } from './login';
import { AuthService } from '../../services/auth.service';
import { Msg91WidgetService } from '../../services/msg91-widget.service';
import { AuthResponse } from '../../models/interfaces';

describe('Login', () => {
  let authServiceSpy: jasmine.SpyObj<AuthService>;
  let msg91WidgetServiceSpy: jasmine.SpyObj<Msg91WidgetService>;
  let router: Router;

  const authResponse: AuthResponse = {
    id: 'u1',
    fullName: 'Jane',
    email: 'jane@x.com',
    phone: '9999999999',
    role: 'customer',
  };

  beforeEach(() => {
    authServiceSpy = jasmine.createSpyObj('AuthService', [
      'login',
      'saveAuth',
      'getDefaultRouteForRole',
      'sendDeviceOtp',
      'enrollDevice',
      'enrollPreApprovedDevice',
      'forgotPassword',
      'resetPassword',
      'verifyPhoneLogin',
    ]);
    authServiceSpy.getDefaultRouteForRole.and.returnValue('/');
    authServiceSpy.sendDeviceOtp.and.returnValue(of({ message: 'sent', devCode: null }));

    msg91WidgetServiceSpy = jasmine.createSpyObj('Msg91WidgetService', ['initialize', 'sendOtp', 'verifyOtp'], {
      captchaElementId: 'msg91-phone-captcha',
    });
    msg91WidgetServiceSpy.initialize.and.returnValue(Promise.resolve());

    TestBed.configureTestingModule({
      imports: [Login],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: authServiceSpy },
        { provide: Msg91WidgetService, useValue: msg91WidgetServiceSpy },
      ],
    });
    router = TestBed.inject(Router);
  });

  // MatSnackBarModule declares its own `providers: [MatSnackBar]`, and importing it into this
  // standalone component pulls that provider into the component's own injector - shadowing any
  // TestBed-level override. So we spy on the real, component-scoped instance instead of mocking it.
  //
  // Everything in this file except the dedicated Turnstile tests below is testing other
  // concerns, so treat "widget already solved" as the default baseline rather than making
  // every single test set this explicitly.
  function create() {
    const fixture = TestBed.createComponent(Login);
    fixture.componentInstance.turnstileToken = 'test-turnstile-token';
    fixture.detectChanges();
    const snackBar = fixture.debugElement.injector.get(MatSnackBar);
    spyOn(snackBar, 'open').and.stub();
    return { fixture, snackBar };
  }

  it('should create with an invalid, empty form', () => {
    const { fixture } = create();
    expect(fixture.componentInstance.loginForm.invalid).toBeTrue();
  });

  it('requires a valid email and a password of at least 6 characters', () => {
    const { fixture } = create();
    const form = fixture.componentInstance.loginForm;

    form.get('email')?.setValue('not-an-email');
    form.get('password')?.setValue('12345');
    expect(form.invalid).toBeTrue();
    expect(form.get('email')?.hasError('email')).toBeTrue();
    expect(form.get('password')?.hasError('minlength')).toBeTrue();

    form.get('email')?.setValue('jane@x.com');
    form.get('password')?.setValue('123456');
    expect(form.valid).toBeTrue();
  });

  it('onSubmit does nothing when the form is invalid', () => {
    const { fixture } = create();
    fixture.componentInstance.onSubmit();
    expect(authServiceSpy.login).not.toHaveBeenCalled();
  });

  it('onSubmit does nothing until the Turnstile widget has been solved', () => {
    const { fixture } = create();
    fixture.componentInstance.loginForm.setValue({ email: 'jane@x.com', password: '123456' });
    fixture.componentInstance.turnstileToken = null;

    fixture.componentInstance.onSubmit();

    expect(authServiceSpy.login).not.toHaveBeenCalled();
  });

  it('onSubmit includes the Turnstile token in the login request', () => {
    authServiceSpy.login.and.returnValue(of(authResponse));
    const { fixture } = create();
    fixture.componentInstance.loginForm.setValue({ email: 'jane@x.com', password: '123456' });
    fixture.componentInstance.turnstileToken = 'solved-token';

    fixture.componentInstance.onSubmit();

    expect(authServiceSpy.login).toHaveBeenCalledWith(
      jasmine.objectContaining({ turnstileToken: 'solved-token' }),
    );
  });

  it('a failed submit clears the spent Turnstile token so the widget must be resolved again', () => {
    authServiceSpy.login.and.returnValue(throwError(() => ({ status: 500 })));
    const { fixture } = create();
    fixture.componentInstance.loginForm.setValue({ email: 'jane@x.com', password: '123456' });

    fixture.componentInstance.onSubmit();

    expect(fixture.componentInstance.turnstileToken).toBeNull();
  });

  it('onSubmit logs in, saves auth, celebrates, and navigates to the role home on success', () => {
    authServiceSpy.login.and.returnValue(of(authResponse));
    spyOn(router, 'navigateByUrl');
    const { fixture } = create();
    fixture.componentInstance.loginForm.setValue({ email: 'jane@x.com', password: '123456' });

    fixture.componentInstance.onSubmit();

    expect(authServiceSpy.saveAuth).toHaveBeenCalledWith(authResponse);
    // The success snackbar was replaced by the welcome celebration overlay.
    expect(router.navigateByUrl).toHaveBeenCalledWith('/');
    expect(fixture.componentInstance.loading).toBeFalse();
  });

  it('shows an "Invalid email or password" message for a 401', () => {
    authServiceSpy.login.and.returnValue(throwError(() => ({ status: 401 })));
    const { fixture, snackBar } = create();
    fixture.componentInstance.loginForm.setValue({ email: 'jane@x.com', password: '123456' });

    fixture.componentInstance.onSubmit();

    expect(snackBar.open).toHaveBeenCalledWith('Invalid email or password', 'Close', jasmine.any(Object));
    expect(fixture.componentInstance.loading).toBeFalse();
  });

  it('shows the server Turnstile-failure message for a 400 - distinct from bad credentials', () => {
    authServiceSpy.login.and.returnValue(
      throwError(() => ({ status: 400, error: { message: 'Verification failed. Please try again.' } })),
    );
    const { fixture, snackBar } = create();
    fixture.componentInstance.loginForm.setValue({ email: 'jane@x.com', password: '123456' });

    fixture.componentInstance.onSubmit();

    expect(snackBar.open).toHaveBeenCalledWith(
      'Verification failed. Please try again.',
      'Close',
      jasmine.any(Object),
    );
  });

  it('shows a rate-limit message for 429 errors', () => {
    authServiceSpy.login.and.returnValue(throwError(() => ({ status: 429 })));
    const { fixture, snackBar } = create();
    fixture.componentInstance.loginForm.setValue({ email: 'jane@x.com', password: '123456' });

    fixture.componentInstance.onSubmit();

    expect(snackBar.open).toHaveBeenCalledWith(
      'Too many attempts. Please wait a minute.',
      'Close',
      jasmine.any(Object),
    );
  });

  it('shows a server-unreachable message for status 0 / TimeoutError', () => {
    authServiceSpy.login.and.returnValue(throwError(() => ({ status: 0 })));
    const { fixture, snackBar } = create();
    fixture.componentInstance.loginForm.setValue({ email: 'jane@x.com', password: '123456' });

    fixture.componentInstance.onSubmit();

    expect(snackBar.open).toHaveBeenCalledWith(
      'Server is taking too long. Please try again.',
      'Close',
      jasmine.any(Object),
    );
  });

  it('shows a generic error message for other failures', () => {
    authServiceSpy.login.and.returnValue(throwError(() => ({ status: 500 })));
    const { fixture, snackBar } = create();
    fixture.componentInstance.loginForm.setValue({ email: 'jane@x.com', password: '123456' });

    fixture.componentInstance.onSubmit();

    expect(snackBar.open).toHaveBeenCalledWith(
      'Something went wrong. Please try again.',
      'Close',
      jasmine.any(Object),
    );
  });

  describe('staff device approval', () => {
    const deviceBlocked = {
      status: 403,
      error: { needsDeviceEnrollment: true, email: 'admin@x.com' },
    };

    function blockedOnDevice() {
      authServiceSpy.login.and.returnValue(throwError(() => deviceBlocked));
      const created = create();
      created.fixture.componentInstance.loginForm.setValue({
        email: 'admin@x.com',
        password: '123456',
      });
      created.fixture.componentInstance.onSubmit();
      return created;
    }

    it('switches to the approval step and requests a code straight away', () => {
      const { fixture } = blockedOnDevice();

      expect(fixture.componentInstance.showDeviceStep).toBeTrue();
      expect(fixture.componentInstance.deviceEmail).toBe('admin@x.com');
      expect(authServiceSpy.sendDeviceOtp).toHaveBeenCalledWith({
        email: 'admin@x.com',
        password: '123456',
      });
    });

    it('does not navigate away to the email-verification screen', () => {
      spyOn(router, 'navigate');

      blockedOnDevice();

      // The two 403 shapes are easy to conflate - this one must stay on the login card.
      expect(router.navigate).not.toHaveBeenCalled();
    });

    it('surfaces the dev-mode code when the backend returns one', () => {
      authServiceSpy.sendDeviceOtp.and.returnValue(of({ message: 'sent', devCode: '123456' }));

      const { fixture } = blockedOnDevice();

      expect(fixture.componentInstance.deviceDevCode).toBe('123456');
    });

    it('enrollDevice does nothing until a full 6-digit code is entered', () => {
      const { fixture } = blockedOnDevice();
      fixture.componentInstance.deviceCode = '123';

      fixture.componentInstance.enrollDevice();

      expect(authServiceSpy.enrollDevice).not.toHaveBeenCalled();
    });

    it('a valid code enrolls the device, saves auth, and navigates to the role home', () => {
      authServiceSpy.enrollDevice.and.returnValue(of({ ...authResponse, role: 'admin' }));
      authServiceSpy.getDefaultRouteForRole.and.returnValue('/admin');
      spyOn(router, 'navigateByUrl');
      const { fixture } = blockedOnDevice();
      fixture.componentInstance.deviceCode = '654321';

      fixture.componentInstance.enrollDevice();

      expect(authServiceSpy.enrollDevice).toHaveBeenCalledWith({
        email: 'admin@x.com',
        password: '123456',
        code: '654321',
      });
      expect(authServiceSpy.saveAuth).toHaveBeenCalled();
      expect(router.navigateByUrl).toHaveBeenCalledWith('/admin');
    });

    it('shows the server message and stays put when the code is wrong', () => {
      authServiceSpy.enrollDevice.and.returnValue(
        throwError(() => ({ status: 400, error: { message: 'That code is invalid or has expired.' } })),
      );
      const { fixture } = blockedOnDevice();
      fixture.componentInstance.deviceCode = '000000';

      fixture.componentInstance.enrollDevice();

      expect(fixture.componentInstance.deviceError).toBe('That code is invalid or has expired.');
      expect(fixture.componentInstance.showDeviceStep).toBeTrue();
      expect(authServiceSpy.saveAuth).not.toHaveBeenCalled();
    });

    it('cancelling returns to the credentials form', () => {
      const { fixture } = blockedOnDevice();

      fixture.componentInstance.cancelDeviceEnrollment();

      expect(fixture.componentInstance.showDeviceStep).toBeFalse();
      expect(fixture.componentInstance.deviceCode).toBe('');
    });

    describe('admin pre-approval', () => {
      it('a pre-approved response enrolls automatically with no code, saves auth, and navigates home', () => {
        authServiceSpy.sendDeviceOtp.and.returnValue(of({ message: 'already approved', devCode: null, preApproved: true }));
        authServiceSpy.enrollPreApprovedDevice.and.returnValue(of({ ...authResponse, role: 'admin' }));
        authServiceSpy.getDefaultRouteForRole.and.returnValue('/admin');
        spyOn(router, 'navigateByUrl');

        const { fixture } = blockedOnDevice();

        expect(fixture.componentInstance.devicePreApproved).toBeTrue();
        expect(authServiceSpy.enrollPreApprovedDevice).toHaveBeenCalledWith({
          email: 'admin@x.com',
          password: '123456',
        });
        expect(authServiceSpy.saveAuth).toHaveBeenCalled();
        expect(router.navigateByUrl).toHaveBeenCalledWith('/admin');
      });

      it('surfaces the server error and drops back to preApproved:false if it fails', () => {
        authServiceSpy.sendDeviceOtp.and.returnValue(of({ message: 'already approved', devCode: null, preApproved: true }));
        authServiceSpy.enrollPreApprovedDevice.and.returnValue(
          throwError(() => ({ status: 400, error: { message: 'That approval is no longer valid.' } })),
        );

        const { fixture } = blockedOnDevice();

        expect(fixture.componentInstance.deviceError).toBe('That approval is no longer valid.');
        expect(fixture.componentInstance.devicePreApproved).toBeFalse();
        expect(authServiceSpy.saveAuth).not.toHaveBeenCalled();
      });
    });
  });

  describe('forgot password', () => {
    it('carries the already-typed email into the reset form', () => {
      const { fixture } = create();
      fixture.componentInstance.loginForm.patchValue({ email: 'jane@x.com' });

      fixture.componentInstance.startPasswordReset();

      expect(fixture.componentInstance.resetStage).toBe('request');
      expect(fixture.componentInstance.resetEmail).toBe('jane@x.com');
    });

    it('will not request a code without a solved Turnstile', () => {
      const { fixture } = create();
      fixture.componentInstance.startPasswordReset();
      fixture.componentInstance.resetEmail = 'jane@x.com';
      fixture.componentInstance.turnstileToken = null;

      fixture.componentInstance.requestResetCode();

      expect(authServiceSpy.forgotPassword).not.toHaveBeenCalled();
    });

    it('requesting a code advances to the reset stage and spends the Turnstile token', () => {
      authServiceSpy.forgotPassword.and.returnValue(of({ message: 'sent', devCode: null }));
      const { fixture } = create();
      fixture.componentInstance.startPasswordReset();
      fixture.componentInstance.resetEmail = 'jane@x.com';

      fixture.componentInstance.requestResetCode();

      expect(authServiceSpy.forgotPassword).toHaveBeenCalledWith({
        email: 'jane@x.com',
        turnstileToken: 'test-turnstile-token',
      });
      expect(fixture.componentInstance.resetStage).toBe('reset');
      expect(fixture.componentInstance.turnstileToken).toBeNull();
    });

    it('surfaces the dev-mode code when the backend returns one', () => {
      authServiceSpy.forgotPassword.and.returnValue(of({ message: 'sent', devCode: '424242' }));
      const { fixture } = create();
      fixture.componentInstance.startPasswordReset();
      fixture.componentInstance.resetEmail = 'jane@x.com';

      fixture.componentInstance.requestResetCode();

      expect(fixture.componentInstance.resetDevCode).toBe('424242');
    });

    it('rejects a new password shorter than 10 characters without calling the API', () => {
      const { fixture } = create();
      fixture.componentInstance.resetStage = 'reset';
      fixture.componentInstance.resetCode = '123456';
      fixture.componentInstance.resetNewPassword = 'tooshort';

      fixture.componentInstance.submitNewPassword();

      expect(authServiceSpy.resetPassword).not.toHaveBeenCalled();
    });

    it('a successful reset returns to sign-in with the email prefilled and no session', () => {
      authServiceSpy.resetPassword.and.returnValue(of({ message: 'ok' }));
      const { fixture, snackBar } = create();
      fixture.componentInstance.resetStage = 'reset';
      fixture.componentInstance.resetEmail = 'jane@x.com';
      fixture.componentInstance.resetCode = '123456';
      fixture.componentInstance.resetNewPassword = 'BrandNewPassw0rd!';

      fixture.componentInstance.submitNewPassword();

      expect(fixture.componentInstance.resetStage).toBe('none');
      expect(fixture.componentInstance.loginForm.value.email).toBe('jane@x.com');
      expect(fixture.componentInstance.loginForm.value.password).toBe('');
      // Reset deliberately issues no session, so nothing should have been saved.
      expect(authServiceSpy.saveAuth).not.toHaveBeenCalled();
      expect(snackBar.open).toHaveBeenCalledWith(
        'Password updated. Please sign in.',
        'Close',
        jasmine.any(Object),
      );
    });

    it('shows the server message and stays on the reset step when the code is wrong', () => {
      authServiceSpy.resetPassword.and.returnValue(
        throwError(() => ({ status: 400, error: { message: 'That code is invalid or has expired.' } })),
      );
      const { fixture } = create();
      fixture.componentInstance.resetStage = 'reset';
      fixture.componentInstance.resetEmail = 'jane@x.com';
      fixture.componentInstance.resetCode = '000000';
      fixture.componentInstance.resetNewPassword = 'BrandNewPassw0rd!';

      fixture.componentInstance.submitNewPassword();

      expect(fixture.componentInstance.resetError).toBe('That code is invalid or has expired.');
      expect(fixture.componentInstance.resetStage).toBe('reset');
    });

    it('cancelling returns to the credentials form', () => {
      const { fixture } = create();
      fixture.componentInstance.startPasswordReset();

      fixture.componentInstance.cancelPasswordReset();

      expect(fixture.componentInstance.resetStage).toBe('none');
    });
  });

  describe('phone login', () => {
    it('switching to phone mode resets the sub-flow to entering a number, and initialises the widget', () => {
      const { fixture } = create();

      fixture.componentInstance.switchToPhoneLogin();

      expect(fixture.componentInstance.loginMode).toBe('phone');
      expect(fixture.componentInstance.phoneStage).toBe('enter');
      expect(msg91WidgetServiceSpy.initialize).toHaveBeenCalled();
    });

    it('shows "not available" when the widget itself fails to initialise', async () => {
      msg91WidgetServiceSpy.initialize.and.returnValue(Promise.reject(new Error('script blocked')));
      const { fixture } = create();

      fixture.componentInstance.switchToPhoneLogin();
      await fixture.whenStable();

      expect(fixture.componentInstance.phoneUnavailable).toBeTrue();
    });

    it('will not send a code for an empty phone number', () => {
      const { fixture } = create();
      fixture.componentInstance.switchToPhoneLogin();
      fixture.componentInstance.phoneNumber = '';

      fixture.componentInstance.sendPhoneLoginCode();

      expect(msg91WidgetServiceSpy.sendOtp).not.toHaveBeenCalled();
    });

    it('sending a code asks the widget to send it, and advances to the code stage', async () => {
      msg91WidgetServiceSpy.sendOtp.and.returnValue(Promise.resolve());
      const { fixture } = create();
      fixture.componentInstance.switchToPhoneLogin();
      fixture.componentInstance.phoneNumber = '9123456789';

      fixture.componentInstance.sendPhoneLoginCode();
      await fixture.whenStable();

      expect(msg91WidgetServiceSpy.sendOtp).toHaveBeenCalledWith('9123456789');
      expect(fixture.componentInstance.phoneStage).toBe('code');
    });

    it('surfaces the widget failure message when sending fails', async () => {
      msg91WidgetServiceSpy.sendOtp.and.returnValue(Promise.reject(new Error('Too many attempts. Please wait a minute.')));
      const { fixture } = create();
      fixture.componentInstance.switchToPhoneLogin();
      fixture.componentInstance.phoneNumber = '9123456789';

      fixture.componentInstance.sendPhoneLoginCode();
      // Zoneless: a bare Promise.reject() settled before .then()/.catch() attach isn't tracked by
      // whenStable()'s pending-task signal, so flush the microtask queue explicitly instead.
      await Promise.resolve();
      await Promise.resolve();

      expect(fixture.componentInstance.phoneError).toBe('Too many attempts. Please wait a minute.');
      expect(fixture.componentInstance.phoneStage).toBe('enter');
    });

    it('verifyPhoneLoginCode does nothing until a full 4-digit code is entered', () => {
      const { fixture } = create();
      fixture.componentInstance.phoneCode = '12';

      fixture.componentInstance.verifyPhoneLoginCode();

      expect(msg91WidgetServiceSpy.verifyOtp).not.toHaveBeenCalled();
      expect(authServiceSpy.verifyPhoneLogin).not.toHaveBeenCalled();
    });

    it('a valid code verifies against the widget, signs in via the resulting token, and navigates home', async () => {
      msg91WidgetServiceSpy.verifyOtp.and.returnValue(Promise.resolve('widget-access-token'));
      authServiceSpy.verifyPhoneLogin.and.returnValue(of(authResponse));
      spyOn(router, 'navigateByUrl');
      const { fixture } = create();
      fixture.componentInstance.phoneNumber = '9123456789';
      fixture.componentInstance.phoneCode = '2468';

      fixture.componentInstance.verifyPhoneLoginCode();
      await fixture.whenStable();

      expect(msg91WidgetServiceSpy.verifyOtp).toHaveBeenCalledWith('2468');
      expect(authServiceSpy.verifyPhoneLogin).toHaveBeenCalledWith({
        phone: '9123456789',
        widgetToken: 'widget-access-token',
      });
      expect(authServiceSpy.saveAuth).toHaveBeenCalledWith(authResponse);
      expect(router.navigateByUrl).toHaveBeenCalledWith('/');
    });

    it('shows the widget failure message when the entered code itself is wrong', async () => {
      msg91WidgetServiceSpy.verifyOtp.and.returnValue(
        Promise.reject(new Error('That code is invalid or has expired.')),
      );
      const { fixture } = create();
      fixture.componentInstance.phoneNumber = '9123456789';
      fixture.componentInstance.phoneCode = '0000';

      fixture.componentInstance.verifyPhoneLoginCode();
      // Same zoneless caveat as the sendOtp failure test above.
      await Promise.resolve();
      await Promise.resolve();

      expect(fixture.componentInstance.phoneError).toBe('That code is invalid or has expired.');
      expect(authServiceSpy.verifyPhoneLogin).not.toHaveBeenCalled();
      expect(authServiceSpy.saveAuth).not.toHaveBeenCalled();
    });

    it('shows the server message and stays put when the backend rejects an otherwise-valid token', async () => {
      msg91WidgetServiceSpy.verifyOtp.and.returnValue(Promise.resolve('widget-access-token'));
      authServiceSpy.verifyPhoneLogin.and.returnValue(
        throwError(() => ({ status: 400, error: { message: 'That code is invalid or has expired.' } })),
      );
      const { fixture } = create();
      fixture.componentInstance.phoneNumber = '9123456789';
      fixture.componentInstance.phoneCode = '0000';

      fixture.componentInstance.verifyPhoneLoginCode();
      await fixture.whenStable();

      expect(fixture.componentInstance.phoneError).toBe('That code is invalid or has expired.');
      expect(authServiceSpy.saveAuth).not.toHaveBeenCalled();
    });

    it('switching back to email login clears phone errors', () => {
      const { fixture } = create();
      fixture.componentInstance.switchToPhoneLogin();
      fixture.componentInstance.phoneError = 'stale error';
      fixture.componentInstance.phoneUnavailable = true;

      fixture.componentInstance.switchToEmailLogin();

      expect(fixture.componentInstance.loginMode).toBe('email');
      expect(fixture.componentInstance.phoneError).toBe('');
      expect(fixture.componentInstance.phoneUnavailable).toBeFalse();
    });
  });

  it('sets slowConnection true after 5s while the request is still pending', () => {
    const subject = new Subject<AuthResponse>();
    authServiceSpy.login.and.returnValue(subject.asObservable());
    const { fixture } = create();
    fixture.componentInstance.loginForm.setValue({ email: 'jane@x.com', password: '123456' });

    jasmine.clock().install();
    try {
      fixture.componentInstance.onSubmit();
      expect(fixture.componentInstance.slowConnection).toBeFalse();

      jasmine.clock().tick(5000);
      expect(fixture.componentInstance.slowConnection).toBeTrue();

      subject.next(authResponse);
      subject.complete();
      expect(fixture.componentInstance.slowConnection).toBeFalse();
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('ngOnDestroy clears the pending slow-connection timer so it never fires', () => {
    const subject = new Subject<AuthResponse>();
    authServiceSpy.login.and.returnValue(subject.asObservable());
    const { fixture } = create();
    fixture.componentInstance.loginForm.setValue({ email: 'jane@x.com', password: '123456' });

    jasmine.clock().install();
    try {
      fixture.componentInstance.onSubmit();
      fixture.componentInstance.ngOnDestroy();

      jasmine.clock().tick(5000);
      expect(fixture.componentInstance.slowConnection).toBeFalse();
    } finally {
      jasmine.clock().uninstall();
    }
  });
});
