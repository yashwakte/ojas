import { test, expect } from './fixtures';
import { MONGO_URL, deleteUsersByEmail } from './db';

const API_URL = 'https://localhost:7126/api';

function uniqueUser() {
  const suffix = Date.now().toString().slice(-8);
  return {
    fullName: 'Playwright Test',
    email: `pw.${suffix}@example.com`,
    phone: `9${suffix.padEnd(9, '0')}`,
    password: 'Passw0rd123!',
  };
}

const created: string[] = [];

// Without this every run leaves another registered account behind in a real database. Skipped
// silently when no connection string is configured - only the tidying needs one.
test.afterAll(async () => {
  if (MONGO_URL && created.length > 0) await deleteUsersByEmail(created);
});

test('register, verify OTP, then the refresh token rotates the session and revokes on logout', async ({ page }) => {
  const user = uniqueUser();
  created.push(user.email);

  await page.goto('/register');
  await page.getByLabel('Full Name').fill(user.fullName);
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Phone Number').fill(user.phone);
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', { name: 'Create Account' }).click();

  // Registration succeeded and dropped us into the OTP step.
  await expect(page.getByText('Verify your email')).toBeVisible();

  // Dev-mode hint (Brevo isn't necessarily configured on this machine) surfaces the real code.
  const code = (await page.locator('.dev-code-hint strong').textContent())?.trim();
  expect(code).toMatch(/^\d{6}$/);

  await page.getByLabel('Verification code').fill(code!);
  await page.getByRole('button', { name: 'Verify & Continue' }).click();

  // Verified -> logged in -> redirected home.
  await expect(page).toHaveURL('/');

  const cookies = await page.context().cookies();
  const cookieNames = cookies.map((c) => c.name);
  expect(cookieNames).toContain('ojas_auth');
  expect(cookieNames).toContain('ojas_refresh');
  expect(cookieNames).toContain('ojas_csrf');
  const authCookieBeforeRefresh = cookies.find((c) => c.name === 'ojas_auth')!.value;
  const refreshCookieBeforeRefresh = cookies.find((c) => c.name === 'ojas_refresh')!.value;

  // Exercise /refresh directly - can't wait out a real 15-minute access-token expiry in a test.
  // page.request shares the browser context's cookie jar, so this is exactly what the
  // frontend's interceptor does silently once the access token actually expires.
  const refreshResponse = await page.request.post(`${API_URL}/auth/refresh`);
  expect(refreshResponse.ok()).toBeTruthy();
  const refreshedAuth = await refreshResponse.json();
  expect(refreshedAuth.email).toBe(user.email);
  expect(refreshedAuth.csrfToken).toBeTruthy();

  const cookiesAfterRefresh = await page.context().cookies();
  const authCookieAfterRefresh = cookiesAfterRefresh.find((c) => c.name === 'ojas_auth')!.value;
  const refreshCookieAfterRefresh = cookiesAfterRefresh.find((c) => c.name === 'ojas_refresh')!.value;
  expect(authCookieAfterRefresh).not.toBe(authCookieBeforeRefresh);
  expect(refreshCookieAfterRefresh).not.toBe(refreshCookieBeforeRefresh);

  // Replaying the rotated-away token seconds later is the honest two-tab case: both tabs in a
  // browser share one cookie jar, so when the access token expires they can both refresh with
  // the same value, and signing the loser out for that would be a bug. It gets a working access
  // token - and deliberately no refresh token, because the jar already holds the successor. That
  // is what stops the session forking into two branches that rotate forever, which is the
  // session a token thief would want. A replay after the grace window instead revokes the whole
  // family; that path needs the clock moved on, so it lives in the API integration tests
  // (AuthFlowTests.Refresh_ReplayingALongSpentToken_RevokesTheWholeSessionFamily).
  await page.context().addCookies([
    {
      name: 'ojas_refresh',
      value: refreshCookieBeforeRefresh,
      domain: 'localhost',
      path: '/api/auth',
      secure: true,
      sameSite: 'None',
    },
  ]);
  const replayResponse = await page.request.post(`${API_URL}/auth/refresh`);
  expect(replayResponse.ok()).toBeTruthy();

  const cookiesAfterReplay = await page.context().cookies();
  // The successor was not overwritten - the replay left the jar exactly as it found it.
  expect(cookiesAfterReplay.find((c) => c.name === 'ojas_refresh')!.value).toBe(
    refreshCookieBeforeRefresh,
  );

  // Restore the real (rotated) cookie, then confirm logout revokes it server-side too.
  await page.context().addCookies([
    {
      name: 'ojas_refresh',
      value: refreshCookieAfterRefresh,
      domain: 'localhost',
      path: '/api/auth',
      secure: true,
      sameSite: 'None',
    },
  ]);
  const logoutResponse = await page.request.post(`${API_URL}/auth/logout`);
  expect(logoutResponse.status()).toBe(204);

  const refreshAfterLogout = await page.request.post(`${API_URL}/auth/refresh`);
  expect(refreshAfterLogout.status()).toBe(401);
});
