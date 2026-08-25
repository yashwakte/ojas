import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { MONGO_URL, deleteUsersByEmail } from './db';

/**
 * The two-tab identity bug, end to end.
 *
 * Cookies and localStorage belong to a browser profile, not to a tab. Signing into a second
 * account in one tab silently repoints every other tab's cookie at the new account - and those
 * tabs used to carry on rendering the *old* one from their in-memory copy, so one person's name
 * and menu sat above another person's orders, addresses and wallet. No attacker required; two
 * tabs were enough.
 *
 * Playwright's pages within a single BrowserContext share exactly what real tabs share - one
 * cookie jar, one localStorage, and storage events that fire across them - so this exercises the
 * real mechanism rather than a simulation of it.
 *
 * Both halves of the story live in one test on purpose: registration is rate-limited to 5
 * requests a minute per IP (see playwright.config.ts), and two accounts is already four calls
 * against that budget. Splitting them would trip it and fail on rate-limit noise.
 */

/** The header renders the first name only, so these have to differ in their first word. */
function uniqueUser(firstName: string, seq: number) {
  const suffix = `${Date.now()}`.slice(-8);
  return {
    firstName,
    fullName: `${firstName} Tester`,
    email: `pw.tabs.${firstName.toLowerCase()}.${suffix}@example.com`,
    // seq, not just the timestamp: two calls in the same millisecond would otherwise collide on
    // the unique phone index and the second registration would come back a 409.
    phone: `9${suffix}${seq}`,
    password: 'Passw0rd123!',
  };
}

const created: string[] = [];

test.afterAll(async () => {
  if (MONGO_URL && created.length > 0) await deleteUsersByEmail(created);
});

/** Registers through the UI and drives the OTP step, leaving the page signed in at home. */
async function registerAndVerify(page: Page, user: ReturnType<typeof uniqueUser>) {
  await page.goto('/register');
  await page.getByLabel('Full Name').fill(user.fullName);
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Phone Number').fill(user.phone);
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', { name: 'Create Account' }).click();

  await expect(page.getByText('Verify your email')).toBeVisible();

  const code = (await page.locator('.dev-code-hint strong').textContent())?.trim();
  expect(code).toMatch(/^\d{6}$/);

  await page.getByLabel('Verification code').fill(code!);
  await page.getByRole('button', { name: 'Verify & Continue' }).click();
  await expect(page).toHaveURL('/');
  await dismissAddressPrompt(page);
}

/**
 * A signed-in customer with no delivery address gets the "Where should we deliver?" sheet a few
 * seconds after signing in (see App's effect). It is modal, so left alone it lands in the middle
 * of whichever step happens to be running and swallows its clicks. Dismissing it deliberately is
 * far steadier than trying to out-run it - and dismissing counts as an answer, so it stays shut.
 */
async function dismissAddressPrompt(page: Page) {
  const close = page.locator('.ap-close');
  await close.waitFor({ state: 'visible', timeout: 15_000 });
  await close.click();
  await expect(page.locator('.ap-backdrop')).toHaveCount(0);
}

test('two tabs never disagree about who is signed in', async ({ page }) => {
  // Two registrations, two OTP steps and a full page reload - well past the 30s default.
  test.setTimeout(180_000);

  const first = uniqueUser('Alpha', 0);
  const second = uniqueUser('Bravo', 1);
  created.push(first.email, second.email);

  await registerAndVerify(page, first);
  await expect(page.locator('.user-name')).toHaveText(first.firstName);

  // A second tab in the same browser - same cookie jar, same localStorage.
  const secondTab = await page.context().newPage();
  // Matches what the shared fixture does for the first page: skip the first-visit modal, which
  // is a native showModal() dialog and would make the rest of the page inert.
  await secondTab.addInitScript(() => window.localStorage.setItem('ojas_visited', '1'));

  await test.step('a second account signing in elsewhere takes the first tab with it', async () => {
    // Armed before the trigger, because the notice is deliberately brief: it holds for about a
    // second and a half and is then swept away by the reload it announced. Asserting on it
    // afterwards races that, and loses whenever the second tab spends any time of its own.
    const noticeSeen = page.waitForSelector('app-session-switch-notice .ssn', {
      state: 'attached',
      timeout: 90_000,
    });

    await registerAndVerify(secondTab, second);

    // The first tab must notice, and cover itself rather than silently swapping under the
    // reader. This resolving is the proof; reading the element's text afterwards is not possible
    // here, because by then the reload it announced has destroyed the execution context. What it
    // actually says is pinned by session-switch-notice.spec.ts instead.
    await noticeSeen;

    // Wait for the cover to clear, not for the name to change. The name updates while the notice
    // is still up, and the reload that follows aborts anything in flight - navigating in that
    // window cancels the very requests the assertions below are about.
    await expect(page.locator('app-session-switch-notice .ssn')).toHaveCount(0, {
      timeout: 30_000,
    });
    await expect(page.locator('.user-name')).toHaveText(second.firstName);

    // And the profile page - which reads from the server - agrees with the header. This exact
    // pairing is what was broken: one account's name above another account's record.
    await page.goto('/profile');
    await expect(page.getByText(second.email).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(first.email)).toHaveCount(0);
  });

  await test.step('signing out in one tab signs the other out, with no manual refresh', async () => {
    await secondTab.goto('/');
    await expect(secondTab.locator('.user-name')).toHaveText(second.firstName);
    // No address prompt to dismiss here - it was answered for this account in the step above,
    // and that answer is recorded per account in storage the two tabs share.

    await page.getByRole('button', { name: /Logout/i }).click();
    await expect(page).toHaveURL(/\/login/);

    // The cookies are gone browser-wide, so leaving the other tab looking signed in would be a
    // lie that only resolves the next time the user happens to trigger a request.
    // The heading specifically - the phrase also appears in the sentence underneath it.
    await expect(secondTab.getByRole('heading', { name: 'Signed out' })).toBeVisible({
      timeout: 20_000,
    });
    await expect(secondTab).toHaveURL(/\/login/, { timeout: 30_000 });
  });

  await secondTab.close();
});
