import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

/** How far a swipe must travel, as a fraction of the stage, before it turns the page. Below this
 * the image springs back — a hesitant drag should not change what the customer is looking at. */
const PAGE_THRESHOLD = 0.18;

/** What a double-tap zooms to. Enough to read the small print on a pack, not so much that the
 * customer loses their place on it. */
const DOUBLE_TAP_SCALE = 2.5;
const MAX_SCALE = 4;
const MIN_SCALE = 1;

/** Two taps closer together than this, and near enough to each other, count as a double-tap. */
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP_PX = 24;

interface Point {
  x: number;
  y: number;
}

/**
 * The full-screen product viewer, in the shape customers already know from Flipkart and Myntra:
 * tap a photo, it fills the screen on black, swipe sideways for the next one, pinch or double-tap
 * to get close enough to read the pack.
 *
 * Everything is driven by pointer events rather than by scrolling, because the two gestures
 * overlap: once an image is zoomed in a horizontal drag has to pan it rather than turn the page,
 * and no amount of scroll-snap can tell those apart. The track is transformed directly instead.
 */
@Component({
  selector: 'app-image-lightbox',
  imports: [MatIconModule],
  templateUrl: './image-lightbox.html',
  styleUrl: './image-lightbox.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown)': 'onKey($event)',
  },
})
export class ImageLightbox implements OnDestroy {
  readonly images = input.required<string[]>();
  readonly startIndex = input<number>(0);
  readonly productName = input<string>('');

  readonly closed = output<void>();
  /** So the page underneath can follow along — closing the viewer on image 3 should leave the
   * inline gallery showing image 3, not snap back to where it was opened from. */
  readonly indexChanged = output<number>();

  private readonly stage = viewChild.required<ElementRef<HTMLElement>>('stage');

  protected readonly index = signal(0);
  protected readonly scale = signal(MIN_SCALE);
  protected readonly offset = signal<Point>({ x: 0, y: 0 });
  /** Live finger travel during a swipe, in pixels. Kept apart from `offset`, which is the pan of
   * a zoomed image — mixing the two dragged the picture out of its own frame. */
  protected readonly drag = signal(0);
  protected readonly animating = signal(true);

  protected readonly zoomed = computed(() => this.scale() > MIN_SCALE);

  constructor() {
    effect(() => {
      // Opens at the image that was tapped, and never mid-zoom.
      this.index.set(Math.max(0, Math.min(this.startIndex(), this.images().length - 1)));
      this.resetZoom();
    });

    // A full-screen viewer that lets the page scroll behind it feels broken the moment a pinch
    // spills over into the document.
    document.body.style.overflow = 'hidden';
  }

  ngOnDestroy(): void {
    document.body.style.overflow = '';
  }

  // ===== pointer bookkeeping =====
  private readonly pointers = new Map<number, Point>();
  private startPointer: Point | null = null;
  private startOffset: Point = { x: 0, y: 0 };
  private pinchStartDistance = 0;
  private pinchStartScale = MIN_SCALE;
  private lastTapAt = 0;
  private lastTapPoint: Point | null = null;

  protected onPointerDown(event: PointerEvent): void {
    // Capture keeps a fast swipe that leaves the image mid-gesture reporting to us rather than
    // being dropped. It throws for a pointer the browser doesn't consider active, which is not
    // worth failing the gesture over.
    try {
      (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    } catch {
      /* no capture available; the gesture still works, it just ends if the finger leaves */
    }
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.animating.set(false);

    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinchStartDistance = Math.hypot(a.x - b.x, a.y - b.y);
      this.pinchStartScale = this.scale();
      this.startPointer = null;
      return;
    }

    this.startPointer = { x: event.clientX, y: event.clientY };
    this.startOffset = this.offset();
  }

