import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { ScrollRevealDirective } from '../../directives/scroll-reveal.directive';
import { RevealWordsDirective } from '../../directives/reveal-words.directive';
import { CountUpDirective } from '../../directives/count-up.directive';

/**
 * "Our story" on the home page: who is behind the flour. The one dark band on the page, a pause
 * between shelves of products.
 *
 * Every line is the owner's own account from the About page - a farming family, one small outlet
 * in Pune, ten-plus years, 1,200-plus retail outlets. Nothing is claimed here that the About page
 * does not already say, so the two can never disagree.
 */
@Component({
  selector: 'app-home-story',
  imports: [RouterLink, MatIconModule, ScrollRevealDirective, RevealWordsDirective, CountUpDirective],
  templateUrl: './home-story.html',
  styleUrl: './home-story.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeStory {
  /** The chakki's grooves, every 30 degrees. */
  protected readonly grooves = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];
}
