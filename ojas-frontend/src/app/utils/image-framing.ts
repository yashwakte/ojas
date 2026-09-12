/**
 * Reshaping an admin's picture to one of the storefront's banner frames (2:1), in the browser,
 * before it is uploaded.
 *
 * The storefront shows every poster and campaign picture filling its frame edge to edge. A picture
 * of some other shape therefore has to become that shape first, and there are only two honest ways
 * to do it: cut some of it off (fill), or add to it (show it whole). Adding is what these posters
 * usually need - their headlines and taglines are printed right up to the edges - so the part of
 * the frame the picture does not cover is continued from the picture's own edges: the table
 * carried on downwards, the wall and table carried on sideways, meeting at the same table line,
 * with the picture eased into it over a short distance and a little grain so the invented surface
 * does not read as plastic. tools/build-hero-posters.mjs does the same for the posters that ship
 * with the site; keep the two in step.
 *
 * Everything here is plain arithmetic on an RGBA pixel buffer, so it is testable without a canvas.
 */

/** Where the picture is drawn in the frame, in frame pixels. Negative or oversized means cropped. */
export interface Placement {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The picture whole: as large as fits, centred - and, if a band at the foot of the frame is
 * reserved for buttons laid over it, fitted into the part above that band instead.
 */
export function fitPlacement(
  srcWidth: number,
  srcHeight: number,
  frameWidth: number,
  frameHeight: number,
  reserveBottom = 0,
): Placement {
  const boxHeight = frameHeight * (1 - reserveBottom);
  const scale = Math.min(frameWidth / srcWidth, boxHeight / srcHeight);
  const width = srcWidth * scale;
  const height = srcHeight * scale;
  return { x: (frameWidth - width) / 2, y: (boxHeight - height) / 2, width, height };
}

/** The picture filling the frame: as small as still covers it, centred. */
export function fillPlacement(srcWidth: number, srcHeight: number, frameWidth: number, frameHeight: number): Placement {
  const scale = Math.max(frameWidth / srcWidth, frameHeight / srcHeight);
  const width = srcWidth * scale;
  const height = srcHeight * scale;
  return { x: (frameWidth - width) / 2, y: (frameHeight - height) / 2, width, height };
}

/**
 * Anywhere between the two - `t` 0 is the whole picture, 1 fills the frame - moved by `shift`, and
 * held so that it never uncovers an edge it has no need to: a picture taller than the frame can be
 * slid up and down but not off the top, one narrower than it can be slid about inside it.
 */
export function placementBetween(
  fit: Placement,
  fill: Placement,
  t: number,
  shift: { x: number; y: number },
  frameWidth: number,
  frameHeight: number,
): Placement {
  const k = Math.min(1, Math.max(0, t));
  // Geometric rather than linear, so each step of the size slider looks like the same step.
  const scale = Math.pow(fill.width / fit.width, k);
  const width = fit.width * scale;
  const height = fit.height * scale;
  const cx = lerp(fit.x + fit.width / 2, fill.x + fill.width / 2, k) + shift.x;
  const cy = lerp(fit.y + fit.height / 2, fill.y + fill.height / 2, k) + shift.y;
  return {
    x: clampAxis(cx - width / 2, width, frameWidth),
    y: clampAxis(cy - height / 2, height, frameHeight),
    width,
    height,
  };
}

/** Whether the picture covers the whole frame, so nothing needs continuing. */
export function covers(p: Placement, frameWidth: number, frameHeight: number): boolean {
  return p.x <= 0.5 && p.y <= 0.5 && p.x + p.width >= frameWidth - 0.5 && p.y + p.height >= frameHeight - 0.5;
}

/**
 * Fills every part of the frame the picture does not cover by continuing the picture's own edges.
 * `pixels` is the frame's RGBA buffer with the picture already drawn into it at `p`; it is changed
 * in place. `random` is only for the grain, and is injectable so tests are repeatable.
 */
export function continueEdges(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  p: Placement,
  random: () => number = Math.random,
): void {
  const x0 = clampInt(Math.round(p.x), 0, width);
  const x1 = clampInt(Math.round(p.x + p.width), 0, width);
  const y0 = clampInt(Math.round(p.y), 0, height);
  const y1 = clampInt(Math.round(p.y + p.height), 0, height);
  if (x1 - x0 < 2 || y1 - y0 < 2) return;
  if (x0 === 0 && y0 === 0 && x1 === width && y1 === height) return;

  const invented = new Uint8Array(width * height);
  const frame = { pixels, width, height, invented };

  // Above and below first, across the picture's width only; then the sides over the full height,
  // so the corners carry on whatever the picture's foot (or head) became.
  if (y1 < height) continueVertically(frame, x0, x1, y1 - 1, 1, height - y1, y1 - y0);
  if (y0 > 0) continueVertically(frame, x0, x1, y0, -1, y0, y1 - y0);
  if (x0 > 0) continueSideways(frame, x0, -1, x0, x1 - x0);
  if (x1 < width) continueSideways(frame, x1 - 1, 1, width - x1, x1 - x0);

  for (let i = 0; i < width * height; i++) {
    if (!invented[i]) continue;
    const n = (random() - 0.5) * 9;
    const o = i * 4;
    for (let c = 0; c < 3; c++) pixels[o + c] = pixels[o + c] + n;
  }
}

interface Frame {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  invented: Uint8Array;
}

/** The picture's head or foot, carried on up or down: a per-column average of its outer rows. */
function continueVertically(f: Frame, x0: number, x1: number, edgeRow: number, dir: 1 | -1, pad: number, drawnHeight: number): void {
  const { pixels, width, invented } = f;
  const n = x1 - x0;
  const rows = Math.max(1, Math.min(12, Math.floor(drawnHeight / 4)));
  const profile = new Float32Array(n * 3);
  for (let x = 0; x < n; x++) {
    for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let i = 0; i < rows; i++) s += pixels[((edgeRow - dir * i) * width + x0 + x) * 4 + c];
      profile[x * 3 + c] = s / rows;
    }
  }
  smoothRange(profile, 0, n, 4);

  for (let i = 1; i <= pad; i++) {
    const y = edgeRow + dir * i;
    // Below the picture the light falls off towards the front, as it would across a real table.
    const falloff = dir > 0 ? 1 - 0.16 * (i / pad) : 1;
    for (let x = 0; x < n; x++) {
      const o = (y * width + x0 + x) * 4;
      for (let c = 0; c < 3; c++) pixels[o + c] = profile[x * 3 + c] * falloff;
      pixels[o + 3] = 255;
      invented[y * width + x0 + x] = 1;
    }
  }

  const blend = Math.min(24, Math.floor(drawnHeight / 8));
  for (let i = 0; i < blend; i++) {
    const y = edgeRow - dir * i;
    const k = smoothstep(1 - i / blend);
    for (let x = 0; x < n; x++) {
      const o = (y * f.width + x0 + x) * 4;
      for (let c = 0; c < 3; c++) pixels[o + c] = pixels[o + c] * (1 - k) + profile[x * 3 + c] * k;
    }
  }
}

