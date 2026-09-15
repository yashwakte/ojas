import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ChatbotUiService } from './chatbot-ui.service';
import { AuthService } from './auth.service';

describe('ChatbotUiService', () => {
  let service: ChatbotUiService;

  // Karma's headless browser window may or may not be "mobile width" - assert against whichever
  // branch is actually true here rather than hardcoding one, so this test isn't coupled to a
  // specific test-runner viewport size.
  const expectedDefaultPosition = () =>
    window.innerWidth <= 900 ? { right: 8, bottom: 70 } : { right: 20, bottom: 20 };

  /** A second instance stands in for the next page load: nothing carries over but storage. */
  const freshPageLoad = () => TestBed.runInInjectionContext(() => new ChatbotUiService());

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ChatbotUiService);
  });

  afterEach(() => localStorage.clear());

  it('starts closed, not removed, at the viewport-appropriate default position', () => {
    expect(service.open()).toBeFalse();
    expect(service.removed()).toBeFalse();
    expect(service.position()).toEqual(expectedDefaultPosition());
  });

  it('openChat opens the panel', () => {
    service.openChat();
    expect(service.open()).toBeTrue();
  });

  it('openChat un-hides the bubble if it had been removed', () => {
    service.remove();
    expect(service.removed()).toBeTrue();

    service.openChat();

    expect(service.removed()).toBeFalse();
    expect(service.open()).toBeTrue();
  });

  it('closeChat closes the panel without touching removed', () => {
    service.openChat();
    service.closeChat();

    expect(service.open()).toBeFalse();
    expect(service.removed()).toBeFalse();
  });

  it('remove hides the bubble and closes the panel', () => {
    service.openChat();

    service.remove();

    expect(service.removed()).toBeTrue();
    expect(service.open()).toBeFalse();
  });

  it('a removed bubble is back on the next page load', () => {
    service.remove();

    expect(freshPageLoad().removed()).toBeFalse();
  });

  it('forgets the "removed" flag an older version stored, so a phone that hid it gets it back', () => {
    localStorage.setItem('ojas_chatbot_removed', '1');

    const reloaded = freshPageLoad();

    expect(reloaded.removed()).toBeFalse();
    expect(localStorage.getItem('ojas_chatbot_removed')).toBeNull();
  });

  it('signing in brings a removed bubble back', () => {
    TestBed.flushEffects();
    service.remove();

    TestBed.inject(AuthService).saveAuth({
      id: 'u1',
      fullName: 'Jane',
      email: 'j@x.com',
      phone: '9999999999',
      role: 'customer',
    });
    TestBed.flushEffects();

    expect(service.removed()).toBeFalse();
  });

  it('a token refresh for the same account does not undo a removal', () => {
    const auth = TestBed.inject(AuthService);
    auth.saveAuth({ id: 'u1', fullName: 'Jane', email: 'j@x.com', phone: '9999999999', role: 'customer', csrfToken: 'a' });
    TestBed.flushEffects();
    service.remove();

    auth.saveAuth({ id: 'u1', fullName: 'Jane', email: 'j@x.com', phone: '9999999999', role: 'customer', csrfToken: 'b' });
    TestBed.flushEffects();

    expect(service.removed()).toBeTrue();
  });

  it('setPosition updates the live position', () => {
    service.setPosition({ right: 140, bottom: 260 });

    expect(service.position()).toEqual({ right: 140, bottom: 260 });
  });

  it('a dragged position does NOT carry over to a fresh service instance (a real page refresh)', () => {
    service.setPosition({ right: 140, bottom: 260 });

    expect(freshPageLoad().position()).toEqual(expectedDefaultPosition());
  });
});
