import { TestBed } from '@angular/core/testing';
import { TurnstileWidget } from './turnstile-widget';
import { environment } from '../../../environments/environment';

describe('TurnstileWidget', () => {
  let turnstileMock: jasmine.SpyObj<NonNullable<Window['turnstile']>>;

  beforeEach(() => {
    turnstileMock = jasmine.createSpyObj('turnstile', ['render', 'reset', 'remove']);
    turnstileMock.render.and.returnValue('widget-1');
    window.turnstile = turnstileMock;

    TestBed.configureTestingModule({ imports: [TurnstileWidget] });
  });

  afterEach(() => {
    delete window.turnstile;
  });

  function create() {
    const fixture = TestBed.createComponent(TurnstileWidget);
    fixture.detectChanges();
    return fixture;
  }

  it('renders the widget into its container with the configured site key', () => {
    create();

    expect(turnstileMock.render).toHaveBeenCalledTimes(1);
    const [container, options] = turnstileMock.render.calls.mostRecent().args;
    expect(container).toBeInstanceOf(HTMLDivElement);
    expect(options.sitekey).toBe(environment.turnstileSiteKey);
  });

  it('emits verified with the token when the widget solves', () => {
    const fixture = create();
    const emitted: string[] = [];
    fixture.componentInstance.verified.subscribe((token) => emitted.push(token));

    const options = turnstileMock.render.calls.mostRecent().args[1];
    options.callback('the-token');

    expect(emitted).toEqual(['the-token']);
  });

  it('emits expired on both expired-callback and error-callback', () => {
    const fixture = create();
    let expiredCount = 0;
    fixture.componentInstance.expired.subscribe(() => expiredCount++);

    const options = turnstileMock.render.calls.mostRecent().args[1];
    options['expired-callback']?.();
    options['error-callback']?.();

    expect(expiredCount).toBe(2);
  });

  it('reset() resets the rendered widget by id', () => {
    const fixture = create();

    fixture.componentInstance.reset();

    expect(turnstileMock.reset).toHaveBeenCalledWith('widget-1');
  });

  it('reset() is a no-op if the widget never rendered', () => {
    delete window.turnstile;
    const fixture = create();

    expect(() => fixture.componentInstance.reset()).not.toThrow();
    expect(turnstileMock.reset).not.toHaveBeenCalled();
  });

  it('polls until the turnstile script has loaded, then renders', () => {
    delete window.turnstile;
    jasmine.clock().install();
    try {
      const fixture = create();
      expect(turnstileMock.render).not.toHaveBeenCalled();

      window.turnstile = turnstileMock;
      jasmine.clock().tick(100);
      fixture.detectChanges();

      expect(turnstileMock.render).toHaveBeenCalledTimes(1);
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('removes the widget on destroy', () => {
    const fixture = create();

    fixture.destroy();

    expect(turnstileMock.remove).toHaveBeenCalledWith('widget-1');
  });

  it('gives up only after 30s, and offers a retry rather than a dead end', () => {
    // The old ceiling was 10s, which a slow mobile connection can exceed while still being
    // perfectly capable of loading the script.
    delete window.turnstile;
    jasmine.clock().install();
    try {
      const fixture = create();

      jasmine.clock().tick(29_000);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.turnstile-unavailable')).toBeNull();

      jasmine.clock().tick(2_000);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.turnstile-retry')).not.toBeNull();
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('retrying after the script finally arrives renders the widget', () => {
    delete window.turnstile;
    jasmine.clock().install();
    try {
      const fixture = create();
      jasmine.clock().tick(31_000);
      fixture.detectChanges();

      // The script was merely slow, not blocked - it lands after we had given up.
      window.turnstile = turnstileMock;
      fixture.nativeElement.querySelector('.turnstile-retry').click();
      fixture.detectChanges();

      expect(turnstileMock.render).toHaveBeenCalledTimes(1);
      expect(fixture.nativeElement.querySelector('.turnstile-unavailable')).toBeNull();
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('cancels a pending retry on destroy without ever rendering', () => {
    delete window.turnstile;
    jasmine.clock().install();
    try {
      const fixture = create();
      fixture.destroy();

      window.turnstile = turnstileMock;
      jasmine.clock().tick(1000);

      expect(turnstileMock.render).not.toHaveBeenCalled();
    } finally {
      jasmine.clock().uninstall();
    }
  });
});
