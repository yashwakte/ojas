import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { CountUpDirective } from '../../directives/count-up.directive';
import { WelcomeService } from '../../services/welcome.service';
import { ProductService } from '../../services/product.service';
import { FREE_DELIVERY_CART_THRESHOLD } from '../../constants/pricing';
import { HomePosters } from '../home-posters/home-posters';

/**
 * The beat between the last overlay leaving and the hero's buttons arriving. Without it the two
 * moments butt up against each other and read as one confused animation.
 */
const HANDOVER_MS = 320;

/**
 * The top of the home page: one dark card holding the owner's posters in a carousel, with the
 * two buttons and the trust line centred beneath them, and the shop's live figures along its foot.
 *
 * The posters are the only picture. They carry their own headlines, so nothing is written over
 * them; the page's h1 is for screen readers and search engines.
 *
 * The category figure is the catalogue's own, so it cannot drift from the truth when the owner
 * opens a new aisle. The product figure is the size of the range as the owner states it.
 */
@Component({
  selector: 'app-home-hero',
  imports: [RouterLink, MatIconModule, CountUpDirective, HomePosters],
  templateUrl: './home-hero.html',
  styleUrl: './home-hero.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeHero {
  private readonly welcome = inject(WelcomeService);
  private readonly productService = inject(ProductService);

  readonly freeDeliveryFrom = FREE_DELIVERY_CART_THRESHOLD;

  /**
   * "30+ Products": the Ojas range as the owner describes it (September 2026). Deliberately not
   * the count of what is listed online, which is smaller - not every product in the range is
   * priced for the website at any one time.
   */
  readonly rangeSize = 30;

  /** The buttons have arrived. They wait their turn behind the intro and any welcome overlay. */
  readonly revealed = signal(false);

  /** True once the browser has painted; nothing may animate before this. */
  private readonly painted = signal(false);
  private timer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Listed products only. An admin browsing the shop also receives unpriced drafts, and those are
   * not part of what a customer can buy.
   */
  private readonly listed = computed(() => this.productService.products().filter((p) => p.isListed));

  /** The catalogue has arrived in full - not just the one product a detail page fetched. */
  readonly catalogueReady = computed(() => !this.productService.loading() && this.listed().length > 0);
  readonly categoryCount = computed(() => new Set(this.listed().map((p) => p.category)).size);

  /** The numbers count up once, when the copy arrives, and not before there is a number. */
  readonly statsLive = computed(() => this.revealed() && this.catalogueReady());

  constructor() {
    afterNextRender(() => this.painted.set(true));

    // THE HANDOVER. The branded intro curtain, the first-visit greeting, the post-auth welcome
    // overlay and this hero all want the first two seconds of the page. So the hero goes last:
    // whoever is on screen owns the moment and hands it on when they are done.
    effect(() => {
      if (!this.painted()) return;

      if (WelcomeService.prefersReducedMotion()) {
        this.revealed.set(true);
        return;
      }

      const someoneElsesTurn =
        !this.welcome.introDone() || !!this.welcome.celebration() || this.welcome.stageHeld();

      if (someoneElsesTurn) {
        if (!this.revealed()) this.cancel();
        return;
      }

      if (this.revealed() || this.timer) return;
      this.timer = setTimeout(() => {
        this.timer = null;
        this.revealed.set(true);
      }, HANDOVER_MS);
    });

    inject(DestroyRef).onDestroy(() => this.cancel());
  }

  private cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
