// @ts-check
const { defineConfig, devices } = require('@playwright/test');

/**
 * Local: `npm run test:e2e` — core extension behavior against live YouTube.
 *
 * To run every Playwright project: `npx playwright test`
 */
module.exports = defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  timeout: 60000,
  expect: {
    timeout: 20000,
  },
  globalSetup: require.resolve('./tests/e2e/global-setup.js'),
  globalTeardown: require.resolve('./tests/e2e/global-teardown.js'),
  projects: [
    {
      name: 'chromium',
      testIgnore: ['**/extension-*.spec.js', '**/core-*.spec.js', '**/static-*.spec.js'],
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chromium',
      },
    },
    {
      name: 'chromium-extension',
      testMatch: ['**/core-*.spec.js'],
      // Extension loads via tests/e2e/extension-fixture.js (launchPersistentContext); keep one worker for stability.
      workers: 1,
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chromium',
      },
    },
    {
      name: 'chromium-extension-static',
      testMatch: ['**/static-*.spec.js'],
      // Static replay still uses the real extension context and extension storage.
      workers: 1,
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chromium',
      },
    },
  ],
});
