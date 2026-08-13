export const PRODUCT_CATEGORIES = [
  'Flour',
  'Grains',
  'Health Mix',
  'Upwas',
  'Premium Atta',
  'Powder Box',
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export interface ProductCategoryDetail {
  name: ProductCategory;
  icon: string;
  desc: string;
}

// Single source of truth for category icon/description, shared by the home page's
// category section and the header's mobile categories sheet so they stay in sync.
export const PRODUCT_CATEGORY_DETAILS: ProductCategoryDetail[] = [
  { name: 'Flour', icon: 'grain', desc: 'Stone-ground daily' },
  { name: 'Grains', icon: 'rice_bowl', desc: 'Whole grain goodness' },
  { name: 'Health Mix', icon: 'favorite', desc: 'Nutrient-rich blends' },
  { name: 'Upwas', icon: 'self_improvement', desc: 'Fasting friendly' },
  { name: 'Premium Atta', icon: 'bakery_dining', desc: 'Everyday rotis & bhakris' },
  { name: 'Powder Box', icon: 'science', desc: 'Kitchen essentials' },
];
