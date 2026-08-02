/**
 * Loads the unpacked MV3 extension via Chromium persistent context (Playwright-recommended).
 * Config `launchOptions` alone is unreliable for extensions; a unique userDataDir avoids parallel test clashes.
 */
const { test: base, expect, chromium } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const rootDir = path.resolve(__dirname, '../..');
const extensionPath = path.resolve(rootDir, 'build', 'e2e', 'chrome');
const storageStatePath = path.join(rootDir, 'yt-storage.json');

const test = base.extend({
  context: async ({}, use) => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-rewatch-e2e-'));
    /** @type {import('@playwright/test').BrowserContextOptions} */
    const opts = {
      channel: 'chromium',
      // Default to headless; PW_HEADED=1 is the explicit debugging override.
      headless: process.env.PW_HEADED !== '1',
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    };
    if (fs.existsSync(storageStatePath)) {
      opts.storageState = storageStatePath;
    }
    const context = await chromium.launchPersistentContext(userDataDir, opts);
    try {
      await use(context);
    } finally {
      await context.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  },
});

module.exports = { test, expect };
