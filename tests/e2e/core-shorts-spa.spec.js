/**
 * Live contract for Shorts entered through YouTube's SPA navigation.
 */

const { test, expect } = require('./extension-fixture');
const { dismissYouTubeConsent } = require('./youtube-consent');
const {
  getStoredVideo,
  removeStoredVideo,
  setExtensionSettings,
} = require('./chromium-extension-storage');

const HOME_URL = 'https://www.youtube.com/';
const TEST_TIMEOUT_MS = 240000;
const DEFAULT_SETTINGS = {
  autoCleanPeriod: 'forever',
  paginationCount: 10,
  overlayTitle: 'viewed',
  overlayColor: 'blue',
  overlayLabelSize: 'medium',
  debug: true,
  pauseHistoryInPlaylists: false,
};

function shortsVideoId(url) {
  return new URL(url).pathname.match(/^\/shorts\/([^/?#]+)/)?.[1] || '';
}

async function accessBlock(page) {
  return page.evaluate(() => {
    const text = document.body?.innerText || '';
    const pattern = [/unusual traffic/i, /captcha/i, /not a robot/i, /verify you are human/i]
      .find((candidate) => candidate.test(text));
    return pattern ? `YouTube access blocked by ${pattern}` : null;
  });
}

async function activeShortState(page) {
  return page.evaluate(() => {
    const videos = [...document.querySelectorAll('video')];
    const visible = (video) => {
      const rect = video.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const video = videos.find((candidate) => visible(candidate) && !candidate.paused && candidate.readyState >= 1)
      || videos.find((candidate) => visible(candidate) && candidate.readyState >= 1)
      || null;
    const reel = video?.closest('ytd-reel-video-renderer') || null;
    const videoId = window.location.pathname.match(/^\/shorts\/([^/?#]+)/)?.[1] || '';
    const reelVideoId = [...(reel?.querySelectorAll('a[href*="/shorts/"]') || [])]
      .map((link) => (link.getAttribute('href') || '').match(/\/shorts\/([\w-]+)/)?.[1] || '')
      .find(Boolean) || '';
    const titleEl = reel?.querySelector([
      'yt-shorts-video-title-view-model h1',
      'yt-shorts-video-title-view-model h2',
      'yt-shorts-video-title-view-model [aria-label]',
      'a.ytp-title-link[href*="/shorts/"]',
      'yt-shorts-video-title-view-model',
    ].join(', '));
    const channelLink = reel?.querySelector([
      'yt-reel-channel-bar-view-model a[href^="/@"]',
      'yt-reel-channel-bar-view-model a[href^="/channel/"]',
      'a[href^="/@"][href$="/shorts"]',
      'a[href*="youtube.com/@"][href$="/shorts"]',
      'a[href^="/channel/"]',
      'a[href*="youtube.com/channel/"]',
      'ytd-channel-name a',
      '#owner-name a',
      'a[href^="/@"]',
    ].join(', '));
    const channelHref = channelLink?.getAttribute('href') || '';
    const channelId = channelHref.match(/\/channel\/([^/?#]+)/)?.[1]
      || channelHref.match(/\/@([^/?#]+)/)?.[1]
      || '';
    return {
      videoId,
      reelVideoId,
      found: !!video,
      duration: video && Number.isFinite(video.duration) ? video.duration : 0,
      readyState: video ? video.readyState : 0,
      title: (titleEl?.getAttribute('aria-label') || titleEl?.textContent || '').trim(),
      channelName: (channelLink?.textContent || '').trim(),
      channelId,
    };
  });
}

async function waitForActiveShort(page, expectedDifferentFrom = '', expectedVideoId = '') {
  await expect.poll(async () => {
    const state = await activeShortState(page);
    return state.found
      && state.readyState >= 1
      && state.duration > 0
      && state.videoId
      && state.videoId !== expectedDifferentFrom
      && (!expectedVideoId || state.videoId === expectedVideoId)
      && state.reelVideoId === state.videoId
      && !!state.title
      && !!state.channelName
      && !!state.channelId;
  }, { timeout: 60000 }).toBe(true);
  return activeShortState(page);
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function expectStoredShortMatchesActive(record, active) {
  expect(record).toMatchObject({
    videoId: active.videoId,
    isShorts: true,
    url: `https://www.youtube.com/shorts/${active.videoId}`,
  });
  expect(normalizeText(record.title)).toBe(normalizeText(active.title));
  expect(normalizeText(record.channelName)).toBe(normalizeText(active.channelName));
  expect(record.channelId).toBe(active.channelId);
}

async function extensionOrigin(context) {
  const worker = context.serviceWorkers().find((item) => item.url().includes('background.js'))
    || await context.waitForEvent('serviceworker', {
      predicate: (item) => item.url().includes('background.js'),
    });
  const workerUrl = new URL(worker.url());
  return `${workerUrl.protocol}//${workerUrl.host}`;
}

async function openShortsFromYouTubeMenu(page) {
  await page.goto(HOME_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  await dismissYouTubeConsent(page);

  const blocked = await accessBlock(page);
  if (blocked) return blocked;

  await expect(page.locator('a[href="/shorts/"]:visible').first()).toBeVisible({ timeout: 30000 });
  await page.locator('a[href="/shorts/"]:visible').first().evaluate((anchor) => anchor.click());
  await expect.poll(() => shortsVideoId(page.url()), { timeout: 60000 }).toMatch(/^[\w-]+$/);
  return null;
}

async function dispatchTrackedSave(page) {
  await page.evaluate(() => {
    const videos = [...document.querySelectorAll('video')].filter((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && candidate.readyState >= 1;
    });
    const video = videos.find((candidate) => !candidate.paused) || videos[0];
    if (!video) throw new Error('Active Shorts video element not found');

    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 10;
    video.muted = true;
    video.currentTime = Math.min(5, Math.max(1, duration / 2));
    video.dispatchEvent(new Event('timeupdate'));
    video.dispatchEvent(new Event('seeked'));
    video.dispatchEvent(new Event('pause'));
  });
  await page.waitForTimeout(900);
  return activeShortState(page);
}

async function clickNextShort(page) {
  const next = page.getByRole('button', { name: 'Next video' });
  await expect(next).toBeVisible({ timeout: 30000 });
  await next.click();
}

async function verifyDirectLoad(page, context, active) {
  await removeStoredVideo(context, active.videoId);
  await page.goto(`https://www.youtube.com/shorts/${active.videoId}`, { waitUntil: 'domcontentloaded' });
  await dismissYouTubeConsent(page);
  const direct = await waitForActiveShort(page, '', active.videoId);
  const savedDirect = await dispatchTrackedSave(page);
  expect(savedDirect.videoId).toBe(direct.videoId);
  await expect.poll(() => getStoredVideo(context, direct.videoId), { timeout: 15000 })
    .not.toBeNull();
  const record = await getStoredVideo(context, direct.videoId);
  expectStoredShortMatchesActive(record, savedDirect);
}

async function verifyFeedPlacement(context, videoIds) {
  const feed = await context.newPage();
  await feed.goto(`${await extensionOrigin(context)}/feed.html`, { waitUntil: 'domcontentloaded' });
  await expect(feed.locator('html')).not.toHaveClass(/app-loading/);
  await feed.locator('#navShorts').click();
  for (const videoId of videoIds) {
    await expect(feed.locator(`.ytvht-feed-card[data-ytvht-video-id="${videoId}"]`)).toBeVisible();
  }
  await feed.locator('#navHistory').click();
  for (const videoId of videoIds) {
    await expect(feed.locator(`.history-row[data-ytvht-video-id="${videoId}"]`)).toHaveCount(0);
  }
  await feed.close();
}

test.describe('Shorts SPA tracking (live YouTube)', () => {
  test.setTimeout(TEST_TIMEOUT_MS);

  test('detects Shorts across SPA, scroll, direct load, and feed projection', async ({ context, page }, testInfo) => {
    const extensionLogs = [];
    page.on('console', (message) => {
      const value = message.text();
      if (value.includes('[ythdb]') || value.includes('[Storage]')) extensionLogs.push(value);
    });

    await setExtensionSettings(context, DEFAULT_SETTINGS);

    try {
      const blocked = await openShortsFromYouTubeMenu(page);
      test.skip(!!blocked, blocked);

      const first = await waitForActiveShort(page);
      await removeStoredVideo(context, first.videoId);
      const savedFirst = await dispatchTrackedSave(page);
      expect(savedFirst.videoId).toBe(first.videoId);

      await expect.poll(() => getStoredVideo(context, first.videoId), { timeout: 15000 })
        .toMatchObject({ videoId: first.videoId, isShorts: true });
      const initialRecord = await getStoredVideo(context, first.videoId);
      expectStoredShortMatchesActive(initialRecord, savedFirst);

      // Establish that the transition itself, rather than an earlier timer,
      // is responsible for retaining the outgoing Short.
      await removeStoredVideo(context, first.videoId);
      await clickNextShort(page);
      const second = await waitForActiveShort(page, first.videoId);
      const savedSecond = await dispatchTrackedSave(page);
      expect(savedSecond.videoId).toBe(second.videoId);

      await expect.poll(() => getStoredVideo(context, second.videoId), { timeout: 15000 })
        .toMatchObject({ videoId: second.videoId, isShorts: true });
      const secondRecord = await getStoredVideo(context, second.videoId);
      expectStoredShortMatchesActive(secondRecord, savedSecond);
      await expect.poll(() => getStoredVideo(context, first.videoId), { timeout: 10000 })
        .toMatchObject({ videoId: first.videoId, isShorts: true });
      const outgoingRecord = await getStoredVideo(context, first.videoId);
      expectStoredShortMatchesActive(outgoingRecord, savedFirst);

      await verifyDirectLoad(page, context, second);
      await verifyFeedPlacement(context, [first.videoId, second.videoId]);
    } finally {
      await testInfo.attach('extension-debug.log', {
        body: extensionLogs.join('\n') || '(no extension debug logs captured)',
        contentType: 'text/plain',
      });
    }
  });
});
