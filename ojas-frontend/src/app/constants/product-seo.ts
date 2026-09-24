import {
  Product,
  deliveryDaysLabel,
  effectivePrice,
  isPurchasable,
} from '../models/interfaces';
import { BRAND_NAME } from './business';
import { ProductCategory, isProductCategory } from './product-categories';
import { ORGANIZATION_ID, PageSeo, SITE_URL, absoluteUrl } from './seo';

/**
 * What a product or aisle page tells search engines.
 *
 * The catalogue names its products in English ("Sorghum Flour"), but nobody in Pune searches for
 * sorghum: they type jowar atta, or ज्वारी पीठ. So each title carries the name on the listing, the
 * name people say, and the Marathi printed on the pack — and the competitors who rank for
 * "modak peeth" spell it that way, which is why the pack's own "Pith" is joined by "Peeth".
 */

interface LocalName {
  /** As printed on the front of the Ojas pack. */
  marathi: string;
  /** The everyday name, where it differs from the listing's. */
  also?: string;
}

/**
 * Keyed by the product's name, lower-cased. The Marathi was read off the pack photographs in
 * September 2026 — do not add a name here without seeing it on a pack, because a misspelt word in
 * a title is published to everyone who searches for it. A product not listed here simply goes
 * without; nothing else depends on it.
 */
const LOCAL_NAMES: Readonly<Record<string, LocalName>> = {
  'modak pith': { marathi: 'मोदक पीठ', also: 'Modak Peeth' },
  'anarasa flour': { marathi: 'अनारसे पीठ', also: 'Anarse Pith' },
  'upvas bhajani': { marathi: 'उपवास भाजणी', also: 'Upwas Bhajani' },
  'rajgira (amaranth) flour': { marathi: 'राजगिरा पीठ' },
  'shingada flour': { marathi: 'शिंगाडा पीठ', also: 'Singhara Atta' },
  'buckwheat flour': { marathi: 'कुट्टू आटा', also: 'Kuttu Atta' },
  'sorghum flour': { marathi: 'ज्वारी पीठ', also: 'Jowar Atta' },
  'bajra flour': { marathi: 'बाजरी पीठ', also: 'Bajri Atta' },
  'ragi flour': { marathi: 'नाचणी पीठ', also: 'Nachni Atta' },
  'rice flour': { marathi: 'तांदूळ पीठ', also: 'Tandul Pith' },
  'wheat daliya': { marathi: 'गहू दलिया', also: 'Broken Wheat' },
  'ragi malt (sprouted)': { marathi: 'नाचणी सत्व' },
  'chana sattu': { marathi: 'चना सात्तू', also: 'Roasted Gram Flour' },
};

export function localNameFor(productName: string): LocalName | undefined {
  return LOCAL_NAMES[productName.trim().toLowerCase()];
}

/** A product's path on the storefront: its readable slug, or its id until it has one. */
export function productPath(product: Pick<Product, 'id' | 'slug'>): string {
  return `/products/${encodeURIComponent(product.slug || product.id)}`;
}

/** "500g" reads "500 g" in a title; anything else is left as the listing wrote it. */
export function formatWeight(weight: string): string {
  return (weight ?? '').trim().replace(/^(\d+(?:\.\d+)?)\s*(g|kg|ml|l)$/i, '$1 $2');
}

