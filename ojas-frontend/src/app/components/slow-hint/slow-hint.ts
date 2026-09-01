import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

/**
 * Shown when something is taking longer than it should - a cold API instance, a slow connection,
 * a payment page being prepared.
 *
 * Two deliberate choices. It says "still working" rather than naming a cause, because "the server
 * is waking up" is our problem described in our language and tells a customer nothing they can
 * act on. And it fills the wait with something worth reading about the thing they are actually
 * buying, which is the difference between a wait that feels broken and one that feels occupied.
 *
 * Facts rotate rather than sitting still, so a long wait does not look like a frozen screen.
 */
const FACTS: readonly string[] = [
  'Ragi (finger millet) is one of the richest plant sources of calcium of any cereal grain.',
  'Bajra (pearl millet) is naturally gluten-free, and has been grown in India for over 3,000 years.',
  'Jowar (sorghum) is among the oldest cultivated grains in the world.',
  'The United Nations named 2023 the International Year of Millets — grains India has been eating all along.',
  'Whole wheat atta keeps the bran and the germ, which is where most of the fibre lives.',
  'Daliya is simply wheat cracked into pieces rather than ground into flour.',
  'Besan is milled from chana dal, which is why it carries so much more protein than most flours.',
  'Stone-ground flour is milled slowly, which keeps it cooler than high-speed steel roller milling.',
];

/** Long enough to finish reading a line, short enough that the screen never looks frozen. */
const ROTATE_MS = 6000;

@Component({
  selector: 'app-slow-hint',
  imports: [MatIconModule],
  template: `
    <div class="slow-hint" role="status" aria-live="polite">
      <div class="slow-hint-top">
        <mat-icon>hourglass_top</mat-icon>
        <span>Still working — this can take a few seconds.</span>
      </div>
      <p class="slow-hint-fact">
        <strong>Did you know?</strong>
        {{ fact() }}
      </p>
    </div>
  `,
  styles: `
    .slow-hint {
      margin-top: 14px;
      padding: 12px 14px;
      border-radius: 12px;
      background: #fdf7ef;
      border: 1px solid #f0e2cd;
      animation: slowHintIn 0.35s ease both;
    }

    .slow-hint-top {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.86rem;
      font-weight: 600;
      color: #8a5c00;

      mat-icon {
        font-size: 17px;
        width: 17px;
        height: 17px;
        animation: slowHintSpin 1.8s linear infinite;
      }
    }

    .slow-hint-fact {
      margin: 8px 0 0;
      font-size: 0.84rem;
      line-height: 1.6;
      color: var(--ojas-text-light);

      strong {
        color: var(--ojas-ink);
      }
    }

    @keyframes slowHintSpin {
      to {
        transform: rotate(360deg);
      }
    }

    @keyframes slowHintIn {
      from {
        opacity: 0;
        transform: translateY(4px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    /* Respect a reader who has asked the system for less motion - the spinner and the entry
       animation are decoration, not information. */
    @media (prefers-reduced-motion: reduce) {
      .slow-hint {
        animation: none;
      }

      .slow-hint-top mat-icon {
        animation: none;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SlowHint implements OnInit, OnDestroy {
  /** Starts on a random fact so a customer who hits two slow requests in a row doesn't read the
   * same opening line twice. */
  private index = Math.floor(Math.random() * FACTS.length);
  protected readonly fact = signal(FACTS[this.index]);
  private timer: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    this.timer = setInterval(() => {
      this.index = (this.index + 1) % FACTS.length;
      this.fact.set(FACTS[this.index]);
    }, ROTATE_MS);
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
