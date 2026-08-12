export const PRODUCT_CATEGORIES = [
  'Flour',
  'Grains',
  'Health Mix',
  'Upwas',
  'Premium Atta',
  'Powder Box',
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];
