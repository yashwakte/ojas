// Builds the home page hero from the real product renders, rather than from stock photography.
//
// Every Ojas pack shot - the flour pouches and the new powder boxes alike - is a render on a
// plain studio backdrop. That is what makes this possible: the backdrop can be keyed out
// programmatically, so the products can be re-arranged into a single branded scene whenever the
// range changes, instead of commissioning new artwork each time.
//
//     npm run hero:build      # writes tools/source-images/hero-banner.png
//     npm run images:optimize # then regenerates the WebP ladder the page actually serves
//
// Needs sharp, which is an optionalDependency: the committed outputs are what ship, so neither
// this script nor sharp is ever required to build or deploy the site.

import { writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

let sharp;
try {
  sharp = (await import('sharp')).default;
} catch {
  console.error('This script needs sharp:  npm install --include=optional sharp');
  process.exit(1);
}

const ROOT = path.join(import.meta.dirname, '..');
const MOCKUPS = process.env.OJAS_MOCKUPS ?? 'C:/Users/Yash Wakte/Downloads/fwdupdatedmockupfiles13_04_2026';
const OUT = path.join(import.meta.dirname, 'source-images', 'hero-banner.png');

const WIDTH = 2000;
const HEIGHT = 1070; // ~1.87:1, the shape the hero slot already expects

/**
 * Lifts a product off its studio backdrop.
 *
 * The backdrop is a smooth vertical gradient, uniform across any given row, so the far-left
 * column of each row *is* that row's backdrop colour. Keying per row rather than against a single
 * global colour is what lets a pale cream custard box survive on a pale grey field - a global key
 * would either keep a grey halo or eat the box.
 */
async function cutout(file, { targetHeight }) {
  const { data, info } = await sharp(file)
    .resize({ width: 1100 })
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

/** A soft elliptical shadow, so every product sits on the same surface. */
function shadow(width, height) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs><radialGradient id="s"><stop offset="0%" stop-color="rgba(120,60,20,0.34)"/>
      <stop offset="60%" stop-color="rgba(120,60,20,0.14)"/>
      <stop offset="100%" stop-color="rgba(120,60,20,0)"/></radialGradient></defs>
    <ellipse cx="${width / 2}" cy="${height / 2}" rx="${width / 2}" ry="${height / 2}" fill="url(#s)"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function build() {
  // A warm field rather than flat white: it matches the cream the storefront already uses behind
  // the hero, so the image reads as part of the page instead of a rectangle pasted onto it.
  const background = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#FFFDF9"/>
        <stop offset="55%" stop-color="#FFF3E6"/>
        <stop offset="100%" stop-color="#FCE3CC"/>
      </linearGradient>
      <radialGradient id="glow" cx="50%" cy="34%" r="62%">
        <stop offset="0%" stop-color="rgba(255,255,255,0.95)"/>
        <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
      </radialGradient>
      <linearGradient id="surface" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="rgba(214,150,96,0.00)"/>
        <stop offset="100%" stop-color="rgba(206,138,80,0.22)"/>
      </linearGradient>
    </defs>
    <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
    <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#glow)"/>
    <rect y="${HEIGHT - 260}" width="${WIDTH}" height="260" fill="url(#surface)"/>
    <rect y="${HEIGHT - 8}" width="${WIDTH}" height="8" fill="#F25A1A" opacity="0.85"/>
  </svg>`);

  // Headline only in Latin script. The Devanagari brand line is carried by the logo artwork and by
  // the packs themselves, so nothing here depends on a Devanagari font being installed wherever
  // this script happens to run.
  const headline = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="300">
    <text x="${WIDTH / 2}" y="74" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif"
      font-size="60" fill="#3A2415" letter-spacing="0.5">A Culinary Journey Through Generations</text>
    <text x="${WIDTH / 2}" y="126" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif"
      font-size="29" fill="#8A6A4F" font-style="italic">Every Grain, Every Blend — a Story of Maharashtrian Heritage</text>
  </svg>`);

  const trust = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="60">
    <text x="${WIDTH / 2}" y="38" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif"
      font-size="26" fill="#7A5A40" letter-spacing="3">100% NATURAL &#183; NO PRESERVATIVES &#183; STONE-GROUND FRESH</text>
  </svg>`);

  // The line-up: the flour range this brand is known for, then the new Powder Box range, so the
  // hero shows the whole catalogue rather than only the newest part of it.
  const pouches = ['bajra-flour', 'ragi-flour', 'sorghum-flour', 'rice-flour', 'wheat-daliya']
    .map((n) => path.join(ROOT, 'public', 'images', `${n}.jpg`))
    .filter(existsSync);
  const boxes = ['1.1', '2.1', '3.1', '4.1', '5.1']
    .map((n) => path.join(MOCKUPS, `${n}.jpg`))
    .filter(existsSync);

  if (boxes.length === 0) {
    console.error(`No powder-box mockups found in ${MOCKUPS}. Set OJAS_MOCKUPS to the folder holding them.`);
    process.exit(1);
  }

  // Two rows, mirroring the layout this brand already used: the flour range it is known for
  // above, the new Powder Box range below. One row of ten would either shrink every product to a
  // thumbnail or overflow the canvas, and it would leave the top two-thirds of the image empty.
  const rows = [
    { files: pouches, height: 250, baseline: 600, gap: 30 },
    { files: boxes, height: 340, baseline: 960, gap: 40 },
  ];

  const layers = [
    { input: headline, top: 30, left: 0 },
    { input: trust, top: HEIGHT - 82, left: 0 },
  ];

  const logo = path.join(ROOT, 'public', 'images', 'logo.png');
  if (existsSync(logo)) {
    const mark = await sharp(logo).resize({ height: 92 }).png().toBuffer({ resolveWithObject: true });
    layers.push({ input: mark.data, top: 168, left: Math.round((WIDTH - mark.info.width) / 2) });
  }

  let count = 0;
  for (const row of rows) {
    const items = await Promise.all(row.files.map((f) => cutout(f, { targetHeight: row.height })));
    count += items.length;

    const natural = items.reduce((sum, i) => sum + i.info.width, 0) + row.gap * (items.length - 1);
    const scale = Math.min(1, (WIDTH - 140) / natural);
    let x = Math.round((WIDTH - natural * scale) / 2);

    for (const item of items) {
      const w = Math.round(item.info.width * scale);
      const h = Math.round(item.info.height * scale);

      // Cast one consistent shadow per product. The renders' own shadows were cropped away, so
      // without this the packs would appear to float rather than stand on the same surface.
      const sh = await shadow(Math.round(w * 1.1), 44);
      layers.push({ input: sh, left: Math.round(x - w * 0.05), top: row.baseline - 22 });
      layers.push({
        input: await sharp(item.data).resize({ width: w, height: h }).png().toBuffer(),
        left: x,
        top: row.baseline - h,
      });

      x += w + Math.round(row.gap * scale);
    }
  }

  const out = await sharp(background).composite(layers).png({ compressionLevel: 9 }).toBuffer();
  writeFileSync(OUT, out);
  console.log(`hero-banner.png  ${WIDTH}x${HEIGHT}  ${(out.length / 1024 / 1024).toFixed(2)}MB  (${count} products)`);
  console.log('Now run:  npm run images:optimize');
}

build().catch((error) => {
  console.error(error);
  process.exit(1);
});
