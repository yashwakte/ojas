import { defineConfig, devices } from '@playwright/test';

/**
 * The security suite, run against the deployed site rather than localhost.
 *
 * Kept as its own config, and its own directory, because it is a different kind of test: it may
 * only ever *read*, and every assertion is of the form "this is refused". Nothing here registers
 * an account, places an order, or writes a row — running a suite that creates data against the
 * live site would leave real orders behind and, with a live payment gateway, could move money.
 *
 * Point it somewhere else with OJAS_BASE_URL, e.g. a staging deploy:
 *   OJAS_BASE_URL=https://staging.example.com npx playwright test --config playwright.prod.config.ts
 */
export default defineConfig({
  testDir: './tests-security',
  fullyParallel: false,
  // One worker: the API rate-limits by IP (60/min general, 5/min auth in production), and a
  // suite that trips the limiter fails on 429s rather than on anything it meant to assert.
  workers: 1,
  retries: 1,
  reporter: [['list']],
  timeout: 60_000,
  use: {
    baseURL: process.env['OJAS_BASE_URL'] ?? 'https://ojas-atta.vercel.app',
    trace: 'retain-on-failure',
    // Render's free tier sleeps; the first request after idle can take ~50s to wake it.
    actionTimeout: 45_000,
    navigationTimeout: 45_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
