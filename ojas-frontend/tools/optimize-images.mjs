// Turns the full-resolution artwork in tools/source-images/ into the small, modern files the
// storefront actually serves from public/images/.
//
// This exists because the home page's hero was a 2.1 MB PNG that had been given a .jpg name -
// a photograph in a format designed for line art - and it is the largest thing in the first
// screenful, so it was single-handedly deciding how fast the site felt. The same picture as
// WebP is a small fraction of that size with no visible difference.
//
// Run it after adding or replacing anything in tools/source-images/:
//
//     npm run images:optimize
//
// Outputs are committed, so a normal build and deploy needs neither this script nor sharp.
// Existing outputs newer than their source are left alone, which keeps re-runs cheap and
// stops repeated runs from re-compressing already-compressed files.

import { readdir, stat, mkdir } from 'node:fs/promises';
import { PACK_SHOT_SOURCES } from './pack-shot-sources.mjs';
import { findMrpValue, maskMrp } from './lib/mrp-mask.mjs';
import { existsSync } from 'node:fs';
import path from 'node:path';

// sharp is an optionalDependency, never a build dependency: the optimised files are committed,
// so a production build and deploy must never be able to fail because an image tool would not
// install. Declaring it optional means npm installs it where it can and shrugs where it can't.
let sharp;
try {
  sharp = (await import('sharp')).default;
} catch {
  console.error('This script needs sharp:  npm install --include=optional sharp');
  process.exit(1);
}

const SOURCE_DIR = path.join(import.meta.dirname, 'source-images');

// Where the client's untouched pack photographs live. Overridable so they can be re-run from
// wherever they were delivered, but the default keeps them inside the repo where they belong.
const packsFlag = process.argv.indexOf('--packs');
const PACK_SOURCE_DIR = packsFlag !== -1 && process.argv[packsFlag + 1]
  ? path.resolve(process.argv[packsFlag + 1])
  : path.join(SOURCE_DIR, 'pack-shots');
const OUTPUT_DIR = path.join(import.meta.dirname, '..', 'public', 'images');

/**
 * `--force` re-encodes everything regardless of timestamps.
 *
 * The mtime check below asks "is the source newer than the output", which answers the question it
 * was written for — someone dropped in a new photograph — and quietly answers nothing at all when
 * what changed is this script. Removing the printed MRP changed how every pack shot is produced
 * while leaving every source file untouched, so without this the whole pass was a no-op.
 */
const FORCE = process.argv.includes('--force');

// Which widths each picture is published at. The hero is full-bleed and needs to look right on
// a desktop monitor as well as a phone, so it gets a ladder for the browser to choose from;
// everything else is only ever shown small.
const RECIPES = {
  hero: { widths: [640, 960, 1280, 1600], fallbackWidth: 1280, quality: 80 },
  default: { widths: [1000], fallbackWidth: 1000, quality: 80 },
};

/**
 * The hero is a carousel now rather than a single picture, so the ladder is chosen by prefix
 * rather than by one hardcoded filename: anything named `hero-*.png|jpg` in source-images is a
 * hero slide and gets the full set of widths. Adding another slide to the shipped set is then
 * a matter of dropping the artwork in and re-running this, with nothing here to remember to edit.
 */
function recipeFor(name) {
  return name.startsWith('hero-') ? RECIPES.hero : RECIPES.default;
}

/**
 * The pack shots — the client's photographs of every product, front and back — get their own pass,
 * built straight from the originals rather than from whatever is already in public/images.
 *
 * That distinction is the whole point. The published images used to be 1200x800 cut-outs derived
 * from the originals by hand: the square photographs had been cropped to landscape, the background
 * removed with a soft selection that left an opaque white halo down both sides of every pack —
 * invisible on a white card, a glow on the lightbox's dark backdrop — and the originals themselves
 * were never committed. So the pictures could only ever get worse, and zooming in showed the limit
 * of a 1200px source rather than the limit of the photograph.
 *
 * Now the originals are the source of truth and nothing is retouched: the photograph is published
 * as shot, square, at the largest size it actually contains. Two widths come out of each one — a
 * full size for the product page and the lightbox, where somebody is reading the label, and a card
 * size, because the products grid was pulling thirty-odd full-resolution pack shots to draw a page
 * of thumbnails.
 */

