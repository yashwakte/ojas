#!/usr/bin/env node
/**
 * Writes every public page of the storefront as finished HTML, after `ng build`.
 *
 *   npm run build:prod      (ng build --configuration production && node tools/prerender.mjs)
 *
 * WHY. The app draws each page in the browser. Until this step existed, every address on
 * www.ojasaata.com answered with the same shell — the home page's title, no canonical tag, no
 * product — so to anything that does not run JavaScript (the crawlers behind ChatGPT, Perplexity
 * and Claude; WhatsApp's link previews) every product was the home page, and Google filed product
 * pages as "Duplicate without user-selected canonical" whenever its renderer gave up waiting on
 * an API instance that sleeps when idle.
 *
 * WHAT. For each public page it takes the built index.html and writes a copy whose <head> carries
 * that page's own title, description, canonical address, link-preview tags and structured data,
 * and whose <app-root> carries the page's content as plain, readable HTML (tools/prerender/pages.ts
 * decides the words, from the same code the app uses). Also writes /llms.txt.
 *
 * WHAT A CUSTOMER SEES. Nothing different. The arrival screen in index.html covers the window from
 * the first frame until the app has drawn the page, and Angular empties <app-root> the moment it
 * starts, so this content is only ever on screen for a reader with JavaScript off.
 *
 * WHERE IT GOES (served by vercel.json):
 *   index.html                     → /                        (the home page)
 *   app-shell.html                 → every other address      (the untouched build output)
 *   _pages/products.html           → /products                (rewrite)
 *   _pages/category-<aisle>.html   → /products?category=…     (rewrite on the query)
 *   products/<slug>/index.html     → /products/<slug>         (and the same under the product id)
 *   about/, offers/, contact/, terms/, refunds/, privacy/
 *
 * A product added after the build simply falls through to app-shell.html, exactly as every page
 * did before; the daily scheduled deploy picks it up.
 *
 * It fails the build rather than ship a wrong page: an API that will not answer, a template
 * whose <head> no longer has the tags this edits, a page without exactly one <h1>, structured
 * data that does not parse, or a vercel.json rewrite pointing at a file this did not write.
 */
import { build } from 'esbuild';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist', 'ojas-frontend', 'browser');
const VERCEL_JSON = path.join(ROOT, 'vercel.json');
const SEO_SERVICE = path.join(ROOT, 'src', 'app', 'services', 'seo.service.ts');

/** SeoService owns the <script> with this id and replaces its contents on every page. */
const PAGE_JSON_LD_ID = 'page-structured-data';

/** Render's free instance takes up to a minute to wake; one attempt may spend all of that. */
const FETCH_TIMEOUT_MS = 100_000;
const FETCH_ATTEMPTS = 3;

main().catch((error) => {
  console.error(`\n[prerender] FAILED: ${error?.stack ?? error}\n`);
  process.exit(1);
});

async function main() {
  const started = Date.now();
  // A second run over the same build (`npm run prerender` on its own) finds index.html already
  // turned into the home page; the untouched copy is app-shell.html. `ng build` empties the
  // output folder, so after a fresh build there is no app-shell.html and index.html is pristine.
  const shell = path.join(DIST, 'app-shell.html');
  const template = await readFile(shell, 'utf8').catch(() => readFile(path.join(DIST, 'index.html'), 'utf8'));
  assertTemplate(template);

  // The SPA fallback, kept byte-for-byte as Angular built it, before index.html becomes the home page.
  await writeFile(shell, template);

  const seoService = await readFile(SEO_SERVICE, 'utf8');
  if (!seoService.includes(`PAGE_JSON_LD_ID = '${PAGE_JSON_LD_ID}'`)) {
    throw new Error(
      `SeoService no longer names its structured-data script '${PAGE_JSON_LD_ID}'. Update ` +
        'PAGE_JSON_LD_ID here to match, or the app will add a second Product block beside this one.',
    );
  }

  const vercel = JSON.parse(await readFile(VERCEL_JSON, 'utf8'));
  const apiBase = (process.env.PRERENDER_API_URL ?? apiBaseFrom(vercel)).replace(/\/$/, '');

  console.log(`[prerender] Reading the catalogue from ${apiBase}`);
  const products = await fetchJson(`${apiBase}/products`);
  if (!Array.isArray(products) || products.length === 0) {
    throw new Error(`GET ${apiBase}/products returned no products; refusing to publish an empty shop.`);
  }
  for (const p of products) {
    if (!p?.id || !p?.name || typeof p.price !== 'number') {
      throw new Error(`A product from the API is missing its id, name or price: ${JSON.stringify(p).slice(0, 200)}`);
    }
  }

  const topReviews = {};
  for (const p of products.filter((p) => (p.ratingCount ?? 0) > 0)) {
    const response = await fetchJson(`${apiBase}/reviews/product/${encodeURIComponent(p.slug || p.id)}`);
    topReviews[p.id] = Array.isArray(response?.top) ? response.top : [];
  }

  const pagesModule = await loadPagesModule();
  const { buildPages, buildLlmsTxt, SITE_URL, SHARE_IMAGE } = pagesModule;
  const pages = buildPages({ products, topReviews });

  const written = new Set();
  for (const page of pages) {
    const html = renderPage(template, page, { SITE_URL, SHARE_IMAGE });
    checkPage(html, page, SITE_URL);
    const target = path.join(DIST, page.file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, html);
    written.add(page.file.replace(/\\/g, '/'));
  }

  await writeFile(path.join(DIST, 'llms.txt'), buildLlmsTxt({ products, topReviews }));

  checkRewrites(vercel, written, pagesModule);

  const productPages = pages.filter((p) => p.route.startsWith('/products/')).length;
  console.log(
    `[prerender] Wrote ${pages.length} pages (${productPages} product addresses for ${products.length} ` +
      `products) and llms.txt in ${((Date.now() - started) / 1000).toFixed(1)}s.`,
  );
}

