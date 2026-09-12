import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import {
  Placement,
  continueEdges,
  covers,
  fillPlacement,
  fitPlacement,
  placementBetween,
} from '../../utils/image-framing';

/**
 * The shape and largest size every poster and campaign picture is stored at. 2:1 is the shape of
 * both slots on the home page; 2000px wide is the banner preset's width (MediaUploadService).
 */
export const BANNER_FRAME = { width: 2000, height: 1000 } as const;

/** Never stored smaller than this, whatever was uploaded: below it the hero looks soft on a laptop. */
const MIN_OUTPUT_WIDTH = 960;

/** The on-screen preview is drawn at this size and scaled by CSS. */
const PREVIEW = { width: 960, height: 480 } as const;

/**
 * On a laptop the hero lays its buttons, trust line and dots over the bottom ~19-22% of the poster.
 * Shown whole, a poster is fitted above a quarter, so none of its own words end up under a button.
 * Must match CONTENT_BOTTOM in tools/build-hero-posters.mjs.
 */
const HERO_BUTTON_BAND = 0.25;

/** How far one press of an arrow key moves the picture, in frame pixels. */
const NUDGE = 24;

const QUALITY = 0.88;

export type BannerSlot = 'hero' | 'campaign';

/**
 * Fits an admin's picture to the storefront's 2:1 banner shape before it is uploaded, and lets them
 * see and choose how.
 *
 * Every picture on the home page fills its frame edge to edge with our buttons laid over it, so
 * whatever shape was uploaded has to become 2:1 first. There are two ways, and which is right
 * depends on the picture, so the admin chooses: "Show whole picture" keeps all of it and continues
 * its own edges to fill the frame (see utils/image-framing), "Fill the banner" crops it. The size
 * slider runs between the two, and the picture can be dragged, or moved with the arrow keys, to
 * choose what stays. Where our buttons will sit is drawn over the preview, so nothing important
 * ends up under them. A picture that is already 2:1 simply fills the frame.
 *
 * What it emits is the finished image - 2:1, WebP - ready to upload as it is.
 */
