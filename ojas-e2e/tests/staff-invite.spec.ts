import { test, expect } from './fixtures';
import { MONGO_URL, deleteUsersByEmail, promoteToAdmin } from './db';

/**
 * The whole staff onboarding path, driven through real browsers:
 *
 *   admin signs in (approving their device by emailed code)
 *     -> creates a delivery partner with no password
 *       -> partner opens the invite link, sets their own password
 *         -> partner is signed in, with that browser bound as their one device
 *
 * Locally no mail is actually sent, so both the device code and the invite link surface in the
 * UI's dev-mode boxes - which is exactly what a developer walking this by hand would use.
 */

const suffix = Date.now().toString().slice(-8);

const admin = {
  fullName: 'Playwright Admin',
  email: `pw.admin.${suffix}@example.com`,
  phone: `7${suffix.padEnd(9, '0')}`,
  password: 'Passw0rd123!',
};

const partner = {
  fullName: 'Playwright Partner',
  email: `pw.partner.${suffix}@example.com`,
  phone: `6${suffix.padEnd(9, '0')}`,
  password: 'PartnerOwnPassw0rd!',
};

test.describe('staff invite onboarding', () => {
  test.skip(!MONGO_URL, 'Set OJAS_E2E_MONGO_URL to the API\'s Mongo connection string to run this spec.');

  // This walks four sign-in-shaped flows end to end across three browser contexts, which is
  // comfortably more than Playwright's 30s default allows for.
  test.setTimeout(120_000);

  test.afterAll(async () => {
    await deleteUsersByEmail([admin.email, partner.email]);
  });

  test('an invited staff member sets their own password and lands signed in', async ({ page, context }) => {
    // --- Arrange: a real, verified account, promoted to admin ---------------------------------
    // Registering through the UI gives a properly hashed password; the role flip is the one
    // thing the API intentionally offers no route for.
    await page.goto('/register');
    await page.getByLabel('Full Name').fill(admin.fullName);
    await page.getByLabel('Email').fill(admin.email);
    await page.getByLabel('Phone Number').fill(admin.phone);
    await page.getByLabel('Password').fill(admin.password);
    await page.getByRole('button', { name: 'Create Account' }).click();

    const registerCode = (await page.locator('.dev-code-hint strong').textContent())?.trim();
    expect(registerCode).toMatch(/^\d{6}$/);
    await page.getByLabel('Verification code').fill(registerCode!);
    await page.getByRole('button', { name: 'Verify & Continue' }).click();
    await expect(page).toHaveURL('/');

    await promoteToAdmin(admin.email);

    // Clear the customer session so the next sign-in is a fresh one carrying the new role.
    await context.clearCookies();
    await page.evaluate(() => window.localStorage.removeItem('ojas_user'));

    // --- Act 1: admin signs in, approving this browser as their device -------------------------
    await page.goto('/login');
    await page.getByLabel('Email').fill(admin.email);
    await page.getByLabel('Password').fill(admin.password);
    await page.getByRole('button', { name: 'Sign In' }).click();

    // Staff can't sign in from an unrecognised browser - the approval step takes over the card.
    await expect(page.getByRole('heading', { name: 'Approve this device' })).toBeVisible();
    await expect(page.getByText('sign you out everywhere else')).toBeVisible();

    const deviceCode = (await page.locator('.dev-code-hint strong').textContent())?.trim();
    expect(deviceCode).toMatch(/^\d{6}$/);
    await page.getByLabel('Approval code').fill(deviceCode!);
    await page.getByRole('button', { name: 'Approve & Sign In' }).click();

    await expect(page).toHaveURL(/\/admin/);

    // --- Act 2: admin invites a delivery partner, setting no password --------------------------
    await page.getByRole('tab', { name: 'Delivery Partners' }).click();

    // mat-card-title renders as a div, so this is a text match rather than a heading role.
    await expect(page.getByText('Create Staff Credential')).toBeVisible();
    // The password field is gone entirely - that's the point of the invite flow.
    await expect(page.getByLabel('Temporary Password')).toHaveCount(0);

    await page.getByLabel('Full Name').fill(partner.fullName);
    await page.getByLabel('Email').fill(partner.email);
    await page.getByLabel('Phone').fill(partner.phone);
    await page.getByRole('button', { name: 'Create Account' }).click();

    const inviteLink = await page.locator('.dev-invite-hint a').getAttribute('href');
    expect(inviteLink).toContain('/accept-invite?token=');

    // Scoped to this partner's own card - a shared dev database may hold other accounts that
    // are also awaiting setup.
    const partnerCard = page.locator('.partner-card').filter({ hasText: partner.email });
    await expect(partnerCard.getByText('Invite sent — waiting for them to set a password')).toBeVisible();

    // --- Act 3: the partner opens the invite in their own browser ------------------------------
    const partnerPage = await context.browser()!.newContext();
    await partnerPage.addInitScript(() => window.localStorage.setItem('ojas_visited', '1'));
    const partnerTab = await partnerPage.newPage();

    await partnerTab.goto(inviteLink!);
    await expect(partnerTab.getByRole('heading', { name: 'Set up your account' })).toBeVisible();
    await expect(partnerTab.getByText(partner.email)).toBeVisible();
    await expect(partnerTab.getByText('becomes the only one this account can sign in from')).toBeVisible();

    await partnerTab.getByLabel('New password').fill(partner.password);
    await partnerTab.getByLabel('Confirm password').fill(partner.password);
    await partnerTab.getByRole('button', { name: 'Set password & continue' }).click();

    // Accepting signs them straight in - no separate login, no second device approval.
    await expect(partnerTab).toHaveURL(/\/delivery/);

    // --- Assert: the binding is real -----------------------------------------------------------
    // A different browser has the right password but not the device, so it stays locked out.
    const strangerContext = await context.browser()!.newContext();
    await strangerContext.addInitScript(() => window.localStorage.setItem('ojas_visited', '1'));
    const strangerTab = await strangerContext.newPage();

    await strangerTab.goto('/login');
    await strangerTab.getByLabel('Email').fill(partner.email);
    await strangerTab.getByLabel('Password').fill(partner.password);
    await strangerTab.getByRole('button', { name: 'Sign In' }).click();

    await expect(strangerTab.getByRole('heading', { name: 'Approve this device' })).toBeVisible();

    await partnerPage.close();
    await strangerContext.close();
  });
});
