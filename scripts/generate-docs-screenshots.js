#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('@playwright/test');

const ROOT = path.resolve(__dirname, '..');
const CATALOG_PATH = path.join(__dirname, 'docs-screenshot-catalog.json');
const DEFAULT_EXTENSION_PATH = path.join(ROOT, 'build', 'e2e', 'chrome');

function parseArguments(argv) {
  const options = { only: null, outputDir: null, list: false, headed: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--list') options.list = true;
    else if (argument === '--headed') options.headed = true;
    else if (argument === '--only') options.only = String(argv[++index] || '').split(',').filter(Boolean);
    else if (argument === '--output-dir') options.outputDir = argv[++index] || '';
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (options.outputDir === '') throw new Error('--output-dir requires a path');
  return options;
}

function readCatalog() {
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  if (catalog.schemaVersion !== 1 || !catalog.defaults || !Array.isArray(catalog.screenshots)) {
    throw new Error('Unsupported documentation screenshot catalogue');
  }
  const ids = new Set();
  const outputs = new Set();
  catalog.screenshots.forEach((entry) => {
    if (!entry.id || !entry.page || !entry.view || !entry.output || !entry.readySelector) {
      throw new Error('Every screenshot entry requires id, page, view, output, and readySelector');
    }
    if (ids.has(entry.id)) throw new Error(`Duplicate screenshot id: ${entry.id}`);
    if (outputs.has(entry.output)) throw new Error(`Duplicate screenshot output: ${entry.output}`);
    ids.add(entry.id);
    outputs.add(entry.output);
  });
  return catalog;
}

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  }[character]));
}

