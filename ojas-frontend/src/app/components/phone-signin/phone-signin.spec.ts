import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { PhoneSignIn } from './phone-signin';
import { AuthService } from '../../services/auth.service';
import { Msg91WidgetService } from '../../services/msg91-widget.service';
import { AuthResponse, PhoneSignInResponse } from '../../models/interfaces';

describe('PhoneSignIn', () => {
  const session: AuthResponse = {
    id: 'u1',
    fullName: 'Sneha Dhoran',
    email: 'sneha@example.com',
    phone: '9876543210',
    role: 'customer',
    csrfToken: 'csrf',
  };

  let auth: jasmine.SpyObj<AuthService>;
  let msg91: jasmine.SpyObj<Msg91WidgetService>;

  beforeEach(() => {
    // Moving to the code step focuses its input, which would scroll the test runner's own page
    // and upset later specs that measure what is on screen.
    spyOn(HTMLElement.prototype, 'focus');

    auth = jasmine.createSpyObj('AuthService', ['checkPhone', 'checkEmail', 'phoneSignIn', 'saveAuth']);
    auth.checkPhone.and.returnValue(of({ exists: false }));
    auth.checkEmail.and.returnValue(of({ exists: false }));
    auth.phoneSignIn.and.returnValue(
      of<PhoneSignInResponse>({ session, isNewAccount: true, emailVerified: false }),
    );

    msg91 = jasmine.createSpyObj('Msg91WidgetService', ['preload', 'initialize', 'sendOtp', 'verifyOtp'], {
      captchaElementId: 'msg91-test-captcha',
    });
    msg91.initialize.and.resolveTo();
    msg91.sendOtp.and.resolveTo();
    msg91.verifyOtp.and.resolveTo('widget-token');

    TestBed.configureTestingModule({
      imports: [PhoneSignIn],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: auth },
        { provide: Msg91WidgetService, useValue: msg91 },
      ],
    });
  });

  async function create() {
    const fixture = TestBed.createComponent(PhoneSignIn);
    fixture.detectChanges();
    // Lets afterNextRender run and the widget's initialize() promise settle.
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  function type(fixture: ComponentFixture<PhoneSignIn>, name: string, value: string) {
    const input: HTMLInputElement = fixture.nativeElement.querySelector(`input[name="${name}"]`);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
    fixture.detectChanges();
  }

  function sendButton(fixture: ComponentFixture<PhoneSignIn>): HTMLButtonElement {
    return fixture.nativeElement.querySelector('button[type="submit"]');
  }

  it('asks a new number for what the registration page asks, before any code is sent', async () => {
    const fixture = await create();
    type(fixture, 'phone', '9876543210');

    expect(auth.checkPhone).toHaveBeenCalledWith('9876543210');
    expect(sendButton(fixture).disabled).toBeTrue();

    type(fixture, 'fullName', 'Sneha Dhoran');
    type(fixture, 'email', 'sneha@example.com');
    type(fixture, 'password', 'short');
    expect(sendButton(fixture).disabled).toBeTrue();
    expect(fixture.nativeElement.textContent).toContain('at least 10 characters');

    type(fixture, 'password', 'Checkout123!');
    expect(sendButton(fixture).disabled).toBeFalse();
  });

  it('needs nothing but the number when it already has an account', async () => {
    auth.checkPhone.and.returnValue(of({ exists: true }));
    const fixture = await create();
    type(fixture, 'phone', '9876543210');

    expect(fixture.nativeElement.querySelector('input[name="email"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('input[name="password"]')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Welcome back');
    expect(sendButton(fixture).disabled).toBeFalse();
  });

  it('refuses an email that belongs to another account before a code is spent on it', async () => {
    auth.checkEmail.and.returnValue(of({ exists: true }));
    const fixture = await create();
    type(fixture, 'phone', '9876543210');
    type(fixture, 'fullName', 'Sneha Dhoran');
    type(fixture, 'email', 'taken@example.com');

    expect(fixture.nativeElement.textContent).toContain('already on another Ojas account');
    expect(sendButton(fixture).disabled).toBeTrue();
    expect(msg91.sendOtp).not.toHaveBeenCalled();
  });

  it('signs in with the verified code, saves the session and hands it to the page', async () => {
    const fixture = await create();
    const emitted: PhoneSignInResponse[] = [];
    fixture.componentInstance.signedIn.subscribe((r) => emitted.push(r));

    type(fixture, 'phone', '9876543210');
    type(fixture, 'fullName', 'Sneha Dhoran');
    type(fixture, 'email', 'Sneha@Example.com ');
    type(fixture, 'password', 'Checkout123!');
    sendButton(fixture).click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(msg91.sendOtp).toHaveBeenCalledWith('9876543210');
    expect(fixture.nativeElement.textContent).toContain('+91 9876543210');

    type(fixture, 'otp', '1234');
    sendButton(fixture).click();
    await fixture.whenStable();

    expect(auth.phoneSignIn).toHaveBeenCalledWith({
      phone: '9876543210',
      widgetToken: 'widget-token',
      fullName: 'Sneha Dhoran',
      email: 'sneha@example.com',
      password: 'Checkout123!',
    });
    expect(auth.saveAuth).toHaveBeenCalledWith(session);
    expect(emitted.length).toBe(1);
  });

  it('sends back to the form, with what was typed, when the email turns out to be taken', async () => {
    auth.phoneSignIn.and.returnValue(
      throwError(() => ({ status: 409, error: { field: 'email', message: 'taken' } })),
    );
    const fixture = await create();
    type(fixture, 'phone', '9876543210');
    type(fixture, 'fullName', 'Sneha Dhoran');
    type(fixture, 'email', 'sneha@example.com');
    type(fixture, 'password', 'Checkout123!');
    sendButton(fixture).click();
    await fixture.whenStable();
    fixture.detectChanges();
    type(fixture, 'otp', '1234');
    sendButton(fixture).click();
    await fixture.whenStable();
    fixture.detectChanges();

    const email: HTMLInputElement = fixture.nativeElement.querySelector('input[name="email"]');
    expect(email).not.toBeNull();
    expect(email.value).toBe('sneha@example.com');
    expect(fixture.nativeElement.textContent).toContain('already on another Ojas account');
    expect(auth.saveAuth).not.toHaveBeenCalled();
  });

  it('offers a returning customer their password as well, which costs no text', async () => {
    auth.checkPhone.and.returnValue(of({ exists: true }));
    const fixture = await create();
    type(fixture, 'phone', '9876543210');

    const link: HTMLAnchorElement = fixture.nativeElement.querySelector('.ps-hint--welcome a');
    expect(link.getAttribute('href')).toBe('/login?redirect=%2Fcheckout');
  });
});
