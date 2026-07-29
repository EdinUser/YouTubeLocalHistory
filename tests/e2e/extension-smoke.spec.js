/**
 * Extension smoke tests — run with project `chromium-extension` (npm run test:e2e).
 * Asserts the real unpacked build loads and the content script runs on YouTube.
 */

const { test, expect } = require('./extension-fixture');
const { dismissYouTubeConsent } = require('./youtube-consent');

async function openFunnyCatsSearch(page) {
  await page.goto('https://www.youtube.com/results?search_query=funny+cats', {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForLoadState('networkidle').catch(() => {});
  await dismissYouTubeConsent(page);
  await page.waitForSelector('ytd-video-renderer', { timeout: 30000 });
}

async function getServiceWorker(context) {
  const existing = context.serviceWorkers().find((worker) => worker.url().includes('background.js'));
  if (existing) {
    return existing;
  }

  return context.waitForEvent('serviceworker', {
    timeout: 15000,
    predicate: (worker) => worker.url().includes('background.js'),
  });
}

test.describe('Extension smoke (real browser)', () => {
  test('content script injects extension styles on YouTube', async ({ page }) => {
    await page.goto('https://www.youtube.com/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    await dismissYouTubeConsent(page);

    const style = page.locator('#ytvht-styles');
    await expect(style).toBeAttached({ timeout: 30000 });
  });

  test('popup page loads in extension context', async ({ context, page }) => {
    await page.goto('https://www.youtube.com/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    await dismissYouTubeConsent(page);

    const workers = context.serviceWorkers();
    const sw =
      workers.find((w) => w.url().includes('chrome-extension://') && w.url().includes('background')) ||
      workers.find((w) => w.url().includes('background.js'));
    expect(sw, 'extension service worker should register').toBeTruthy();

    const extensionId = new URL(sw.url()).hostname;
    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
    await expect(popupPage.locator('#ytvhtTabVideos')).toBeVisible({ timeout: 15000 });
  });

  test('search result video is tracked and saved in extension storage', async ({ context, page }) => {
    await openFunnyCatsSearch(page);

    const firstResult = page.locator('ytd-video-renderer').first();
    await expect(firstResult).toBeVisible({ timeout: 30000 });

    const resultLink = firstResult.locator('a#thumbnail[href*="watch?v="]').first();
    const resultTitle = firstResult.locator('#video-title').first();
    const videoHref = await resultLink.getAttribute('href');
    expect(videoHref, 'search result should have a watch link').toBeTruthy();

    const videoId = new URL(videoHref, 'https://www.youtube.com').searchParams.get('v');
    expect(videoId, 'search result should expose a video id').toBeTruthy();

    const expectedTitle = ((await resultTitle.textContent()) || '').trim();

    await resultLink.click();
    await page.waitForURL(/\/watch\?v=/, { timeout: 30000 });
    await dismissYouTubeConsent(page);
    await page.waitForSelector('video', { timeout: 30000 });

    await page.evaluate(async () => {
      const video = document.querySelector('video');
      if (!video) {
        throw new Error('video element not found');
      }

      video.muted = true;
      video.currentTime = 16;
      video.dispatchEvent(new Event('timeupdate'));

      try {
        await video.play();
      } catch {
        // Autoplay may still be blocked; currentTime + timeupdate is enough to trigger a save.
      }
    });

    await page.waitForTimeout(6500);

    const serviceWorker = await getServiceWorker(context);
    const savedRecord = await serviceWorker.evaluate(
      (id) =>
        new Promise((resolve) => {
          chrome.storage.local.get([`video_${id}`], (items) => resolve(items[`video_${id}`] || null));
        }),
      videoId
    );

    expect(savedRecord, 'expected watched video to be stored by the extension').toBeTruthy();
    expect(savedRecord.videoId).toBe(videoId);
    expect(savedRecord.time).toBeGreaterThan(0);
    expect(savedRecord.url).toContain(`/watch?v=${videoId}`);
    if (expectedTitle) {
      expect(savedRecord.title).toContain(expectedTitle);
    }
  });
});