function svgDataUri({ width, height, label, start, end, subtitle = '' }) {
  const fontSize = Math.max(22, Math.round(width / 18));
  const subtitleSize = Math.max(14, Math.round(fontSize * 0.42));
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${start}"/>
      <stop offset="1" stop-color="${end}"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" rx="${Math.round(width * 0.04)}" fill="url(#g)"/>
  <circle cx="${Math.round(width * 0.82)}" cy="${Math.round(height * 0.18)}" r="${Math.round(width * 0.16)}" fill="#fff" opacity=".12"/>
  <circle cx="${Math.round(width * 0.16)}" cy="${Math.round(height * 0.88)}" r="${Math.round(width * 0.22)}" fill="#fff" opacity=".08"/>
  <text x="${Math.round(width * 0.08)}" y="${Math.round(height * 0.55)}" fill="#fff" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="700">${escapeXml(label)}</text>
  <text x="${Math.round(width * 0.08)}" y="${Math.round(height * 0.68)}" fill="#fff" opacity=".82" font-family="Arial, sans-serif" font-size="${subtitleSize}">${escapeXml(subtitle)}</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.trim())}`;
}

function buildFixture(fixedNow) {
  const day = 24 * 60 * 60 * 1000;
  const channelDefinitions = [
    ['UCdocsAtlasWorkshop001', 'Atlas Workshop', '@atlasworkshop', '#2855d9', '#50b6ff'],
    ['UCdocsQuietKitchen002', 'Quiet Kitchen', '@quietkitchen', '#c7477b', '#ff9d67'],
    ['UCdocsFieldNotesStudio3', 'Field Notes Studio', '@fieldnotesstudio', '#16856b', '#65d39f'],
    ['UCdocsNightSkyLab0004', 'Night Sky Lab', '@nightskylab', '#5137a5', '#a66cff'],
  ];
  const channels = channelDefinitions.map(([channelId, channelTitle, handle, start, end], index) => ({
    channelId,
    channelTitle,
    handle,
    source: 'manual',
    followedAt: fixedNow - (index + 8) * day,
    metadataHydratedAt: fixedNow,
    thumbnail: svgDataUri({ width: 160, height: 160, label: channelTitle.slice(0, 1), start, end }),
    bannerUrl: svgDataUri({ width: 960, height: 180, label: '', start, end }),
    subscriberCount: `${42 + index * 37}K subscribers`,
    videoCount: String(120 + index * 34),
    latestUploadAt: fixedNow - (index + 1) * 60 * 60 * 1000,
  }));

  const videoDefinitions = [
    ['docs-video-01', 0, 'Build a calm weekly planning system', 'Planning', 1, 1180, false],
    ['docs-video-02', 1, 'Five pantry dinners for busy evenings', 'Cooking', 2, 860, false],
    ['docs-video-03', 2, 'A quiet walk through the coastal forest', 'Field journal', 3, 1325, false],
    ['docs-video-04', 3, 'What to look for in the August night sky', 'Astronomy', 4, 1040, false],
    ['docs-video-05', 0, 'Designing a workspace that stays useful', 'Workshop', 6, 1540, false],
    ['docs-video-06', 1, 'Bread techniques worth practicing', 'Kitchen notes', 8, 975, false],
    ['docs-video-07', 2, 'How field recordings shape a story', 'Audio journal', 12, 1240, false],
    ['docs-short-01', 3, 'Find north using two familiar stars', 'One-minute sky', 1, 52, true],
    ['docs-short-02', 1, 'The fastest way to sharpen a kitchen knife', 'Quick skill', 3, 43, true],
    ['docs-short-03', 0, 'A two-minute desk reset', 'Small systems', 5, 68, true],
    ['docs-short-04', 2, 'Listen for this woodland rhythm', 'Sound note', 7, 39, true],
  ];

  const videos = videoDefinitions.map(([videoId, channelIndex, title, subtitle, ageHours, durationSeconds, isShort], index) => {
    const channel = channels[channelIndex];
    const colors = channelDefinitions[channelIndex].slice(3);
    return {
      videoId,
      channelId: channel.channelId,
      channelTitle: channel.channelTitle,
      title,
      thumbnailUrl: svgDataUri({
        width: isShort ? 360 : 640,
        height: isShort ? 640 : 360,
        label: subtitle,
        subtitle: channel.channelTitle,
        start: colors[0],
        end: colors[1],
      }),
      publishedAt: fixedNow - ageHours * 60 * 60 * 1000,
      discoveredAt: fixedNow - ageHours * 60 * 60 * 1000,
      lastSeenInFeedAt: fixedNow - Math.max(1, ageHours - 1) * 60 * 60 * 1000,
      durationSeconds,
      isShort,
      viewCountText: `${18 + index * 7}K views`,
      source: 'rss',
    };
  });

  const history = [
    { videoId: 'docs-video-01', title: videos[0].title, channelName: channels[0].channelTitle, time: 412, duration: 1180, timestamp: fixedNow - 90 * 60 * 1000 },
    { videoId: 'docs-video-03', title: videos[2].title, channelName: channels[2].channelTitle, time: 875, duration: 1325, timestamp: fixedNow - 5 * 60 * 60 * 1000 },
    { videoId: 'docs-video-06', title: videos[5].title, channelName: channels[1].channelTitle, time: 214, duration: 975, timestamp: fixedNow - 28 * 60 * 60 * 1000 },
    { videoId: 'docs-archive-01', title: 'The notebook method I still use', channelName: channels[0].channelTitle, time: 700, duration: 700, timestamp: fixedNow - 3 * day },
    { videoId: 'docs-archive-02', title: 'A practical guide to recording outdoors', channelName: channels[2].channelTitle, time: 930, duration: 930, timestamp: fixedNow - 5 * day },
  ].map((record) => ({
    ...record,
    url: `https://www.youtube.com/watch?v=${record.videoId}`,
    type: 'video',
  }));

  const watchLater = [
    { videoId: 'docs-later-01', title: 'A beginner-friendly guide to meteor showers', channelName: channels[3].channelTitle, addedAt: fixedNow - 35 * 60 * 1000 },
    { videoId: 'docs-later-02', title: 'Make a useful weekly meal template', channelName: channels[1].channelTitle, addedAt: fixedNow - 7 * 60 * 60 * 1000 },
  ].map((record) => ({
    ...record,
    url: `https://www.youtube.com/watch?v=${record.videoId}`,
  }));

  const playlists = [
    ['PLdocsReferenceFocus01', 'Focus and planning', 18, 0],
    ['PLdocsReferenceKitchen2', 'Reliable kitchen techniques', 26, 1],
    ['PLdocsReferenceNature03', 'Field notes and quiet places', 14, 2],
  ].map(([playlistId, title, videoCount, channelIndex], index) => ({
    playlistId,
    title,
    videoCount,
    url: `https://www.youtube.com/playlist?list=${playlistId}`,
    thumbnail: videos.find((video) => video.channelId === channels[channelIndex].channelId).thumbnailUrl,
    timestamp: fixedNow - (index + 2) * day,
    lastUpdated: fixedNow - (index + 1) * day,
  }));

  const daily = {};
  [24, 31, 18, 44, 27, 52, 36].forEach((minutes, index) => {
    const date = new Date(fixedNow - (6 - index) * day).toISOString().slice(0, 10);
    daily[date] = minutes * 60;
  });
  const hourly = new Array(24).fill(0);
  [7, 8, 12, 17, 18, 20, 21].forEach((hour, index) => { hourly[hour] = (index + 2) * 540; });

  return {
    channels,
    videos,
    history,
    watchLater,
    playlists,
    settings: {
      themePreference: 'dark',
      accentColor: 'blue',
      overlayColor: 'blue',
      overlayTitle: 'viewed',
      overlayLabelSize: 'medium',
      paginationCount: 20,
      localFeedEnabled: true,
      feedRefreshMinutes: 60,
      hideMembers: false,
      hideLive: false,
      hideWatched: false,
    },
    stats: {
      totalWatchSeconds: 13 * 60 * 60 + 24 * 60,
      daily,
      hourly,
      lastUpdated: fixedNow,
      counters: { videos: 42, shorts: 12, totalDurationSeconds: 61140, completed: 29 },
      stats_synced: true,
      lastFullRebuild: fixedNow,
    },
  };
}

