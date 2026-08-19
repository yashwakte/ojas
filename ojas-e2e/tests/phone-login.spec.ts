import { test, expect } from './fixtures';

/**
 * Phone-number sign-in for customers. MSG91 isn't configured locally (nor in production yet -
 * that's blocked on DLT registration), so the only end-to-end-testable behaviour today is the
 * "not available yet" path: the toggle must appear, the sub-flow must render, and a 503 from the
 * backend must surface as a clear message rather than a silent failure or a blank state.
 *
 * Once MSG91 credentials exist (locally or in a test environment), extend this file with the
 * happy path: send code -> read the dev-mode code -> verify -> land signed in.
 */

test('the phone login toggle appears on the sign-in card and switches modes', async ({ page }) => {
  await page.goto('/login');

  await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible();
  await page.getByRole('button', { name: 'Use phone number instead' }).click();

  await expect(page.getByLabel('Phone number')).toBeVisible();
  await expect(page.getByText("Enter your phone number and we'll send you a 6-digit code.")).toBeVisible();

  // And back again, to confirm the toggle is reversible rather than a one-way navigation.
  await page.getByRole('button', { name: 'Use email instead' }).click();
  await expect(page.getByLabel('Email')).toBeVisible();
});

test('requesting a code with MSG91 unconfigured shows "not available yet", not a blank failure', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Use phone number instead' }).click();

  await page.getByLabel('Phone number').fill('9123456789');

  // The dummy Turnstile widget (Cloudflare's official always-pass test key) auto-resolves
  // without a manual click, but does so asynchronously - see turnstile-widget.ts - so the
  // button starts disabled. click() auto-waits against the full test timeout rather than the
  // shorter 5s expect() default, so it's the button becoming actionable that gates this, not a
  // race against the widget.
  await page.getByRole('button', { name: 'Send code' }).click();

  await expect(page.getByText("Phone sign-in isn't available yet. Please sign in with email instead.")).toBeVisible();

  // Must stay on the "enter number" stage - a 503 is not an invitation to type a code that was
  // never sent.
  await expect(page.getByLabel('Phone number')).toBeVisible();
});
