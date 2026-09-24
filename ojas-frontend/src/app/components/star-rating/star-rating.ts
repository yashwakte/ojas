import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Read-only stars for a rating, fractional ones included: 4.3 draws four full stars and a third
 * of the fifth. Drawn as one row of outline stars with a filled row clipped over it, so a partial
 * star is exact rather than rounded to a half.
 *
 * Announced as words ("Rated 4.3 out of 5") - five star glyphs mean nothing read aloud.
 */
@Component({
  selector: 'app-star-rating',
  template: `
    <span class="stars" role="img" [attr.aria-label]="label()">
      <span class="row base" aria-hidden="true">
        @for (s of five; track s) {
          <svg viewBox="0 0 24 24"><path [attr.d]="star" /></svg>
        }
      </span>
      <span class="row fill" aria-hidden="true" [style.width.%]="percent()">
        @for (s of five; track s) {
          <svg viewBox="0 0 24 24"><path [attr.d]="star" /></svg>
        }
      </span>
    </span>
  `,
  styles: `
    :host {
      display: inline-flex;
      vertical-align: middle;
      --star-size: 16px;
    }
    .stars {
      position: relative;
      display: inline-flex;
      line-height: 0;
    }
    .row {
      display: inline-flex;
      gap: 2px;
      white-space: nowrap;
    }
    .fill {
      position: absolute;
      inset: 0 auto 0 0;
      overflow: hidden;
    }
    svg {
      flex-shrink: 0;
      width: var(--star-size);
      height: var(--star-size);
    }
    .base path {
      fill: #ece4da;
    }
    .fill path {
      fill: #f0a020;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StarRating {
  readonly value = input.required<number>();

  protected readonly five = [1, 2, 3, 4, 5];
  protected readonly star =
    'M12 2.6l2.9 6 6.6.8-4.9 4.5 1.3 6.5L12 17.2l-5.9 3.2 1.3-6.5L2.5 9.4l6.6-.8z';

  /** Width of the filled row, as a share of the whole row. The 2px gaps shift a boundary by well
   * under a pixel, which the eye cannot see at these sizes. */
  protected readonly percent = computed(() => {
    const v = Math.max(0, Math.min(5, this.value() || 0));
    return (v / 5) * 100;
  });

  protected readonly label = computed(() => `Rated ${this.value()} out of 5`);
}
