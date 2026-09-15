import { TestBed } from '@angular/core/testing';
import { WelcomeService } from './welcome.service';

describe('WelcomeService intro', () => {
  const KEY = 'ojas_intro_shown';
  let originalUrl: string;

  beforeEach(() => {
    originalUrl = location.pathname + location.search;
    sessionStorage.removeItem(KEY);
    localStorage.removeItem('ojas_user');
    spyOn(WelcomeService, 'prefersReducedMotion').and.returnValue(false);
  });

  afterEach(() => {
    history.replaceState(null, '', originalUrl);
    sessionStorage.removeItem(KEY);
    localStorage.removeItem('ojas_user');
  });

  const service = () => TestBed.inject(WelcomeService);

  it('plays on the first page of a visit', () => {
    expect(service().playIntro).toBeTrue();
    expect(service().introDone()).toBeFalse();
  });

  it('does not play again within the same visit', () => {
    sessionStorage.setItem(KEY, '1');
    expect(service().playIntro).toBeFalse();
    expect(service().introDone()).toBeTrue();
  });

  it('ignores the old once-per-browser flag, so a returning customer is greeted again', () => {
    localStorage.setItem(KEY, '1');
    try {
      expect(service().playIntro).toBeTrue();
    } finally {
      localStorage.removeItem(KEY);
    }
  });

  it('never plays on the staff screens', () => {
    history.replaceState(null, '', '/delivery/orders');
    expect(service().playIntro).toBeFalse();
  });

  it('never plays for signed-in staff, whatever page they open', () => {
    localStorage.setItem('ojas_user', JSON.stringify({ role: 'admin' }));
    expect(service().playIntro).toBeFalse();
  });

  it('never plays on the way back from paying', () => {
    history.replaceState(null, '', '/my-orders?cashfreeOrderId=abc');
    expect(service().playIntro).toBeFalse();
  });

  it('never plays for someone who has asked for reduced motion', () => {
    (WelcomeService.prefersReducedMotion as jasmine.Spy).and.returnValue(true);
    expect(service().playIntro).toBeFalse();
  });
});
