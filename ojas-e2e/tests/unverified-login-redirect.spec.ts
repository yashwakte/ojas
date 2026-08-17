import { test, expect } from './fixtures';

function uniqueUser() {
  const suffix = Date.now().toString().slice(-8);
  return {
    fullName: 'Playwright Unverified',
    email: `pw.unverified.${suffix}@example.com`,
    phone: `8${suffix.padEnd(9, '0')}`,
    password: 'Passw0rd123!',
  };
}

test('logging into an account that abandoned OTP verification lands on a working OTP screen, not a blank page', async ({ page }) => {
  const user = uniqueUser();

  // Register, but abandon at the OTP step - never verify. Simulates someone who closed the
  // tab, or a pre-existing account created before this feature shipped.
  await page.goto('/register');
  await page.getByLabel('Full Name').fill(user.fullName);
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Phone Number').fill(user.phone);
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', { name: 'Create Account' }).click();
  await expect(page.getByText('Verify your email')).toBeVisible();

  // Now try to log in normally with the same (still-unverified) credentials.
  await page.goto('/login');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', { name: 'Sign In' }).click();

  // Must land back on a *rendered* OTP screen - this is the regression this test guards:
  // the page used to go completely blank here (header/footer only, empty router-outlet).
  await expect(page).toHaveURL(/\/register\?verify=/);
  await expect(page.getByText('Verify your email')).toBeVisible();
  await expect(page.getByText(user.email)).toBeVisible();

  // And the recovery path actually works end to end, not just renders.
  const code = (await page.locator('.dev-code-hint strong').textContent())?.trim();
  expect(code).toMatch(/^\d{6}$/);
  await page.getByLabel('Verification code').fill(code!);
  await page.getByRole('button', { name: 'Verify & Continue' }).click();
  await expect(page).toHaveURL('/');
});
