import { test, expect } from '@playwright/test';

// Proves, against the deployed site, that each public address serves its own finished HTML
// (ojas-frontend/tools/prerender.mjs) - which only Vercel's real routing can show: files before
// rewrites, a folder's index.html for a bare path, and the rewrites on ?category=. Read-only.
//
// Every one of these, if it broke, would quietly fall back to the app shell rather than fail
// visibly - the page would still work for customers while search engines went back to seeing
// the home page everywhere. That is exactly why it needs asserting rather than eyeballing.

const SITE = 'https://www.ojasaata.com';

function canonicalOf(html: string): string | null {
  return html.match(/<link rel="canonical" href="([^"]*)"/)?.[1] ?? null;
}

const PAGES: { path: string; canonical: string; h1: RegExp }[] = [
  { path: '/', canonical: `${SITE}/`, h1: /stone-ground Maharashtrian flours/ },
  { path: '/products', canonical: `${SITE}/products`, h1: /All products/ },
  { path: '/products?category=Upwas', canonical: `${SITE}/products?category=Upwas`, h1: /Upwas/ },
  {
    path: '/products?category=Traditional%20%26%20Festive',
    canonical: `${SITE}/products?category=Traditional%20%26%20Festive`,
    h1: /Traditional &amp; Festive/,
  },
  { path: '/products/modak-pith', canonical: `${SITE}/products/modak-pith`, h1: /Modak Pith/ },
  { path: '/about', canonical: `${SITE}/about`, h1: /About Ojas/ },
  { path: '/offers', canonical: `${SITE}/offers`, h1: /Save more on bigger orders/ },
  { path: '/refunds', canonical: `${SITE}/refunds`, h1: /Refunds/ },
];

for (const { path, canonical, h1 } of PAGES) {
  test(`${path} is served as its own page, not the app shell`, async ({ request }) => {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    const html = await response.text();

    expect(canonicalOf(html), 'canonical tag').toBe(canonical);
    const headings = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/g) ?? [];
    expect(headings.length, 'exactly one h1').toBe(1);
    expect(headings[0]).toMatch(h1);
    expect(html).toContain('class="prerendered"');
  });
}

test('a product page carries its Product data, with price and returns policy', async ({ request }) => {
  const html = await (await request.get('/products/modak-pith')).text();
  const json = html.match(/<script type="application\/ld\+json" id="page-structured-data">([\s\S]*?)<\/script>/)?.[1];
  expect(json, 'page structured data').toBeTruthy();
  const [product] = JSON.parse(json!) as Record<string, any>[];
  expect(product['@type']).toBe('Product');
  expect(Number(product['offers'].price)).toBeGreaterThan(0);
  expect(product['offers'].hasMerchantReturnPolicy.merchantReturnDays).toBe(3);
});

test("a product's old database-id address names the readable one as canonical", async ({ request }) => {
  const html = await (await request.get('/products/69db536f167fde4aa39e8807')).text();
  expect(canonicalOf(html)).toBe(`${SITE}/products/modak-pith`);
});

test('an address with no page of its own still gets the app, with no canonical claim', async ({ request }) => {
  for (const path of ['/cart', '/products/a-product-that-does-not-exist']) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect(canonicalOf(await response.text()), path).toBeNull();
  }
});

test('llms.txt describes the shop for AI assistants', async ({ request }) => {
  const response = await request.get('/llms.txt');
  expect(response.status()).toBe(200);
  const text = await response.text();
  expect(text.startsWith('# Ojas')).toBeTruthy();
  expect(text).toContain(`${SITE}/products/modak-pith`);
});

test('once the app has started, the page has one canonical, one data block and no prerendered text', async ({ page }) => {
  await page.goto('/products/modak-pith');
  await expect(page.locator('h1')).toHaveText(/Modak Pith/);
  await expect(page.locator('.prerendered')).toHaveCount(0);
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
  await expect(page.locator('#page-structured-data')).toHaveCount(1);
});
