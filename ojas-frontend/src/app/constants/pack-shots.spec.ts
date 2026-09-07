import {
  PACK_SHOT_MEDIUM_WIDTH,
  PACK_SHOT_REVISION,
  PACK_SHOT_THUMBNAIL_WIDTH,
  packShotSrc,
  packShotSrcset,
  thumbnailPackShot,
} from './pack-shots';

describe('thumbnailPackShot', () => {
  it('points a committed pack shot at its card-sized variant', () => {
    expect(thumbnailPackShot('/images/bajra-flour-front.webp')).toBe(
      '/images/bajra-flour-front-420.webp',
    );
    expect(thumbnailPackShot('/images/upvas-bhajani-back.webp')).toBe(
      '/images/upvas-bhajani-back-420.webp',
    );
  });

  /**
   * The variants only exist for the committed pack shots. A product photographed and uploaded
   * through the admin screens is stored content-addressed under /api/media/ and has no sibling —
   * inventing one would 404 and leave a hole where the picture should be, which is worse than
   * serving an image that is merely bigger than it needs to be.
   */
  it('leaves anything without a generated variant exactly as it is', () => {
    const uploaded = '/api/media/' + 'a'.repeat(64) + '.webp';
    expect(thumbnailPackShot(uploaded)).toBe(uploaded);

    expect(thumbnailPackShot('/images/placeholder.svg')).toBe('/images/placeholder.svg');
    expect(thumbnailPackShot('/images/hero-banner-1280.jpg')).toBe('/images/hero-banner-1280.jpg');
    expect(thumbnailPackShot('https://example.com/pack-front.webp')).toBe(
      'https://example.com/pack-front.webp',
    );
    expect(thumbnailPackShot('data:image/webp;base64,AAAA')).toBe('data:image/webp;base64,AAAA');
  });

  /** A product withdrawn from the catalogue has no image at all, and the templates draw a plain
   * tile for that rather than a broken one. */
  it('answers empty for a missing image rather than producing a broken URL', () => {
    expect(thumbnailPackShot(null)).toBe('');
    expect(thumbnailPackShot(undefined)).toBe('');
    expect(thumbnailPackShot('')).toBe('');
  });

  /** Already a variant, so it must not gain a second suffix — which is what a re-run of the
   * image tool over its own output would otherwise produce a name for. */
  it('does not re-suffix a variant it has already produced', () => {
    const variant = '/images/bajra-flour-front-420.webp';
    expect(thumbnailPackShot(variant)).toBe(variant);
  });

  /** The widths here and PACK_SHOT_WIDTH / PACK_SHOT_MEDIUM_WIDTH in tools/optimize-images.mjs
   * name the same files. If they ever disagree, every thumbnail on the site 404s, so it is worth
   * two assertions. */
  it('asks for the widths the image tool actually publishes', () => {
    expect(PACK_SHOT_THUMBNAIL_WIDTH).toBe(420);
    expect(PACK_SHOT_MEDIUM_WIDTH).toBe(900);
  });

  /**
   * Products carry a revision on their image URL (see packShotSrc), and the thumbnail has to be
   * the small file at the SAME revision — not the full-size one because a query string was in the
   * way, which is what a regex anchored on the end of the string would have done.
   */
  it('keeps the revision when it swaps in the small variant', () => {
    expect(thumbnailPackShot(packShotSrc('/images/bajra-flour-front.webp'))).toBe(
      '/images/bajra-flour-front-420.webp?v=' + PACK_SHOT_REVISION,
    );
  });
});

describe('packShotSrc', () => {
  /**
   * The pack shots keep stable filenames because those URLs are stored against every product in
   * the database. Without a revision, replacing what one of those files CONTAINS is invisible to
   * every customer who has been to the shop in the last day — and, behind the
   * stale-while-revalidate window, for up to a week after that. New photography that most visitors
   * cannot see is not shipped photography.
   */
  it('stamps a committed pack shot with the current revision', () => {
    expect(packShotSrc('/images/bajra-flour-front.webp')).toBe(
      '/images/bajra-flour-front.webp?v=' + PACK_SHOT_REVISION,
    );
    expect(packShotSrc('/images/bajra-flour-front-420.webp')).toBe(
      '/images/bajra-flour-front-420.webp?v=' + PACK_SHOT_REVISION,
    );
  });

  /** Admin uploads are already content-addressed by hash, so a revision on one of those would
   * throw away a year of caching to solve a problem it does not have. */
  it('leaves anything that is not a committed pack shot alone', () => {
    const uploaded = '/api/media/' + 'a'.repeat(64) + '.webp';
    expect(packShotSrc(uploaded)).toBe(uploaded);
    expect(packShotSrc('/images/placeholder.svg')).toBe('/images/placeholder.svg');
    expect(packShotSrc('https://example.com/pack-front.webp')).toBe(
      'https://example.com/pack-front.webp',
    );
    expect(packShotSrc(null)).toBe('');
  });
});

describe('packShotSrcset', () => {
  /** The well on the product page is a few hundred pixels wide; the 2000px file exists so the
   * lightbox can be zoomed into. Offering the browser the middle width is what stops it spending
   * 120KB on a box that a third of that fills. */
  it('offers every published width, carrying the revision on each', () => {
    const v = PACK_SHOT_REVISION;
    expect(packShotSrcset(packShotSrc('/images/bajra-flour-front.webp'))).toBe(
      '/images/bajra-flour-front-420.webp?v=' + v + ' 420w, ' +
        '/images/bajra-flour-front-900.webp?v=' + v + ' 900w, ' +
        '/images/bajra-flour-front.webp?v=' + v + ' 2000w',
    );
  });

  /** Empty, not a guess. An admin upload has no generated widths, and naming files that were
   * never written would have the browser fetch a 404 in preference to the picture that exists. */
  it('answers empty for anything without generated widths', () => {
    expect(packShotSrcset('/api/media/' + 'a'.repeat(64) + '.webp')).toBe('');
    expect(packShotSrcset('/images/placeholder.svg')).toBe('');
    expect(packShotSrcset('')).toBe('');
    expect(packShotSrcset(null)).toBe('');
  });
});
