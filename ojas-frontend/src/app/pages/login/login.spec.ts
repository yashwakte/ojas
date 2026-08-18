import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject, of, throwError } from 'rxjs';
import { Login } from './login';
import { AuthService } from '../../services/auth.service';
import { AuthResponse } from '../../models/interfaces';

describe('Login', () => {
  let authServiceSpy: jasmine.SpyObj<AuthService>;
  let router: Router;

  const authResponse: AuthResponse = {
    id: 'u1',
    fullName: 'Jane',
    email: 'jane@x.com',
    phone: '9999999999',
    role: 'customer',
  };

  beforeEach(() => {
    authServiceSpy = jasmine.createSpyObj('AuthService', ['login', 'saveAuth', 'getDefaultRouteForRole']);
    authServiceSpy.getDefaultRouteForRole.and.returnValue('/');

    TestBed.configureTestingModule({
      imports: [Login],
      providers: [provideRouter([]), { provide: AuthService, useValue: authServiceSpy }],
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
