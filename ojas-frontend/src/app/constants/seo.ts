import { COUPONS, FREE_DELIVERY_CART_THRESHOLD } from './pricing';

/**
 * How the shop describes itself to search engines and to link previews (WhatsApp, Instagram).
 *
 * Every page used to share one title and one description, "Ojas - शुद्ध आहार...शुद्ध विचार", so
 * Google was told the jowar flour page and the refund policy were the same page, and neither
 * said "atta", "flour" or "Pune" — the words people actually search. SeoService applies these.
 *
 * Product and category wording lives in product-seo.ts, which only the shop's own pages load.
 */

/**
 * The one address Google should know the shop by. The bare domain 308-redirects here, so a
 * canonical tag or share link naming the bare form would point at a redirect.
 */
export const SITE_URL = 'https://www.ojasaata.com';

/** The owner's 2:1 range poster — the picture a shared link shows when a page has no own. */
export const SHARE_IMAGE = `${SITE_URL}/images/hero-banner-framed-1280.jpg`;
export const SHARE_IMAGE_WIDTH = 1280;
export const SHARE_IMAGE_HEIGHT = 640;

/** Matches the @id of the OnlineStore block in index.html, so product markup can name its seller. */
export const ORGANIZATION_ID = `${SITE_URL}/#organization`;

export interface PageSeo {
  title: string;
  description: string;
  /**
   * The site-relative address (with any query that belongs to it) this page should be indexed
   * under. Defaults to the current path with no query, which strips sort and filter parameters.
   */
  canonicalPath?: string;
  /** An absolute image URL for link previews. Defaults to SHARE_IMAGE. */
  image?: string;
  type?: 'website' | 'product';
  /** Keep this page out of search results altogether. */
  noindex?: boolean;
  /** Structured data for this page alone. The organisation and website blocks live in index.html. */
  jsonLd?: readonly Record<string, unknown>[];
}

/**
 * Route data value for a page that sets its own SEO because it depends on what it loads — a
 * product, a category, a policy. SeoService leaves those alone on navigation.
 */
export const SEO_SET_BY_PAGE = 'page';

/**
 * The home page. KEEP IN STEP WITH index.html, whose <title> and description are what a link
 * previewer and the first crawl read before any of this runs.
 */
export const HOME_SEO: PageSeo = {
  title: 'Ojas Aata – Stone-Ground Atta, Modak Peeth & Upwas Flours in Pune',
  description:
    'Ojas (ओजस्) makes chakki-fresh jowar, bajra, ragi and rice flour, modak peeth, anarase pith ' +
    'and upwas flours in Pune since 2007. Order online, delivered in 1–2 days.',
};

export const ABOUT_SEO: PageSeo = {
  title: 'About Ojas – Stone-Ground Flours from a Pune Farming Family',
  description:
    'Ojas began as one small stone-chakki outlet in Pune and is now stocked in over 1,200 retail ' +
    'outlets. Grain chosen the way a farmer would, ground on a chakki, with no additives or ' +
    'preservatives.',
};

/** Read from the coupon table itself, so this can never advertise a coupon checkout refuses. */
function offersDescription(): string {
  const coupons = [...COUPONS]
    .sort((a, b) => a.minCartValue - b.minCartValue)
    .map((c) => `${c.discountPercentage}% off orders over ₹${c.minCartValue.toLocaleString('en-IN')}`);
  const delivery = `free delivery in Pune on orders over ₹${FREE_DELIVERY_CART_THRESHOLD}`;
  return coupons.length
    ? `Ojas coupons: ${coupons.join(' and ')}, plus ${delivery}.`
    : `Ojas offers ${delivery}.`;
}

export const OFFERS_SEO: PageSeo = {
  title: 'Offers & Coupons – Ojas, Pune',
  description: offersDescription(),
};

export const NOT_FOUND_SEO: PageSeo = {
  title: 'Page not found – Ojas',
  description: 'This page is not on the Ojas shop. Browse our stone-ground flours instead.',
  noindex: true,
};

/**
 * Sign-in, cart, checkout, account and staff screens: nothing a search result should lead to.
 * robots.txt keeps crawlers off them as well; this covers any link that reaches one anyway.
 */
export const PRIVATE_PAGE_SEO: PageSeo = {
  title: 'Ojas – शुद्ध आहार… शुद्ध विचार',
  description: HOME_SEO.description,
  noindex: true,
};

/**
 * What a route's `data.seo` holds: a key naming one of the pages below, or SEO_SET_BY_PAGE.
 *
 * A key rather than the copy itself because the route table is in the first download every
 * visitor makes, and the budget for that download is tight. With keys it carries a word per
 * route; this file and SeoService load in a chunk of their own once the app has started.
 */
export type RouteSeoKey = 'home' | 'about' | 'offers' | 'not-found' | typeof SEO_SET_BY_PAGE;

export const ROUTE_SEO: Readonly<Record<Exclude<RouteSeoKey, typeof SEO_SET_BY_PAGE>, PageSeo>> = {
  home: HOME_SEO,
  about: ABOUT_SEO,
  offers: OFFERS_SEO,
  'not-found': NOT_FOUND_SEO,
};

/** A site-relative path made absolute on the canonical host. Absolute URLs pass through. */
export function absoluteUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return SITE_URL + (pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`);
}
