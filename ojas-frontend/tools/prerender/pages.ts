/**
 * What each public page says before the app has started: the words a search engine, an AI
 * crawler or a link previewer reads in the HTML as served.
 *
 * The storefront draws everything in the browser, so until this existed every address on the
 * site answered with the same empty shell and the home page's title. Google's 7 October 2026
 * report — "Duplicate without user-selected canonical" — was that: dozens of addresses that
 * looked like one page until a renderer had run the app and waited on an API that sleeps when
 * idle, and the crawlers behind ChatGPT, Perplexity and Claude, which do not run JavaScript at
 * all, saw nothing but the home page for every product.
 *
 * Nothing here is new copy. Titles, descriptions and structured data come from the same
 * functions the running app calls (constants/seo.ts, constants/product-seo.ts); the About and
 * policy text comes from the same files their pages render; prices and stock from the same
 * helpers the cart uses. So the page a crawler reads is the page a customer is about to see.
 *
 * Bundled and run by tools/prerender.mjs after `ng build`. It runs in Node, so it imports only
 * plain data and functions — never a component or a service.
 */
import {
  BUSINESS_NAME,
  FSSAI_LICENCE_NUMBER,
  INSTAGRAM_URL,
  REGISTERED_ADDRESS,
  RETURN_WINDOW_DAYS,
  SUPPORT_EMAIL,
  SUPPORT_HOURS,
  SUPPORT_PHONE,
  SUPPORT_PHONE_HREF,
} from '../../src/app/constants/business';
import { COUPONS, FREE_DELIVERY_CART_THRESHOLD } from '../../src/app/constants/pricing';
import {
  PRODUCT_CATEGORIES,
  PRODUCT_CATEGORY_DETAILS,
  ProductCategory,
  normalizeCategory,
} from '../../src/app/constants/product-categories';
import {
  categoryPath,
  formatWeight,
  localNameFor,
  productPageSeo,
  productPath,
  productsPageSeo,
} from '../../src/app/constants/product-seo';
import { ABOUT_SEO, HOME_SEO, OFFERS_SEO, PageSeo, SITE_URL } from '../../src/app/constants/seo';
import {
  Product,
  ProductReview,
  deliveryDaysLabel,
  effectivePrice,
  isPurchasable,
} from '../../src/app/models/interfaces';
import {
  ABOUT_COMPANY_INTRO,
  ABOUT_MILESTONES,
  ABOUT_STORY,
  ABOUT_STORY_HEADING,
  ABOUT_TAGLINE,
  ABOUT_VALUES,
} from '../../src/app/pages/about/about-content';
import { LEGAL_DOCUMENTS, POLICY_LAST_UPDATED } from '../../src/app/pages/legal/legal-content';

export interface PrerenderInput {
  /** The public catalogue, exactly as GET /api/products returns it. */
  products: readonly Product[];
  /** Each product's top reviews, by product id. Absent for a product with none. */
  topReviews: Readonly<Record<string, readonly ProductReview[]>>;
}

export interface PrerenderPage {
  /** The address the page answers at, for messages and checks. */
  route: string;
  /** Where the page is written, relative to the build's output folder. */
  file: string;
  seo: PageSeo;
  /** The page's content, placed inside <app-root>. */
  body: string;
}

/** The six aisles' pages are served by vercel.json rewrites that name these files. */
export function categoryFile(category: ProductCategory): string {
  return `_pages/category-${categorySlug(category)}.html`;
}

export const ALL_PRODUCTS_FILE = '_pages/products.html';

