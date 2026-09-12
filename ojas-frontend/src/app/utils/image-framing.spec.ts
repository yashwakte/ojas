import { continueEdges, covers, fillPlacement, fitPlacement, placementBetween } from './image-framing';

/** An RGBA frame, painted `rgb` wherever `inside(x, y)` holds and left transparent elsewhere. */
function frame(width: number, height: number, inside: (x: number, y: number) => boolean, rgb: [number, number, number]) {
  const px = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!inside(x, y)) continue;
      const o = (y * width + x) * 4;
      px.set([...rgb, 255], o);
    }
  }
  return px;
}

const at = (px: Uint8ClampedArray, width: number, x: number, y: number) => Array.from(px.slice((y * width + x) * 4, (y * width + x) * 4 + 4));
const noGrain = () => 0.5;

describe('image framing', () => {
  describe('placement', () => {
    it('fits a whole poster above the band the buttons sit in', () => {
      // The upwas poster: 1600x1066, into the 2400x1200 frame with its foot fifth kept clear.
      const p = fitPlacement(1600, 1066, 2400, 1200, 0.2);
      expect(p.height).toBeCloseTo(960);
      expect(p.y).toBeCloseTo(0);
      expect(p.x + p.width / 2).toBeCloseTo(1200);
    });

    it('fills the frame by covering it, centred', () => {
      const p = fillPlacement(1600, 1066, 2400, 1200);
      expect(p.width).toBeCloseTo(2400);
      expect(p.y).toBeLessThan(0);
      expect(covers(p, 2400, 1200)).toBeTrue();
    });

    it('lands a picture that is already 2:1 exactly on the frame', () => {
      const p = fillPlacement(1774, 887, 2000, 1000);
      expect(p.x).toBeCloseTo(0);
      expect(p.y).toBeCloseTo(0);
      expect(p.width).toBeCloseTo(2000);
    });

    it('never lets a drag pull a filling picture off an edge', () => {
      const fit = fitPlacement(1600, 1066, 2400, 1200);
      const fill = fillPlacement(1600, 1066, 2400, 1200);
      const p = placementBetween(fit, fill, 1, { x: 0, y: 5000 }, 2400, 1200);
      expect(p.y).toBe(0);
      expect(covers(p, 2400, 1200)).toBeTrue();
    });

    it('keeps a picture narrower than the frame inside it', () => {
      const fit = fitPlacement(1600, 1066, 2400, 1200);
      const fill = fillPlacement(1600, 1066, 2400, 1200);
      const p = placementBetween(fit, fill, 0, { x: -5000, y: 0 }, 2400, 1200);
      expect(p.x).toBe(0);
    });
  });

  describe('continuing the edges', () => {
    it("carries a picture's own colour into the margins either side of it", () => {
      const W = 40;
      const H = 20;
      const warm: [number, number, number] = [200, 150, 100];
      const px = frame(W, H, (x) => x >= 10 && x < 30, warm);

      continueEdges(px, W, H, { x: 10, y: 0, width: 20, height: 20 }, noGrain);

      for (const x of [0, 5, 35, 39]) {
        const [r, g, b, a] = at(px, W, x, 10);
        expect(a).toBe(255);
        // A plain wall carries on as the same wall, give or take the faint vignette.
        expect(Math.abs(r - 200)).toBeLessThan(14);
        expect(Math.abs(g - 150)).toBeLessThan(11);
        expect(Math.abs(b - 100)).toBeLessThan(8);
      }
    });

    it('carries the foot of a picture down into the band below it', () => {
      const W = 30;
      const H = 30;
      const px = frame(W, H, (_, y) => y < 20, [90, 60, 40]);

      continueEdges(px, W, H, { x: 0, y: 0, width: 30, height: 20 }, noGrain);

      const [r, , , a] = at(px, W, 15, 28);
      expect(a).toBe(255);
      // Darker towards the front, as a table is, but still the same wood.
      expect(r).toBeLessThanOrEqual(90);
      expect(r).toBeGreaterThan(70);
    });

    it('leaves a picture that already covers the frame exactly as it was', () => {
      const W = 20;
      const H = 10;
      const px = frame(W, H, () => true, [10, 20, 30]);
      const before = px.slice();

      continueEdges(px, W, H, { x: 0, y: 0, width: 20, height: 10 }, noGrain);

      expect(Array.from(px)).toEqual(Array.from(before));
    });
  });
});
