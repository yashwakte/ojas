import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of, throwError } from 'rxjs';
import { Register } from './register';
import { AuthService } from '../../services/auth.service';
import { AuthResponse, RegisterPendingResponse } from '../../models/interfaces';

describe('Register', () => {
  let authServiceSpy: jasmine.SpyObj<AuthService>;
  let router: Router;

  const authResponse: AuthResponse = {
    id: 'u1',
    fullName: 'Jane',
    email: 'jane@x.com',
    phone: '9999999999',
    role: 'customer',
  };

  const pendingResponse: RegisterPendingResponse = {
    email: 'jane@x.com',
    message: "We've sent a 6-digit code to your email.",
    devCode: '123456',
  };

  beforeEach(() => {
    authServiceSpy = jasmine.createSpyObj('AuthService', [
      'register',
      'verifyEmailOtp',
      'resendEmailOtp',
      'saveAuth',
      'checkEmail',
      'checkPhone',
    ]);
    authServiceSpy.checkEmail.and.returnValue(of({ exists: false }));
    authServiceSpy.checkPhone.and.returnValue(of({ exists: false }));
    authServiceSpy.resendEmailOtp.and.returnValue(of({ message: 'ok' }));

    TestBed.configureTestingModule({
      imports: [Register],
      providers: [provideRouter([]), { provide: AuthService, useValue: authServiceSpy }],
    });
    router = TestBed.inject(Router);
  });

  // See login.spec.ts: MatSnackBarModule provides its own MatSnackBar at the component's
  // injector level, so a TestBed-level override is shadowed. Spy on the real instance instead.
  // Everything in this file except the dedicated Turnstile tests below is testing other
  // concerns, so treat "widget already solved" as the default baseline rather than making
  // every single test set this explicitly.
  function create() {
    const fixture = TestBed.createComponent(Register);
    fixture.componentInstance.turnstileToken = 'test-turnstile-token';
    fixture.detectChanges();
    const snackBar = fixture.debugElement.injector.get(MatSnackBar);
    spyOn(snackBar, 'open').and.stub();
    return { fixture, snackBar };
  }

  function fillValidForm(fixture: ReturnType<typeof create>['fixture']) {
    const form = fixture.componentInstance.registerForm;
    form.get('fullName')?.setValue('Jane Doe');
    form.get('password')?.setValue('123456789A');
    form.get('email')?.setValue('jane@x.com');
    form.get('phone')?.setValue('9876543210');
  }

  it('should create with an invalid, empty form', () => {
    const { fixture } = create();
    expect(fixture.componentInstance.registerForm.invalid).toBeTrue();
  });

  it('arriving with a ?verify=email query param (redirected from login) shows the OTP step without crashing', () => {
    // Regression test: this used to call sendResend() - which calls cdr.detectChanges() -
    // from the constructor, before the component's view existed, which threw and crashed
    // the whole component. The router-outlet rendered blank with no error surfaced anywhere,
    // since the header/footer live outside the outlet and kept rendering fine.
    TestBed.resetTestingModule();
    authServiceSpy = jasmine.createSpyObj('AuthService', [
      'register',
      'verifyEmailOtp',
      'resendEmailOtp',
      'saveAuth',
      'checkEmail',
      'checkPhone',
    ]);
    authServiceSpy.checkEmail.and.returnValue(of({ exists: false }));
    authServiceSpy.checkPhone.and.returnValue(of({ exists: false }));
    authServiceSpy.resendEmailOtp.and.returnValue(of({ message: 'ok', devCode: '654321' }));

    TestBed.configureTestingModule({
      imports: [Register],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: authServiceSpy },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap({ verify: 'stuck@example.com' }) } },
        },
      ],
    });

    const fixture = TestBed.createComponent(Register);
    expect(() => fixture.detectChanges()).not.toThrow();

    const component = fixture.componentInstance;
    expect(component.showOtpStep).toBeTrue();
    expect(component.pendingEmail).toBe('stuck@example.com');
    expect(authServiceSpy.resendEmailOtp).toHaveBeenCalledWith({ email: 'stuck@example.com' });
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
    authServiceSpy.register.and.returnValue(of(pendingResponse));
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

  it('onSubmit registers, then advances to the OTP step instead of logging in directly', () => {
    authServiceSpy.register.and.returnValue(of(pendingResponse));
    const { fixture } = create();

    jasmine.clock().install();
    try {
      fillValidForm(fixture);
      jasmine.clock().tick(200);

      fixture.componentInstance.onSubmit();

      expect(fixture.componentInstance.showOtpStep).toBeTrue();
      expect(fixture.componentInstance.pendingEmail).toBe(pendingResponse.email);
      expect(fixture.componentInstance.loading).toBeFalse();
      expect(authServiceSpy.saveAuth).not.toHaveBeenCalled();
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('verifyOtp verifies the code, saves auth, celebrates, and navigates home on success', () => {
    authServiceSpy.register.and.returnValue(of(pendingResponse));
    authServiceSpy.verifyEmailOtp.and.returnValue(of(authResponse));
    spyOn(router, 'navigate');
    const { fixture } = create();

    jasmine.clock().install();
    try {
      fillValidForm(fixture);
      jasmine.clock().tick(200);
      fixture.componentInstance.onSubmit();

      fixture.componentInstance.otpCode = '123456';
      fixture.componentInstance.verifyOtp();

      expect(authServiceSpy.verifyEmailOtp).toHaveBeenCalledWith({
        email: pendingResponse.email,
        code: '123456',
      });
      expect(authServiceSpy.saveAuth).toHaveBeenCalledWith(authResponse);
      expect(router.navigate).toHaveBeenCalledWith(['/']);
      expect(fixture.componentInstance.verifying).toBeFalse();
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('verifyOtp surfaces an error message and does not log in on an invalid code', () => {
    authServiceSpy.register.and.returnValue(of(pendingResponse));
    authServiceSpy.verifyEmailOtp.and.returnValue(
      throwError(() => ({ status: 400, error: { message: 'That code is invalid or has expired.' } })),
    );
    const { fixture } = create();

    jasmine.clock().install();
    try {
      fillValidForm(fixture);
      jasmine.clock().tick(200);
      fixture.componentInstance.onSubmit();

      fixture.componentInstance.otpCode = '000000';
      fixture.componentInstance.verifyOtp();

      expect(fixture.componentInstance.otpError).toBe('That code is invalid or has expired.');
      expect(authServiceSpy.saveAuth).not.toHaveBeenCalled();
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('resendOtp calls the service and starts a cooldown', () => {
    authServiceSpy.register.and.returnValue(of(pendingResponse));
    const { fixture } = create();

    jasmine.clock().install();
    try {
      fillValidForm(fixture);
      jasmine.clock().tick(200);
      fixture.componentInstance.onSubmit();
      authServiceSpy.resendEmailOtp.calls.reset();

      fixture.componentInstance.resendCooldown = 0;
      fixture.componentInstance.resendOtp();

      expect(authServiceSpy.resendEmailOtp).toHaveBeenCalledWith({ email: pendingResponse.email });
      expect(fixture.componentInstance.resendCooldown).toBeGreaterThan(0);
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('resendOtp does nothing while a cooldown is active', () => {
    authServiceSpy.register.and.returnValue(of(pendingResponse));
    const { fixture } = create();

    jasmine.clock().install();
    try {
      fillValidForm(fixture);
      jasmine.clock().tick(200);
      fixture.componentInstance.onSubmit();
      authServiceSpy.resendEmailOtp.calls.reset();

      fixture.componentInstance.resendOtp();

      expect(authServiceSpy.resendEmailOtp).not.toHaveBeenCalled();
    } finally {
      jasmine.clock().uninstall();
    }
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
