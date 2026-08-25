import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { SessionSwitchNotice } from './session-switch-notice';
import { AuthService } from '../../services/auth.service';
import { AuthResponse } from '../../models/interfaces';

describe('SessionSwitchNotice', () => {
  const authResponse: AuthResponse = {
    id: 'u1',
    fullName: 'Jane Doe',
    email: 'jane@example.com',
    phone: '9876543210',
    role: 'customer',
    csrfToken: 'csrf-abc',
  };

  beforeEach(() => {
    localStorage.clear();
    // A session change ends in a real page reload after a short hold. Jasmine's clock keeps that
    // timer from ever firing here (the app is zoneless, so fakeAsync is unavailable), and the
    // spy below is the second line of defence - a real reload inside Karma takes the whole suite
    // down with it.
    jasmine.clock().install();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
  });

  afterEach(() => {
    jasmine.clock().uninstall();
    localStorage.clear();
  });

  function authWithNoReload(): AuthService {
    const auth = TestBed.inject(AuthService);
    spyOn(auth as unknown as { reloadPage: () => void }, 'reloadPage');
    return auth;
  }

  function render() {
    const fixture = TestBed.createComponent(SessionSwitchNotice);
    fixture.detectChanges();
    return fixture;
  }

  it('renders nothing while no session change is happening', () => {
    const fixture = render();
    expect(fixture.nativeElement.querySelector('.ssn')).toBeNull();
  });

  it('lets clicks through to the app when idle', () => {
    // The host is a full-screen `position: fixed` box at z-index 3000 whether or not anything is
    // rendered inside it. Without pointer-events: none it is an invisible sheet over the whole
    // app that swallows every click - which is indistinguishable, to a user, from "the site is
    // broken and the sign-in button does nothing". This shipped once; it must not ship again.
    const fixture = render();
    expect(getComputedStyle(fixture.nativeElement).pointerEvents).toBe('none');
  });

  it('covers and blocks the page once a switch is under way', () => {
    const auth = authWithNoReload();
    auth.saveAuth(authResponse);
    auth.onOtherTabSessionChange(
      JSON.stringify({ ...authResponse, id: 'u2', fullName: 'Rajesh Kumar' }),
    );

    const fixture = render();
    const cover = fixture.nativeElement.querySelector('.ssn') as HTMLElement;

    expect(cover).not.toBeNull();
    // The cover itself must take pointer events - while it is up, whatever is underneath may
    // belong to a different account and must not be reachable.
    expect(getComputedStyle(cover).pointerEvents).toBe('auto');
    expect(fixture.nativeElement.textContent).toContain('Switching to Rajesh');
  });

  it('names the sign-out case rather than an account switch', () => {
    const auth = authWithNoReload();
    auth.saveAuth(authResponse);
    auth.onOtherTabSessionChange(null);

    const fixture = render();

    expect(fixture.nativeElement.textContent).toContain('Signed out');
  });
});
