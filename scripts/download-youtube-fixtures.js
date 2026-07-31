#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');

const rootDir = path.resolve(__dirname, '..');
const defaultManifestPath = path.join(rootDir, 'tests', 'fixtures', 'youtube-pages', 'pages.json');
const defaultOutputDir = path.join(rootDir, 'tests', 'fixtures', 'youtube-pages', 'captures');

function parseArgs(argv) {
  const args = {
    manifestPath: defaultManifestPath,
    outputDir: defaultOutputDir,
    only: null,
    headed: process.env.PW_HEADLESS !== '1',
    screenshot: true,
    sanitize: true,
    timeoutMs: 60000,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--manifest') {
      args.manifestPath = path.resolve(argv[++index]);
    } else if (arg === '--out') {
      args.outputDir = path.resolve(argv[++index]);
    } else if (arg === '--only') {
      args.only = argv[++index].split(',').map((name) => name.trim()).filter(Boolean);
    } else if (arg === '--headless') {
      args.headed = false;
    } else if (arg === '--headed') {
      args.headed = true;
    } else if (arg === '--no-screenshot') {
      args.screenshot = false;
    } else if (arg === '--preserve-scripts') {
      args.sanitize = false;
    } else if (arg === '--timeout') {
      args.timeoutMs = Number(argv[++index]);
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`
Usage:
  node scripts/download-youtube-fixtures.js [options]

Options:
  --manifest <path>       Fixture manifest. Default: tests/fixtures/youtube-pages/pages.json
  --out <path>            Output directory. Default: tests/fixtures/youtube-pages/captures
  --only <names>          Comma-separated fixture names to capture.
  --headless              Run Chromium headless.
  --headed                Run Chromium headed. Default locally unless PW_HEADLESS=1.
  --no-screenshot         Do not write screenshot.png.
  --preserve-scripts      Keep page scripts/iframes in page.html. Default strips them.
  --timeout <ms>          Per-page timeout. Default: 60000.
`);
}

function readManifest(manifestPath) {
  const raw = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(raw);

  if (!Array.isArray(manifest.pages)) {
    throw new Error(`Manifest ${manifestPath} must contain a "pages" array.`);
  }

  return manifest;
}

function safeFixtureName(name) {
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(name)) {
    throw new Error(`Invalid fixture name "${name}". Use lowercase letters, numbers, and hyphens.`);
  }

  return name;
}

async function dismissYouTubeConsent(page) {
  const buttonNames = [
    'Accept all',
    'Reject all',
    'I agree',
    'Agree',
    'Accept',
    'Принять все',
    'Приемам всички',
  ];

  for (const name of buttonNames) {
    const button = page.getByRole('button', { name, exact: false }).first();
    if (await button.isVisible({ timeout: 1500 }).catch(() => false)) {
      await button.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1000);
      return;
    }
  }

  for (const frame of page.frames()) {
    for (const name of buttonNames) {
      const button = frame.getByRole('button', { name, exact: false }).first();
      if (await button.isVisible({ timeout: 1000 }).catch(() => false)) {
        await button.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(1000);
        return;
      }
    }
  }
}

async function waitForPageReady(page, fixture) {
  const selector = fixture.readySelector || 'body';
  await page.waitForSelector(selector, {
    state: fixture.readyState || 'attached',
    timeout: fixture.timeoutMs || 30000,
  });

  if (fixture.waitForNetworkIdle !== false) {
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  }

  await page.waitForTimeout(fixture.settleMs || 2500);
}

async function annotateCapture(page, fixture, capturedAt) {
  await page.evaluate(
    ({ name, url, capturedAt: timestamp }) => {
      document.documentElement.setAttribute('data-ytlh-fixture', name);
      document.documentElement.setAttribute('data-ytlh-fixture-url', url);
      document.documentElement.setAttribute('data-ytlh-fixture-captured-at', timestamp);
    },
    { name: fixture.name, url: fixture.url, capturedAt }
  );
}

async function sanitizeCapture(page) {
  await page.evaluate(() => {
    document.querySelectorAll('script, iframe, noscript').forEach((node) => node.remove());
    document
      .querySelectorAll('link[rel="preload"], link[rel="modulepreload"], link[rel="preconnect"], link[rel="dns-prefetch"]')
      .forEach((node) => node.remove());
  });
}

async function captureFixture(browser, fixture, outputDir, options) {
  safeFixtureName(fixture.name);

  const fixtureDir = path.join(outputDir, fixture.name);
  fs.mkdirSync(fixtureDir, { recursive: true });

  const context = await browser.newContext({
    viewport: fixture.viewport || { width: 1440, height: 1100 },
    locale: fixture.locale || 'en-US',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(options.timeoutMs);

  console.log(`[fixtures] Capturing ${fixture.name}: ${fixture.url}`);

  const capturedAt = new Date().toISOString();
  try {
    await page.goto(fixture.url, {
      waitUntil: fixture.waitUntil || 'domcontentloaded',
      timeout: options.timeoutMs,
    });
    await dismissYouTubeConsent(page);
    await waitForPageReady(page, fixture);
    await annotateCapture(page, fixture, capturedAt);

    if (options.screenshot) {
      await page.screenshot({
        path: path.join(fixtureDir, 'screenshot.png'),
        fullPage: true,
      }).catch((error) => {
        console.warn(`[fixtures] Screenshot failed for ${fixture.name}: ${error.message}`);
      });
    }

    if (options.sanitize) {
      await sanitizeCapture(page);
    }

    const html = await page.content();
    fs.writeFileSync(path.join(fixtureDir, 'page.html'), html);

    const metadata = {
      name: fixture.name,
      url: fixture.url,
      purpose: fixture.purpose || '',
      capturedAt,
      readySelector: fixture.readySelector || null,
      viewport: fixture.viewport || { width: 1440, height: 1100 },
      sanitized: options.sanitize,
      source: 'scripts/download-youtube-fixtures.js',
    };
    fs.writeFileSync(path.join(fixtureDir, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`);
  } finally {
    await context.close();
  }
}

async function main() {
  const options = parseArgs(process.argv);
  const manifest = readManifest(options.manifestPath);
  const selected = options.only
    ? manifest.pages.filter((fixture) => options.only.includes(fixture.name))
    : manifest.pages;

  if (selected.length === 0) {
    throw new Error('No fixtures selected.');
  }

  fs.mkdirSync(options.outputDir, { recursive: true });

  const browser = await chromium.launch({
    channel: process.env.PW_CHROME_CHANNEL || 'chromium',
    headless: !options.headed,
  });

  try {
    for (const fixture of selected) {
      await captureFixture(browser, fixture, options.outputDir, options);
    }
  } finally {
    await browser.close();
  }

  console.log(`[fixtures] Wrote ${selected.length} fixture(s) to ${path.relative(rootDir, options.outputDir)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
