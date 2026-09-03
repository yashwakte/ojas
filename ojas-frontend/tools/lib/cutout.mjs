// Lifts a product off its studio backdrop and returns it trimmed, with an alpha channel.
//
// Extracted from build-hero.mjs so the hero builder and the product-shot importer key the same
// mockups the same way. They were about to hold two copies of a hundred lines of pixel work
// tuned to one specific set of renders, which is how two things that must agree stop agreeing.
//
// Needs sharp, which is an optionalDependency — callers pass it in rather than importing it
// here, so this module stays loadable in environments that never installed it.

/**
 * Lifts a product off its studio backdrop.
 *
 * The backdrop is a smooth vertical gradient, uniform across any given row, so the far-left
 * column of each row *is* that row's backdrop colour. Keying per row rather than against a single
 * global colour is what lets a pale cream custard box survive on a pale grey field - a global key
 * would either keep a grey halo or eat the box.
 */
export async function cutout(sharp, file, { targetHeight, workWidth = 1100 }) {
  const { data, info } = await sharp(file)
    .resize({ width: workWidth })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width: W, height: H, channels: C } = info;
  const alpha = new Uint8Array(W * H);

  // The backdrop is sampled at BOTH ends of each row and interpolated across it, rather than
  // taken as one constant. The pouch photographs are vignetted horizontally - noticeably darker
  // at the corners than in the middle - so a single left-edge sample mis-describes the backdrop
  // by the time it reaches the centre, keys the whole row as faintly opaque, and leaves a grey
  // rectangle behind the product. A ramp tracks the vignette; it costs one extra sample.
  const EDGE = 20;
  for (let y = 0; y < H; y++) {
    let lr = 0, lg = 0, lb = 0, rr = 0, rg = 0, rb = 0;
    for (let x = 0; x < EDGE; x++) {
      const li = (y * W + x) * C;
      lr += data[li]; lg += data[li + 1]; lb += data[li + 2];
      const ri = (y * W + (W - 1 - x)) * C;
      rr += data[ri]; rg += data[ri + 1]; rb += data[ri + 2];
    }
    lr /= EDGE; lg /= EDGE; lb /= EDGE;
    rr /= EDGE; rg /= EDGE; rb /= EDGE;

    for (let x = 0; x < W; x++) {
      const t = x / (W - 1);
      const br = lr + (rr - lr) * t;
      const bg = lg + (rg - lg) * t;
      const bb = lb + (rb - lb) * t;

      const i = (y * W + x) * C;
      const diff = Math.max(
        Math.abs(data[i] - br),
        Math.abs(data[i + 1] - bg),
        Math.abs(data[i + 2] - bb),
      );
      // A soft ramp rather than a hard cut, so edges stay anti-aliased instead of turning
      // into a jagged 1-bit stencil against the hero's background.
      alpha[y * W + x] = diff <= 16 ? 0 : diff >= 42 ? 255 : Math.round(((diff - 16) / 26) * 255);
    }
  }

  // Fill interior holes. White packaging against a white backdrop keys as transparent - the milk
  // splash and the white label panels punched straight through the box. Anything transparent that
  // cannot be reached from outside the product is by definition inside it, so flood the true
  // background inwards from the border and make everything it never reaches opaque.
  const outside = new Uint8Array(W * H);
  const queue = new Int32Array(W * H);
  let head = 0, tail = 0;
  // Traversable means "more backdrop than product". A strict `alpha < 8` looked right and was
  // not: the backdrop carries a faint vignette, so the ring of it immediately around the pack
  // keys a little above zero, walls the flood fill off, and every pixel it then fails to reach -
  // the entire backdrop inside the crop - gets filled in as though it were part of the product.
  // That is what put a grey rectangle behind all ten packs.
  const push = (p) => {
    if (!outside[p] && alpha[p] < 120) { outside[p] = 1; queue[tail++] = p; }
  };
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  while (head < tail) {
    const p = queue[head++];
    const x = p % W, y = (p / W) | 0;
    if (x > 0) push(p - 1);
    if (x < W - 1) push(p + 1);
    if (y > 0) push(p - W);
    if (y < H - 1) push(p + W);
  }
  for (let p = 0; p < W * H; p++) if (!outside[p]) alpha[p] = 255;

  // Crop to the solid product. The render's drop shadow keys as a soft, part-transparent smear
  // below the pack; bounding to fully-opaque pixels leaves it behind, so the hero can cast its
  // own shadow consistently for every product instead of inheriting ten different ones.
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (alpha[y * W + x] > 240) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const rgba = Buffer.alloc(W * H * 4);
  for (let p = 0; p < W * H; p++) {
    const i = p * C;
    rgba[p * 4] = data[i];
    rgba[p * 4 + 1] = data[i + 1];
    rgba[p * 4 + 2] = data[i + 2];
    rgba[p * 4 + 3] = alpha[p];
  }

  return sharp(rgba, { raw: { width: W, height: H, channels: 4 } })
    .extract({ left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 })
    .resize({ height: targetHeight, fit: 'inside' })
    .png()
    .toBuffer({ resolveWithObject: true });
}