/**
 * The picture's side, carried on outwards: a per-row average of its outer strip, smoothed along the
 * edge - the wall and the table separately, so the table's edge stays one crisp line across the
 * frame rather than dissolving into a blur.
 */
function continueSideways(f: Frame, edgeCol: number, dir: 1 | -1, pad: number, drawnWidth: number): void {
  const { pixels, width, height, invented } = f;
  const strip = Math.max(2, Math.min(Math.round(drawnWidth * 0.025), Math.floor(drawnWidth / 2)));
  const profile = new Float32Array(height * 3);
  for (let y = 0; y < height; y++) {
    for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let i = 0; i < strip; i++) s += pixels[(y * width + edgeCol - dir * i) * 4 + c];
      profile[y * 3 + c] = s / strip;
    }
  }

  const tableY = tableEdge(profile, height);
  smoothRange(profile, 0, tableY, Math.max(1, height * 0.022));
  smoothRange(profile, tableY, height, Math.max(1, height * 0.005));

  const feather = Math.max(2, Math.min(Math.round(drawnWidth * 0.03), Math.floor(drawnWidth / 3)));
  for (let y = 0; y < height; y++) {
    for (let i = 1; i <= pad; i++) {
      const x = edgeCol + dir * i;
      const o = (y * width + x) * 4;
      // A faint vignette towards the outer edge, the way light falls off across a real wall.
      const shade = 1 - 0.06 * smoothstep(i / pad);
      for (let c = 0; c < 3; c++) pixels[o + c] = profile[y * 3 + c] * shade;
      pixels[o + 3] = 255;
      invented[y * width + x] = 1;
    }
    for (let i = 0; i < feather; i++) {
      const o = (y * width + edgeCol - dir * i) * 4;
      const k = smoothstep(1 - i / feather);
      for (let c = 0; c < 3; c++) pixels[o + c] = pixels[o + c] * (1 - k) + profile[y * 3 + c] * k;
    }
  }
}

/** The row where a wall most likely meets a table: the sharpest change of brightness low down. */
function tableEdge(profile: Float32Array, height: number): number {
  const luma = (y: number) => 0.299 * profile[y * 3] + 0.587 * profile[y * 3 + 1] + 0.114 * profile[y * 3 + 2];
  const span = Math.max(1, Math.round(height / 120));
  let best = 0;
  let at = Math.round(height * 0.7);
  for (let y = Math.max(span, Math.round(height * 0.4)); y < Math.min(height - span, Math.round(height * 0.85)); y++) {
    let above = 0;
    let below = 0;
    for (let i = 1; i <= span; i++) {
      above += luma(y - i);
      below += luma(y + i - 1);
    }
    const step = Math.abs(above - below) / span;
    if (step > best) {
      best = step;
      at = y;
    }
  }
  return at;
}

/** A 1-D gaussian over samples [from, to) of a 3-channel profile, clamped at the ends. */
function smoothRange(profile: Float32Array, from: number, to: number, sigma: number): void {
  const n = to - from;
  if (n < 2) return;
  const radius = Math.ceil(sigma * 3);
  const kernel: number[] = [];
  let total = 0;
  for (let i = -radius; i <= radius; i++) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel.push(w);
    total += w;
  }
  const src = profile.slice(from * 3, to * 3);
  for (let p = 0; p < n; p++) {
    for (let c = 0; c < 3; c++) {
      let acc = 0;
      for (let i = -radius; i <= radius; i++) {
        const q = Math.min(n - 1, Math.max(0, p + i));
        acc += src[q * 3 + c] * kernel[i + radius];
      }
      profile[(from + p) * 3 + c] = acc / total;
    }
  }
}

function clampAxis(pos: number, size: number, frame: number): number {
  return size >= frame ? Math.min(0, Math.max(frame - size, pos)) : Math.max(0, Math.min(frame - size, pos));
}

function clampInt(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(k: number): number {
  return k * k * (3 - 2 * k);
}
