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

// Vercel's SPA catch-all answers *any* path that isn't a real file with index.html at 200
// text/html - build assets included. So a tab left open across a deploy, asking for a chunk whose
// hash no longer exists, gets HTML where it expected JavaScript.
//
// An exclusion was tried (`/:path((?!.*\.(?:js|mjs|css|map)$).*)`) so that a gone chunk would 404
// honestly. It compiles and behaves correctly under path-to-regexp v6, but on Vercel it had no
// effect: a bogus .js was still rewritten. Rather than keep guessing at a config that costs a
// deploy per attempt, the catch-all was left as it is and the client was made to cope - which it
// has to anyway, since this is what production actually does. Do not re-add the exclusion without
// a way to verify it; these assertions are what would catch it breaking every deep link.
test('the app shell answers deep links, and a missing chunk is served as HTML', async ({
  request,
}) => {
  for (const path of ['/products', '/my-orders', '/products/some-id']) {
    const response = await request.get(path);
    expect(response.status(), `${path} should serve the app`).toBe(200);
    expect(response.headers()['content-type'] ?? '', `${path} should serve HTML`).toContain(
      'text/html',
    );
  }

  // Documented, not desired. AppRecoveryService must recognise the resulting browser error - a
  // MIME-type complaint or "Unexpected token '<'" rather than a clean fetch failure - which is
  // covered by its own unit tests and was verified by driving a real browser against this exact
  // response. If this ever starts returning 404, that is an improvement, not a regression: relax
  // the assertion rather than reverting whatever caused it.
  const missingChunk = await request.get('/chunk-THIS-HASH-DOES-NOT-EXIST.js');
  expect(
    missingChunk.headers()['content-type'] ?? '',
    'if this is no longer HTML, the catch-all changed - see the note above',
  ).toContain('text/html');
});