function rupees(amount: number): string {
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

/** "Modak Pith (Modak Peeth) 500 g – मोदक पीठ | Ojas, Pune" */
export function productSeoTitle(product: Product): string {
  const local = localNameFor(product.name);
  const also = local?.also ? ` (${local.also})` : '';
  const marathi = local ? ` – ${local.marathi}` : '';
  return `${product.name}${also} ${formatWeight(product.weight)}${marathi} | ${BRAND_NAME}, Pune`;
}

export function productSeoDescription(product: Product): string {
  const local = localNameFor(product.name);
  const lead = local ? `${product.name} (${local.marathi})` : product.name;
  const body = product.description.trim().replace(/\s+/g, ' ');
  const pack = `${formatWeight(product.weight)} pack, ₹${rupees(effectivePrice(product))}.`;
  return `${lead} – ${body} ${pack} Order online from ${BRAND_NAME}; delivered across Pune in ${deliveryDaysLabel()}.`;
}

/** An aisle's address. The sitemap writes the same encoding, so the two always agree. */
export function categoryPath(category: string): string {
  return `/products?category=${encodeURIComponent(category)}`;
}

/**
 * The product and its breadcrumb, as Google's merchant listings read them.
 *
 * Price and stock are taken from the same helpers the page and the cart use, so what a search
 * result shows is what the checkout charges. Shipping is deliberately absent: delivery here is
 * priced by distance within 25 km of Sangvi, and Google can only describe an Indian delivery area
 * by country and state — it would tell a shopper in Mumbai we deliver to them. The return policy
 * is declared once for the whole shop, on the organisation block in index.html.
 */
export function productJsonLd(
  product: Product,
  rating?: { average: number; count: number } | null,
): Record<string, unknown>[] {
  const url = SITE_URL + productPath(product);
  const local = localNameFor(product.name);
  const alternateNames = [local?.marathi, local?.also].filter((n): n is string => !!n);
  const images = [product.imageUrl, ...(product.galleryImageUrls ?? [])]
    .filter((src) => !!src && !src.startsWith('data:'))
    .map(absoluteUrl);

  const productBlock: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    '@id': `${url}#product`,
    name: product.name,
    ...(alternateNames.length ? { alternateName: alternateNames } : {}),
    description: product.description,
    image: images,
    sku: product.id,
    brand: { '@type': 'Brand', name: BRAND_NAME },
    manufacturer: { '@id': ORGANIZATION_ID },
    category: product.category,
    size: formatWeight(product.weight),
    offers: {
      '@type': 'Offer',
      url,
      priceCurrency: 'INR',
      price: effectivePrice(product).toFixed(2),
      availability: isPurchasable(product)
        ? 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock',
      itemCondition: 'https://schema.org/NewCondition',
      seller: { '@id': ORGANIZATION_ID },
    },
    // Star ratings in search results. Only once a real review exists: the reviews are verified
    // purchases shown on this same page, which is what Google requires of a rating it displays.
    ...(rating && rating.count > 0
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: rating.average.toFixed(1),
            reviewCount: rating.count,
            bestRating: 5,
            worstRating: 1,
          },
        }
      : {}),
  };

  // Mirrors the breadcrumb drawn at the top of the product page: Home › Products › aisle › product.
  const crumbs: Record<string, unknown>[] = [
    { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/` },
    { '@type': 'ListItem', position: 2, name: 'Products', item: `${SITE_URL}/products` },
  ];
  if (isProductCategory(product.category)) {
    crumbs.push({
      '@type': 'ListItem',
      position: 3,
      name: product.category,
      item: SITE_URL + categoryPath(product.category),
    });
  }
  crumbs.push({ '@type': 'ListItem', position: crumbs.length + 1, name: product.name });

  return [
    productBlock,
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: crumbs },
  ];
}

/** For an address that is not a product. Kept out of the index, as NOT_FOUND_SEO is. */
export const PRODUCT_NOT_FOUND_SEO: PageSeo = {
  title: 'Product not found – Ojas',
  description: 'This product is not on the Ojas shop. Browse our stone-ground flours instead.',
  noindex: true,
};

export function productPageSeo(
  product: Product,
  rating?: { average: number; count: number } | null,
): PageSeo {
  const image = product.imageUrl && !product.imageUrl.startsWith('data:')
    ? absoluteUrl(product.imageUrl)
    : undefined;
  return {
    title: productSeoTitle(product),
    description: productSeoDescription(product),
    canonicalPath: productPath(product),
    image,
    type: 'product',
    jsonLd: productJsonLd(product, rating),
  };
}

/**
 * Each aisle's title leads with what people type — "modak peeth", "rajgira", "jowar" — rather than
 * the aisle's shop name, which nobody searches for.
 */
const CATEGORY_SEO: Readonly<Record<ProductCategory, Pick<PageSeo, 'title' | 'description'>>> = {
  'Everyday Flours': {
    title: 'Jowar, Bajra, Ragi & Rice Flour Online in Pune | Ojas',
    description:
      'Stone-ground jowar (ज्वारी), bajra (बाजरी), ragi (नाचणी) and rice (तांदूळ) flour for everyday ' +
      'bhakri, roti and dosa. Chakki-fresh Ojas flours, delivered across Pune in 1–2 days.',
  },
  'Traditional & Festive': {
    title: 'Modak Peeth & Anarase Pith Online in Pune | Ojas',
    description:
      'Ukadiche modak peeth (मोदक पीठ) and anarase pith (अनारसे पीठ) for Ganeshotsav, Diwali and ' +
      'every festival, made the traditional Maharashtrian way. Delivered across Pune in 1–2 days.',
  },
  Upwas: {
    title: 'Upwas Flours – Rajgira, Shingada, Kuttu & Bhajani | Ojas',
    description:
      'Fasting-friendly उपवास flours: rajgira (राजगिरा), shingada (शिंगाडा), kuttu (कुट्टू) and ' +
      'upwas bhajani for Navratri, Ekadashi and every upwas day. Delivered across Pune in 1–2 days.',
  },
  'Health & Nutrition': {
    title: 'Chana Sattu, Ragi Malt & Wheat Daliya Online in Pune | Ojas',
    description:
      'Chana sattu, sprouted ragi malt (नाचणी सत्व) and wheat daliya, wholesome at any meal from ' +
      'breakfast to dinner. From Ojas, delivered across Pune in 1–2 days.',
  },
  'Baking & Desserts': {
    title: 'Custard Powder & Corn Flour Online in Pune | Ojas',
    description:
      'Ojas custard powders and corn flour for fruit custard, puddings and baking. Delivered across ' +
      'Pune in 1–2 days.',
  },
  'Spices & Essentials': {
    title: 'Salts & Spice Powders Online in Pune | Ojas',
    description:
      'Rock salt, black salt and everyday spice powders from Ojas. Delivered across Pune in 1–2 days.',
  },
};

const ALL_PRODUCTS_SEO: Pick<PageSeo, 'title' | 'description'> = {
  title: 'Buy Stone-Ground Flours & Atta Online in Pune | Ojas',
  description:
    'The full Ojas range: jowar, bajra, ragi and rice flour, modak peeth, anarase pith, upwas ' +
    'flours, chana sattu, ragi malt, daliya and custard powders. Delivered across Pune in 1–2 days.',
};

/**
 * The products page, for one aisle or for all of them. A search (?q=) is kept out of the index —
 * Google treats a shop's own search results as thin duplicates of its real pages — and sort and
 * filter parameters never reach the canonical address.
 */
export function productsPageSeo(category: string, query: string): PageSeo {
  const aisle = isProductCategory(category) ? category : null;
  const copy = aisle ? CATEGORY_SEO[aisle] : ALL_PRODUCTS_SEO;
  return {
    ...copy,
    canonicalPath: aisle ? categoryPath(aisle) : '/products',
    noindex: query.trim().length > 0,
  };
}
