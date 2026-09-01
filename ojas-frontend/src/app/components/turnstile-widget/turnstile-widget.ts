import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { environment } from '../../../environments/environment';

interface TurnstileRenderOptions {
  sitekey: string;
  callback: (token: string) => void;
  'expired-callback'?: () => void;
  'error-callback'?: () => void;
}

/** Polling interval and ceiling for the Cloudflare script arriving.
 *
 * Thirty seconds, not ten. Ten is plenty on a desk in an office and nowhere near enough on a
 * phone with two bars, which is a large share of who shops here - and giving up early on a
 * connection that was merely slow is indistinguishable, to the customer, from the site being
 * broken. Nothing is lost by waiting: the button is disabled either way, and the wait now ends
 * in a retry rather than a dead end. */
const SCRIPT_POLL_MS = 100;
const SCRIPT_WAIT_LIMIT_MS = 30_000;

declare global {
  interface Window {
    // Loaded via the <script> tag in index.html, not an npm package - undefined until
    // that (async) script finishes, hence the optional type and the poll in renderWidget().
    turnstile?: {
      render(container: HTMLElement, options: TurnstileRenderOptions): string;
      reset(widgetId: string): void;
      remove(widgetId: string): void;
    };
  }
}

/**
 * Thin wrapper around Cloudflare Turnstile's explicit-render API. A token is single-use, so
 * the parent form must call reset() after a failed submit to get a fresh one before retrying.
 */
@Component({
  selector: 'app-turnstile-widget',
  template: `
    <div #container></div>
    @if (unavailable()) {
      <div class="turnstile-unavailable" role="alert">
        <p>
          The security check couldn't load. That's usually a slow connection, or a browser
          extension blocking it.
        </p>
        <button type="button" class="turnstile-retry" (click)="retry()">Try again</button>
      </div>
    }
  `,
  styles: `
    .turnstile-unavailable {
      margin: 4px 0 0;
      font-size: 0.85rem;
      line-height: 1.45;
      color: #b3261e;

      p {
        margin: 0 0 8px;
      }
    }

    .turnstile-retry {
      font: inherit;
      font-weight: 600;
      color: var(--ojas-ink);
      background: none;
      /* A real bordered control rather than a bare link: this is the only way forward from here,
         and on a phone it needs a tap target, not a word in a sentence. */
      border: 1px solid currentColor;
      border-radius: 8px;
      padding: 7px 16px;
      cursor: pointer;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TurnstileWidget implements AfterViewInit, OnDestroy {
  private readonly container = viewChild.required<ElementRef<HTMLDivElement>>('container');

  readonly verified = output<string>();
  /** Covers both an expired solve and a widget-level error - either way, the parent's
   * held token is no longer good and submit should be disabled again. */
  readonly expired = output<void>();

  /** Set once the script has been given long enough and still isn't there. Every form using
   * this widget keeps its submit button disabled until a token arrives, so without something
   * on screen a blocked script is indistinguishable from a button that just does nothing. */
  protected readonly unavailable = signal(false);

  private widgetId: string | null = null;
  private pendingRetry: ReturnType<typeof setTimeout> | null = null;
  private waitedMs = 0;

  ngAfterViewInit(): void {
    this.renderWidget();
  }

  ngOnDestroy(): void {
    if (this.pendingRetry) {
      clearTimeout(this.pendingRetry);
    }
    if (this.widgetId && window.turnstile) {
      window.turnstile.remove(this.widgetId);
    }
  }

  /** Starts the wait over from the beginning. The script may simply have been slower than the
   * ceiling, in which case it has very likely arrived by now and this renders immediately; if it
   * genuinely cannot load, the customer lands back here having lost nothing but the wait. */
  protected retry(): void {
    this.waitedMs = 0;
    this.unavailable.set(false);
    this.renderWidget();
  }

  /** Called by the parent after a failed submit - the spent token can't be reused. */
  reset(): void {
    if (this.widgetId && window.turnstile) {
      window.turnstile.reset(this.widgetId);
    }
  }

  private renderWidget(): void {
    if (!window.turnstile) {
      // Bounded, because this used to poll forever. When the script is blocked - an ad blocker,
      // a corporate network, a domain missing from the Turnstile dashboard's allow-list - it
      // never arrives, and a silent infinite poll leaves the sign-in button disabled with
      // nothing to explain why.
      if (this.waitedMs >= SCRIPT_WAIT_LIMIT_MS) {
        this.unavailable.set(true);
        return;
      }

      this.waitedMs += SCRIPT_POLL_MS;
      this.pendingRetry = setTimeout(() => this.renderWidget(), SCRIPT_POLL_MS);
      return;
    }

    this.unavailable.set(false);
    this.widgetId = window.turnstile.render(this.container().nativeElement, {
      sitekey: environment.turnstileSiteKey,
      callback: (token) => this.verified.emit(token),
      'expired-callback': () => this.expired.emit(),
      'error-callback': () => this.expired.emit(),
    });
  }
}
