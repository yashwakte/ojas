import { test as base } from '@playwright/test';

/**
 * Every test gets a fresh browser context (no localStorage), which looks exactly like a
 * first-time visitor - so the GuestWelcome modal opens itself via a native <dialog
 * showModal()> ~700ms after load (see guest-welcome.ts). That's a real, intentional feature,
 * but native showModal() makes the rest of the page inert while it's open, which silently
 * swallows any form interaction racing against it. Seeding the same flag WelcomeService sets
 * after a real first visit sidesteps the race entirely instead of trying to out-time it.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('ojas_visited', '1');
    });
    await use(page);
  },
});

export { expect } from '@playwright/test';
