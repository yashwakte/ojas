import { TestBed } from '@angular/core/testing';
import { ChatbotUiService } from './chatbot-ui.service';

describe('ChatbotUiService', () => {
  let service: ChatbotUiService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    service = TestBed.inject(ChatbotUiService);
  });

  afterEach(() => localStorage.clear());

  it('starts closed, not removed, at the default bottom-right position', () => {
    expect(service.open()).toBeFalse();
    expect(service.removed()).toBeFalse();
    expect(service.position()).toEqual({ right: 20, bottom: 180 });
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

  it('setPosition updates and persists the dragged position', () => {
    service.setPosition({ right: 140, bottom: 260 });

    expect(service.position()).toEqual({ right: 140, bottom: 260 });

    const reloaded = new ChatbotUiService();
    expect(reloaded.position()).toEqual({ right: 140, bottom: 260 });
  });

  it('falls back to the default position when localStorage holds malformed data', () => {
    localStorage.setItem('ojas_chatbot_position', 'not json');

    const reloaded = new ChatbotUiService();

    expect(reloaded.position()).toEqual({ right: 20, bottom: 180 });
  });
});
