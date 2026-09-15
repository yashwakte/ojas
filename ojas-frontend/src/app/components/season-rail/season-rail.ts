import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { ScrollRevealDirective } from '../../directives/scroll-reveal.directive';
import { Season } from '../../constants/seasons';

/** The festival calendar's cards: a swipeable rail on a phone, a row on a desktop. Each card
 * opens the aisle its flour lives in. */
@Component({
  selector: 'app-season-rail',
  imports: [RouterLink, MatIconModule, ScrollRevealDirective],
  templateUrl: './season-rail.html',
  styleUrl: './season-rail.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SeasonRail {
  readonly seasons = input.required<readonly Season[]>();
}