// ---------------------------------------------------------------------------------------------

async function loadPagesModule() {
  const result = await build({
    entryPoints: [path.join(ROOT, 'tools', 'prerender', 'entry.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    write: false,
    logLevel: 'silent',
    // pages.ts must stay plain data and functions. An Angular import would mean a component or a
    // service has crept in, and those do not run outside a browser.
    external: ['@angular/*'],
  });
  const file = path.join(tmpdir(), `ojas-prerender-${process.pid}-${Date.now()}.mjs`);
  await writeFile(file, result.outputFiles[0].text);
  try {
    return await import(pathToFileURL(file).href);
  } finally {
    await rm(file, { force: true });
  }
}

/** The API's own address, from the rewrite that proxies /api, so the two can never disagree. */
function apiBaseFrom(vercel) {
  const rule = (vercel.rewrites ?? []).find((r) => r.source === '/api/(.*)');
  if (!rule) throw new Error('vercel.json has no /api/(.*) rewrite to read the API address from.');
  return rule.destination.replace(/\/\$1$/, '');
}

async function fetchJson(url) {
  let lastError;
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { accept: 'application/json', 'user-agent': 'ojas-prerender' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      console.warn(`[prerender] ${url} — attempt ${attempt} of ${FETCH_ATTEMPTS} failed: ${error.message}`);
      if (attempt < FETCH_ATTEMPTS) await new Promise((r) => setTimeout(r, 5_000));
    }
  }
  throw new Error(`Could not read ${url}: ${lastError?.message}`);
}

// ---------------------------------------------------------------------------------------------
// The <head> edits. Each must find exactly one tag to change; anything else means index.html has
// changed shape and the result can no longer be trusted.

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function metaPattern(attr, key) {
  return new RegExp(`<meta\\s+${attr}="${escapeRegExp(key)}"\\s+content="[^"]*"\\s*/?>`, 'g');
}

function replaceOnce(html, pattern, replacement, what) {
  const matches = html.match(pattern) ?? [];
  if (matches.length !== 1) {
    throw new Error(`index.html should have exactly one ${what}; found ${matches.length}.`);
  }
  return html.replace(pattern, () => replacement);
}

function setMeta(html, attr, key, value) {
  return replaceOnce(
    html,
    metaPattern(attr, key),
    `<meta ${attr}="${key}" content="${escapeHtml(value)}" />`,
    `<meta ${attr}="${key}">`,
  );
}

function removeMeta(html, attr, key) {
  return replaceOnce(html, metaPattern(attr, key), '', `<meta ${attr}="${key}">`);
}

function assertTemplate(template) {
  const required = [
    [/<title>[\s\S]*?<\/title>/g, '<title>'],
    [metaPattern('name', 'description'), 'description'],
    [metaPattern('property', 'og:title'), 'og:title'],
    [metaPattern('property', 'og:description'), 'og:description'],
    [metaPattern('property', 'og:type'), 'og:type'],
    [metaPattern('property', 'og:image'), 'og:image'],
    [/<app-root><\/app-root>/g, '<app-root></app-root>'],
  ];
  for (const [pattern, what] of required) {
    const count = (template.match(pattern) ?? []).length;
    if (count !== 1) throw new Error(`The built index.html should have exactly one ${what}; found ${count}.`);
  }
  if (/rel="canonical"/.test(template)) {
    throw new Error('The built index.html already has a canonical tag; it is the fallback for every address and must not.');
  }
}

function renderPage(template, page, { SITE_URL, SHARE_IMAGE }) {
  const { seo } = page;
  const image = seo.image ?? SHARE_IMAGE;
  let html = template;

  html = replaceOnce(html, /<title>[\s\S]*?<\/title>/g, `<title>${escapeHtml(seo.title)}</title>`, '<title>');
  html = setMeta(html, 'name', 'description', seo.description);
  html = setMeta(html, 'property', 'og:title', seo.title);
  html = setMeta(html, 'property', 'og:description', seo.description);
  html = setMeta(html, 'property', 'og:type', seo.type ?? 'website');
  html = setMeta(html, 'property', 'og:image', image);
  if (image !== SHARE_IMAGE) {
    // The poster's dimensions would be a lie about a pack shot - as SeoService does.
    html = removeMeta(html, 'property', 'og:image:width');
    html = removeMeta(html, 'property', 'og:image:height');
  }

  const head = [];
  if (seo.noindex) {
    head.push('<meta name="robots" content="noindex, follow" />');
  } else {
    const canonical = SITE_URL + (seo.canonicalPath ?? page.route);
    head.push(`<link rel="canonical" href="${escapeHtml(canonical)}" />`);
    head.push(`<meta property="og:url" content="${escapeHtml(canonical)}" />`);
  }
  const blocks = seo.jsonLd ?? [];
  if (blocks.length) {
    // "<" escaped so no product name or review can close the script element early, as SeoService does.
    const json = JSON.stringify(blocks.length === 1 ? blocks[0] : blocks).replace(/</g, '\\u003c');
    head.push(`<script type="application/ld+json" id="${PAGE_JSON_LD_ID}">${json}</script>`);
  }
  html = replaceOnce(html, /<\/head>/g, `    ${head.join('\n    ')}\n  </head>`, '</head>');

  return replaceOnce(html, /<app-root><\/app-root>/g, `<app-root>${page.body}</app-root>`, '<app-root>');
}

// ---------------------------------------------------------------------------------------------
// Checks on what was written.

function checkPage(html, page, SITE_URL) {
  const fail = (why) => {
    throw new Error(`${page.route} (${page.file}): ${why}`);
  };

  const body = html.slice(html.indexOf('<app-root>'), html.indexOf('</app-root>'));
  // Counted over the whole document: the noscript fallback in index.html is read by crawlers too.
  const h1s = html.match(/<h1[\s>]/g) ?? [];
  if (h1s.length !== 1) fail(`expected one <h1> in the page, found ${h1s.length}`);
  if (!/<h1[\s>]/.test(body)) fail('the <h1> is not in the page content');
  if (/\bundefined\b|\bNaN\b|\[object Object\]/.test(body)) fail('the content contains undefined, NaN or [object Object]');
  if (body.length < 400) fail(`the content is suspiciously short (${body.length} characters)`);

  const titles = html.match(/<title>([\s\S]*?)<\/title>/g) ?? [];
  if (titles.length !== 1 || titles[0] !== `<title>${escapeHtml(page.seo.title)}</title>`) fail('the <title> is wrong');

  if (!page.seo.noindex) {
    const canonicals = [...html.matchAll(/<link rel="canonical" href="([^"]*)"/g)];
    if (canonicals.length !== 1) fail(`expected one canonical tag, found ${canonicals.length}`);
    if (!canonicals[0][1].startsWith(`${SITE_URL}/`)) fail(`canonical ${canonicals[0][1]} is not on ${SITE_URL}`);
  }

  for (const [, json] of html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      JSON.parse(json);
    } catch (error) {
      fail(`structured data does not parse: ${error.message}`);
    }
  }
}

