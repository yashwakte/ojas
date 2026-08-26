import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';

/**
 * The campaign banner exactly as customers see it on the home page.
 *
 * This exists so the admin's "Live Preview" and the real home page are the same
 * component rather than two hand-maintained copies of the same CSS — the copies
 * had already drifted apart on max-height, padding, border-radius and font sizes,
 * which is what made the preview misleading.
 *
 * `preview` only rounds the corners so it sits inside the admin card; the real
 * banner is full-bleed. Nothing else about the rendering differs.
 *
 * Title and subtitle are both optional. Festival artwork usually carries its own
 * headline already, and laying a second one over the top of it looked wrong — two
 * competing titles fighting for the same corner of the same picture. Leave them
 * blank and the artwork speaks for itself, with nothing over it but the call to
 * action.
 */
@Component({
  selector: 'app-campaign-banner',
  imports: [RouterLink, MatIconModule],
  templateUrl: './campaign-banner.html',
  styleUrl: './campaign-banner.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CampaignBanner {
  title = input<string>('');
  subtitle = input<string>('');
  ctaText = input<string>('');
  ctaLink = input<string>('');
  backgroundImageUrl = input<string>('');

  /** Renders inside the admin card: rounded, and the CTA is not a live link. */
  preview = input(false);

  /**
   * Set on the topmost banner only. It loads the image eagerly at high priority
   * because it is likely to be the largest thing in the first screenful; every
   * banner below it stays lazy so it costs nothing until it is scrolled to.
   */
  priority = input(false);

  /**
   * Whether anything is being written over the artwork. Drives how heavy the scrim
   * needs to be: a block of text needs a dark gradient behind it to stay readable,
   * whereas a lone button only needs a soft pool of shade under itself, and dimming
   * the whole lower half of a festival photo for its sake would spoil the picture.
   */
  readonly hasOverlayText = computed(() => !!this.title() || !!this.subtitle());
}
