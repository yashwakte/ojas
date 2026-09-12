// Reshapes the client's two home posters to the storefront's poster frame (2:1), so each one fills
// its window edge to edge with no bars and no blurred padding.
//
//     node tools/build-hero-posters.mjs      # writes tools/source-images/hero-*-framed.png
//     npm run images:optimize                # then regenerates the WebP ladder the page serves
//
// Nothing printed on a poster is cropped away and nothing on it is retouched. Each one is scaled so
// the lowest thing on it that matters - the last row of packs, a tagline - lands at 75% of the
// frame's height, clear of the band where the hero lays its buttons over the picture on a laptop.
// The canvas around it is continued from the poster's own surfaces: the table carried on downwards,
// then the wall and the table carried on sideways, meeting at the same table line.
//
// The sideways continuation is built row by row from the poster's outer strip, but only from the
// pixels in it that are actually wall or table. Whatever touches the poster's edge - a sheaf of
// wheat, a picture frame, a bowl - is recognised as not being either (it is too far in colour from
// the poster's own corners and foot) and left out, so it does not get smeared out into the margin
// as a stripe. Wall and table are smoothed separately, so the table's edge stays one crisp line
// across the whole frame instead of dissolving into a blur. The poster is eased into its
// continuation over a short distance, and the invented surface gets the photograph's grain.
//
// The one thing removed is the upwas poster's maroon frame line, which would otherwise have been
// continued as a maroon band across the new canvas.
//
// Needs sharp, an optionalDependency: the committed outputs are what ship.

import path from 'node:path';

let sharp;
try {
  sharp = (await import('sharp')).default;
} catch {
  console.error('This script needs sharp:  npm install --include=optional sharp');
  process.exit(1);
}

const SOURCES = path.join(import.meta.dirname, 'source-images', 'posters');
const OUT = process.env.OJAS_POSTER_OUT ?? path.join(import.meta.dirname, 'source-images');

/** The frame every poster is reshaped to. Must match the 2:1 window in home-posters.scss. */
const FRAME = { width: 2400, height: 1200 };

/**
 * Where the lowest line that matters on a poster lands, as a share of the frame's height. The
 * hero's buttons, trust line and dots take the bottom ~19-22% on a laptop (measured from 1024px to
 * 2560px wide), so 75% leaves a clear gap above them at every size. Must match HERO_BUTTON_BAND in
 * components/image-framer.
 */
const CONTENT_BOTTOM = 0.75;

const POSTERS = [
  {
    source: 'hero-banner.png',
    out: 'hero-banner-framed.png',
    // A sliver of plain wall above the headline, so the poster can sit a touch larger.
    trim: { top: 14 },
    // The last row of packs ends 92% of the way down (after the trim).
    contentBottom: 0.919,
    // Wheat, a vase and bowls on the left; lamps, a picture frame and a bowl on the right. The
    // strip is wide so there is always some bare wall or table in it to read.
    strip: 0.14,
    gate: 46,
    feather: 90,
    smooth: { wall: 26, table: 10 },
  },
  {
    source: 'hero-upvas.jpg',
    out: 'hero-upvas-framed.png',
    // The maroon frame line (35px top, ~40px each side, ~48px bottom, measured), plus 40px of
    // plain wall above the headline.
    trim: { left: 42, right: 42, top: 77, bottom: 50 },
    // The tagline ends 96% of the way down (after the trim).
    contentBottom: 0.962,
    // Its edges are bare wall and table, but its barnyard pack stands only ~45px in from the left,
    // so the strip is narrow and the ease-in short.
    strip: 0.022,
    gate: null,
    feather: 34,
    // Its table is bands of wood - top, lip, front - that should carry on as crisp lines, but not
    // carry every fibre of grain with them.
    smooth: { wall: 22, table: 6 },
  },
];

const smoothstep = (k) => k * k * (3 - 2 * k);
const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  return s[s.length >> 1];
}