@Component({
  selector: 'app-image-framer',
  imports: [MatButtonModule, MatIconModule],
  templateUrl: './image-framer.html',
  styleUrl: './image-framer.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImageFramer {
  /** The picture as the admin picked it. */
  readonly file = input.required<File>();

  /** Which slot it is for, and so which of our buttons to draw over the preview. */
  readonly slot = input<BannerSlot>('hero');

  /** The finished 2:1 image. */
  readonly framed = output<Blob>();
  readonly cancelled = output<void>();

  private readonly preview = viewChild<ElementRef<HTMLCanvasElement>>('preview');
  private readonly stage = viewChild<ElementRef<HTMLElement>>('stage');

  private readonly source = signal<ImageBitmap | HTMLImageElement | null>(null);
  readonly failed = signal(false);
  readonly busy = signal(false);

  /** 0 shows the whole picture, 100 fills the frame. */
  readonly size = signal(0);

  /** The admin's own move, in frame pixels, from where the picture would otherwise sit. */
  private readonly shift = signal({ x: 0, y: 0 });

  readonly ready = computed(() => !!this.source());

  /** Already 2:1 (within 2%), so it can fill the frame with nothing added and nothing cut. */
  readonly alreadyFits = computed(() => {
    const s = this.source();
    return !!s && Math.abs(s.width / s.height - 2) < 0.04;
  });

  readonly placement = computed(() => this.placeIn(BANNER_FRAME.width, BANNER_FRAME.height));

  /** Part of the picture falls outside the frame and will be cut off. */
  readonly crops = computed(() => {
    const p = this.placement();
    if (!p) return false;
    const W = BANNER_FRAME.width;
    const H = BANNER_FRAME.height;
    return p.x < -1 || p.y < -1 || p.x + p.width > W + 1 || p.y + p.height > H + 1;
  });

  /** Part of the frame is not covered by the picture and will be continued from its edges. */
  readonly extends = computed(() => {
    const p = this.placement();
    return !!p && !covers(p, BANNER_FRAME.width, BANNER_FRAME.height);
  });

  private drag: { x: number; y: number; id: number } | null = null;

  constructor() {
    effect((onCleanup) => {
      const file = this.file();
      let stale = false;
      this.source.set(null);
      this.failed.set(false);
      this.shift.set({ x: 0, y: 0 });

      decode(file).then(
        (image) => {
          if (stale) {
            if ('close' in image) image.close();
            return;
          }
          this.source.set(image);
          // A picture made at the right shape fills the frame; anything else starts whole.
          this.size.set(Math.abs(image.width / image.height - 2) < 0.04 ? 100 : 0);
        },
        () => {
          if (!stale) this.failed.set(true);
        },
      );
      onCleanup(() => (stale = true));
    });

    effect(() => {
      const canvas = this.preview()?.nativeElement;
      const src = this.source();
      // Read so the preview redraws when either changes.
      this.size();
      this.shift();
      if (!canvas || !src) return;
      this.render(canvas, PREVIEW.width, PREVIEW.height, src);
    });

    inject(DestroyRef).onDestroy(() => {
      const s = this.source();
      if (s && 'close' in s) s.close();
    });
  }

  setSize(value: number): void {
    this.size.set(Math.min(100, Math.max(0, Math.round(value))));
    this.settleShift();
  }

  onSizeInput(event: Event): void {
    this.setSize(Number((event.target as HTMLInputElement).value));
  }

  onPointerDown(event: PointerEvent): void {
    if (!this.ready()) return;
    this.drag = { x: event.clientX, y: event.clientY, id: event.pointerId };
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  }

  onPointerMove(event: PointerEvent): void {
    const drag = this.drag;
    const stage = this.stage()?.nativeElement;
    if (!drag || drag.id !== event.pointerId || !stage) return;
    const k = BANNER_FRAME.width / Math.max(1, stage.clientWidth);
    this.moveBy((event.clientX - drag.x) * k, (event.clientY - drag.y) * k);
    this.drag = { ...drag, x: event.clientX, y: event.clientY };
  }

  onPointerUp(): void {
    this.drag = null;
  }

  onKeydown(event: KeyboardEvent): void {
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-NUDGE, 0],
      ArrowRight: [NUDGE, 0],
      ArrowUp: [0, -NUDGE],
      ArrowDown: [0, NUDGE],
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    this.moveBy(move[0], move[1]);
  }

  /** Renders the finished image at full size and hands it on. */
  async use(): Promise<void> {
    const src = this.source();
    const p = this.placement();
    if (!src || !p || this.busy()) return;
    this.busy.set(true);
    try {
      // Never store more pixels than the picture actually has at this size: enlarging invents no
      // detail and only costs bytes.
      const native = (BANNER_FRAME.width * src.width) / p.width;
      const width = Math.round(Math.min(BANNER_FRAME.width, Math.max(MIN_OUTPUT_WIDTH, native)));
      const canvas = document.createElement('canvas');
      this.render(canvas, width, width / 2, src);
      const blob = await encode(canvas);
      if (blob) this.framed.emit(blob);
      else this.failed.set(true);
    } finally {
      this.busy.set(false);
    }
  }

  // ----- Drawing -----

  /** Where the picture sits in a frame of this size, from the slider and the admin's move. */
  private placeIn(width: number, height: number, shift = this.shift()): Placement | null {
    const src = this.source();
    if (!src) return null;
    const reserve = this.slot() === 'hero' ? HERO_BUTTON_BAND : 0;
    const fit = fitPlacement(src.width, src.height, width, height, reserve);
    const fill = fillPlacement(src.width, src.height, width, height);
    const k = width / BANNER_FRAME.width;
    return placementBetween(fit, fill, this.size() / 100, { x: shift.x * k, y: shift.y * k }, width, height);
  }

  private render(canvas: HTMLCanvasElement, width: number, height: number, src: CanvasImageSource): void {
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const p = this.placeIn(width, height);
    if (!ctx || !p) return;

    ctx.clearRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, p.x, p.y, p.width, p.height);

    if (!covers(p, width, height)) {
      const image = ctx.getImageData(0, 0, width, height);
      continueEdges(image.data, width, height, p);
      ctx.putImageData(image, 0, 0);
    }
  }

  private moveBy(dx: number, dy: number): void {
    this.shift.update((s) => ({ x: s.x + dx, y: s.y + dy }));
    this.settleShift();
  }

  /**
   * Forgets any part of a move that the frame's edges stopped, so dragging back the other way
   * responds at once instead of first unwinding a distance that never showed.
   */
  private settleShift(): void {
    const W = BANNER_FRAME.width;
    const H = BANNER_FRAME.height;
    const moved = this.placeIn(W, H);
    const home = this.placeIn(W, H, { x: 0, y: 0 });
    if (!moved || !home) return;
    this.shift.set({
      x: moved.x + moved.width / 2 - (home.x + home.width / 2),
      y: moved.y + moved.height / 2 - (home.y + home.height / 2),
    });
  }
}

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      // Fall through to the element-based decode, which older Safari needs.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('That file could not be read as an image.'));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** WebP where the browser's canvas can write it, JPEG where it cannot. */
function encode(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (webp) => (webp ? resolve(webp) : canvas.toBlob(resolve, 'image/jpeg', QUALITY)),
      'image/webp',
      QUALITY,
    );
  });
}