/**
 * Every page vercel.json sends traffic to must exist, or that address would answer 404; and every
 * aisle's page must have a rewrite, or it would be written and never served.
 */
function checkRewrites(vercel, written, { PRODUCT_CATEGORIES, categoryFile, ALL_PRODUCTS_FILE }) {
  const rules = vercel.rewrites ?? [];
  const local = new Set();
  for (const rule of rules) {
    const destination = rule.destination;
    if (/^https?:\/\//.test(destination)) continue;
    const file = destination.replace(/^\//, '');
    local.add(file);
    if (file === 'app-shell.html') continue;
    if (!written.has(file)) {
      throw new Error(`vercel.json rewrites ${rule.source} to ${destination}, which this build did not write.`);
    }
  }
  for (const file of [ALL_PRODUCTS_FILE, ...PRODUCT_CATEGORIES.map(categoryFile)]) {
    if (!local.has(file)) throw new Error(`vercel.json has no rewrite serving ${file}.`);
  }
  const last = rules.at(-1);
  if (last?.source !== '/(.*)' || last?.destination !== '/app-shell.html') {
    throw new Error('The last vercel.json rewrite must send every other address to /app-shell.html.');
  }

  // Each aisle's rule must match the address the app actually links to, both as the browser
  // sends it (%20, %26) and decoded, since which one Vercel compares is not something to guess.
  for (const aisle of PRODUCT_CATEGORIES) {
    const rule = rules.find((r) => r.destination === `/${categoryFile(aisle)}`);
    const value = rule?.has?.find((h) => h.type === 'query' && h.key === 'category')?.value;
    if (rule?.source !== '/products' || !value) {
      throw new Error(`The rewrite for ${aisle} must be on /products with a "category" query condition.`);
    }
    const pattern = new RegExp(value);
    const forms = [aisle, encodeURIComponent(aisle), aisle.replace(/ /g, '+').replace(/&/g, '%26')];
    for (const form of forms) {
      if (!pattern.test(form)) throw new Error(`The rewrite for ${aisle} does not match "${form}".`);
    }
    for (const other of PRODUCT_CATEGORIES.filter((c) => c !== aisle)) {
      if (pattern.test(other) || pattern.test(encodeURIComponent(other))) {
        throw new Error(`The rewrite for ${aisle} also matches ${other}.`);
      }
    }
  }
}