  protected onPointerMove(event: PointerEvent): void {
    if (!this.pointers.has(event.pointerId)) return;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinchStartDistance > 0) {
        this.setScale((distance / this.pinchStartDistance) * this.pinchStartScale);
      }
      return;
    }

    if (!this.startPointer) return;
    const dx = event.clientX - this.startPointer.x;
    const dy = event.clientY - this.startPointer.y;

    if (this.zoomed()) {
      // Panning the picture, not turning the page.
      this.offset.set(this.clampOffset({ x: this.startOffset.x + dx, y: this.startOffset.y + dy }));
      return;
    }

    this.drag.set(dx);
  }

  protected onPointerUp(event: PointerEvent): void {
    this.pointers.delete(event.pointerId);
    this.animating.set(true);

    if (this.pointers.size > 0) {
      // Came off a pinch with a finger still down; re-anchor so nothing jumps.
      this.startPointer = null;
      return;
    }

    // Did the finger actually go anywhere? A pan and a tap are the same two events apart from
    // this, and the answer decides whether a zoomed image is being dragged or double-tapped.
    // A pointer with no start recorded came off a pinch, which is never a tap.
    const wasATap =
      this.startPointer !== null &&
      Math.hypot(event.clientX - this.startPointer.x, event.clientY - this.startPointer.y) <
        DOUBLE_TAP_SLOP_PX;
    this.startPointer = null;

    if (this.zoomed()) {
      this.pinchStartDistance = 0;
      this.offset.set(this.clampOffset(this.offset()));
      // Returning here unconditionally is what made a zoom a one-way door: every tap was read as
      // the end of a pan, so the double-tap that fits the photo back into the frame - the one the
      // hint text promises - could never be recognised once the customer had zoomed in.
      if (wasATap) this.detectDoubleTap(event);
      return;
    }

    const travelled = this.drag();
    const width = this.stage().nativeElement.clientWidth || 1;
    this.drag.set(0);

    if (Math.abs(travelled) > width * PAGE_THRESHOLD) {
      if (travelled < 0) this.next();
      else this.previous();
      return;
    }

    this.detectDoubleTap(event);
  }

  /** Recognised by hand rather than with `dblclick`, which never fires for touch. */
  private detectDoubleTap(event: PointerEvent): void {
    const now = Date.now();
    const point = { x: event.clientX, y: event.clientY };
    const near =
      this.lastTapPoint !== null &&
      Math.hypot(point.x - this.lastTapPoint.x, point.y - this.lastTapPoint.y) < DOUBLE_TAP_SLOP_PX;

    if (now - this.lastTapAt < DOUBLE_TAP_MS && near) {
      this.lastTapAt = 0;
      this.lastTapPoint = null;
      this.toggleZoomAt(point);
      return;
    }

    this.lastTapAt = now;
    this.lastTapPoint = point;
  }

  protected onWheel(event: WheelEvent): void {
    event.preventDefault();
    this.animating.set(false);
    this.setScale(this.scale() * (event.deltaY < 0 ? 1.12 : 1 / 1.12));
  }

  protected toggleZoom(): void {
    const rect = this.stage().nativeElement.getBoundingClientRect();
    this.toggleZoomAt({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  }

  /** Zooms towards the point that was tapped, so the detail under the finger stays under it —
   * always zooming to the centre is what makes a viewer feel like it is fighting you. */
  private toggleZoomAt(point: Point): void {
    this.animating.set(true);
    if (this.zoomed()) {
      this.resetZoom();
      return;
    }

    const rect = this.stage().nativeElement.getBoundingClientRect();
    const fromCentreX = point.x - (rect.left + rect.width / 2);
    const fromCentreY = point.y - (rect.top + rect.height / 2);
    this.scale.set(DOUBLE_TAP_SCALE);
    this.offset.set(
      this.clampOffset({
        x: -fromCentreX * (DOUBLE_TAP_SCALE - 1),
        y: -fromCentreY * (DOUBLE_TAP_SCALE - 1),
      }),
    );
  }

  private setScale(next: number): void {
    const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
    this.scale.set(clamped);
    if (clamped === MIN_SCALE) this.offset.set({ x: 0, y: 0 });
    else this.offset.set(this.clampOffset(this.offset()));
  }

  /** Keeps the picture covering the stage: a zoomed image can be pushed no further than its own
   * overhang, so there is never a band of empty black beside it. */
  private clampOffset(point: Point): Point {
    const rect = this.stage().nativeElement.getBoundingClientRect();
    const overhangX = Math.max(0, (rect.width * this.scale() - rect.width) / 2);
    const overhangY = Math.max(0, (rect.height * this.scale() - rect.height) / 2);
    return {
      x: Math.min(overhangX, Math.max(-overhangX, point.x)),
      y: Math.min(overhangY, Math.max(-overhangY, point.y)),
    };
  }

  private resetZoom(): void {
    this.scale.set(MIN_SCALE);
    this.offset.set({ x: 0, y: 0 });
    this.pinchStartDistance = 0;
  }

  protected go(index: number): void {
    const count = this.images().length;
    if (index < 0 || index >= count || index === this.index()) return;
    this.animating.set(true);
    this.index.set(index);
    this.resetZoom();
    this.indexChanged.emit(index);
  }

  protected next(): void {
    this.go(this.index() + 1);
  }

  protected previous(): void {
    this.go(this.index() - 1);
  }

  protected close(): void {
    this.closed.emit();
  }

  /** The track's transform: whole pages, plus whatever the finger is currently dragging. */
  protected readonly trackTransform = computed(
    () => `translate3d(calc(${-this.index() * 100}% + ${this.drag()}px), 0, 0)`,
  );

  protected readonly imageTransform = computed(() => {
    const { x, y } = this.offset();
    return `translate3d(${x}px, ${y}px, 0) scale(${this.scale()})`;
  });

  /** Bound through the `host` object rather than @HostListener, per this project's conventions. */
  onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') this.close();
    if (event.key === 'ArrowRight') this.next();
    if (event.key === 'ArrowLeft') this.previous();
  }
}