export function categorySlug(category: string): string {
  return category
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// ---------------------------------------------------------------------------------------------
// Markup helpers

function esc(text: string | number): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function link(href: string, text: string): string {
  return `<a href="${esc(href)}">${esc(text)}</a>`;
}

function rupees(amount: number): string {
  return `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function paragraphs(texts: readonly string[]): string {
  return texts.map((t) => `<p>${esc(t)}</p>`).join('');
}

// ---------------------------------------------------------------------------------------------
// Pieces shared by every page

function siteNav(): string {
  const aisles = PRODUCT_CATEGORIES.map((c) => `<li>${link(categoryPath(c), c)}</li>`).join('');
  return (
    `<nav aria-label="Shop"><ul>` +
    `<li>${link('/', 'Home')}</li>` +
    `<li>${link('/products', 'All products')}</li>` +
    aisles +
    `<li>${link('/offers', 'Offers')}</li>` +
    `<li>${link('/about', 'About Ojas')}</li>` +
    `<li>${link('/contact', 'Contact')}</li>` +
    `</ul></nav>`
  );
}

function siteFooter(): string {
  return (
    `<footer>` +
    `<p>Ojas is a brand of ${esc(BUSINESS_NAME)}, ${esc(REGISTERED_ADDRESS)}.` +
    (FSSAI_LICENCE_NUMBER ? ` FSSAI licence no. ${esc(FSSAI_LICENCE_NUMBER)}.` : '') +
    `</p>` +
    `<p>Phone <a href="${esc(SUPPORT_PHONE_HREF)}">${esc(SUPPORT_PHONE)}</a> · ` +
    `Email <a href="mailto:${esc(SUPPORT_EMAIL)}">${esc(SUPPORT_EMAIL)}</a> · ` +
    `${esc(SUPPORT_HOURS)} · ${link(INSTAGRAM_URL, 'Instagram')}</p>` +
    `<p>${link('/terms', 'Terms and Conditions')} · ${link('/refunds', 'Refunds and Cancellations')} · ` +
    `${link('/privacy', 'Privacy Policy')} · ${link('/contact', 'Contact Us')}</p>` +
    `</footer>`
  );
}

function page(main: string): string {
  return `<div class="prerendered">${siteNav()}<main>${main}</main>${siteFooter()}</div>`;
}

/** The promise every product makes, from the same constants the cart and the policies use. */
function deliveryAndReturns(): string {
  return (
    `Delivered across Pune in ${deliveryDaysLabel()}. Free delivery on orders of ` +
    `${rupees(FREE_DELIVERY_CART_THRESHOLD)} or more. Unopened packs can be returned within ` +
    `${RETURN_WINDOW_DAYS} days of delivery and are collected free.`
  );
}

// ---------------------------------------------------------------------------------------------
// Products

function displayName(product: Product): string {
  const local = localNameFor(product.name);
  const also = local?.also ? ` (${local.also})` : '';
  const marathi = local ? ` – ${local.marathi}` : '';
  return `${product.name}${also}${marathi}`;
}

function priceText(product: Product): string {
  const now = effectivePrice(product);
  return product.discount > 0 && now < product.price
    ? `${rupees(now)} (${product.discount}% off ${rupees(product.price)})`
    : rupees(now);
}

function stockText(product: Product): string {
  return isPurchasable(product) ? 'in stock' : 'out of stock';
}

function productListItem(product: Product): string {
  const rating =
    product.ratingCount && product.ratingAverage
      ? `, rated ${product.ratingAverage.toFixed(1)}/5 (${product.ratingCount} review${product.ratingCount === 1 ? '' : 's'})`
      : '';
  return (
    `<li>${link(productPath(product), displayName(product))} — ` +
    `${esc(formatWeight(product.weight))}, ${esc(priceText(product))}, ${stockText(product)}${esc(rating)}</li>`
  );
}

function productList(products: readonly Product[]): string {
  return `<ul>${products.map(productListItem).join('')}</ul>`;
}

/** In stock first, then by name — the order a shopper would want to read them in. */
function shelfOrder(products: readonly Product[]): Product[] {
  return [...products].sort(
    (a, b) =>
      Number(isPurchasable(b)) - Number(isPurchasable(a)) || a.name.localeCompare(b.name, 'en'),
  );
}

function inAisle(products: readonly Product[], aisle: ProductCategory): Product[] {
  return shelfOrder(products.filter((p) => normalizeCategory(p.category) === aisle));
}

function productPage(product: Product, all: readonly Product[], top: readonly ProductReview[]): string {
  const aisle = normalizeCategory(product.category);
  const local = localNameFor(product.name);
  const crumbs =
    `<nav aria-label="Breadcrumb"><ol>` +
    `<li>${link('/', 'Home')}</li><li>${link('/products', 'Products')}</li>` +
    ((PRODUCT_CATEGORIES as readonly string[]).includes(aisle)
      ? `<li>${link(categoryPath(aisle), aisle)}</li>`
      : '') +
    `<li aria-current="page">${esc(product.name)}</li></ol></nav>`;

  const names = [local?.also, local?.marathi].filter((n): n is string => !!n);
  const rating =
    product.ratingCount && product.ratingAverage
      ? `<p>Rated ${esc(product.ratingAverage.toFixed(1))} out of 5 from ${esc(product.ratingCount)} ` +
        `verified purchase review${product.ratingCount === 1 ? '' : 's'}.</p>`
      : '';

  const details = (
    [
      ['Ingredients', product.ingredients],
      ['Benefits', product.benefits],
      ['Storage Information', product.storageInfo],
    ] as const
  )
    .filter(([, text]) => !!text?.trim())
    .map(([heading, text]) => `<h2>${esc(heading)}</h2><p>${esc(text.trim())}</p>`)
    .join('');

  const reviews = top.filter((r) => !r.isHidden);
  const reviewBlock = reviews.length
    ? `<h2>Customer reviews</h2>` +
      reviews
        .map(
          (r) =>
            `<blockquote><p>${esc(r.rating)}/5 — ${esc(r.comment?.trim() || 'No comment')}</p>` +
            `<footer>${esc(r.authorName)}, ${esc(r.createdAt.slice(0, 10))}</footer></blockquote>`,
        )
        .join('')
    : '';

  const siblings = all.filter(
    (p) => p.id !== product.id && normalizeCategory(p.category) === aisle,
  );
  const more = siblings.length
    ? `<h2>More from ${esc(aisle)}</h2>${productList(shelfOrder(siblings))}`
    : '';

  return page(
    crumbs +
      `<article>` +
      `<h1>${esc(product.name)}</h1>` +
      (names.length ? `<p>Also known as ${esc(names.join(' · '))}.</p>` : '') +
      `<p>${esc(formatWeight(product.weight))} pack · ${esc(priceText(product))} · ${stockText(product)}</p>` +
      rating +
      `<p>${esc(product.description.trim())}</p>` +
      details +
      `<h2>Delivery and returns</h2><p>${esc(deliveryAndReturns())}</p>` +
      reviewBlock +
      `</article>` +
      more,
  );
}

// ---------------------------------------------------------------------------------------------
// Pages

function homePage(products: readonly Product[]): string {
  const aisles = PRODUCT_CATEGORY_DETAILS.map(
    (c) => `<li>${link(categoryPath(c.name), c.name)} — ${esc(c.blurb)}</li>`,
  ).join('');
  const shelves = PRODUCT_CATEGORIES.map((aisle) => {
    const list = inAisle(products, aisle);
    return list.length ? `<h3>${link(categoryPath(aisle), aisle)}</h3>${productList(list)}` : '';
  }).join('');

  return page(
    `<h1>Ojas: stone-ground Maharashtrian flours, upwas staples and kitchen essentials, delivered fresh across Pune</h1>` +
      `<p>${esc(HOME_SEO.description)}</p>` +
      `<p>${esc(deliveryAndReturns())}</p>` +
      `<h2>Shop by category</h2><ul>${aisles}</ul>` +
      `<h2>Our products</h2>${shelves}` +
      `<h2>About Ojas</h2>${paragraphs(ABOUT_STORY.slice(0, 2))}<p>${link('/about', 'Read our story')}</p>`,
  );
}

function allProductsPage(products: readonly Product[]): string {
  const seo = productsPageSeo('All', '');
  const shelves = PRODUCT_CATEGORY_DETAILS.map((c) => {
    const list = inAisle(products, c.name);
    return list.length
      ? `<h2>${link(categoryPath(c.name), c.name)}</h2><p>${esc(c.blurb)}</p>${productList(list)}`
      : '';
  }).join('');
  return page(`<h1>All products</h1><p>${esc(seo.description)}</p>${shelves}`);
}

function categoryPage(products: readonly Product[], aisle: ProductCategory): string {
  const detail = PRODUCT_CATEGORY_DETAILS.find((c) => c.name === aisle);
  const list = inAisle(products, aisle);
  const others = PRODUCT_CATEGORIES.filter((c) => c !== aisle)
    .map((c) => `<li>${link(categoryPath(c), c)}</li>`)
    .join('');
  return page(
    `<h1>${esc(aisle)}</h1>` +
      (detail ? `<p>${esc(detail.blurb)}</p>` : '') +
      `<p>${esc(productsPageSeo(aisle, '').description)}</p>` +
      (list.length
        ? productList(list)
        : `<p>New products for this aisle are on their way. ${link('/products', 'Browse everything we make')}.</p>`) +
      `<h2>Other aisles</h2><ul>${others}</ul>`,
  );
}

function aboutPage(): string {
  return page(
    `<h1>About Ojas</h1><p>${esc(ABOUT_TAGLINE)}</p>` +
      `<h2>${esc(ABOUT_STORY_HEADING)}</h2>${paragraphs(ABOUT_STORY)}` +
      `<h2>Our values</h2><ul>${ABOUT_VALUES.map((v) => `<li><strong>${esc(v.title)}</strong> — ${esc(v.desc)}</li>`).join('')}</ul>` +
      `<h2>How far we've come</h2><ul>${ABOUT_MILESTONES.map((m) => `<li><strong>${esc(m.title)}</strong> — ${esc(m.desc)}</li>`).join('')}</ul>` +
      `<h2>Ojas is a brand owned and operated by ${esc(BUSINESS_NAME)}</h2><p>${esc(ABOUT_COMPANY_INTRO)}</p>`,
  );
}

