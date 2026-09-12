/**
 * The aisles of the shop.
 *
 * These were Flour, Grains, Health Mix, Upwas, Premium Atta and Powder Box until September 2026,
 * and three of those were wrong in ways a shopper could see. Premium Atta had no products in it at
 * all, so its chip led to "No products found". Grains held one product, wheat daliya. And Powder
 * Box described the packaging rather than what is inside it: custard, corn flour, baking soda,
 * salts and spice powders are four different aisles on any grocery site, and nobody looking for
 * cinnamon thinks to open a box called Powder Box.
 *
 * The replacement follows the way BigBasket and Blinkit group the same goods: everyday flours
 * apart from festive ones, a fasting aisle, a breakfast-and-health aisle, baking, and spices.
 * The API moves existing products across on boot (ProductService.RecategoriseCatalogueAsync), and
 * `normalizeCategory` below covers the gap until it has.
 *
 * 'Upwas' keeps its old name deliberately. It is already in campaign links the owner has
 * published, and it is the word customers here use.
 */
export const PRODUCT_CATEGORIES = [
  'Everyday Flours',
  'Traditional & Festive',
  'Upwas',
  'Health & Breakfast',
  'Baking & Desserts',
  'Spices & Essentials',
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

/**
 * Where each retired category went. Used for products the API has not moved yet and, just as
 * importantly, for links: a campaign button or a bookmark pointing at `?category=Flour` still
 * lands somewhere sensible instead of on an unfiltered shop.
 */
export const LEGACY_CATEGORY_NAMES: Readonly<Record<string, ProductCategory>> = {
  Flour: 'Everyday Flours',
  'Premium Atta': 'Everyday Flours',
  Grains: 'Health & Breakfast',
  'Health Mix': 'Health & Breakfast',
  'Powder Box': 'Baking & Desserts',
};

/** A category as the storefront files it: retired names are translated, anything else kept. */
export function normalizeCategory(category: string | null | undefined): string {
  const trimmed = (category ?? '').trim();
  return LEGACY_CATEGORY_NAMES[trimmed] ?? trimmed;
}

export function isProductCategory(value: string): value is ProductCategory {
  return (PRODUCT_CATEGORIES as readonly string[]).includes(value);
}

export interface ProductCategoryDetail {
  name: ProductCategory;
  icon: string;
  /** A few words, for tiles and chips. */
  desc: string;
  /** A sentence, for the top of the products page when this aisle is open. */
  blurb: string;
}

// Single source of truth for category icon/description, shared by the home page's category
// section, the header's category menus and the products page so they stay in sync.
export const PRODUCT_CATEGORY_DETAILS: ProductCategoryDetail[] = [
  {
    name: 'Everyday Flours',
    icon: 'grain',
    desc: 'Jowar, bajra, ragi & rice',
    blurb: 'Stone-ground millet and rice flours for everyday rotis, bhakris and dosas.',
  },
  {
    name: 'Traditional & Festive',
    icon: 'celebration',
    desc: 'Modak, anarase & more',
    blurb: 'Flours for modak, anarase and the Maharashtrian classics made for festivals.',
  },
  {
    name: 'Upwas',
    icon: 'self_improvement',
    desc: 'Fasting friendly',
    blurb: 'Grain-free flours for your fasting days: rajgira, shingada, kuttu and more.',
  },
  {
    name: 'Health & Breakfast',
    icon: 'breakfast_dining',
    desc: 'Sattu, ragi malt & daliya',
    blurb: 'Chana sattu, sprouted ragi malt and daliya for a nourishing start to the day.',
  },
  {
    name: 'Baking & Desserts',
    icon: 'cake',
    desc: 'Custard & corn flour',
    blurb: 'Custard powders, corn flour and baking staples for the sweet side of the kitchen.',
  },
  {
    name: 'Spices & Essentials',
    icon: 'soup_kitchen',
    desc: 'Salts & spice powders',
    blurb: 'Salts, spice powders and the small things every kitchen runs out of.',
  },
];

export function categoryDetail(name: string): ProductCategoryDetail | undefined {
  return PRODUCT_CATEGORY_DETAILS.find((c) => c.name === name);
}
