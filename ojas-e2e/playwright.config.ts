import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  // One worker: tests share a backend with a 5 req/min "auth" rate limit (login/register/
  // verify-otp/resend-otp), so running spec files concurrently risks tripping it and failing
  // on rate-limit noise rather than a real assertion. Even sequentially, the full suite's
  // combined auth-endpoint calls can exceed 5/min on a single dev run (each spec file is
  // comfortably under the limit alone) - if the whole suite flakes with a 429/"Too many
  // attempts" failure, that's this, not a regression; wait ~60s and rerun, or run the
  // affected spec file individually to confirm.
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4200',
    trace: 'retain-on-failure',
    // The API's ASP.NET Core dev cert is self-signed; trusted locally via
    // `dotnet dev-certs https --trust`, but Playwright's own Chromium doesn't always
    // pick that up, so ignore cert errors for this local-only test run.
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
