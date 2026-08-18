import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  output,
  viewChild,
} from '@angular/core';
import { environment } from '../../../environments/environment';

interface TurnstileRenderOptions {
  sitekey: string;
  callback: (token: string) => void;
  'expired-callback'?: () => void;
  'error-callback'?: () => void;
}

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
  template: `<div #container></div>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TurnstileWidget implements AfterViewInit, OnDestroy {
  private readonly container = viewChild.required<ElementRef<HTMLDivElement>>('container');

  readonly verified = output<string>();
  /** Covers both an expired solve and a widget-level error - either way, the parent's
   * held token is no longer good and submit should be disabled again. */
  readonly expired = output<void>();

  private widgetId: string | null = null;
  private pendingRetry: ReturnType<typeof setTimeout> | null = null;

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

  /** Called by the parent after a failed submit - the spent token can't be reused. */
  reset(): void {
    if (this.widgetId && window.turnstile) {
      window.turnstile.reset(this.widgetId);
    }
  }

  private renderWidget(): void {
    if (!window.turnstile) {
      this.pendingRetry = setTimeout(() => this.renderWidget(), 100);
      return;
    }

    this.widgetId = window.turnstile.render(this.container().nativeElement, {
      sitekey: environment.turnstileSiteKey,
      callback: (token) => this.verified.emit(token),
      'expired-callback': () => this.expired.emit(),
      'error-callback': () => this.expired.emit(),
    });
  }
}
