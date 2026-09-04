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

  // Anchored on the known publishing convention rather than on "ends in .webp": the admin store
  // serves .webp too, from a path where no -420 sibling was ever written.
  const match = /^(\/images\/[a-z0-9-]+-(?:front|back))\.webp$/i.exec(url);
  return match ? `${match[1]}-${PACK_SHOT_THUMBNAIL_WIDTH}.webp` : url;
}
