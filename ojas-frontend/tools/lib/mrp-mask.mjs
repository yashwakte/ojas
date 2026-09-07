/**
 * Blanks the printed M.R.P. out of a pack photograph.
 *
 * The owner's reason is commercial rather than cosmetic: the MRP is fixed at print time while the
 * real one moves, so a photograph showing "MRP : 65/-" is a price promise the shop may not be able
 * to keep — and this catalogue has already been found listing packs above their printed MRP. Every
 * other rule about this photography still holds (no cut-out, no background removal, no colour
 * work); this is the single permitted alteration, and it is deliberately the smallest one that
 * does the job: only the VALUE goes. The label, the colon and the "(Incl. all taxes)" note stay,
 * so the field reads exactly like the Batch No. and Packing Date beside it, which already ship
 * blank for the packing line to stamp.
 *
 * WHERE it is, is recorded rather than inferred. Two rounds of trying to find the MRP row from the
 * pixels alone — locate the white statutory panel, split it into text rows, take the second — were
 * wrong on roughly half the packs, because the panel is one of four white blocks on the pack, its
 * rounded corners register as text rows, "(Incl. all taxes)" sometimes merges into the MRP row and
 * sometimes does not, and on one pack the value sits a whole line below its own label. A wrong
 * answer here paints a white rectangle across a nutrition table, which is worse than no answer.
 *
 * So MRP_WINDOWS below records, per photograph, a coarse box that contains the price and nothing
 * else, read off a coordinate grid laid over the original. Coarse is all a person needs to supply:
 * within that window the exact bounding box of the ink is measured from the pixels, so the mask is
 * tight against the digits rather than as loose as the window. This is the same division of labour
 * as pack-shot-sources.mjs — the part only a person can determine is written down once, and
 * everything derivable from it is derived.
 */

/** Boxes are [x0, y0, x1, y1] as percentages of the photograph. */
export const MRP_WINDOWS = {
  // Custard and corn-flour cartons: one wide statutory strip across the foot of the back panel,
  // "M.R.P.  : 40/-" at its top left. 4.2 sits further right in frame than its siblings.
  '1.2.jpg': [40.5, 84.0, 46.0, 86.0], // custard pineapple, 40/-
  '2.2.jpg': [37.8, 84.0, 43.0, 86.0], // custard mango, 40/-
  '3.2.jpg': [40.5, 84.0, 46.0, 86.0], // custard strawberry, 40/-
  '4.2.jpg': [40.9, 84.0, 46.0, 86.0], // custard vanilla, 40/-
  '5.2.jpg': [40.5, 84.0, 46.0, 86.0], // corn flour, 25/-

  // Pouches. Same artwork throughout — a white "Net Weight / MRP / Batch no. / Packing Date /
  // Best Before" panel on the right — but each pack sits at its own height in its own photograph,
  // so the vertical band is per file. The left edge clears the colon; the right runs to the panel.
  'IMG-20260831-WA0022.jpg.jpeg': [63.0, 55.5, 74.0, 59.0], // modak pith, 60/-
  'IMG-20260831-WA0025.jpg.jpeg': [63.0, 55.5, 74.0, 59.0], // bajra, 45/-
  'IMG-20260831-WA0026.jpg.jpeg': [63.0, 55.6, 74.0, 59.1], // anarasa, 115/-
  'IMG-20260831-WA0029.jpg.jpeg': [63.0, 50.7, 74.0, 54.2], // wheat daliya, 45/-
  'IMG-20260831-WA0030.jpg.jpeg': [62.0, 56.3, 74.0, 59.8], // rice flour, 50/-
  'IMG-20260831-WA0031.jpg.jpeg': [63.0, 52.4, 74.0, 55.8], // sorghum, 50/-
  'IMG-20260831-WA0032.jpg.jpeg': [63.0, 56.3, 74.0, 59.8], // ragi flour, 50/-
  'IMG-20260831-WA0035.jpg.jpeg': [63.0, 56.3, 74.0, 59.8], // chana sattu, 50/-
  'IMG-20260831-WA0036.jpg.jpeg': [63.0, 50.3, 74.0, 53.8], // rajgira, 60/-
  'IMG-20260831-WA0037.jpg.jpeg': [63.0, 50.2, 74.0, 53.7], // buckwheat, 65/-
  'IMG-20260831-WA0038.jpg.jpeg': [63.0, 56.2, 74.0, 59.8], // ragi malt, 65/-
  'IMG-20260831-WA0039.jpg.jpeg': [63.0, 56.2, 74.0, 59.8], // shingada, 100/-
  'IMG-20260831-WA0040.jpg.jpeg': [63.0, 50.4, 74.0, 53.8], // upvas bhajani, 60/-

  // Not listed, and deliberately: the boxed range photographed in May and June 2026 (baking
  // powder, baking soda, rock salt, black salt, cocoa, citric acid, MSG, dry ginger, cinnamon,
  // jeshthamadh, yeast) and the newer pouches (amboli, thalipeeth bhajani, bhagar) already print
  // "M.R.P. :" with nothing after it. There is nothing on those to remove.
};

/** Anything at or below this counts as ink rather than label. */
const INK = 150;
/** Breathing room around the measured ink, so no anti-aliased glyph edge survives. */
const PAD = 0.003;
/** Work at this width when measuring; enough to resolve a digit, cheap to scan. */
const SCAN_W = 900;

