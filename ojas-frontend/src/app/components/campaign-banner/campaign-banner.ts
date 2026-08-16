import { ChangeDetectionStrategy, Component, input } from '@angular/core';
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
 */
@Component({
  selector: 'app-campaign-banner',
  imports: [RouterLink, MatIconModule],
  templateUrl: './campaign-banner.html',
  styleUrl: './campaign-banner.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CampaignBanner {
  title = input.required<string>();
  subtitle = input<string>('');
  ctaText = input<string>('');
  ctaLink = input<string>('');
  backgroundImageUrl = input<string>('');

  /** Renders inside the admin card: rounded, and the CTA is not a live link. */
  preview = input(false);
}
