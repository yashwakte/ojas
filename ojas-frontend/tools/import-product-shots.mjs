// Imports the client's product photography into public/images under the naming convention the
// catalogue already uses: <slug>-front.webp and <slug>-back.webp, 1000x1000, matching the boxed
// products (corn flour, the four custards) that were imported the same way earlier.
//
// The client sends these as a WhatsApp dump — IMG-20260831-WA0033.jpg and so on — so the mapping
// from filename to product is recorded here rather than inferred. That mapping is the only part
// a human had to work out (by reading the pack shots), and writing it down is what stops the
// next import from having to work it out again.
//
//     OJAS_SHOTS=<folder> node tools/import-product-shots.mjs
//
// Needs sharp, which is an optionalDependency: the committed webp outputs are what ship, so
// neither this script nor sharp is required to build or deploy the site.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { cutout } from './lib/cutout.mjs';

let sharp;
try {
  sharp = (await import('sharp')).default;
} catch {
  console.error('This script needs sharp:  npm install --include=optional sharp');
  process.exit(1);
}

const SRC = process.env.OJAS_SHOTS ?? 'C:/Users/Yash Wakte/Downloads/Images';
const OUT = path.join(import.meta.dirname, '..', 'public', 'images');

// 3:2 landscape with an alpha channel, close to the shape of a product card's image well so
// `object-fit: contain` leaves only a sliver at the sides.
//
// The first cut of this import wrote 1000x1000 squares straight from the client's files and it
// was wrong twice over. Square art in a 3:2 well meant `cover` cropped about half the height
// away, so every card showed the middle band of a pouch with its brand mark and its net weight
// both sliced off. And each one carried the studio's grey gradient, which on a warm cream page
// reads as a grey box behind the product rather than as a photograph of it.
//
// So the backdrop is keyed out and the pack is placed on transparency: the card's own wash shows
// through, nothing is cropped, and one product sits at the same scale as the next.
const CANVAS_W = 1200;
const CANVAS_H = 800;
/** Leaves the pack a little air rather than letting it touch the edges of the well. */
const PACK_H = Math.round(CANVAS_H * 0.9);
const QUALITY = 82;

/** slug -> [front file, back file] */
const SHOTS = {
  // 500g pouches
  'sorghum-flour': ['IMG-20260831-WA0033.jpg.jpeg', 'IMG-20260831-WA0031.jpg.jpeg'],
  'bajra-flour': ['IMG-20260831-WA0023.jpg.jpeg', 'IMG-20260831-WA0025.jpg.jpeg'],
  'ragi-flour': ['IMG-20260831-WA0027.jpg.jpeg', 'IMG-20260831-WA0032.jpg.jpeg'],
  'rice-flour': ['IMG-20260831-WA0028.jpg.jpeg', 'IMG-20260831-WA0030.jpg.jpeg'],
  'modak-pith': ['IMG-20260831-WA0021.jpg.jpeg', 'IMG-20260831-WA0022.jpg.jpeg'],
  'anarasa-flour': ['IMG-20260831-WA0024.jpg.jpeg', 'IMG-20260831-WA0026.jpg.jpeg'],
  'wheat-daliya': ['IMG-20260831-WA0034.jpg.jpeg', 'IMG-20260831-WA0029.jpg.jpeg'],
  // 200g pouches
  'chana-sattu': ['IMG-20260322-WA0013.jpg.jpeg', 'IMG-20260831-WA0035.jpg.jpeg'],
  'ragi-malt': ['IMG-20260322-WA0008.jpg.jpeg', 'IMG-20260831-WA0038.jpg.jpeg'],
  'rajgira-flour': ['IMG-20260322-WA0009.jpg.jpeg', 'IMG-20260831-WA0036.jpg.jpeg'],
  'buckwheat-flour': ['IMG-20260322-WA0011.jpg.jpeg', 'IMG-20260831-WA0037.jpg.jpeg'],
  'shingada-flour': ['IMG-20260322-WA0014.jpg.jpeg', 'IMG-20260831-WA0039.jpg.jpeg'],
  'upvas-bhajani': ['IMG-20260322-WA0005.jpg.jpeg', 'IMG-20260831-WA0040.jpg.jpeg'],
  // Boxed range
  'custard-pineapple': ['1.1.jpg', '1.2.jpg'],
  'custard-mango': ['2.1.jpg', '2.2.jpg'],
  'custard-strawberry': ['3.1.jpg', '3.2.jpg'],
  'custard-vanilla': ['4.1.jpg', '4.2.jpg'],
  'corn-flour': ['5.1.jpg', '5.2.jpg'],
};

let written = 0;
let missing = 0;

for (const [slug, [front, back]] of Object.entries(SHOTS)) {
  for (const [face, file] of [
    ['front', front],
    ['back', back],
  ]) {
    const source = path.join(SRC, file);
    if (!existsSync(source)) {
      console.warn(`  MISSING  ${slug}-${face}  <-  ${file}`);
      missing++;
      continue;
    }
    const output = path.join(OUT, `${slug}-${face}.webp`);

    // Keyed off the studio backdrop and trimmed to the product, then centred on the canvas. The
    // pack is sized by HEIGHT so a tall pouch and a squat custard box end up looking like they
    // were photographed for the same catalogue instead of at two different distances.
    const { data: pack } = await cutout(sharp, source, { targetHeight: PACK_H });

    await sharp({
      create: {
        width: CANVAS_W,
        height: CANVAS_H,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{ input: pack, gravity: 'center' }])
      .webp({ quality: QUALITY, alphaQuality: 100 })
      .toFile(output);
    written++;
  }
}

console.log(`${written} images written to public/images${missing ? `, ${missing} missing` : ''}`);
