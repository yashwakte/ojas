import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';

/**
 * Any address the shop does not have.
 *
 * Vercel serves the app for every path with a 200, so this page cannot send a real 404 status.
 * What tells search engines "nothing here" instead is the noindex its route's SEO carries — Google
 * documents that as the way for an app like this one to avoid soft 404s.
 */
@Component({
  selector: 'app-not-found',
  imports: [RouterLink, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="not-found-page">
      <mat-icon class="not-found-icon" aria-hidden="true">search_off</mat-icon>
      <h1>Page not found</h1>
      <p>
        This address isn't part of the Ojas shop. It may have been mistyped, or the page has
        moved.
      </p>
      <div class="not-found-actions">
        <a routerLink="/products" class="not-found-primary">Browse products</a>
        <a routerLink="/" class="not-found-secondary">Go to the home page</a>
      </div>
    </section>
  `,
  styles: `
    .not-found-page {
      max-width: 520px;
      margin: 0 auto;
      padding: 72px 24px 96px;
      text-align: center;
      color: #3a2f28;
    }
    .not-found-icon {
      width: 56px;
      height: 56px;
      font-size: 56px;
      color: #b3420f;
    }
    h1 {
      margin: 12px 0 8px;
      font-size: 1.6rem;
    }
    p {
      margin: 0 0 28px;
      line-height: 1.6;
      color: #5c4f46;
    }
    .not-found-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      justify-content: center;
    }
    .not-found-primary,
    .not-found-secondary {
      display: inline-flex;
      align-items: center;
      min-height: 44px;
      padding: 0 22px;
      border-radius: 999px;
      font-weight: 600;
      text-decoration: none;
    }
    .not-found-primary {
      background: #b3420f;
      color: #fff;
    }
    .not-found-secondary {
      border: 1.5px solid #b3420f;
      color: #b3420f;
    }
    .not-found-primary:focus-visible,
    .not-found-secondary:focus-visible {
      outline: 3px solid #f5a300;
      outline-offset: 2px;
    }
  `,
})
export class NotFound {}
