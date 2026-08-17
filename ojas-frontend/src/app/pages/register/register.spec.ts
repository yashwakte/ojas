import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of, throwError } from 'rxjs';
import { Register } from './register';
import { AuthService } from '../../services/auth.service';
import { AuthResponse } from '../../models/interfaces';

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

  beforeEach(() => {
    authServiceSpy = jasmine.createSpyObj('AuthService', ['register', 'saveAuth', 'checkEmail', 'checkPhone']);
    authServiceSpy.checkEmail.and.returnValue(of({ exists: false }));
    authServiceSpy.checkPhone.and.returnValue(of({ exists: false }));

    TestBed.configureTestingModule({
      imports: [Register],
      providers: [provideRouter([]), { provide: AuthService, useValue: authServiceSpy }],
    });
    router = TestBed.inject(Router);
  });

  // See login.spec.ts: MatSnackBarModule provides its own MatSnackBar at the component's
  // injector level, so a TestBed-level override is shadowed. Spy on the real instance instead.
  function create() {
    const fixture = TestBed.createComponent(Register);
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

  it('onSubmit registers, saves auth, celebrates, and navigates home on success', () => {
    authServiceSpy.register.and.returnValue(of(authResponse));
    spyOn(router, 'navigate');
    const { fixture } = create();

    jasmine.clock().install();
    try {
      fillValidForm(fixture);
      jasmine.clock().tick(200);

      fixture.componentInstance.onSubmit();

      expect(authServiceSpy.saveAuth).toHaveBeenCalledWith(authResponse);
      // The success snackbar was replaced by the welcome celebration overlay.
      expect(router.navigate).toHaveBeenCalledWith(['/']);
      expect(fixture.componentInstance.loading).toBeFalse();
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