/**
 * The box, in fractions of the frame, that must be painted out — or null when this photograph has
 * no recorded MRP, or when the recorded window turns out to hold no ink at all.
 */
export async function findMrpValue(sharp, file, fileName) {
  const window = MRP_WINDOWS[fileName];
  if (!window) return null;

  const meta = await sharp(file).metadata();
  const h = Math.round((SCAN_W / meta.width) * meta.height);
  const { data } = await sharp(file)
    .resize(SCAN_W, h)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const [wx0, wy0, wx1, wy1] = window;
  const x0 = Math.round((wx0 / 100) * SCAN_W);
  const x1 = Math.round((wx1 / 100) * SCAN_W);
  const y0 = Math.round((wy0 / 100) * h);
  const y1 = Math.round((wy1 / 100) * h);

  // Column-by-column ink, grouped into runs. The runs are the glyphs: on the cartons the window
  // has to be drawn wide enough to survive the price sitting a percent or two further left on one
  // box than the next, which means it takes in the colon as well.
  const runs = [];
  let run = null;
  for (let x = x0; x < x1; x++) {
    let top = -1, bottom = -1, area = 0;
    for (let y = y0; y < y1; y++) {
      if (data[y * SCAN_W + x] > INK) continue;
      if (top < 0) top = y;
      bottom = y;
      area++;
    }
    if (top >= 0) {
      if (run) {
        run.x1 = x;
        run.top = Math.min(run.top, top);
        run.bottom = Math.max(run.bottom, bottom);
        run.area += area;
      } else {
        run = { x0: x, x1: x, top, bottom, area };
      }
    } else if (run) {
      runs.push(run);
      run = null;
    }
  }
  if (run) runs.push(run);
  if (runs.length === 0) return null;

  // The colon is the one mark here that is both tiny and leading: two dots, an order of magnitude
  // less ink than a digit. So the mask starts at the first substantial glyph and runs to the end of
  // the window, which drops a leading colon and keeps everything after it — including the trailing
  // "-", which carries about as little ink as a colon does and would be left stranded on the label
  // by any rule applied to every run rather than only to the leading ones.
  //
  // Height is the obvious discriminator and it does not work: a slash overshoots a digit at both
  // ends, so a threshold set high enough to reject a colon also rejected the "4" of "40/-" on four
  // of the five cartons and masked "0/-" alone.
  const heaviest = Math.max(...runs.map((r) => r.area));
  const first = runs.findIndex((r) => r.area >= 0.3 * heaviest);
  const kept = runs.slice(first === -1 ? 0 : first);

  const minX = kept[0].x0;
  const maxX = kept[kept.length - 1].x1;
  const minY = Math.min(...kept.map((r) => r.top));
  const maxY = Math.max(...kept.map((r) => r.bottom));

  const padX = PAD * SCAN_W;
  const padY = PAD * h;
  return {
    left: Math.max(0, (minX - padX) / SCAN_W),
    top: Math.max(0, (minY - padY) / h),
    width: Math.min(1, (maxX - minX + 1 + padX * 2) / SCAN_W),
    height: Math.min(1, (maxY - minY + 1 + padY * 2) / h),
  };
}

/**
 * Paints the MRP value out so the field reads as unprinted rather than as damage.
 */
export async function maskMrp(sharp, file, box) {
  const meta = await sharp(file).metadata();
  const L = Math.round(box.left * meta.width);
  const T = Math.round(box.top * meta.height);
  const W = Math.round(box.width * meta.width);
  const H = Math.round(box.height * meta.height);

  // Fill by interpolating the label across the gap rather than painting a flat colour or cloning
  // one strip of it. These labels carry a soft studio gradient and a little film grain, and a flat
  // patch — even one sampled from the panel — reads as a bright sticker laid over the photograph,
  // while a cloned strip brings the shading it was cut from with it and leaves a visible seam.
  //
  // Taking the column of pixels just outside each end of the mask, stretching each across the
  // whole gap and cross-fading between them reproduces the gradient in both directions at once:
  // vertically from the columns themselves, horizontally from the fade. Nothing has an edge.
  const GUTTER = Math.max(2, Math.round(W * 0.06));
  const leftX = Math.max(0, L - GUTTER);
  const rightX = Math.min(meta.width - 1, L + W + GUTTER);

  const column = (x) => sharp(file).extract({ left: x, top: T, width: 1, height: H }).toBuffer();
  const spread = (buf) => sharp(buf).resize(W, H, { fit: 'fill' }).toBuffer();

  const fade = Buffer.from(
    `<svg width="${W}" height="${H}"><defs><linearGradient id="g" x1="0" x2="1">` +
      `<stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/>` +
      `</linearGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/></svg>`,
  );

  const [fromLeft, fromRight] = await Promise.all([
    column(leftX).then(spread),
    column(rightX).then(spread),
  ]);
  const rightFaded = await sharp(fromRight)
    .ensureAlpha()
    .composite([{ input: fade, blend: 'dest-in' }])
    .png()
    .toBuffer();
  const patch = await sharp(fromLeft).composite([{ input: rightFaded }]).png().toBuffer();

  return sharp(file).composite([{ input: patch, left: L, top: T }]).toBuffer();
}
