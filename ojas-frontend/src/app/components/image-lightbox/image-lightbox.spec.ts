import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ImageLightbox } from './image-lightbox';

/**
 * The gesture logic, exercised through real pointer events rather than by calling methods.
 * Swiping and panning are the same physical action distinguished only by whether the image is
 * zoomed, so they have to be tested the way a finger actually delivers them.
 */
describe('ImageLightbox', () => {
  const images = ['/a.webp', '/b.webp', '/c.webp'];
  let fixture: ComponentFixture<ImageLightbox>;

  /** The stage is what every gesture is measured against, and jsdom-style layout gives it no
   * size, so its box is pinned here. 400px wide makes the swipe threshold a round 72px. */
  const STAGE_WIDTH = 400;
  const STAGE_HEIGHT = 600;

  function stage(): HTMLElement {
    return fixture.nativeElement.querySelector('.lb-stage');
  }

  function pinStageBox(): void {
    const element = stage();
    Object.defineProperty(element, 'clientWidth', { value: STAGE_WIDTH, configurable: true });
    Object.defineProperty(element, 'clientHeight', { value: STAGE_HEIGHT, configurable: true });
    element.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: STAGE_WIDTH,
        height: STAGE_HEIGHT,
        right: STAGE_WIDTH,
        bottom: STAGE_HEIGHT,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
  }

  function pointer(type: string, x: number, y = 300, pointerId = 1): void {
    stage().dispatchEvent(
      new PointerEvent(type, { pointerId, clientX: x, clientY: y, bubbles: true }),
    );
    fixture.detectChanges();
  }

  /** One finger, down at `from`, across to `to`, released. */
  function swipe(from: number, to: number): void {
    pointer('pointerdown', from);
    pointer('pointermove', to);
    pointer('pointerup', to);
  }

  function currentIndex(): number {
    return Number(fixture.nativeElement.querySelector('.lb-counter').textContent.split('/')[0]);
  }

  function transformOfTrack(): string {
    return (fixture.nativeElement.querySelector('.lb-track') as HTMLElement).style.transform;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ImageLightbox] });
    fixture = TestBed.createComponent(ImageLightbox);
    fixture.componentRef.setInput('images', images);
    fixture.componentRef.setInput('startIndex', 0);
    fixture.componentRef.setInput('productName', 'Vanilla Custard Powder');
    fixture.detectChanges();
    pinStageBox();
  });

  afterEach(() => fixture.destroy());

  it('opens on the photo that was tapped', () => {
    const other = TestBed.createComponent(ImageLightbox);
    other.componentRef.setInput('images', images);
    other.componentRef.setInput('startIndex', 2);
    other.detectChanges();

    expect(other.nativeElement.querySelector('.lb-counter').textContent.trim()).toBe('3 / 3');
    other.destroy();
  });

  describe('swiping between photos', () => {
    it('a decisive swipe left moves to the next photo', () => {
      swipe(300, 150); // 150px of a 400px stage, well past the 18% threshold

      expect(currentIndex()).toBe(2);
    });

    it('a decisive swipe right moves back', () => {
      swipe(300, 150);
      swipe(100, 300);

      expect(currentIndex()).toBe(1);
    });

    it('a hesitant drag springs back rather than turning the page', () => {
      // 40px is under the 72px threshold. A half-hearted drag must not change what the customer
      // is looking at - that is the difference between a viewer that feels solid and one that
      // flicks around under their thumb.
      swipe(300, 260);

      expect(currentIndex()).toBe(1);
      expect(transformOfTrack()).toContain('0%');
    });

    it('follows the finger while the drag is in flight', () => {
      pointer('pointerdown', 300);
      pointer('pointermove', 220);

      expect(transformOfTrack()).toContain('80px');
      expect(transformOfTrack()).toMatch(/-\s*80px|\+\s*-80px/);
    });

    it('will not run off either end', () => {
      swipe(100, 300); // already on the first
      expect(currentIndex()).toBe(1);

      swipe(300, 100);
      swipe(300, 100);
      swipe(300, 100); // one more than there are photos
      expect(currentIndex()).toBe(3);
    });

    it('reports the photo it lands on, so the page underneath can follow', () => {
      const seen: number[] = [];
      fixture.componentInstance.indexChanged.subscribe((i) => seen.push(i));

      swipe(300, 150);

      expect(seen).toEqual([1]);
    });
  });

  describe('zooming', () => {
    function doubleTap(x: number, y = 300): void {
      pointer('pointerdown', x, y);
      pointer('pointerup', x, y);
      pointer('pointerdown', x, y);
      pointer('pointerup', x, y);
    }

    /** Only the photo on screen carries a transform; the others are left alone so the browser
     * has nothing to composite for them. */
    function imageTransform(): string {
      const images = fixture.nativeElement.querySelectorAll('.lb-slide img');
      return (images[currentIndex() - 1] as HTMLElement).style.transform;
    }

    it('a double-tap zooms in, and a second one fits the photo again', () => {
      doubleTap(200);
      expect(imageTransform()).toContain('scale(2.5)');

      doubleTap(200);
      expect(imageTransform()).toContain('scale(1)');
    });

    it('zooms towards the point that was tapped, not the middle', () => {
      // Tapping the left edge has to bring the left edge closer, which means shifting the image
      // right. Always zooming to the centre is what makes a viewer feel like it fights you.
      doubleTap(40);

      const x = Number(/translate3d\((-?[\d.]+)px/.exec(imageTransform())![1]);
      expect(x).toBeGreaterThan(0);
    });

    it('drags pan the photo instead of turning the page once zoomed', () => {
      doubleTap(200);
      const before = currentIndex();

      // The very same gesture that paged a moment ago.
      swipe(300, 150);

      expect(currentIndex()).toBe(before);
      expect(imageTransform()).toContain('scale(2.5)');
    });

    it('never pans past the edge of the photo', () => {
      doubleTap(200);
      // Shove it far further than its own overhang.
      pointer('pointerdown', 300);
      pointer('pointermove', 4000);
      pointer('pointerup', 4000);

      // At 2.5x on a 400px stage the overhang each side is 300px, and no more.
      const x = Number(/translate3d\((-?[\d.]+)px/.exec(imageTransform())![1]);
      expect(x).toBeLessThanOrEqual(300.001);
    });

    it('a pinch scales the photo', () => {
      pointer('pointerdown', 180, 300, 1);
      pointer('pointerdown', 220, 300, 2); // fingers 40px apart
      stage().dispatchEvent(
        new PointerEvent('pointermove', { pointerId: 2, clientX: 300, clientY: 300, bubbles: true }),
      );
      fixture.detectChanges();

      // Spread to 120px apart: three times the starting distance.
      expect(imageTransform()).toContain('scale(3)');
    });

    it('fits the photo again when the next one is opened', () => {
      doubleTap(200);
      fixture.nativeElement.querySelectorAll('.lb-thumb')[2].click();
      fixture.detectChanges();

      expect(imageTransform()).toContain('scale(1)');
    });
  });

  describe('getting out', () => {
    it('closes on Escape', () => {
      let closed = false;
      fixture.componentInstance.closed.subscribe(() => (closed = true));

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

      expect(closed).toBeTrue();
    });

    it('moves with the arrow keys', () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
      fixture.detectChanges();
      expect(currentIndex()).toBe(2);

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
      fixture.detectChanges();
      expect(currentIndex()).toBe(1);
    });

    it('locks the page behind it, and lets go on the way out', () => {
      expect(document.body.style.overflow).toBe('hidden');

      fixture.destroy();

      expect(document.body.style.overflow).toBe('');
    });
  });
});