function offersPage(): string {
  const coupons = [...COUPONS]
    .sort((a, b) => a.minCartValue - b.minCartValue)
    .map(
      (c) =>
        `<li><strong>${esc(c.discountPercentage)}% off orders of ${esc(rupees(c.minCartValue))} or more</strong> — coupon ${esc(c.code)}</li>`,
    )
    .join('');
  return page(
    `<h1>Save more on bigger orders</h1>` +
      `<p>Choose a coupon at checkout, under Coupons &amp; Offers. One coupon per order.</p>` +
      `<ul>${coupons}<li><strong>Free delivery on orders of ${esc(rupees(FREE_DELIVERY_CART_THRESHOLD))} or more</strong> — applied automatically, no coupon needed.</li></ul>`,
  );
}

function legalPage(slug: string): string {
  const doc = LEGAL_DOCUMENTS[slug];
  const sections = doc.sections
    .map(
      (s) =>
        `<section><h2>${esc(s.heading)}</h2>` +
        paragraphs(s.paragraphs ?? []) +
        (s.bullets ? `<ul>${s.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : '') +
        (s.footnote ? `<p>${esc(s.footnote)}</p>` : '') +
        `</section>`,
    )
    .join('');
  return page(
    `<article><h1>${esc(doc.title)}</h1><p>Last updated ${esc(POLICY_LAST_UPDATED)}</p>` +
      `<p>${esc(doc.intro)}</p>${sections}</article>`,
  );
}

/** The policy pages' SEO, exactly as pages/legal/legal.ts applies it. */
function legalSeo(slug: string): PageSeo {
  const doc = LEGAL_DOCUMENTS[slug];
  return { title: `${doc.title} · Ojas`, description: doc.intro, canonicalPath: `/${slug}` };
}

export const LEGAL_SLUGS = ['contact', 'terms', 'refunds', 'privacy'] as const;

export function buildPages({ products, topReviews }: PrerenderInput): PrerenderPage[] {
  const pages: PrerenderPage[] = [
    { route: '/', file: 'index.html', seo: { ...HOME_SEO, canonicalPath: '/' }, body: homePage(products) },
    {
      route: '/products',
      file: ALL_PRODUCTS_FILE,
      seo: productsPageSeo('All', ''),
      body: allProductsPage(products),
    },
    ...PRODUCT_CATEGORIES.map((aisle) => ({
      route: categoryPath(aisle),
      file: categoryFile(aisle),
      seo: productsPageSeo(aisle, ''),
      body: categoryPage(products, aisle),
    })),
    { route: '/about', file: 'about/index.html', seo: { ...ABOUT_SEO, canonicalPath: '/about' }, body: aboutPage() },
    { route: '/offers', file: 'offers/index.html', seo: { ...OFFERS_SEO, canonicalPath: '/offers' }, body: offersPage() },
    ...LEGAL_SLUGS.map((slug) => ({
      route: `/${slug}`,
      file: `${slug}/index.html`,
      seo: legalSeo(slug),
      body: legalPage(slug),
    })),
  ];

  for (const product of products) {
    const top = topReviews[product.id] ?? [];
    const rating =
      product.ratingCount && product.ratingAverage
        ? { average: product.ratingAverage, count: product.ratingCount }
        : null;
    const seo = productPageSeo(product, rating, top);
    const body = productPage(product, products, top);
    // The readable address, and the database-id address that older links (the Business
    // Profile's product links, anything shared before slugs) still use. Both carry the slug as
    // their canonical, so Google files them as one page.
    const keys = [...new Set([product.slug, product.id].filter((k): k is string => !!k))];
    for (const key of keys) {
      pages.push({
        route: `/products/${key}`,
        file: `products/${encodeURIComponent(key)}/index.html`,
        seo,
        body,
      });
    }
  }

  return pages;
}

// ---------------------------------------------------------------------------------------------
// llms.txt — https://llmstxt.org — a plain summary of the shop for AI assistants.

export function buildLlmsTxt({ products }: PrerenderInput): string {
  const lines: string[] = [
    '# Ojas',
    '',
    `> ${HOME_SEO.description}`,
    '',
    `Ojas (ओजस्) is a Pune food brand owned and operated by ${BUSINESS_NAME}. It makes stone-ground ` +
      'flours and traditional Maharashtrian food products — jowar, bajra, ragi and rice flour, modak ' +
      'peeth, anarase pith and upwas (fasting) flours — and has been in business since 2007. Ojas is ' +
      'stocked in over 1,200 retail outlets and sells online at ' +
      `${SITE_URL}.`,
    '',
    `- Delivery: across Pune in ${deliveryDaysLabel()}, from Sangvi, Pune. Free delivery on orders of ` +
      `${rupees(FREE_DELIVERY_CART_THRESHOLD)} or more.`,
    `- Returns: unopened packs within ${RETURN_WINDOW_DAYS} days of delivery, collected free. ` +
      `Policy: ${SITE_URL}/refunds`,
    `- Payment: online at checkout — UPI, cards and net banking, through Cashfree Payments. Cash on delivery is not offered.`,
    `- Contact: ${SUPPORT_PHONE}, ${SUPPORT_EMAIL}, ${SUPPORT_HOURS}.`,
    `- Address: ${REGISTERED_ADDRESS}`,
    ...(FSSAI_LICENCE_NUMBER ? [`- FSSAI licence: ${FSSAI_LICENCE_NUMBER}`] : []),
    '',
  ];

  for (const detail of PRODUCT_CATEGORY_DETAILS) {
    const list = inAisle(products, detail.name);
    if (!list.length) continue;
    lines.push(`## ${detail.name}`, '', detail.blurb, '');
    for (const p of list) {
      const description = p.description.trim().replace(/\s+/g, ' ');
      lines.push(
        `- [${displayName(p)}](${SITE_URL}${productPath(p)}): ${formatWeight(p.weight)}, ` +
          `${priceText(p)}, ${stockText(p)}. ${description}`,
      );
    }
    lines.push('');
  }

  lines.push(
    '## Pages',
    '',
    `- [All products](${SITE_URL}/products)`,
    `- [Offers and coupons](${SITE_URL}/offers)`,
    `- [About Ojas](${SITE_URL}/about)`,
    `- [Contact](${SITE_URL}/contact)`,
    `- [Refunds and cancellations](${SITE_URL}/refunds)`,
    `- [Terms and conditions](${SITE_URL}/terms)`,
    `- [Privacy policy](${SITE_URL}/privacy)`,
    '',
  );
  return lines.join('\n');
}
