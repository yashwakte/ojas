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