/** Never upscale past this, and never past the original either. Enough that the lightbox can be
 * zoomed into and still be reading the pack's own printing rather than its pixels. */
const PACK_SHOT_FULL_WIDTH = 2000;

/**
 * The shape the pack shots are published in, and the one the card's image well matches.
 *
 * The photographs are square, and the packs inside them are portrait — a pouch fills about 83% of
 * the frame's height and under half its width. That combination is what made the card too tall:
 * publishing the square as-is and letting it fill the card's width meant an image area as tall as
 * the card was wide, and most of the extra was empty backdrop down either side.
 *
 * The obvious fix is the wrong one. Cropping the square down to a landscape frame would cut 8% off
 * the top of every pouch, which is the exact bug the card had years ago — a row of packs with
 * their sealed tops sliced off. The pack is portrait; no landscape crop can contain it.
 *
 * So the frame is made wider instead of shorter: the photograph is extended sideways with a copy
 * of its own edge pixels until it is 4:3. The backdrop is a smooth vertical gradient, so
 * replicating the left and right edge columns continues it exactly — there is no seam, no flat
 * band, and not one pixel of the pack is touched, moved or resized. The card's well is 4:3 to
 * match, so the picture is full-bleed with nothing letterboxed.
 */
const PACK_SHOT_ASPECT = 4 / 3;

/**
 * How much of each photograph's outer edge is discarded before the backdrop is continued outwards,
 * measured per photograph rather than assumed.
 *
 * A fixed one pixel was enough for the carton photographs, which carry a single bright column at
 * the frame edge as an export artefact. It was not enough for the June 2026 delivery, which came
 * out of the studio with a four-pixel RED rule drawn around the whole frame. One pixel in from
 * that is still red, so the pack shot was published with a 250px crimson band down each side —
 * invisible in the original, glaring the moment the edge column is the one replicated outwards.
 *
 * So the trim is measured: walk in from each edge for as long as the line there does not match the
 * backdrop a little further in, and cut that much. The cap keeps a mistake cheap — a photograph
 * whose pack runs to the frame edge loses at most this fraction rather than losing the product.
 */
const MAX_EDGE_TRIM = 0.02;
/** How different a line has to be from the reference before it counts as border rather than
 * backdrop. Comfortably above sensor noise and JPEG ringing, far below a printed rule. */
const EDGE_TOLERANCE = 12;

async function detectEdgeTrim(source, meta) {
  const { data, info } = await sharp(source)
    .resize({ width: Math.min(meta.width, 400) })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const scale = meta.width / w;
  const at = (x, y) => data[y * w + x];

  const limit = Math.max(2, Math.round(Math.min(w, h) * MAX_EDGE_TRIM));
  const differs = (a, b) => Math.abs(a - b) > EDGE_TOLERANCE;

  // Compare whole lines against a reference line just inside the widest trim we would ever take.
  const lineDiff = (get, ref) => {
    let total = 0;
    const n = get.length;
    for (let i = 0; i < n; i++) total += Math.abs(get[i] - ref[i]);
    return total / n;
  };
  const col = (x) => Array.from({ length: h }, (_, y) => at(x, y));
  const row = (y) => Array.from({ length: w }, (_, x) => at(x, y));

  const walk = (line, ref) => {
    let n = 0;
    while (n < limit && differs(lineDiff(line(n), ref), 0)) n++;
    return n;
  };

  const trim = Math.max(
    walk(col, col(limit + 2)),
    walk((n) => col(w - 1 - n), col(w - 1 - limit - 2)),
    walk(row, row(limit + 2)),
    walk((n) => row(h - 1 - n), row(h - 1 - limit - 2)),
  );
  // Round up a pixel: an anti-aliased rule fades rather than stopping dead.
  return Math.min(Math.round(trim * scale) + 1, Math.round(meta.width * MAX_EDGE_TRIM));
}

