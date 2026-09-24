import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  NgZone,
  afterNextRender,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { WelcomeService } from '../../services/welcome.service';
import { SceneProfile, SceneRenderer } from './scene-renderer';

/** Screens the scene stays off: staff consoles are for working, not for atmosphere. */
const STAFF_PREFIXES = ['/admin', '/delivery', '/accept-invite'];

/**
 * Which arrangement of the aurora's light a page gets, so each part of the shop has its own:
 * moving from the home page to a product shifts the colour fields rather than repeating them.
 */
export function moodForPath(path: string): number {
  if (path === '/' || path.startsWith('/about')) return 0;
  if (path.startsWith('/products/')) return 2;
  if (path.startsWith('/products') || path.startsWith('/offers')) return 1;
  if (path.startsWith('/cart') || path.startsWith('/checkout')) return 3;
  if (path.startsWith('/my-orders') || path.startsWith('/wallet') || path.startsWith('/profile')) return 1;
  return 0;
}

interface NetworkInformationLike {
  saveData?: boolean;
  effectiveType?: string;
}

/**
 * What this device should get, or null for nothing at all.
 *
 * The bar for Ojas is that a customer on two bars of signal and a budget phone never feels the
 * page drag, so the scene steps down rather than risk it: nothing on a slow connection or with
 * Data Saver on, nothing on a phone with under 2 GB of memory, a still frame for anyone who has
 * asked their system for less motion, and fewer motes at 30 fps on every touch screen.
 */
export function sceneProfile(win: Window = window): SceneProfile | null {
  const nav = win.navigator as Navigator & {
    connection?: NetworkInformationLike;
    deviceMemory?: number;
  };
  const connection = nav.connection;
  if (connection?.saveData) return null;
  if (connection?.effectiveType && /(^|-)2g$|^3g$/.test(connection.effectiveType)) return null;
  if (typeof nav.deviceMemory === 'number' && nav.deviceMemory < 2) return null;
  if (typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency < 3) return null;
  if (!('WebGLRenderingContext' in win)) return null;

  const still = win.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const touch = win.matchMedia('(pointer: coarse)').matches;
  const width = win.innerWidth;

  if (width < 700) return { motes: 600, maxDpr: 1, fps: 30, still };
  if (width < 1100 || touch) return { motes: 1100, maxDpr: 1.5, fps: touch ? 30 : 60, still };
  return { motes: 1600, maxDpr: 1.5, fps: 60, still };
}

/**
 * The backdrop behind every storefront page: a slow saffron aurora with flour motes drifting
 * through it in three depth layers (option C, the owner's pick on 2026-09-23). The light shifts
 * as the customer scrolls and between parts of the shop; the motes move at different speeds with
 * the scroll, which is what gives the page depth.
 *
 * It sits behind the page (z-index -1) across the full width, so it shows through every gap and
 * translucent section and can never sit on top of a card, photo or copy. It
 * is started only once the arrival has finished and the browser is idle, runs outside Angular's
 * change detection, pauses in a hidden tab, and fades out and stops on staff screens.
 */
