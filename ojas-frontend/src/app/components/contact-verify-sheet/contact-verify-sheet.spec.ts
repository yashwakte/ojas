import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ContactSheetMode, ContactVerifySheet } from './contact-verify-sheet';
import { UserService } from '../../services/user.service';
import { Msg91WidgetService } from '../../services/msg91-widget.service';
import { UserProfileResponse } from '../../models/interfaces';

describe('ContactVerifySheet', () => {
  const updated: UserProfileResponse = {
    id: 'u1',
    fullName: 'Jane Doe',
    email: 'new@x.com',
    phone: '9876501234',
    createdAt: '2024-01-01',
    savedAddresses: [],
    isEmailVerified: true,
    isPhoneVerified: true,
  };

  let userServiceSpy: jasmine.SpyObj<UserService>;
  let msg91Spy: jasmine.SpyObj<Msg91WidgetService>;

  beforeEach(() => {
    userServiceSpy = jasmine.createSpyObj('UserService', [
      'sendEmailCode',
      'verifyEmailCode',
      'startPhoneChange',
      'verifyPhoneChange',
    ]);
    userServiceSpy.sendEmailCode.and.returnValue(of({ message: 'sent', devCode: null }));
    userServiceSpy.verifyEmailCode.and.returnValue(of(updated));
    userServiceSpy.startPhoneChange.and.returnValue(of({ message: 'ok' }));
    userServiceSpy.verifyPhoneChange.and.returnValue(of(updated));

    msg91Spy = jasmine.createSpyObj('Msg91WidgetService', ['preload', 'initialize', 'sendOtp', 'verifyOtp'], {
      captchaElementId: 'msg91-phone-captcha',
    });
    msg91Spy.initialize.and.returnValue(Promise.resolve());
    msg91Spy.sendOtp.and.returnValue(Promise.resolve());
    msg91Spy.verifyOtp.and.returnValue(Promise.resolve('widget-token'));

    TestBed.configureTestingModule({
      imports: [ContactVerifySheet],
      providers: [
        { provide: UserService, useValue: userServiceSpy },
        { provide: Msg91WidgetService, useValue: msg91Spy },
      ],
    });
  });

  afterEach(() => {
    // The sheet locks page scrolling while open; destroying it must hand that back.
    document.body.style.overflow = '';
  });

  function create(mode: ContactSheetMode): ComponentFixture<ContactVerifySheet> {
    const fixture = TestBed.createComponent(ContactVerifySheet);
    fixture.componentRef.setInput('mode', mode);
    fixture.componentRef.setInput('currentEmail', 'jane@x.com');
    fixture.componentRef.setInput('currentPhone', '9999999999');
    fixture.detectChanges();
    return fixture;
  }

  /** The widget is promise-based; this lets its callbacks run. (The app is zoneless, so there is
   * no fakeAsync to reach for.) */
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  /** A phone-mode sheet whose widget has finished setting up, as it would be once on screen. */
  async function createPhoneSheet(): Promise<ComponentFixture<ContactVerifySheet>> {
    const fixture = create('change-phone');
    await fixture.whenStable();
    await settle();
    return fixture;
  }

  // The template-facing members are protected; tests reach them the way the template does.
  const sheet = (fixture: ComponentFixture<ContactVerifySheet>) => fixture.componentInstance as any;

  it('confirming the current email sends the code at once and opens on the code', () => {
    const fixture = create('verify-email');

    expect(userServiceSpy.sendEmailCode).toHaveBeenCalledWith({ email: 'jane@x.com' });
    expect(sheet(fixture).step()).toBe('code');
  });

  it('a correct email code emits the updated profile and shows the confirmation', () => {
    const fixture = create('verify-email');
    const emitted: UserProfileResponse[] = [];
    fixture.componentInstance.completed.subscribe((p) => emitted.push(p));

    sheet(fixture).code = '123456';
    sheet(fixture).submitCode();

    expect(userServiceSpy.verifyEmailCode).toHaveBeenCalledWith({ email: 'jane@x.com', code: '123456' });
    expect(emitted).toEqual([updated]);
    expect(sheet(fixture).step()).toBe('done');
  });

  it("shows the server's message when the code is refused, and stays on the code step", () => {
    userServiceSpy.verifyEmailCode.and.returnValue(
      throwError(() => ({ status: 400, error: { message: 'That code is invalid or has expired.' } })),
    );
    const fixture = create('verify-email');

    sheet(fixture).code = '000000';
    sheet(fixture).submitCode();

    expect(sheet(fixture).error()).toBe('That code is invalid or has expired.');
    expect(sheet(fixture).step()).toBe('code');
  });

  it('changing the email needs only a valid new address - no password', () => {
    const fixture = create('change-email');
    expect(sheet(fixture).step()).toBe('details');
    expect(fixture.nativeElement.querySelector('input[autocomplete="current-password"]')).toBeNull();

    sheet(fixture).newValue = 'not-an-email';
    expect(sheet(fixture).detailsValid).toBeFalse();

    sheet(fixture).newValue = 'new@x.com';
    expect(sheet(fixture).detailsValid).toBeTrue();

    sheet(fixture).newValue = 'JANE@x.com ';
    expect(sheet(fixture).detailsValid).withContext('the address already on the account').toBeFalse();
  });

  it('changing the email sends the code to the new address', () => {
    const fixture = create('change-email');
    sheet(fixture).newValue = ' New@X.com';

    sheet(fixture).submitDetails();

    expect(userServiceSpy.sendEmailCode).toHaveBeenCalledWith({ email: 'new@x.com' });
    expect(sheet(fixture).step()).toBe('code');
    expect(sheet(fixture).target()).toBe('new@x.com');
  });

  it('an address another account uses keeps the customer on the form with the reason', () => {
    userServiceSpy.sendEmailCode.and.returnValue(
      throwError(() => ({ status: 409, error: { message: 'This email is already registered to another account.' } })),
    );
    const fixture = create('change-email');
    sheet(fixture).newValue = 'new@x.com';

    sheet(fixture).submitDetails();

    expect(sheet(fixture).step()).toBe('details');
    expect(sheet(fixture).error()).toBe('This email is already registered to another account.');
  });

  it('says so plainly when the limit is hit', () => {
    userServiceSpy.sendEmailCode.and.returnValue(throwError(() => ({ status: 429 })));
    const fixture = create('change-email');
    sheet(fixture).newValue = 'new@x.com';

    sheet(fixture).submitDetails();

    expect(sheet(fixture).error()).toContain('Too many attempts');
  });

  it('changing the phone reserves the number on the server first, then texts the code', async () => {
    const fixture = await createPhoneSheet();
    expect(sheet(fixture).widgetReady()).toBeTrue();

    sheet(fixture).newValue = '+91 98765 01234';
    sheet(fixture).submitDetails();
    await settle();

    expect(userServiceSpy.startPhoneChange).toHaveBeenCalledWith({ phone: '9876501234' });
    expect(msg91Spy.sendOtp).toHaveBeenCalledWith('9876501234');
    expect(sheet(fixture).step()).toBe('code');
  });

  it('does not text a code when the server refuses the number change', async () => {
    userServiceSpy.startPhoneChange.and.returnValue(
      throwError(() => ({ status: 409, error: { message: 'This number is already linked to another account.' } })),
    );
    const fixture = await createPhoneSheet();
    sheet(fixture).newValue = '9876501234';

    sheet(fixture).submitDetails();
    await settle();

    expect(msg91Spy.sendOtp).not.toHaveBeenCalled();
    expect(sheet(fixture).error()).toBe('This number is already linked to another account.');
  });

  it('hands the widget token for the new number to the server and emits the result', async () => {
    const fixture = await createPhoneSheet();
    const emitted: UserProfileResponse[] = [];
    fixture.componentInstance.completed.subscribe((p) => emitted.push(p));
    sheet(fixture).newValue = '9876501234';
    sheet(fixture).submitDetails();
    await settle();

    sheet(fixture).code = '4321';
    sheet(fixture).submitCode();
    await settle();

    expect(msg91Spy.verifyOtp).toHaveBeenCalledWith('4321');
    expect(userServiceSpy.verifyPhoneChange).toHaveBeenCalledWith({
      phone: '9876501234',
      widgetToken: 'widget-token',
    });
    expect(emitted).toEqual([updated]);
  });

  it('refuses the current number before asking anything of the server', () => {
    const fixture = create('change-phone');
    sheet(fixture).newValue = '9999999999';

    sheet(fixture).submitDetails();

    expect(userServiceSpy.startPhoneChange).not.toHaveBeenCalled();
  });

  it('emits closed on the close button and on Escape', () => {
    const fixture = create('change-email');
    let closes = 0;
    fixture.componentInstance.closed.subscribe(() => closes++);

    (fixture.nativeElement.querySelector('.cv-close') as HTMLButtonElement).click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(closes).toBe(2);
  });

  it('locks page scrolling while open and releases it when destroyed', () => {
    const fixture = create('change-email');
    expect(document.body.style.overflow).toBe('hidden');

    fixture.destroy();

    expect(document.body.style.overflow).toBe('');
  });
});
