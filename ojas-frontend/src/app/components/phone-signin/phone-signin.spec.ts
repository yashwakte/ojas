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

    auth = jasmine.createSpyObj('AuthService', ['phoneSignIn', 'saveAuth']);
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

  /** Number, code - and, for a new number, the details the API asked for. */
  async function proveNumber(fixture: ComponentFixture<PhoneSignIn>) {
    type(fixture, 'phone', '9876543210');
    sendButton(fixture).click();
    await fixture.whenStable();
    fixture.detectChanges();
    type(fixture, 'otp', '1234');
    sendButton(fixture).click();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const needsDetails = () =>
    throwError(() => ({ status: 400, error: { needsDetails: true, message: 'Please enter your name.' } }));

  it('asks for nothing but the number before the code is verified', async () => {
    const fixture = await create();

    expect(fixture.nativeElement.querySelector('input[name="email"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('input[name="password"]')).toBeNull();
    expect(sendButton(fixture).disabled).toBeTrue();

    type(fixture, 'phone', '9876543210');
    expect(sendButton(fixture).disabled).toBeFalse();
  });

  it('offers every customer their password, which costs no text - without guessing who has one', async () => {
    const fixture = await create();
    const link: HTMLAnchorElement = fixture.nativeElement.querySelector('.ps-hint a');
    expect(link.getAttribute('href')).toBe('/login?redirect=%2Fcheckout');
    expect(fixture.nativeElement.textContent).not.toContain('Welcome back');
  });

  it('signs a known number straight in with the verified code alone', async () => {
    auth.phoneSignIn.and.returnValue(of<PhoneSignInResponse>({ session, isNewAccount: false, emailVerified: true }));
    const fixture = await create();
    const emitted: PhoneSignInResponse[] = [];
    fixture.componentInstance.signedIn.subscribe((r) => emitted.push(r));

    await proveNumber(fixture);

    expect(msg91.sendOtp).toHaveBeenCalledWith('9876543210');
    expect(auth.phoneSignIn).toHaveBeenCalledWith({ phone: '9876543210', widgetToken: 'widget-token' });
    expect(auth.saveAuth).toHaveBeenCalledWith(session);
    expect(emitted.length).toBe(1);
  });

  it('asks a proved new number for its details, then creates the account without another code', async () => {
    auth.phoneSignIn.and.returnValues(
      needsDetails(),
      of<PhoneSignInResponse>({ session, isNewAccount: true, emailVerified: false }),
    );
    const fixture = await create();
    const emitted: PhoneSignInResponse[] = [];
    fixture.componentInstance.signedIn.subscribe((r) => emitted.push(r));

    await proveNumber(fixture);

    // The first ask is the expected next step, not an error.
    expect(fixture.nativeElement.querySelector('.ps-error')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('is verified');

    type(fixture, 'fullName', 'Sneha Dhoran');
    type(fixture, 'email', 'Sneha@Example.com ');
    type(fixture, 'password', 'short');
    expect(sendButton(fixture).disabled).toBeTrue();
    expect(fixture.nativeElement.textContent).toContain('at least 10 characters');

    type(fixture, 'password', 'Checkout123!');
    sendButton(fixture).click();
    await fixture.whenStable();

    expect(auth.phoneSignIn).toHaveBeenCalledWith({
      phone: '9876543210',
      fullName: 'Sneha Dhoran',
      email: 'sneha@example.com',
      password: 'Checkout123!',
    });
    expect(msg91.verifyOtp).toHaveBeenCalledTimes(1);
    expect(emitted.length).toBe(1);
  });

  it('keeps what was typed when the email turns out to be taken', async () => {
    auth.phoneSignIn.and.returnValues(
      needsDetails(),
      throwError(() => ({ status: 409, error: { field: 'email', message: 'taken' } })),
    );
    const fixture = await create();
    await proveNumber(fixture);
    type(fixture, 'fullName', 'Sneha Dhoran');
    type(fixture, 'email', 'sneha@example.com');
    type(fixture, 'password', 'Checkout123!');
    sendButton(fixture).click();
    await fixture.whenStable();
    fixture.detectChanges();

    const email: HTMLInputElement = fixture.nativeElement.querySelector('input[name="email"]');
    expect(email.value).toBe('sneha@example.com');
    expect(fixture.nativeElement.textContent).toContain('already on another Ojas account');
    expect(sendButton(fixture).disabled).toBeTrue();
    expect(auth.saveAuth).not.toHaveBeenCalled();
  });

  it('goes back to the number when the sign-up ticket has run out', async () => {
    auth.phoneSignIn.and.returnValues(
      needsDetails(),
      throwError(() => ({ status: 400, error: { verifyAgain: true, message: 'Please verify your mobile number again.' } })),
    );
    const fixture = await create();
    await proveNumber(fixture);
    type(fixture, 'fullName', 'Sneha Dhoran');
    type(fixture, 'email', 'sneha@example.com');
    type(fixture, 'password', 'Checkout123!');
    sendButton(fixture).click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('input[name="phone"]')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('verify your mobile number again');
  });
});