@Component({
  selector: 'app-ambient-scene',
  template: `
    <canvas #aurora class="aurora" aria-hidden="true" [class.on]="visible()"></canvas>
    <canvas #canvas aria-hidden="true" [class.on]="visible()"></canvas>
  `,
  styles: `
    :host {
      display: contents;
    }
    canvas {
      position: fixed;
      inset: 0;
      width: 100vw;
      height: 100lvh;
      z-index: -1;
      pointer-events: none;
      opacity: 0;
      transition: opacity 1.6s cubic-bezier(0.16, 1, 0.3, 1);
    }
    canvas.on {
      opacity: 1;
    }
    /* Drawn at an eighth of the screen's size and stretched; the browser's smoothing turns it
       back into a soft full-screen glow. */
    canvas.aurora {
      z-index: -2;
    }
    /* Always behind the page, on every screen. A version drawn over the page on phones was
       rejected by the owner (2026-09-23): the scene belongs in the background, never on top of
       cards, photos or copy. */
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AmbientScene {
  private readonly zone = inject(NgZone);
  private readonly router = inject(Router);
  private readonly welcome = inject(WelcomeService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly auroraRef = viewChild.required<ElementRef<HTMLCanvasElement>>('aurora');

  protected readonly visible = signal(false);

  private renderer: SceneRenderer | null = null;
  private profile: SceneProfile | null = null;
  private frameId = 0;
  private running = false;
  private onStaffScreen = false;
  private lastFrame = 0;
  private startedAt = 0;
  private sizedWidth = 0;
  private sizedHeight = 0;
  private readonly cleanups: (() => void)[] = [];

  constructor() {
    const ready = signal(false);
    afterNextRender(() => {
      this.profile = sceneProfile();
      ready.set(!!this.profile);
    });

    // Wait for the arrival to finish, then for an idle moment, so the scene never competes with
    // the first paint of the page itself.
    let requested = false;
    effect(() => {
      if (requested || !ready() || !this.welcome.introDone()) return;
      requested = true;
      untracked(() => this.whenIdle(() => this.start()));
    });

    this.destroyRef.onDestroy(() => this.teardown());
  }

  private whenIdle(run: () => void): void {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: object) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(run, { timeout: 2500 });
    else setTimeout(run, 600);
  }

  private start(): void {
    if (this.renderer || !this.profile) return;
    const canvas = this.canvasRef().nativeElement;
    const renderer = SceneRenderer.create(this.auroraRef().nativeElement, canvas, this.profile);
    if (!renderer) return;
    this.renderer = renderer;

    this.zone.runOutsideAngular(() => {
      this.resize(true);
      this.onRoute(this.router.url);
      this.readScroll();

      this.listen(window, 'resize', () => this.resize(false));
      this.listen(window, 'scroll', () => this.readScroll(), { passive: true });
      this.listen(document, 'visibilitychange', () => this.syncRunning());
      this.listen(canvas, 'webglcontextlost', (event) => {
        event.preventDefault();
        this.teardown();
      });
      if (window.matchMedia('(pointer: fine)').matches) {
        this.listen(
          window,
          'pointermove',
          (event) => {
            const e = event as PointerEvent;
            renderer.pointerX = e.clientX / window.innerWidth;
            renderer.pointerY = 1 - e.clientY / window.innerHeight;
          },
          { passive: true },
        );
      }
    });

    const routes = this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => this.zone.runOutsideAngular(() => this.onRoute(e.urlAfterRedirects)));
    this.cleanups.push(() => routes.unsubscribe());

    this.startedAt = performance.now();
    this.syncRunning();
  }

  private listen(
    target: EventTarget,
    type: string,
    handler: (event: Event) => void,
    options?: AddEventListenerOptions,
  ): void {
    target.addEventListener(type, handler, options);
    this.cleanups.push(() => target.removeEventListener(type, handler, options));
  }

  private onRoute(url: string): void {
    const renderer = this.renderer;
    if (!renderer) return;
    const path = url.split(/[?#]/)[0] || '/';
    this.onStaffScreen = STAFF_PREFIXES.some((prefix) => path.startsWith(prefix));
    // A new page arranges the light its own way; the easing in the renderer makes that a slow
    // shift of colour rather than a cut.
    renderer.mood = moodForPath(path);
    this.readScroll();
    this.zone.run(() => this.visible.set(!this.onStaffScreen));
    this.syncRunning();
  }

  /** Scroll slides the aurora's light through the page and carries the motes at their three
   * depths - the near ones further than the far ones. */
  private readScroll(): void {
    const renderer = this.renderer;
    if (!renderer) return;
    const root = document.documentElement;
    const max = root.scrollHeight - root.clientHeight;
    renderer.scrollPx = window.scrollY;
    renderer.scrollProgress = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    if (this.profile?.still) this.drawOnce();
  }

  /**
   * Only redraws the buffer when the width changes or the height moves by more than a phone's
   * collapsing address bar - otherwise scrolling on a phone would resize the canvas every time the
   * bar slid in or out.
   */
  private resize(force: boolean): void {
    const renderer = this.renderer;
    if (!renderer) return;
    const w = window.innerWidth;
    const h = Math.max(window.innerHeight, document.documentElement.clientHeight);
    if (!force && w === this.sizedWidth && Math.abs(h - this.sizedHeight) < 140) return;
    this.sizedWidth = w;
    this.sizedHeight = h;
    renderer.resize(w, h);
    if (this.profile?.still) this.drawOnce();
  }

  private syncRunning(): void {
    const shouldRun =
      !!this.renderer && !document.hidden && !this.onStaffScreen && !this.profile?.still;
    if (shouldRun && !this.running) {
      this.running = true;
      this.lastFrame = performance.now();
      this.frameId = requestAnimationFrame((t) => this.tick(t));
    } else if (!shouldRun && this.running) {
      this.running = false;
      cancelAnimationFrame(this.frameId);
    }
    if (this.profile?.still && !this.onStaffScreen) this.drawOnce();
  }

  private tick(now: number): void {
    if (!this.running || !this.renderer) return;
    this.frameId = requestAnimationFrame((t) => this.tick(t));

    const minGap = 1000 / (this.profile?.fps ?? 60) - 2;
    const elapsed = now - this.lastFrame;
    if (elapsed < minGap) return;
    this.lastFrame = now;

    // A long gap (a stalled tab, a debugger) must not fling everything at once.
    const dt = Math.min(0.1, elapsed / 1000);
    this.renderer.frame((now - this.startedAt) / 1000, dt);
  }

  private drawOnce(): void {
    this.renderer?.frame(0, 1);
  }

  private teardown(): void {
    this.running = false;
    cancelAnimationFrame(this.frameId);
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.renderer?.dispose();
    this.renderer = null;
    this.visible.set(false);
  }
}
