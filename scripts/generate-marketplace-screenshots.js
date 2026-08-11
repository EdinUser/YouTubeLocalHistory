#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('@playwright/test');
const { By } = require('selenium-webdriver');
const {
  launchFirefoxWithExtension,
  openFirefoxExtensionPage,
} = require('../tests/firefox/firefox-fixture');
const { buildFixture, svgDataUri } = require('./generate-docs-screenshots');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'helpers', 'screenshots');
const CHROME_EXTENSION_DIR = path.resolve(
  process.env.YTLH_CHROME_EXTENSION_DIR || path.join(ROOT, 'build', 'e2e', 'chrome')
);
const WIDTH = 1280;
const HEIGHT = 800;
const FIXED_NOW = Date.parse('2026-08-09T12:00:00.000Z');
const VIEWS = [
  { name: 'home', button: '#navHome', ready: '#grid .ytvht-feed-card' },
  { name: 'subscriptions', button: '#navSubscriptions', ready: '#grid .ytvht-feed-card' },
  { name: 'channels', button: '#manage', ready: '#subscriptionsList .subs-card' },
  { name: 'history', button: '#navHistory', ready: '#historyList .history-row' },
  { name: 'analytics', button: '#analyticsToggle', ready: '#anCards .an-card' },
];

function parseArguments(argv) {
  const options = { browser: 'all', headed: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--headed') options.headed = true;
    else if (argument === '--browser') options.browser = String(argv[++index] || '');
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!['all', 'chrome', 'firefox'].includes(options.browser)) {
    throw new Error('--browser must be all, chrome, or firefox');
  }
  return options;
}

function prepareFixture() {
  const fixture = buildFixture(FIXED_NOW);
  const videoById = new Map(fixture.videos.map((video) => [video.videoId, video]));
  fixture.videos.forEach((video) => { video.thumbnail = video.thumbnailUrl; });
  fixture.history.forEach((record, index) => {
    const feedVideo = videoById.get(record.videoId);
    record.thumbnail = feedVideo?.thumbnail || svgDataUri({
      width: 640,
      height: 360,
      label: 'Watch history',
      subtitle: record.channelName,
      start: index % 2 ? '#385170' : '#68478c',
      end: index % 2 ? '#62b6cb' : '#cf6a87',
    });
    const historyChannel = fixture.channels.find((channel) => channel.channelTitle === record.channelName);
    record.channelId = feedVideo?.channelId || historyChannel?.channelId || '';
  });
  fixture.watchLater.forEach((record, index) => {
    record.thumbnail = svgDataUri({
      width: 640,
      height: 360,
      label: 'Watch later',
      subtitle: record.channelName,
      start: index ? '#a15c38' : '#355c7d',
      end: index ? '#d9a441' : '#6c5b7b',
    });
  });
  fixture.stats.hourly = new Array(24).fill(0);
  [7, 8, 12, 17, 18, 20, 21].forEach((hour, index) => {
    fixture.stats.hourly[hour] = (index + 2) * 60;
  });
  fixture.tombstones = [
    {
      channelId: 'UCdocsIgnoredRestoration01',
      channelTitle: 'Restoration Notes',
      handle: '@restorationnotes',
      thumbnail: svgDataUri({ width: 160, height: 160, label: 'R', start: '#5b6470', end: '#8995a3' }),
      unsubscribedAt: FIXED_NOW - 16 * 24 * 60 * 60 * 1000,
      source: 'channels',
      reason: 'user_unfollow',
    },
  ];
  return fixture;
}

function localStoragePayload(fixture) {
  const localData = {
    settings: fixture.settings,
    popupAccentColor: fixture.settings.accentColor,
    stats: fixture.stats,
    localVideoPlaylists: {},
    feedFeedback: { notInterested: {}, channelLess: {}, channelMore: {} },
  };
  fixture.history.forEach((record) => { localData[`video_${record.videoId}`] = record; });
  fixture.watchLater.forEach((record) => { localData[`watchlater_${record.videoId}`] = record; });
  fixture.playlists.forEach((record) => { localData[`playlist_${record.playlistId}`] = record; });
  return localData;
}

