import { TestBed } from '@angular/core/testing';
import {
  AppRecoveryService,
  decideStaleBuildRecovery,
  isStaleBuildError,
} from './app-recovery.service';

const MARKER = 'ojas_stale_build_reload_at';

describe('app recovery from a stale build', () => {
  beforeEach(() => sessionStorage.removeItem(MARKER));
  afterEach(() => sessionStorage.removeItem(MARKER));

  describe('recognising the failure', () => {
    // The wording differs per browser engine and per cause. A tab left open across a deploy asks
    // for a chunk that no longer exists; whether that comes back as a 404, a MIME mismatch or a
    // syntax error depends on how the host answers, and all of them mean the same thing.
    const staleMessages = [
      'Failed to fetch dynamically imported module: https://ojas/chunk-ABC.js',
      'error loading dynamically imported module',
      'Importing a module script failed.',
      'Loading chunk 42 failed.',
      "Expected a JavaScript module script but the server responded with a MIME type of 'text/html'.",
      "Unexpected token '<'",
    ];

    staleMessages.forEach((message) => {
      it(`recognises: ${message.slice(0, 44)}`, () => {
        expect(isStaleBuildError(new Error(message))).toBeTrue();
      });
    });

    it('recognises a ChunkLoadError by name even when the message is unhelpful', () => {
      const error = Object.assign(new Error('something'), { name: 'ChunkLoadError' });
      expect(isStaleBuildError(error)).toBeTrue();
    });

    it('leaves ordinary application errors alone', () => {
      expect(isStaleBuildError(new Error('Cannot read properties of undefined'))).toBeFalse();
      expect(isStaleBuildError(new Error('Http failure response for /api/orders: 500'))).toBeFalse();
      expect(isStaleBuildError(null)).toBeFalse();
    });
  });

  describe('deciding whether to reload', () => {
    const stale = new Error('Failed to fetch dynamically imported module: /chunk-ABC.js');

    it('reloads the first time', () => {
      expect(decideStaleBuildRecovery(stale)).toBe('reload');
    });

    it('gives up rather than reloading twice inside the cooldown', () => {
      // The whole point of the guard. A freshly loaded copy of the app hitting the same wall is
      // not a stale deploy, and reloading again would put the customer in a loop.
      const now = 1_000_000;
      sessionStorage.setItem(MARKER, String(now));

      expect(decideStaleBuildRecovery(stale, now + 5_000)).toBe('give-up');
    });

    it('allows a fresh attempt once the cooldown has passed', () => {
      const now = 1_000_000;
      sessionStorage.setItem(MARKER, String(now));

      expect(decideStaleBuildRecovery(stale, now + 61_000)).toBe('reload');
    });

    it('never touches anything for an error that is not a stale build', () => {
      expect(decideStaleBuildRecovery(new Error('nope'))).toBe('not-stale');
    });
  });

  describe('what the shell shows', () => {
    let service: AppRecoveryService;

    beforeEach(() => {
      TestBed.configureTestingModule({});
      service = TestBed.inject(AppRecoveryService);
    });

    it('starts with nothing to report', () => {
      expect(service.failure()).toBeNull();
    });

    it('puts a message up when recovery is already spent', () => {
      sessionStorage.setItem(MARKER, String(Date.now()));

      service.onNavigationError(new Error('Failed to fetch dynamically imported module: /c.js'));

      expect(service.failure()).toEqual({ staleBuild: true });
    });

    it('puts a message up for a route that failed for any other reason too', () => {
      // Whatever went wrong, the customer must never be left looking at empty space.
      service.onNavigationError(new Error('Cannot read properties of undefined'));

      expect(service.failure()).toEqual({ staleBuild: false });
    });

    it('takes the message down once a navigation succeeds', () => {
      service.onNavigationError(new Error('boom'));
      service.onNavigationSucceeded();

      expect(service.failure()).toBeNull();
    });

    it('does NOT re-arm the reload guard when a navigation succeeds', () => {
      // Learned by driving a real browser: after a recovery reload the app lands on a page that
      // renders perfectly well. Treating that as "all better" re-armed the reload for the very
      // next tap on the route that was actually broken, so every tap silently reloaded the
      // customer back to where they started - clicks that appear to do nothing at all.
      const marker = String(Date.now());
      sessionStorage.setItem(MARKER, marker);

      service.onNavigationSucceeded();

      expect(sessionStorage.getItem(MARKER)).toBe(marker);
    });
  });
});