/** A 1-D gaussian over samples [from, to) of a 3-channel profile, clamped at the ends. */
function gaussRange(profile, from, to, sigma) {
  if (sigma <= 0 || to - from < 2) return;
  const radius = Math.ceil(sigma * 3);
  const kernel = Array.from({ length: radius * 2 + 1 }, (_, i) => Math.exp(-((i - radius) ** 2) / (2 * sigma * sigma)));
  const total = kernel.reduce((a, b) => a + b, 0);
  const src = profile.slice(from * 3, to * 3);
  const n = to - from;
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

/** The median colour of a rectangle of a W-wide, 3-channel pixel buffer. */
function patch(px, W, x0, y0, x1, y1) {
  const ch = [[], [], []];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) for (let c = 0; c < 3; c++) ch[c].push(px[(y * W + x) * 3 + c]);
  return ch.map(median);
}

async function frame({ source, out, trim = {}, contentBottom, strip, gate, feather, smooth }) {
  const file = path.join(SOURCES, source);
  const meta = await sharp(file).metadata();
  const t = { left: 0, right: 0, top: 0, bottom: 0, ...trim };
  const tw = meta.width - t.left - t.right;
  const th = meta.height - t.top - t.bottom;

  let h = Math.min(FRAME.height, Math.round((FRAME.height * CONTENT_BOTTOM) / contentBottom));
  let w = Math.round((h * tw) / th);
  if (w > FRAME.width) {
    w = FRAME.width;
    h = Math.round((w * th) / tw);
  }

  const { data: poster } = await sharp(file)
    .extract({ left: t.left, top: t.top, width: tw, height: th })
    .resize(w, h, { kernel: 'lanczos3' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const W = FRAME.width;
  const H = FRAME.height;
  const left = Math.round((W - w) / 2);
  const px = Buffer.alloc(W * H * 3);
  const invented = new Uint8Array(W * H);

  for (let y = 0; y < h; y++) poster.copy(px, (y * W + left) * 3, y * w * 3, (y + 1) * w * 3);

  // 1. The table, carried on downwards under the poster: a per-column average of its bottom strip,
  //    smoothed a little across, repeated down the new band, with the light falling off gently
  //    towards the front edge as it would on a real table.
  if (h < H) {
    const rows = 12;
    const profile = new Float32Array(w * 3);
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let s = 0;
        for (let y = h - rows; y < h; y++) s += poster[(y * w + x) * 3 + c];
        profile[x * 3 + c] = s / rows;
      }
    }
    gaussRange(profile, 0, w, 4);
    const blend = 24;
    for (let y = h - blend; y < H; y++) {
      const inside = y < h;
      const k = inside ? smoothstep((y - (h - blend)) / blend) : 1;
      const falloff = inside ? 1 : 1 - 0.16 * ((y - h) / (H - h));
      for (let x = 0; x < w; x++) {
        const o = (y * W + left + x) * 3;
        for (let c = 0; c < 3; c++) {
          const surface = profile[x * 3 + c] * falloff;
          const current = inside ? px[o + c] : surface;
          px[o + c] = Math.round(current * (1 - k) + surface * k);
        }
        if (!inside) invented[y * W + left + x] = 1;
      }
    }
  }

  // 2. The wall and table, carried on sideways, from the poster as it now stands (table included,
  //    so the corners continue the table rather than inventing something of their own).
  const stripPx = Math.max(6, Math.round(w * strip));
  const sides = [
    { edge: left, dir: -1, pad: left },
    { edge: left + w - 1, dir: 1, pad: W - left - w },
  ];

  for (const { edge, dir, pad } of sides) {
    if (pad <= 0) continue;
    const inner = edge - dir * (stripPx - 1);
    const [x0, x1] = [Math.min(edge, inner), Math.max(edge, inner) + 1];

    // What bare wall and bare table look like on this side: its top corner and the foot.
    const corner = Math.max(8, Math.round(w * 0.03));
    const wallRef = patch(px, W, dir < 0 ? left : left + w - corner, 0, dir < 0 ? left + corner : left + w, corner);
    const tableRef = patch(px, W, x0, H - corner, x1, H);

    const profile = new Float32Array(H * 3);
    const known = new Uint8Array(H);
    for (let y = 0; y < H; y++) {
      const ch = [[], [], []];
      for (let x = x0; x < x1; x++) {
        const o = (y * W + x) * 3;
        const c = [px[o], px[o + 1], px[o + 2]];
        if (gate && dist(c, wallRef) > gate && dist(c, tableRef) > gate) continue;
        ch[0].push(c[0]);
        ch[1].push(c[1]);
        ch[2].push(c[2]);
      }
      if (ch[0].length >= Math.max(3, (x1 - x0) * 0.12)) {
        for (let c = 0; c < 3; c++) profile[y * 3 + c] = gate ? median(ch[c]) : ch[c].reduce((a, b) => a + b, 0) / ch[c].length;
        known[y] = 1;
      }
    }

    // Rows where nothing in the strip was bare wall or table borrow from the nearest rows that were.
    let last = -1;
    for (let y = 0; y <= H; y++) {
      if (y < H && !known[y]) continue;
      for (let g = last + 1; g < Math.min(y, H); g++) {
        const a = last >= 0 ? last : y;
        const b = y < H ? y : last;
        const k = a === b ? 0 : (g - a) / (b - a);
        for (let c = 0; c < 3; c++) profile[g * 3 + c] = profile[a * 3 + c] * (1 - k) + profile[b * 3 + c] * k;
      }
      last = y;
    }

    // The table's edge: the sharpest step in brightness in the lower part of the profile.
    let tableY = Math.round(H * 0.7);
    let best = 0;
    const lum = (y) => luma(profile[y * 3], profile[y * 3 + 1], profile[y * 3 + 2]);
    for (let y = Math.round(H * 0.4); y < Math.round(H * 0.85); y++) {
      let above = 0;
      let below = 0;
      for (let i = 1; i <= 10; i++) {
        above += lum(y - i);
        below += lum(y + i - 1);
      }
      const step = Math.abs(above - below) / 10;
      if (step > best) {
        best = step;
        tableY = y;
      }
    }
    gaussRange(profile, 0, tableY, smooth.wall);
    gaussRange(profile, tableY, H, smooth.table);

    for (let y = 0; y < H; y++) {
      // The margin itself, with a faint vignette towards its outer edge, the way light falls off
      // across a real wall.
      for (let i = 1; i <= pad; i++) {
        const x = edge + dir * i;
        const o = (y * W + x) * 3;
        const shade = 1 - 0.06 * smoothstep(i / pad);
        for (let c = 0; c < 3; c++) px[o + c] = Math.round(profile[y * 3 + c] * shade);
        invented[y * W + x] = 1;
      }
      // And the poster's own edge, eased into it.
      for (let i = 0; i < feather; i++) {
        const x = edge - dir * i;
        const o = (y * W + x) * 3;
        const k = smoothstep(1 - i / feather);
        for (let c = 0; c < 3; c++) px[o + c] = Math.round(px[o + c] * (1 - k) + profile[y * 3 + c] * k);
      }
    }
    console.log(`  ${dir < 0 ? 'left ' : 'right'} strip ${stripPx}px, table edge at ${(tableY / H * 100).toFixed(0)}%`);
  }

  // 3. Grain on everything invented, matched by eye to the photograph's own.
  for (let p = 0; p < W * H; p++) {
    if (!invented[p]) continue;
    const n = (Math.random() - 0.5) * 9;
    for (let c = 0; c < 3; c++) px[p * 3 + c] = Math.max(0, Math.min(255, Math.round(px[p * 3 + c] + n)));
  }

  await sharp(px, { raw: { width: W, height: H, channels: 3 } })
    .png({ compressionLevel: 9 })
    .toFile(path.join(OUT, out));

  console.log(`${out}  ${W}x${H}  poster ${w}x${h} at x=${left}  (from ${source})`);
}

for (const poster of POSTERS) await frame(poster);