async function seedInExtensionPage(pageEvaluate, fixture) {
  return pageEvaluate(async (data) => {
    await ytIndexedDBStorage.clearAll();
    await chrome.storage.local.clear();
    await chrome.storage.local.set(data.localData);
    for (const channel of data.channels) {
      await ytIndexedDBStorage.putSubscriptionRecord(channel);
      await ytIndexedDBStorage.putChannelSyncState({
        channelId: channel.channelId,
        initializationState: 'complete',
        lastAttemptAt: data.now,
        lastSuccessfulCheckAt: data.now,
        nextEligibleCheckAt: data.now + 365 * 24 * 60 * 60 * 1000,
        scanLeaseUntil: null,
        scanRunId: null,
        activityClass: 'active',
      });
    }
    for (const video of data.videos) {
      await ytIndexedDBStorage.putSubscriptionFeedVideo(video);
    }
    for (const tombstone of data.tombstones) {
      await ytIndexedDBStorage.putLocalUnsubscribeTombstone(tombstone);
    }
  }, {
    channels: fixture.channels,
    videos: fixture.videos,
    tombstones: fixture.tombstones,
    localData: localStoragePayload(fixture),
    now: FIXED_NOW,
  });
}

function assertPng(file, expectedWidth = WIDTH, expectedHeight = HEIGHT, requireOpaque = false) {
  const data = fs.readFileSync(file);
  if (data.length < 24 || data.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error(`Screenshot is not a PNG: ${file}`);
  }
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  if (width !== expectedWidth || height !== expectedHeight) {
    throw new Error(`${path.basename(file)} is ${width}x${height}; expected ${expectedWidth}x${expectedHeight}`);
  }
  if (requireOpaque && (data.readUInt8(24) !== 8 || data.readUInt8(25) !== 2)) {
    throw new Error(`${path.basename(file)} must be an opaque 24-bit PNG`);
  }
}

function destination(browser, view) {
  const file = path.join(OUTPUT_DIR, `${browser}_${view}.png`);
  const expectedRoot = `${OUTPUT_DIR}${path.sep}`;
  if (!file.startsWith(expectedRoot)) throw new Error('Unsafe marketplace screenshot destination');
  return file;
}

async function waitForChromeImages(page) {
  await page.waitForFunction(() => [...document.images]
    .filter((image) => image.getBoundingClientRect().width > 0 && image.getBoundingClientRect().height > 0)
    .every((image) => image.complete && image.naturalWidth > 0), null, { timeout: 10000 });
}

function promoDestination(name) {
  const file = path.join(OUTPUT_DIR, `chrome_${name}.png`);
  const expectedRoot = `${OUTPUT_DIR}${path.sep}`;
  if (!file.startsWith(expectedRoot)) throw new Error('Unsafe Chrome promotional asset destination');
  return file;
}

