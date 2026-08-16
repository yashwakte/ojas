import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { CelebrationKind, WelcomeService } from '../../services/welcome.service';

/**
 * How long the moment holds before it starts leaving. Registration says more
 * and only ever happens once, so it earns the longer beat; returning users get
 * a briefer greeting that still leaves time to read it.
 */
const HOLD_MS: Record<CelebrationKind, number> = {
  register: 5500,
  login: 3500,
};
const EXIT_MS = 550;

/** Warm light-mote palette — never more than three tones, or it reads as noise. */
const MOTE_TONES = ['255, 236, 214', '255, 198, 150', '255, 255, 255'];

interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  tone: number;
  life: number;
  maxLife: number;
  sway: number;
  swaySpeed: number;
}

@Component({
  selector: 'app-welcome-celebration',
  templateUrl: './welcome-celebration.html',
  styleUrl: './welcome-celebration.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WelcomeCelebration {
  private readonly welcome = inject(WelcomeService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly canvasRef = viewChild<ElementRef<HTMLCanvasElement>>('moteCanvas');

  private rafId: number | null = null;
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  private exitTimer: ReturnType<typeof setTimeout> | null = null;
  private sprites: HTMLCanvasElement[] = [];

  protected readonly celebration = this.welcome.celebration;
  protected readonly leaving = signal(false);
  protected readonly reducedMotion = WelcomeService.prefersReducedMotion();

  protected readonly isNew = computed(() => this.celebration()?.kind === 'register');

  protected readonly initial = computed(() => this.celebration()?.name.charAt(0).toUpperCase() ?? '');

  /** Split into words so each can rise out of its own mask, staggered. */
  protected readonly headlineWords = computed(() => {
    const c = this.celebration();
    if (!c) return [];
    const line = c.kind === 'register' ? `Welcome to Ojas, ${c.name}` : `Welcome back, ${c.name}`;
    return line.split(' ');
  });

  protected readonly subtext = computed(() => {
    const c = this.celebration();
    if (!c) return '';
    return c.kind === 'register'
      ? 'Your place is set. We are genuinely glad you are here.'
      : 'Everything is just where you left it.';
  });

  constructor() {
    effect(() => {
      const c = this.celebration();
      this.clearTimers();

      if (!c) {
        this.stopMotes();
        return;
      }

      this.leaving.set(false);
      this.holdTimer = setTimeout(() => this.beginExit(), HOLD_MS[c.kind]);
    });

    effect(() => {
      const canvas = this.canvasRef();
      const c = this.celebration();
      if (canvas && c && !this.reducedMotion) {
        this.startMotes(canvas.nativeElement, c.kind);
      }
    });

    this.destroyRef.onDestroy(() => {
      this.clearTimers();
      this.stopMotes();
    });
  }

  /** Clicking anywhere skips ahead — the moment should never feel like a wall. */
  protected dismiss(): void {
    if (this.leaving()) return;
    this.clearTimers();
    this.beginExit();
  }

  private beginExit(): void {
    this.leaving.set(true);
    this.exitTimer = setTimeout(() => this.welcome.dismissCelebration(), EXIT_MS);
  }

  private clearTimers(): void {
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
    if (this.exitTimer) {
      clearTimeout(this.exitTimer);
      this.exitTimer = null;
    }
  }

  // Pre-baking each glow into a sprite keeps the draw loop to plain drawImage
  // calls — per-particle shadowBlur would drop frames on mid-range phones.
  private buildSprites(): void {
    if (this.sprites.length) return;
    this.sprites = MOTE_TONES.map((tone) => {
      const size = 64;
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const g = c.getContext('2d');
      if (g) {
        const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        grad.addColorStop(0, `rgba(${tone}, 1)`);
        grad.addColorStop(0.22, `rgba(${tone}, 0.5)`);
        grad.addColorStop(1, `rgba(${tone}, 0)`);
        g.fillStyle = grad;
        g.fillRect(0, 0, size, size);
      }
      return c;
    });
  }

  private startMotes(canvas: HTMLCanvasElement, kind: CelebrationKind): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const generous = kind === 'register';
    const holdMs = HOLD_MS[kind];

    this.buildSprites();

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cx = width / 2;
    const cy = height / 2;
    const motes: Mote[] = [];

    // Ambient drift — a slow, sparse field of light rising through the frame.
    const ambient = generous ? 46 : 30;
    for (let i = 0; i < ambient; i++) {
      motes.push({
        x: Math.random() * width,
        y: height * 0.15 + Math.random() * height,
        vx: 0,
        vy: -(6 + Math.random() * 22) / 60,
        radius: 1.5 + Math.random() * 5,
        tone: Math.floor(Math.random() * MOTE_TONES.length),
        life: Math.random() * 120,
        maxLife: 200 + Math.random() * 160,
        sway: Math.random() * Math.PI * 2,
        swaySpeed: 0.008 + Math.random() * 0.016,
      });
    }

    // A single soft bloom outward from the emblem, easing to a stop — the
    // celebratory beat, without anything resembling a party popper.
    const burst = generous ? 40 : 22;
    for (let i = 0; i < burst; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (0.7 + Math.random() * 2.4) * (generous ? 1 : 0.75);
      motes.push({
        x: cx + Math.cos(angle) * 18,
        y: cy + Math.sin(angle) * 18,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: 1.5 + Math.random() * 4.5,
        tone: Math.floor(Math.random() * MOTE_TONES.length),
        life: 0,
        maxLife: 150 + Math.random() * 110,
        sway: Math.random() * Math.PI * 2,
        swaySpeed: 0.01 + Math.random() * 0.015,
      });
    }

    const start = performance.now();
    const total = holdMs + EXIT_MS;

    const frame = (now: number) => {
      const elapsed = now - start;
      // Fade the whole field out alongside the overlay's own exit.
      const fieldAlpha = elapsed < holdMs ? 1 : Math.max(0, 1 - (elapsed - holdMs) / EXIT_MS);

      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'lighter';

      for (const m of motes) {
        m.life++;
        if (m.life > m.maxLife) {
          m.life = 0;
          m.x = Math.random() * width;
          m.y = height + 20;
          m.vx = 0;
          m.vy = -(6 + Math.random() * 22) / 60;
        }

        m.vx *= 0.965;
        m.vy = m.vy * 0.965 - 0.0035;
        m.sway += m.swaySpeed;
        m.x += m.vx + Math.sin(m.sway) * 0.28;
        m.y += m.vy;

        // Ease in and out across the mote's life so nothing ever pops.
        const p = m.life / m.maxLife;
        const alpha = Math.sin(Math.PI * Math.min(1, Math.max(0, p))) * 0.85 * fieldAlpha;
        if (alpha <= 0.01) continue;

        const r = m.radius * 6;
        ctx.globalAlpha = alpha;
        ctx.drawImage(this.sprites[m.tone], m.x - r, m.y - r, r * 2, r * 2);
      }

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      if (elapsed < total) {
        this.rafId = requestAnimationFrame(frame);
      } else {
        this.rafId = null;
      }
    };

    this.rafId = requestAnimationFrame(frame);
  }

  private stopMotes(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }
}