async function getExtensionOrigin(context) {
  const worker = context.serviceWorkers().find((candidate) => candidate.url().includes('background.js'))
    || await context.waitForEvent('serviceworker', {
      timeout: 15000,
      predicate: (candidate) => candidate.url().includes('background.js'),
    });
  const url = new URL(worker.url());
  return `${url.protocol}//${url.host}`;
}

async function seedExtension(context, extensionOrigin, fixture, fixedNow) {
  const page = await context.newPage();
  await page.goto(`${extensionOrigin}/feed.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof ytIndexedDBStorage !== 'undefined' && typeof ytStorage !== 'undefined');
  await page.evaluate(async (data) => {
    await ytIndexedDBStorage.clearAll();
    await chrome.storage.local.clear();

    const localData = {
      settings: data.settings,
      popupAccentColor: data.settings.accentColor,
      stats: data.stats,
      localVideoPlaylists: {},
      feedFeedback: { notInterested: {}, channelLess: {}, channelMore: {} },
    };
    data.history.forEach((record) => { localData[`video_${record.videoId}`] = record; });
    data.watchLater.forEach((record) => { localData[`watchlater_${record.videoId}`] = record; });
    data.playlists.forEach((record) => { localData[`playlist_${record.playlistId}`] = record; });
    await chrome.storage.local.set(localData);

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
  }, { ...fixture, now: fixedNow });
  await page.close();
}

async function activateView(page, entry) {
  if (entry.page === 'feed.html') {
    await page.waitForFunction(() => !document.documentElement.classList.contains('app-loading'));
    await page.evaluate(async () => { if (typeof loadData === 'function') await loadData(); });
  } else {
    await page.waitForFunction(() => typeof loadHistory === 'function' && typeof switchTab === 'function');
  }

  const selectors = {
    'popup-videos': '#ytvhtTabVideos',
    'feed-home': '#navHome',
    'feed-subscriptions': '#navSubscriptions',
    'feed-shorts': '#navShorts',
    'feed-playlists': '#navPlaylists',
    'feed-history': '#navHistory',
    'feed-channels': '#manage',
    'feed-analytics': '#analyticsToggle',
    'feed-settings': '#navSettings',
  };
  const selector = selectors[entry.view];
  if (!selector) throw new Error(`No capture action is registered for ${entry.view}`);
  if (entry.view === 'popup-videos') {
    await page.evaluate(async () => { await loadHistory(true); });
  }
  await page.locator(selector).click();
}

function outputPath(entry, outputDirectory) {
  if (outputDirectory) return path.resolve(outputDirectory, path.basename(entry.output));
  const destination = path.resolve(ROOT, entry.output);
  const expectedRoot = `${path.join(ROOT, 'docs', 'assets', 'guide')}${path.sep}`;
  if (!destination.startsWith(expectedRoot)) {
    throw new Error(`Screenshot output must stay under docs/assets/guide: ${entry.output}`);
  }
  return destination;
}

function assertPngDimensions(file, expected) {
  const data = fs.readFileSync(file);
  if (data.length < 24 || data.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error(`Screenshot is not a PNG: ${file}`);
  }
  const actual = { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  if (actual.width !== expected.width || actual.height !== expected.height) {
    throw new Error(`Unexpected dimensions for ${path.basename(file)}: ${actual.width}x${actual.height}, expected ${expected.width}x${expected.height}`);
  }
}

async function waitForVisibleImages(page) {
  await page.waitForFunction(() => [...document.images]
    .filter((image) => image.getBoundingClientRect().width > 0 && image.getBoundingClientRect().height > 0)
    .every((image) => image.complete && image.naturalWidth > 0), null, { timeout: 10000 });
}

async function captureEntry(context, extensionOrigin, entry, outputDirectory) {
  const page = await context.newPage();
  await page.setViewportSize(entry.viewport);
  await page.goto(`${extensionOrigin}/${entry.page}`, { waitUntil: 'domcontentloaded' });
  await activateView(page, entry);
  await page.locator(entry.readySelector).first().waitFor({ state: 'visible', timeout: 15000 });
  await page.evaluate(async () => {
    await document.fonts.ready;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    window.scrollTo(0, 0);
  });
  if (entry.capture.type === 'element' && entry.capture.selector === 'body') {
    await page.evaluate(({ width, height }) => {
      document.body.style.width = `${width}px`;
      document.body.style.height = `${height}px`;
      document.body.style.minHeight = `${height}px`;
      document.body.style.maxHeight = `${height}px`;
    }, entry.display);
  }
  await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }' });
  await waitForVisibleImages(page);

  const destination = outputPath(entry, outputDirectory);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const screenshotOptions = { path: destination, animations: 'disabled', caret: 'hide', scale: 'css' };
  if (entry.capture.type === 'element') {
    await page.locator(entry.capture.selector).screenshot(screenshotOptions);
  } else {
    await page.screenshot({ ...screenshotOptions, fullPage: false });
  }
  assertPngDimensions(destination, entry.display);
  await page.close();
  console.log(`Generated ${entry.id}: ${path.relative(ROOT, destination) || destination}`);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const catalog = readCatalog();
  if (options.list) {
    catalog.screenshots.forEach((entry) => console.log(`${entry.id}\t${entry.output}`));
    return;
  }

  const selected = options.only
    ? catalog.screenshots.filter((entry) => options.only.includes(entry.id))
    : catalog.screenshots;
  if (options.only) {
    const found = new Set(selected.map((entry) => entry.id));
    const missing = options.only.filter((id) => !found.has(id));
    if (missing.length) throw new Error(`Unknown screenshot id: ${missing.join(', ')}`);
  }

  const extensionPath = path.resolve(process.env.YTLH_CHROME_EXTENSION_DIR || DEFAULT_EXTENSION_PATH);
  if (!fs.existsSync(path.join(extensionPath, 'manifest.json'))) {
    throw new Error(`Unpacked Chrome extension not found at ${extensionPath}. Run npm run build:e2e:chrome first.`);
  }

  const fixedNow = Date.parse(catalog.defaults.fixedNow);
  if (!Number.isFinite(fixedNow)) throw new Error('Catalogue fixedNow must be an ISO date');
  const fixture = buildFixture(fixedNow);
  const thumbnailByVideoId = new Map(fixture.videos.map((video) => [video.videoId, video.thumbnailUrl]));
  fixture.history.forEach((record, index) => {
    if (!thumbnailByVideoId.has(record.videoId)) {
      thumbnailByVideoId.set(record.videoId, svgDataUri({
        width: 640, height: 360, label: 'Watch history', subtitle: record.channelName,
        start: index % 2 ? '#385170' : '#68478c', end: index % 2 ? '#62b6cb' : '#cf6a87',
      }));
    }
  });
  fixture.watchLater.forEach((record, index) => {
    thumbnailByVideoId.set(record.videoId, svgDataUri({
      width: 640, height: 360, label: 'Watch later', subtitle: record.channelName,
      start: index ? '#a15c38' : '#355c7d', end: index ? '#d9a441' : '#6c5b7b',
    }));
  });

  const temporaryProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'rewatch-docs-'));
  const unexpectedRequests = [];
  let context;
  try {
    context = await chromium.launchPersistentContext(temporaryProfile, {
      channel: process.env.DOCS_SCREENSHOT_BROWSER_CHANNEL || 'chromium',
      headless: !options.headed,
      locale: catalog.defaults.locale,
      timezoneId: 'UTC',
      colorScheme: catalog.defaults.theme,
      reducedMotion: 'reduce',
      deviceScaleFactor: catalog.defaults.deviceScaleFactor,
      viewport: { width: 1440, height: 960 },
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        `--lang=${catalog.defaults.locale}`,
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

      let randomState = 0x5eed1234;
      Math.random = () => {
        randomState = (randomState + 0x6d2b79f5) | 0;
        let value = Math.imul(randomState ^ (randomState >>> 15), 1 | randomState);
        value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
      };
    }, fixedNow);
    await context.route('**/*', async (route) => {
      const requestUrl = route.request().url();
      const url = new URL(requestUrl);
      if (['chrome-extension:', 'data:', 'blob:', 'about:'].includes(url.protocol)) {
        await route.continue();
        return;
      }
      if (url.hostname === 'i.ytimg.com') {
        const match = url.pathname.match(/\/vi\/([^/]+)\//);
        const dataUri = thumbnailByVideoId.get(match && decodeURIComponent(match[1]))
          || svgDataUri({ width: 640, height: 360, label: 're:Watch', subtitle: 'Documentation fixture', start: '#29323c', end: '#485563' });
        await route.fulfill({
          status: 200,
          contentType: 'image/svg+xml',
          body: decodeURIComponent(dataUri.split(',')[1]),
        });
        return;
      }
      unexpectedRequests.push(requestUrl);
      await route.abort('blockedbyclient');
    });

    const extensionOrigin = await getExtensionOrigin(context);
    await seedExtension(context, extensionOrigin, fixture, fixedNow);
    for (const entry of selected) {
      await captureEntry(context, extensionOrigin, entry, options.outputDir);
    }
    if (unexpectedRequests.length) {
      throw new Error(`Unexpected external requests were blocked:\n${[...new Set(unexpectedRequests)].join('\n')}`);
    }
  } finally {
    if (context) await context.close();
    fs.rmSync(temporaryProfile, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