function promoDocument(body, styles) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <style>
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
    body { font-family: Arial, Helvetica, sans-serif; background: #0f0f0f; color: #fff; }
    ${styles}
  </style>
</head>
<body>${body}</body>
</html>`;
}

async function renderChromePromo(context, { file, width, height, document }) {
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width, height });
    await page.setContent(document, { waitUntil: 'load' });
    await page.evaluate(async () => document.fonts.ready);
    await waitForChromeImages(page);
    await page.screenshot({ path: file, animations: 'disabled', caret: 'hide', scale: 'css' });
    assertPng(file, width, height, true);
    console.log(`Generated ${path.relative(ROOT, file)}`);
  } finally {
    await page.close();
  }
}

async function generateChromePromoAssets(context) {
  const smallFile = promoDestination('small_promo_tile');
  const smallDocument = promoDocument(`
    <main class="small-tile">
      <div class="orb orb-one"></div><div class="orb orb-two"></div>
      <header><span class="play"></span><strong>YT re:Watch</strong></header>
      <section class="small-message">
        <h1>Your YouTube history.<br>Kept locally.</h1>
        <p>History&nbsp; • &nbsp;Progress&nbsp; • &nbsp;Local feed</p>
      </section>
      <footer><span></span>Private by design. Independent of your account.</footer>
    </main>`, `
    .small-tile { position: relative; width: 440px; height: 280px; padding: 30px 36px; background: linear-gradient(135deg, #0f0f0f 0%, #142433 100%); }
    .orb { position: absolute; border-radius: 999px; background: #3ea6ff; }
    .orb-one { width: 224px; height: 224px; right: -77px; top: -124px; opacity: .10; }
    .orb-two { width: 188px; height: 188px; left: -64px; bottom: -137px; opacity: .10; }
    header { position: relative; display: flex; align-items: center; gap: 8px; font-size: 23px; }
    .play { width: 0; height: 0; border-top: 11px solid transparent; border-bottom: 11px solid transparent; border-left: 20px solid #3ea6ff; }
    .small-message { position: relative; margin-top: 35px; padding: 20px 24px 18px 29px; border: 1px solid #313131; border-radius: 18px; background: #181818; box-shadow: 0 8px 24px rgba(0, 0, 0, .32); }
    .small-message::before { content: ''; position: absolute; left: -1px; top: 0; width: 7px; height: 100%; border-radius: 4px; background: linear-gradient(#2563eb, #3ea6ff); }
    h1 { margin: 0; font-size: 25px; line-height: 1.32; letter-spacing: -.4px; }
    .small-message p { margin: 13px 0 0; color: #a9b3bd; font-size: 14px; }
    footer { position: relative; display: flex; align-items: center; gap: 9px; margin-top: 20px; color: #c8d1da; font-size: 13px; }
    footer span { width: 10px; height: 10px; border-radius: 50%; background: #3ea6ff; }
  `);
  await renderChromePromo(context, { file: smallFile, width: 440, height: 280, document: smallDocument });

  const homeFile = destination('chrome', 'home');
  const homeScreenshot = `data:image/png;base64,${fs.readFileSync(homeFile).toString('base64')}`;
  const marqueeFile = promoDestination('marquee_promo_tile');
  const marqueeDocument = promoDocument(`
    <main class="marquee">
      <div class="glow glow-blue"></div><div class="glow glow-green"></div>
      <section class="pitch">
        <header><span class="play"></span><strong>YT re:Watch</strong></header>
        <h1>Your YouTube history.<br><em>Kept locally.</em></h1>
        <p>Follow channels, resume videos, and browse your own local feed—independent of your YouTube account.</p>
        <div class="features"><span>Local history</span><span>Watch progress</span><span>Private feed</span></div>
      </section>
      <section class="product-frame">
        <div class="frame-bar"><i></i><i></i><i></i><b>YT re:Watch</b></div>
        <img src="${homeScreenshot}" alt="YT re:Watch Home feed">
      </section>
    </main>`, `
    .marquee { position: relative; width: 1400px; height: 560px; overflow: hidden; background: linear-gradient(125deg, #0b0f13 0%, #101b25 56%, #142b3d 100%); }
    .glow { position: absolute; border-radius: 50%; filter: blur(2px); }
    .glow-blue { width: 560px; height: 560px; left: -310px; bottom: -365px; background: rgba(62, 166, 255, .15); }
    .glow-green { width: 460px; height: 460px; right: -190px; top: -275px; background: rgba(48, 190, 143, .12); }
    .pitch { position: absolute; z-index: 2; left: 70px; top: 54px; width: 535px; }
    header { display: flex; align-items: center; gap: 13px; font-size: 31px; }
    .play { width: 0; height: 0; border-top: 15px solid transparent; border-bottom: 15px solid transparent; border-left: 27px solid #3ea6ff; }
    h1 { margin: 65px 0 23px; font-size: 52px; line-height: 1.08; letter-spacing: -1.7px; }
    h1 em { color: #55b3ff; font-style: normal; }
    .pitch > p { width: 505px; margin: 0; color: #c3ccd5; font-size: 20px; line-height: 1.45; }
    .features { display: flex; gap: 10px; margin-top: 31px; }
    .features span { padding: 9px 13px; border: 1px solid #38516a; border-radius: 999px; background: rgba(31, 55, 75, .72); color: #d9e7f3; font-size: 14px; font-weight: 700; }
    .product-frame { position: absolute; z-index: 1; left: 650px; top: 52px; width: 820px; height: 512px; overflow: hidden; border: 1px solid #3b4c59; border-radius: 24px 0 0 0; background: #0f0f0f; box-shadow: 0 28px 70px rgba(0, 0, 0, .5); transform: rotate(-1deg); transform-origin: center; }
    .frame-bar { display: flex; align-items: center; gap: 8px; height: 35px; padding: 0 15px; background: #20262c; border-bottom: 1px solid #303942; }
    .frame-bar i { width: 9px; height: 9px; border-radius: 50%; background: #56616b; }
    .frame-bar i:first-child { background: #3ea6ff; }
    .frame-bar b { margin-left: 9px; color: #aeb8c1; font-size: 12px; font-weight: 400; }
    .product-frame img { display: block; width: 820px; height: 512px; object-fit: cover; object-position: left top; }
  `);
  await renderChromePromo(context, { file: marqueeFile, width: 1400, height: 560, document: marqueeDocument });
}

async function getChromeExtensionOrigin(context) {
  const worker = context.serviceWorkers().find((candidate) => candidate.url().includes('background.js'))
    || await context.waitForEvent('serviceworker', {
      timeout: 15000,
      predicate: (candidate) => candidate.url().includes('background.js'),
    });
  const url = new URL(worker.url());
  return `${url.protocol}//${url.host}`;
}

async function generateChrome(fixture, headed) {
  if (!fs.existsSync(path.join(CHROME_EXTENSION_DIR, 'manifest.json'))) {
    throw new Error('Missing build/e2e/chrome/manifest.json. Run npm run build:e2e:chrome first.');
  }
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rewatch-marketplace-chrome-'));
  let context;
  const unexpectedRequests = [];
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: process.env.DOCS_SCREENSHOT_BROWSER_CHANNEL || 'chromium',
      headless: !headed,
      locale: 'en-US',
      timezoneId: 'UTC',
      colorScheme: 'dark',
      reducedMotion: 'reduce',
      deviceScaleFactor: 1,
      viewport: { width: WIDTH, height: HEIGHT },
      args: [
        `--disable-extensions-except=${CHROME_EXTENSION_DIR}`,
        `--load-extension=${CHROME_EXTENSION_DIR}`,
        '--lang=en-US',
      ],
    });
    await context.addInitScript((timestamp) => {
      const RealDate = Date;
      class FixedDate extends RealDate {
        constructor(...args) { super(...(args.length ? args : [timestamp])); }
        static now() { return timestamp; }
      }
      FixedDate.parse = RealDate.parse;
      FixedDate.UTC = RealDate.UTC;
      globalThis.Date = FixedDate;
      let state = 0x5eed1234;
      Math.random = () => {
        state = (state + 0x6d2b79f5) | 0;
        let value = Math.imul(state ^ (state >>> 15), 1 | state);
        value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
      };
    }, FIXED_NOW);
    await context.route('**/*', async (route) => {
      const requestUrl = route.request().url();
      const protocol = new URL(requestUrl).protocol;
      if (['chrome-extension:', 'data:', 'blob:', 'about:'].includes(protocol)) {
        await route.continue();
      } else {
        unexpectedRequests.push(requestUrl);
        await route.abort('blockedbyclient');
      }
    });

    const origin = await getChromeExtensionOrigin(context);
    const seedPage = await context.newPage();
    await seedPage.goto(`${origin}/feed.html`, { waitUntil: 'domcontentloaded' });
    await seedPage.waitForFunction(() => typeof ytIndexedDBStorage !== 'undefined' && typeof ytStorage !== 'undefined');
    await seedInExtensionPage((fn, data) => seedPage.evaluate(fn, data), fixture);
    await seedPage.close();

    for (const view of VIEWS) {
      const page = await context.newPage();
      await page.setViewportSize({ width: WIDTH, height: HEIGHT });
      await page.goto(`${origin}/feed.html`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => !document.documentElement.classList.contains('app-loading'));
      await page.locator(view.button).click();
      await page.locator(view.ready).first().waitFor({ state: 'visible', timeout: 15000 });
      await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }' });
      await page.evaluate(async () => {
        await document.fonts.ready;
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        window.scrollTo(0, 0);
      });
      await waitForChromeImages(page);
      const file = destination('chrome', view.name);
      await page.screenshot({ path: file, fullPage: false, animations: 'disabled', caret: 'hide', scale: 'css' });
      assertPng(file);
      await page.close();
      console.log(`Generated ${path.relative(ROOT, file)}`);
    }
    await generateChromePromoAssets(context);
    if (unexpectedRequests.length) {
      throw new Error(`Unexpected Chrome requests were blocked:\n${[...new Set(unexpectedRequests)].join('\n')}`);
    }
  } finally {
    if (context) await context.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

async function setFirefoxViewport(driver) {
  await driver.manage().window().setRect({ width: WIDTH, height: HEIGHT, x: 0, y: 0 });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const metrics = await driver.executeScript(() => ({
      innerWidth,
      innerHeight,
      outerWidth,
      outerHeight,
    }));
    if (metrics.innerWidth === WIDTH && metrics.innerHeight === HEIGHT) return;
    await driver.manage().window().setRect({
      width: WIDTH + Math.max(0, metrics.outerWidth - metrics.innerWidth),
      height: HEIGHT + Math.max(0, metrics.outerHeight - metrics.innerHeight),
      x: 0,
      y: 0,
    });
  }
  const finalMetrics = await driver.executeScript(() => ({ width: innerWidth, height: innerHeight }));
  if (finalMetrics.width !== WIDTH || finalMetrics.height !== HEIGHT) {
    throw new Error(`Could not set Firefox viewport to ${WIDTH}x${HEIGHT}; got ${finalMetrics.width}x${finalMetrics.height}`);
  }
}

async function generateFirefox(fixture, headed) {
  if (headed) process.env.PW_HEADED = '1';
  const session = await launchFirefoxWithExtension({ locale: 'en' });
  const { driver } = session;
  try {
    await openFirefoxExtensionPage(session, 'feed.html');
    await driver.wait(async () => driver.executeScript(() => (
      !document.documentElement.classList.contains('app-loading') &&
      typeof ytIndexedDBStorage !== 'undefined' && typeof ytStorage !== 'undefined'
    )), 15000, 'Firefox feed should initialize');
    const seedResult = await driver.executeAsyncScript((data, done) => {
      (async () => {
        await ytIndexedDBStorage.clearAll();
        await browser.storage.local.clear();
        await browser.storage.local.set(data.localData);
        for (const channel of data.channels) {
          await ytIndexedDBStorage.putSubscriptionRecord(channel);
          await ytIndexedDBStorage.putChannelSyncState({
            channelId: channel.channelId,
            initializationState: 'complete',
            lastAttemptAt: data.now,
            lastSuccessfulCheckAt: data.now,
            nextEligibleCheckAt: data.now + 365 * 24 * 60 * 60 * 1000,
            scanLeaseUntil: null,
            scanRunId: null,
            activityClass: 'active',
          });
        }
        for (const video of data.videos) await ytIndexedDBStorage.putSubscriptionFeedVideo(video);
        for (const tombstone of data.tombstones) await ytIndexedDBStorage.putLocalUnsubscribeTombstone(tombstone);
        done({ ok: true });
      })().catch((error) => done({ ok: false, error: error.message }));
    }, {
      channels: fixture.channels,
      videos: fixture.videos,
      tombstones: fixture.tombstones,
      localData: localStoragePayload(fixture),
      now: FIXED_NOW,
    });
    if (!seedResult?.ok) throw new Error(`Firefox screenshot seed failed: ${seedResult?.error}`);

    for (const view of VIEWS) {
      await openFirefoxExtensionPage(session, 'feed.html');
      await driver.wait(async () => driver.executeScript(() => (
        !document.documentElement.classList.contains('app-loading')
      )), 15000, 'Firefox feed should initialize');
      await setFirefoxViewport(driver);
      const prepared = await driver.executeAsyncScript((timestamp, done) => {
        const RealDate = Date;
        class FixedDate extends RealDate {
          constructor(...args) { super(...(args.length ? args : [timestamp])); }
          static now() { return timestamp; }
        }
        FixedDate.parse = RealDate.parse;
        FixedDate.UTC = RealDate.UTC;
        globalThis.Date = FixedDate;
        let state = 0x5eed1234;
        Math.random = () => {
          state = (state + 0x6d2b79f5) | 0;
          let value = Math.imul(state ^ (state >>> 15), 1 | state);
          value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
          return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
        };
        Promise.resolve(typeof loadData === 'function' ? loadData() : null)
          .then(() => done({ ok: true }))
          .catch((error) => done({ ok: false, error: error.message }));
      }, FIXED_NOW);
      if (!prepared?.ok) throw new Error(`Firefox fixed-state render failed: ${prepared?.error}`);
      await driver.findElement(By.css(view.button)).click();
      await driver.wait(async () => driver.executeScript((selector) => {
        const element = document.querySelector(selector);
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }, view.ready), 15000, `${view.name} should render in Firefox`);
      await driver.executeAsyncScript((done) => {
        const style = document.createElement('style');
        style.textContent = '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }';
        document.head.appendChild(style);
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        window.scrollTo(0, 0);
        document.fonts.ready.then(() => {
          const visible = [...document.images].filter((image) => {
            const rect = image.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
          const startedAt = Date.now();
          const wait = () => {
            if (visible.every((image) => image.complete && image.naturalWidth > 0)) done(true);
            else if (Date.now() - startedAt > 10000) done(false);
            else setTimeout(wait, 50);
          };
          wait();
        });
      });
      const file = destination('firefox', view.name);
      fs.writeFileSync(file, Buffer.from(await driver.takeScreenshot(), 'base64'));
      assertPng(file);
      console.log(`Generated ${path.relative(ROOT, file)}`);
    }
  } finally {
    await session.cleanup();
    if (headed) delete process.env.PW_HEADED;
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const fixture = prepareFixture();
  if (options.browser === 'all' || options.browser === 'chrome') {
    await generateChrome(fixture, options.headed);
  }
  if (options.browser === 'all' || options.browser === 'firefox') {
    await generateFirefox(fixture, options.headed);
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
