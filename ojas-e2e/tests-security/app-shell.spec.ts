import { test, expect } from '@playwright/test';

// Read-only smoke checks against the deployed site, in the spirit of this suite: nothing here
// registers an account, places an order, or writes a row.
test('the session-switch cover does not intercept clicks when idle', async ({ page }) => {
  await page.goto('/');

  // The component is always mounted and is a full-screen fixed box. If its host ever loses
  // pointer-events: none it becomes an invisible sheet over the whole site, and every click -
  // Sign In included - silently does nothing. This exact bug was caught in pre-deploy testing.
  const host = page.locator('app-session-switch-notice');
  await expect(host).toHaveCount(1);
  expect(await host.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');

  // Nothing is rendered inside it while no session change is happening.
  await expect(page.locator('app-session-switch-notice .ssn')).toHaveCount(0);
});

test('a signed-out visitor can still navigate and reach a usable sign-in form', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await page.getByRole('link', { name: 'Products', exact: true }).first().click();
  await expect(page).toHaveURL(/\/products/);

  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();

  expect(errors, `uncaught page errors: ${errors.join(' | ')}`).toEqual([]);
});

// The SPA catch-all rewrite used to hand back index.html for *any* path that wasn't a real file,
// build assets included. A tab left open across a deploy asks for a chunk whose hash no longer
// exists; instead of a clean 404 it got 200 text/html, and the browser's dynamic import failed on
// a MIME mismatch — the failure that leaves a header, a footer and blank space in between.
// The rewrite now excludes .js/.mjs/.css/.map, and these two assertions are what prove it, since
// getting the exclusion wrong in the other direction would break every deep link on the site.
test('a missing build asset 404s instead of being answered with the app shell', async ({
  request,
}) => {
  const response = await request.get('/chunk-THIS-HASH-DOES-NOT-EXIST.js');
  expect(
    response.status(),
    'a gone chunk must fail honestly; answering it with index.html is what makes a stale tab silently blank',
  ).toBe(404);
  expect(response.headers()['content-type'] ?? '').not.toContain('text/html');
});

test('a deep link is still served the app shell', async ({ request }) => {
  // The other half of the same rewrite. A 200 alone proves nothing here — the catch-all returns
  // index.html for anything — so the content type is what is actually being checked.
  for (const path of ['/products', '/my-orders', '/products/some-id']) {
    const response = await request.get(path);
    expect(response.status(), `${path} should serve the app`).toBe(200);
    expect(response.headers()['content-type'] ?? '', `${path} should serve HTML`).toContain(
      'text/html',
    );
  }
});
