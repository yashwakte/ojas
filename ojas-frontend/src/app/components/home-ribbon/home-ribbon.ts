import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * A slow band of words above the closing call to action. Two identical halves scroll as one, so
 * the loop has no seam. Decorative, and a repeat of things said elsewhere on the page, so it is
 * hidden from screen readers.
 */
@Component({
  selector: 'app-home-ribbon',
  template: `
    <div class="ribbon-track">
      @for (half of halves; track half) {
        <div class="ribbon-half">
          @for (w of words(); track w) {
            <span class="ribbon-item">{{ w }}</span>
            <span class="ribbon-dot">✦</span>
          }
        </div>
      }
    </div>
  `,
  styleUrl: './home-ribbon.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true' },
})
export class HomeRibbon {
  readonly words = input.required<readonly string[]>();
  protected readonly halves = [0, 1];
}
