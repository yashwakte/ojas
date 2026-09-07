/**
 * Picking the right size of pack shot for where it is being shown.
 *
 * The client photographed every pack front and back, and those pictures are published at
 * 1200x800 — which is the right size for the product page and the lightbox, where someone is
 * actually reading the label. It is emphatically the wrong size for a product card a couple of
 * hundred pixels wide, and the products grid was loading thirty-odd of them at roughly 65 KB
 * each: about two megabytes of photography to draw a page of thumbnails. On a phone on mobile
 * data that is most of why the storefront took a long time to fill in, and why cards below the
 * fold could still be blank when a customer gave up and reloaded.
 *
 * `npm run images:optimize` writes a `-420` sibling next to every pack shot (about 12 KB each),
 * and this is what points a thumbnail at it.
 */

/** The width the small variants are published at, and the only one that exists. Kept in step with
 * PACK_SHOT_WIDTH in tools/optimize-images.mjs — if that changes, this must too, and the two are
 * checked against each other by pack-shots.spec.ts. */
export const PACK_SHOT_THUMBNAIL_WIDTH = 420;

/** The width the product page's image well is served at. Kept in step with
 * PACK_SHOT_MEDIUM_WIDTH in tools/optimize-images.mjs. */
export const PACK_SHOT_MEDIUM_WIDTH = 900;

/**
 * The thumbnail-sized version of a pack shot, or the original URL unchanged when there isn't one.
 *
 * Only the committed pack shots under `/images/` have variants. Everything else — a product
 * photographed and uploaded through the admin screens, which is stored content-addressed under
 * `/api/media/`, an absolute URL, an inline data: image — is returned exactly as given. Guessing a
 * variant for those would produce a 404 and a card with a hole in it, which is worse than a
 * picture that is merely larger than it needs to be.
 */
export function thumbnailPackShot(url: string | null | undefined): string {
  if (!url) return '';

  const [path, query] = splitQuery(url);
  // Anchored on the known publishing convention rather than on "ends in .webp": the admin store
  // serves .webp too, from a path where no -420 sibling was ever written.
  const match = /^(\/images\/[a-z0-9-]+-(?:front|back))\.webp$/i.exec(path);
  return match ? `${match[1]}-${PACK_SHOT_THUMBNAIL_WIDTH}.webp${query}` : url;
}

/**
 * The revision of the committed pack shots, bumped by hand whenever they are re-generated.
 *
 * The pack shots keep stable filenames — `/images/bajra-flour-front.webp` — because those URLs are
 * stored against every product in the database, and content-addressed names would mean rewriting
 * every one of those rows on every re-shoot. Stable names have one cost, and it bites exactly when
 * the photographs are replaced: those files are served `max-age=86400, stale-while-revalidate`,
 * so a customer who has been to the shop in the last day keeps seeing the OLD picture from their
 * own cache, and does so for up to a week while the new one revalidates behind them. New
 * photography that most visitors cannot see is not shipped photography.
 *
 * A revision in the query string is the standard answer and costs nothing: it changes the cache
 * key, so the new file is fetched once, and it stays stable afterwards so the year-long caching
 * this exists to protect still applies to every subsequent visit.
 *
 * BUMP THIS whenever `npm run images:optimize` changes what a pack shot contains. Leaving it
 * unchanged after a re-shoot is the failure mode; changing it needlessly only costs one refetch.
 */
export const PACK_SHOT_REVISION = '20260907';

/**
 * A pack-shot URL with the current revision on it. Anything that is not one of the committed pack
 * shots — an admin upload under /api/media, an absolute URL, a data: image — is handed back
 * untouched, because those are already content-addressed and versioning them would defeat their
 * caching rather than help it.
 */
export function packShotSrc(url: string | null | undefined): string {
  if (!url) return '';
  if (!/^\/images\/[a-z0-9-]+-(?:front|back)(?:-\d+)?\.webp$/i.test(url)) return url;
  return `${url}?v=${PACK_SHOT_REVISION}`;
}

/** Splits a URL into its path and its query (including the "?"), so a variant name can be built
 * from the path without losing the revision that follows it. */
function splitQuery(url: string): [string, string] {
  const at = url.indexOf('?');
  return at === -1 ? [url, ''] : [url.slice(0, at), url.slice(at)];
}

/**
 * A `srcset` for a pack shot, letting the browser pick the smallest file that will still look
 * sharp in the box it is going into.
 *
 * The product page used to hand its image well the full-size file unconditionally. That file
 * exists for the lightbox, where somebody is zooming in to read a pack's printing; the well behind
 * it is 576px on a desktop and under 400 on a phone, so it was spending around 120KB to fill a box
 * that a third of that would have filled — on the exact screen a customer reaches by tapping a
 * product and then waits on.
 *
 * Returns an empty string for anything that is not a committed pack shot, and the caller leaves
 * `srcset` off entirely in that case: an admin upload has no generated widths, and naming ones
 * that do not exist would have the browser fetch a 404 in preference to the picture.
 */
export function packShotSrcset(url: string | null | undefined): string {
  if (!url) return '';
  const [path, query] = splitQuery(url);
  const match = /^(\/images\/[a-z0-9-]+-(?:front|back))\.webp$/i.exec(path);
  if (!match) return '';
  const base = match[1];
  return [
    `${base}-${PACK_SHOT_THUMBNAIL_WIDTH}.webp${query} ${PACK_SHOT_THUMBNAIL_WIDTH}w`,
    `${base}-${PACK_SHOT_MEDIUM_WIDTH}.webp${query} ${PACK_SHOT_MEDIUM_WIDTH}w`,
    `${base}.webp${query} 2000w`,
  ].join(', ');
}
