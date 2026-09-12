import {
  LEGACY_CATEGORY_NAMES,
  PRODUCT_CATEGORIES,
  PRODUCT_CATEGORY_DETAILS,
  isProductCategory,
  normalizeCategory,
} from './product-categories';

describe('product categories', () => {
  it('translates every retired category into one that exists', () => {
    expect(normalizeCategory('Flour')).toBe('Everyday Flours');
    expect(normalizeCategory('Premium Atta')).toBe('Everyday Flours');
    expect(normalizeCategory('Grains')).toBe('Health & Breakfast');
    expect(normalizeCategory('Health Mix')).toBe('Health & Breakfast');
    expect(normalizeCategory('Powder Box')).toBe('Baking & Desserts');

    for (const target of Object.values(LEGACY_CATEGORY_NAMES)) {
      expect(isProductCategory(target)).toBeTrue();
    }
  });

  it('leaves current categories, and anything it does not recognise, as they are', () => {
    expect(normalizeCategory('Upwas')).toBe('Upwas');
    expect(normalizeCategory(' Spices & Essentials ')).toBe('Spices & Essentials');
    expect(normalizeCategory('Something New')).toBe('Something New');
    expect(normalizeCategory(null)).toBe('');
  });

  it('has an icon, a short line and a sentence for every category, in shop order', () => {
    expect(PRODUCT_CATEGORY_DETAILS.map((c) => c.name)).toEqual([...PRODUCT_CATEGORIES]);
    for (const c of PRODUCT_CATEGORY_DETAILS) {
      expect(c.icon).toBeTruthy();
      expect(c.desc.length).toBeGreaterThan(5);
      expect(c.blurb.length).toBeGreaterThan(30);
    }
  });
});
