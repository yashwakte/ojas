import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AcceptInvite } from './accept-invite';
import { AuthService } from '../../services/auth.service';
import { WelcomeService } from '../../services/welcome.service';
import { AuthResponse, InvitePreviewResponse } from '../../models/interfaces';

describe('AcceptInvite', () => {
  let authServiceSpy: jasmine.SpyObj<AuthService>;
  let welcomeSpy: jasmine.SpyObj<WelcomeService>;
  let router: Router;

  const invite: InvitePreviewResponse = {
    fullName: 'Dev Partner',
    email: 'partner@x.com',
    role: 'delivery',
  };

  const authResponse: AuthResponse = {
    id: 'u1',
    fullName: 'Dev Partner',
    email: 'partner@x.com',
    phone: '9999999999',
    role: 'delivery',
  };

  /** The token arrives as a query param on the link from the invite email. */
  function configure(token: string | null) {
    authServiceSpy = jasmine.createSpyObj('AuthService', [
      'getInvite',
      'acceptInvite',
      'saveAuth',
      'getDefaultRouteForRole',
    ]);
    authServiceSpy.getDefaultRouteForRole.and.returnValue('/delivery/orders');
    welcomeSpy = jasmine.createSpyObj('WelcomeService', ['celebrate']);

    TestBed.configureTestingModule({
      imports: [AcceptInvite],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: authServiceSpy },
        { provide: WelcomeService, useValue: welcomeSpy },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { queryParamMap: convertToParamMap(token ? { token } : {}) },
          },
        },
      ],
    });
    router = TestBed.inject(Router);
  }

  it('shows an error when the link has no token at all', () => {
    configure(null);
    const fixture = TestBed.createComponent(AcceptInvite);
    fixture.detectChanges();

    expect(fixture.componentInstance.linkError()).toContain('missing its token');
    expect(authServiceSpy.getInvite).not.toHaveBeenCalled();
  });

  it('loads the invite and names the account being activated', () => {
    configure('tok-123');
    authServiceSpy.getInvite.and.returnValue(of(invite));
    const fixture = TestBed.createComponent(AcceptInvite);
    fixture.detectChanges();

    expect(authServiceSpy.getInvite).toHaveBeenCalledWith('tok-123');
    expect(fixture.componentInstance.invite()).toEqual(invite);
    expect(fixture.componentInstance.loading()).toBeFalse();
  });

  it('shows an error for an expired or unknown link', () => {
    configure('stale-token');
    authServiceSpy.getInvite.and.returnValue(throwError(() => ({ status: 404 })));
    const fixture = TestBed.createComponent(AcceptInvite);
    fixture.detectChanges();

    expect(fixture.componentInstance.linkError()).toContain('invalid or has expired');
    expect(fixture.componentInstance.invite()).toBeNull();
  });

  it('will not submit until the password is long enough and both fields match', () => {
    configure('tok-123');
    authServiceSpy.getInvite.and.returnValue(of(invite));
    const fixture = TestBed.createComponent(AcceptInvite);
    fixture.detectChanges();
    const component = fixture.componentInstance;

    component.password = 'short';
    component.confirmPassword = 'short';
    expect(component.canSubmit).toBeFalse();

    component.password = 'LongEnoughPassw0rd!';
    component.confirmPassword = 'DifferentPassw0rd!';
    expect(component.canSubmit).toBeFalse();

    component.confirmPassword = 'LongEnoughPassw0rd!';
    expect(component.canSubmit).toBeTrue();
  });

  it('onSubmit does nothing while the form is incomplete', () => {
    configure('tok-123');
    authServiceSpy.getInvite.and.returnValue(of(invite));
    const fixture = TestBed.createComponent(AcceptInvite);
    fixture.detectChanges();

    fixture.componentInstance.password = 'short';
    fixture.componentInstance.onSubmit();

    expect(authServiceSpy.acceptInvite).not.toHaveBeenCalled();
  });

  it('accepting signs them straight in - no separate login step', () => {
    configure('tok-123');
    authServiceSpy.getInvite.and.returnValue(of(invite));
    authServiceSpy.acceptInvite.and.returnValue(of(authResponse));
    spyOn(router, 'navigateByUrl');
    const fixture = TestBed.createComponent(AcceptInvite);
    fixture.detectChanges();

    fixture.componentInstance.password = 'MyOwnPassw0rd!';
    fixture.componentInstance.confirmPassword = 'MyOwnPassw0rd!';
    fixture.componentInstance.onSubmit();

    expect(authServiceSpy.acceptInvite).toHaveBeenCalledWith({
      token: 'tok-123',
      password: 'MyOwnPassw0rd!',
    });
    expect(authServiceSpy.saveAuth).toHaveBeenCalledWith(authResponse);
    expect(router.navigateByUrl).toHaveBeenCalledWith('/delivery/orders');
  });

  it('surfaces the server message when acceptance is refused', () => {
    configure('tok-123');
    authServiceSpy.getInvite.and.returnValue(of(invite));
    authServiceSpy.acceptInvite.and.returnValue(
      throwError(() => ({ status: 400, error: { message: 'This invite link is invalid or has expired.' } })),
    );
    const fixture = TestBed.createComponent(AcceptInvite);
    fixture.detectChanges();

    fixture.componentInstance.password = 'MyOwnPassw0rd!';
    fixture.componentInstance.confirmPassword = 'MyOwnPassw0rd!';
    fixture.componentInstance.onSubmit();

    expect(fixture.componentInstance.submitError()).toBe('This invite link is invalid or has expired.');
    expect(authServiceSpy.saveAuth).not.toHaveBeenCalled();
    expect(fixture.componentInstance.submitting()).toBeFalse();
  });
});
