/**
 * Core contract tests: saved extension history must resume the real YouTube player.
 */

const { test, expect } = require('./extension-fixture');
const { dismissYouTubeConsent } = require('./youtube-consent');
const {
  getStoredVideo,
  removeStoredVideo,
  setExtensionSettings,
} = require('./chromium-extension-storage');

const VIDEO_ID = 'dQw4w9WgXcQ';
const WATCH_URL = `https://www.youtube.com/watch?v=${VIDEO_ID}`;
const TARGET_TIME = 45;
const RESUME_TOLERANCE = 2;
const PRIMARY_VIDEO_SELECTOR = '#movie_player video.html5-main-video, ytd-player video.html5-main-video';
const DEFAULT_SETTINGS = {
  autoCleanPeriod: 90,
  paginationCount: 10,
  overlayTitle: 'viewed',
  overlayColor: 'blue',
  overlayLabelSize: 'medium',
  debug: true,
  pauseHistoryInPlaylists: false,
};

async function enableExtensionDebug(context) {
  await setExtensionSettings(context, DEFAULT_SETTINGS);
}

async function openWatchPage(page) {
  await page.goto(WATCH_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  await dismissYouTubeConsent(page);

  if (!page.url().includes('/watch')) {
    await page.goto(WATCH_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    await dismissYouTubeConsent(page);
  }

  await page.waitForSelector(PRIMARY_VIDEO_SELECTOR, { timeout: 30000 });
}

async function waitForPrimaryVideo(page) {
  const deadline = Date.now() + 90000;

  await expect
    .poll(
      async () =>
        page.evaluate((selector) => {
          const video = document.querySelector(selector);
          return {
            found: !!video,
            duration: video && Number.isFinite(video.duration) ? video.duration : 0,
            readyState: video ? video.readyState : 0,
          };
        }, PRIMARY_VIDEO_SELECTOR),
      { timeout: 30000 }
    )
    .toMatchObject({ found: true, readyState: expect.any(Number) });

  while (Date.now() < deadline) {
    await skipYouTubeAdIfPossible(page);

    const duration = await page.evaluate((selector) => {
      const video = document.querySelector(selector);
      return video && Number.isFinite(video.duration) ? video.duration : 0;
    }, PRIMARY_VIDEO_SELECTOR);

    if (duration > TARGET_TIME + 20) {
      return;
    }

    await page.waitForTimeout(1000);
  }

  const finalDuration = await page.evaluate((selector) => {
    const video = document.querySelector(selector);
    return video && Number.isFinite(video.duration) ? video.duration : 0;
  }, PRIMARY_VIDEO_SELECTOR);
  expect(finalDuration).toBeGreaterThan(TARGET_TIME + 20);
}

async function skipYouTubeAdIfPossible(page) {
  const skipButton = page
    .locator('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, button')
    .filter({ hasText: /skip/i })
    .first();

  if (await skipButton.isVisible({ timeout: 250 }).catch(() => false)) {
    await skipButton.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(500);
  }
}

async function setVideoTime(page, seconds) {
  await page.evaluate(({ time, selector }) => {
    const video = document.querySelector(selector);
    if (!video) {
      throw new Error('video element not found');
    }

    video.muted = true;
    video.pause();
    video.currentTime = time;
  }, { time: seconds, selector: PRIMARY_VIDEO_SELECTOR });

  await expect
    .poll(
      () =>
        page.evaluate((selector) => {
          const video = document.querySelector(selector);
          return video ? video.currentTime : 0;
        }, PRIMARY_VIDEO_SELECTOR),
      { timeout: 15000 }
    )
    .toBeGreaterThanOrEqual(seconds - 1);

  await page.evaluate((selector) => {
    const video = document.querySelector(selector);
    if (!video) {
      throw new Error('video element not found');
    }

    video.dispatchEvent(new Event('timeupdate'));
    video.dispatchEvent(new Event('seeked'));
    video.dispatchEvent(new Event('pause'));
  }, PRIMARY_VIDEO_SELECTOR);
}

async function saveVideoAtTime(context, page, seconds) {
  const deadline = Date.now() + 30000;
  let lastSavedTime = 0;

  while (Date.now() < deadline) {
    await setVideoTime(page, seconds);
    await page.waitForTimeout(900);

    const record = await getStoredVideo(context, VIDEO_ID);
    lastSavedTime = record && typeof record.time === 'number' ? record.time : 0;
    if (lastSavedTime >= seconds - RESUME_TOLERANCE) {
      return record;
    }
  }

  throw new Error(`Expected extension to save ${seconds}s, last saved time was ${lastSavedTime}s`);
}

async function pauseVideo(page) {
  await page.evaluate((selector) => {
    const video = document.querySelector(selector);
    if (video) {
      video.pause();
    }
  }, PRIMARY_VIDEO_SELECTOR);
}

async function clearYouTubeOriginState(context, page) {
  const client = await context.newCDPSession(page);
  await client.send('Storage.clearDataForOrigin', {
    origin: 'https://www.youtube.com',
    storageTypes: 'all',
  });
  await context.clearCookies();
}

async function expectPlayerAtOrAfterSavedTime(page) {
  await expect
    .poll(
      () =>
        page.evaluate((selector) => {
          const video = document.querySelector(selector);
          return video ? video.currentTime : 0;
        }, PRIMARY_VIDEO_SELECTOR),
      { timeout: 30000 }
    )
    .toBeGreaterThanOrEqual(TARGET_TIME - RESUME_TOLERANCE);
}

test.describe('Core resume contract (real YouTube)', () => {
  test.setTimeout(240000);

  test('saved timestamp resumes after leaving the video and after a clean reload', async ({ context, page }, testInfo) => {
    const extensionLogs = [];
    page.on('console', (message) => {
      const text = message.text();
      if (text.includes('[ythdb]') || text.includes('[Storage]')) {
        extensionLogs.push(text);
      }
    });

    await enableExtensionDebug(context);

    try {
      await removeStoredVideo(context, VIDEO_ID);
      await openWatchPage(page);
      await waitForPrimaryVideo(page);

      const startingTime = await page.evaluate((selector) => {
        const video = document.querySelector(selector);
        video.pause();
        return video.currentTime;
      }, PRIMARY_VIDEO_SELECTOR);
      expect(startingTime, 'fresh test profile should start below the saved-time range')
        .toBeLessThan(TARGET_TIME - RESUME_TOLERANCE);

      const savedRecord = await saveVideoAtTime(context, page, TARGET_TIME);
      expect(savedRecord.videoId).toBe(VIDEO_ID);
      expect(savedRecord.url).toBe(WATCH_URL);
      expect(savedRecord.time).toBeGreaterThanOrEqual(TARGET_TIME - RESUME_TOLERANCE);

      await pauseVideo(page);
      await page.goto('https://www.youtube.com/results?search_query=playwright+testing', {
        waitUntil: 'domcontentloaded',
      });
      await dismissYouTubeConsent(page);
      await clearYouTubeOriginState(context, page);
      await expect
        .poll(async () => {
          const record = await getStoredVideo(context, VIDEO_ID);
          return record ? record.time : 0;
        })
        .toBeGreaterThanOrEqual(TARGET_TIME - RESUME_TOLERANCE);

      await openWatchPage(page);
      await waitForPrimaryVideo(page);
      await expectPlayerAtOrAfterSavedTime(page);

      await pauseVideo(page);
      await clearYouTubeOriginState(context, page);
      await expect
        .poll(async () => {
          const record = await getStoredVideo(context, VIDEO_ID);
          return record ? record.time : 0;
        })
        .toBeGreaterThanOrEqual(TARGET_TIME - RESUME_TOLERANCE);

      await openWatchPage(page);
      await waitForPrimaryVideo(page);
      await expectPlayerAtOrAfterSavedTime(page);
    } finally {
      await testInfo.attach('extension-debug.log', {
        body: extensionLogs.join('\n') || '(no extension debug logs captured)',
        contentType: 'text/plain',
      });
    }
  });
});
