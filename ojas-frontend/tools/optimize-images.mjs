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
const OUTPUT_DIR = path.join(import.meta.dirname, '..', 'public', 'images');

// Which widths each picture is published at. The hero is full-bleed and needs to look right on
// a desktop monitor as well as a phone, so it gets a ladder for the browser to choose from;
// everything else is only ever shown small.
const RECIPES = {
  'hero-banner': { widths: [640, 960, 1280, 1600], fallbackWidth: 1280, quality: 80 },
  default: { widths: [1000], fallbackWidth: 1000, quality: 80 },
};

async function isStale(source, output) {
  if (!existsSync(output)) return true;
  const [a, b] = await Promise.all([stat(source), stat(output)]);
  return a.mtimeMs > b.mtimeMs;
}

async function run() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  const files = (await readdir(SOURCE_DIR)).filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
  if (files.length === 0) {
    console.log('No source images found in tools/source-images — nothing to do.');
    return;
  }

  for (const file of files) {
    const name = path.basename(file, path.extname(file));
    const source = path.join(SOURCE_DIR, file);
    const recipe = RECIPES[name] ?? RECIPES.default;
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