/** What a product card actually needs. Roughly 12 KB against 200 KB for the full size. */
const PACK_SHOT_WIDTH = 420;

/**
 * What the product page's image well actually needs.
 *
 * The full size exists so the lightbox can be zoomed into and still be showing the pack's own
 * printing. The well on the page behind it is nothing like that big — about 576px on a desktop and
 * under 400 on a phone — and it was being handed the 2000px file regardless: a hundred and twenty
 * kilobytes to fill a box that four times less would have filled, on the one screen a customer
 * reaches by tapping and then waits on. 900px covers the well at 2x on a phone and at better than
 * 1.5x on a desktop, for roughly a third of the bytes.
 */
const PACK_SHOT_MEDIUM_WIDTH = 900;

const PACK_SHOT_QUALITY = 82;
const PACK_SHOT_CARD_QUALITY = 78;
const PACK_SHOT_MEDIUM_QUALITY = 80;

export function packShotVariantName(fileName, width = PACK_SHOT_WIDTH) {
  return fileName.replace(/\.webp$/i, `-${width}.webp`);
}

/**
 * Rebuilds every pack shot from the client's originals.
 *
 * `--packs <dir>` says where they are; it defaults to tools/source-images/pack-shots so the whole
 * pipeline is reproducible from a checkout. Keeping the originals somewhere the repo can see them
 * is the point — the previous set lived only in somebody's Downloads folder, which is why the
 * published images could not be regenerated when they turned out to have a halo baked in.
 *
 * Nothing here retouches the photograph. No crop, no cut-out, no background removal: the picture
 * is resized and re-encoded, and that is all.
 */
async function optimizePackShots(sourceDir) {
  if (!existsSync(sourceDir)) {
    console.log(`No pack-shot originals at ${sourceDir} — leaving the published pack shots alone.`);
    return;
  }

  for (const [product, sides] of Object.entries(PACK_SHOT_SOURCES)) {
    for (const [side, fileName] of Object.entries(sides)) {
      const source = path.join(sourceDir, fileName);
      if (!existsSync(source)) {
        console.warn(`  missing original for ${product}-${side}: ${fileName}`);
        continue;
      }

      const full = path.join(OUTPUT_DIR, `${product}-${side}.webp`);
      const card = path.join(OUTPUT_DIR, packShotVariantName(`${product}-${side}.webp`));
      const medium = path.join(
        OUTPUT_DIR,
        packShotVariantName(`${product}-${side}.webp`, PACK_SHOT_MEDIUM_WIDTH),
      );
      if (
        !(await isStale(source, full))
        && !(await isStale(source, card))
        && !(await isStale(source, medium))
      ) continue;

      const meta = await sharp(source).metadata();

      // The one alteration these photographs are allowed. The printed MRP is fixed at print time
      // while the real one moves, so a pack shot that shows "MRP : 65/-" is a price promise the
      // shop may not be able to keep. Only the value goes; see lib/mrp-mask.mjs.
      const mrp = await findMrpValue(sharp, source, fileName);
      const original = mrp ? await maskMrp(sharp, source, mrp) : source;

      // Shave the frame's own border off before anything else — see detectEdgeTrim.
      const edge = await detectEdgeTrim(original, meta);
      const bleed = edge * 2;
      const trimmed = await sharp(original)
        .extract({
          left: edge,
          top: edge,
          width: meta.width - bleed,
          height: meta.height - bleed,
        })
        .toBuffer();
      const inner = await sharp(trimmed).metadata();

      // Widen to the published aspect by continuing the backdrop outwards. Never narrows, and
      // never touches the pack: a photograph already wider than 4:3 is left exactly as it is.
      const wanted = Math.round(inner.height * PACK_SHOT_ASPECT);
      const pad = Math.max(0, Math.round((wanted - inner.width) / 2));
      const framed = pad > 0
        ? await sharp(trimmed).extend({ left: pad, right: pad, extendWith: 'copy' }).toBuffer()
        : trimmed;

      // Never enlarge: upscaling invents no detail and only costs bytes.
      const framedWidth = (await sharp(framed).metadata()).width;
      const fullWidth = Math.min(PACK_SHOT_FULL_WIDTH, framedWidth);

      const fullInfo = await sharp(framed)
        .resize({ width: fullWidth })
        .webp({ quality: PACK_SHOT_QUALITY })
        .toFile(full);

      const cardInfo = await sharp(framed)
        .resize({ width: Math.min(PACK_SHOT_WIDTH, framedWidth) })
        .webp({ quality: PACK_SHOT_CARD_QUALITY })
        .toFile(card);

      const mediumInfo = await sharp(framed)
        .resize({ width: Math.min(PACK_SHOT_MEDIUM_WIDTH, framedWidth) })
        .webp({ quality: PACK_SHOT_MEDIUM_QUALITY })
        .toFile(medium);

      console.log(
        `${(product + '-' + side).padEnd(26)} ${String(meta.width).padStart(4)}px source${mrp ? ' (mrp removed)' : '             '}  ->  ` +
        `${fullWidth}px ${(fullInfo.size / 1024).toFixed(0)}KB  +  ` +
        `${PACK_SHOT_MEDIUM_WIDTH}px ${(mediumInfo.size / 1024).toFixed(0)}KB  +  ` +
        `${PACK_SHOT_WIDTH}px ${(cardInfo.size / 1024).toFixed(0)}KB`,
      );
    }
  }
}

