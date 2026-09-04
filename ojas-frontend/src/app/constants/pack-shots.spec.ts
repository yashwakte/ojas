import { PACK_SHOT_THUMBNAIL_WIDTH, thumbnailPackShot } from './pack-shots';

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

  /** The width here and PACK_SHOT_WIDTH in tools/optimize-images.mjs name the same files. If they
   * ever disagree, every thumbnail on the site 404s, so it is worth one assertion. */
  it('asks for the width the image tool actually publishes', () => {
    expect(PACK_SHOT_THUMBNAIL_WIDTH).toBe(420);
  });
});
