import { TestBed } from '@angular/core/testing';
import { ChatbotUiService } from './chatbot-ui.service';

describe('ChatbotUiService', () => {
  let service: ChatbotUiService;

  // Karma's headless browser window may or may not be "mobile width" - assert against whichever
  // branch is actually true here rather than hardcoding one, so this test isn't coupled to a
  // specific test-runner viewport size.
  const expectedDefaultPosition = () =>
    window.innerWidth <= 900 ? { right: 20, bottom: 180 } : { right: 20, bottom: 20 };

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
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

  it('remove persists across a fresh service instance (new "page load")', () => {
    service.remove();

    const reloaded = new ChatbotUiService();

    expect(reloaded.removed()).toBeTrue();
  });

  it('setPosition updates the live position', () => {
    service.setPosition({ right: 140, bottom: 260 });

    expect(service.position()).toEqual({ right: 140, bottom: 260 });
  });

  it('a dragged position does NOT carry over to a fresh service instance (a real page refresh)', () => {
    service.setPosition({ right: 140, bottom: 260 });

    const reloaded = new ChatbotUiService();

    expect(reloaded.position()).toEqual(expectedDefaultPosition());
  });
});
