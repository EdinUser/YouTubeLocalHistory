#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');
const { sanitizeYouTubeFixturePage } = require('./youtube-fixture-sanitizer');

const rootDir = path.resolve(__dirname, '..');
const defaultCaptureDir = path.join(rootDir, 'tests', 'fixtures', 'youtube-pages', 'captures');

async function sanitizeFixtureDirectory(captureDir) {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const name of fs.readdirSync(captureDir)) {
      const fixtureDir = path.join(captureDir, name);
      const htmlPath = path.join(fixtureDir, 'page.html');
      if (!fs.statSync(fixtureDir).isDirectory() || !fs.existsSync(htmlPath)) continue;

      const context = await browser.newContext();
      await context.route('**/*', (route) => route.abort());
      const page = await context.newPage();
      await page.setContent(fs.readFileSync(htmlPath, 'utf8'), { waitUntil: 'domcontentloaded' });
      await sanitizeYouTubeFixturePage(page);
      const html = (await page.content()).split('\n').map((line) => line.trimEnd()).join('\n');
      fs.writeFileSync(htmlPath, `${html}\n`);
      fs.rmSync(path.join(fixtureDir, 'screenshot.png'), { force: true });
      await context.close();
      console.log(`[fixtures] Sanitized ${name}`);
    }
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  sanitizeFixtureDirectory(defaultCaptureDir).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { sanitizeFixtureDirectory };