async function isStale(source, output) {
  if (FORCE || !existsSync(output)) return true;
  const [a, b] = await Promise.all([stat(source), stat(output)]);
  return a.mtimeMs > b.mtimeMs;
}

async function run() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  // Pack shots first, and unconditionally: they live in public/images rather than in
  // source-images, so an empty source directory must not skip them.
  await optimizePackShots(PACK_SOURCE_DIR);

  const files = (await readdir(SOURCE_DIR)).filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
  if (files.length === 0) {
    console.log('No source images found in tools/source-images — nothing to do.');
    return;
  }

  for (const file of files) {
    const name = path.basename(file, path.extname(file));
    const source = path.join(SOURCE_DIR, file);
    const recipe = recipeFor(name);
    const meta = await sharp(source).metadata();

    for (const width of recipe.widths) {
      // Never enlarge: upscaling invents no detail and only costs bytes.
      if (width > meta.width) continue;

      const output = path.join(OUTPUT_DIR, `${name}-${width}.webp`);
      if (!(await isStale(source, output))) continue;

      const info = await sharp(source).resize({ width }).webp({ quality: recipe.quality }).toFile(output);
      console.log(`${path.basename(output).padEnd(28)} ${width}px  ${(info.size / 1024).toFixed(0)}KB`);
    }

    // One JPEG alongside the WebP set, as the <picture> fallback for anything that somehow
    // cannot take WebP. Everything current can; it costs one small file to never find out.
    const fallback = path.join(OUTPUT_DIR, `${name}-${recipe.fallbackWidth}.jpg`);
    if (await isStale(source, fallback)) {
      const info = await sharp(source)
        .resize({ width: Math.min(recipe.fallbackWidth, meta.width) })
        .jpeg({ quality: recipe.quality, mozjpeg: true })
        .toFile(fallback);
      console.log(`${path.basename(fallback).padEnd(28)} ${recipe.fallbackWidth}px  ${(info.size / 1024).toFixed(0)}KB`);
    }
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
