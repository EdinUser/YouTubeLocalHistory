/**
 * Core overlay contract tests: saved extension history must mark live YouTube list items.
 */

const { test, expect } = require('./extension-fixture');
const { dismissYouTubeConsent } = require('./youtube-consent');
const {
  getStoredVideo,
  seedStoredVideo: seedExtensionVideo,
} = require('./chromium-extension-storage');

const PLAYLIST_URL = 'https://www.youtube.com/playlist?list=PLQga0f7orXVB8fZObVcpXuX-2swTybQqR';
const CHANNEL_VIDEOS_URL = 'https://www.youtube.com/@TodorKirilov/videos';
const SAVED_TIME = 45;
const SAVED_DURATION = 180;

async function seedStoredVideo(context, videoId) {
  await seedExtensionVideo(context, videoId, {
    title: `Overlay test video ${videoId}`,
    time: SAVED_TIME,
    duration: SAVED_DURATION,
    timestamp: Date.now(),
    url: `https://www.youtube.com/watch?v=${videoId}`,
    channelName: 'Overlay Test Channel',
    channelId: '@TodorKirilov',
  });
}

async function openYouTubeListPage(page, url, expectedUrlPattern) {
  await gotoWithRetry(page, url);
  await page.waitForLoadState('networkidle').catch(() => {});
  await dismissYouTubeConsent(page);

  if (!expectedUrlPattern.test(page.url())) {
    await gotoWithRetry(page, url);
    await page.waitForLoadState('networkidle').catch(() => {});
    await dismissYouTubeConsent(page);
  }
}

async function gotoWithRetry(page, url) {
  let lastError;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      return;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(1000 * (attempt + 1));
    }
  }

  throw lastError;
}

async function getFirstVisibleVideoId(page) {
  return expect
    .poll(
      () =>
        page.evaluate(() => {
          const anchors = [...document.querySelectorAll('a[href*="watch?v="]')];
          for (const anchor of anchors) {
            const rect = anchor.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) continue;

            try {
              const videoId = new URL(anchor.href, window.location.href).searchParams.get('v');
              if (videoId) return videoId;
            } catch {
              /* continue */
            }
          }

          return null;
        }),
      { timeout: 30000 }
    )
    .not.toBeNull()
    .then(() =>
      page.evaluate(() => {
        const anchors = [...document.querySelectorAll('a[href*="watch?v="]')];
        for (const anchor of anchors) {
          const rect = anchor.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) continue;

          try {
            const videoId = new URL(anchor.href, window.location.href).searchParams.get('v');
            if (videoId) return videoId;
          } catch {
            /* continue */
          }
        }

        return null;
      })
    );
}

async function getOverlayState(page, videoId) {
  return page.evaluate((id) => {
    function findVideoContainers() {
      const anchors = [...document.querySelectorAll('a[href*="watch?v="]')];
      const containers = [];

      for (const anchor of anchors) {
        try {
          const url = new URL(anchor.href, window.location.href);
          if (url.searchParams.get('v') !== id) continue;
        } catch {
          continue;
        }

        const container =
          anchor.closest(
            'ytd-playlist-video-renderer, ytd-playlist-panel-video-renderer, yt-lockup-view-model, ytd-video-renderer, ytd-rich-item-renderer'
          ) || anchor;

        if (container && !containers.includes(container)) {
          containers.push(container);
        }
      }

      return containers;
    }

    const containers = findVideoContainers();
    if (!containers.length) {
      return { containerFound: false, labelFound: false, progressFound: false, removeFound: false };
    }

    for (const container of containers) {
      const label = container.querySelector('.ytvht-viewed-label');
      const progress = container.querySelector('.ytvht-progress-bar');
      const remove = container.querySelector('.ytvht-remove-button');

      if (label || progress || remove) {
        return {
          containerFound: true,
          labelFound: !!label,
          labelText: label ? label.textContent.trim() : '',
          progressFound: !!progress,
          progressWidth: progress ? progress.style.width : '',
          removeFound: !!remove,
        };
      }
    }

    return {
      containerFound: true,
      labelFound: false,
      labelText: '',
      progressFound: false,
      progressWidth: '',
      removeFound: false,
    };
  }, videoId);
}

async function clickOverlayRemove(page, videoId) {
  await page.evaluate((id) => {
    const anchors = [...document.querySelectorAll('a[href*="watch?v="]')];
    for (const anchor of anchors) {
      let matches = false;
      try {
        matches = new URL(anchor.href, window.location.href).searchParams.get('v') === id;
      } catch {
        matches = false;
      }

      if (!matches) continue;

      const container =
        anchor.closest(
          'ytd-playlist-video-renderer, ytd-playlist-panel-video-renderer, yt-lockup-view-model, ytd-video-renderer, ytd-rich-item-renderer'
        ) || anchor;
      const remove = container.querySelector('.ytvht-remove-button');
      if (remove) {
        remove.click();
        return;
      }
    }

    throw new Error(`Overlay remove button not found for ${id}`);
  }, videoId);
}

async function expectSavedOverlayVisible(page, videoId) {
  await expect
    .poll(() => getOverlayState(page, videoId), { timeout: 30000 })
    .toMatchObject({
      containerFound: true,
      labelFound: true,
      labelText: 'viewed',
      progressFound: true,
      progressWidth: '25%',
      removeFound: true,
    });
}

async function expectSavedOverlayRemoved(page, videoId) {
  await expect
    .poll(() => getOverlayState(page, videoId), { timeout: 15000 })
    .toMatchObject({
      containerFound: true,
      labelFound: false,
      progressFound: false,
      removeFound: false,
    });
}

test.describe('Core overlays (live YouTube lists)', () => {
  test.setTimeout(90000);

  test('saved playlist video shows extension overlay and can be removed from the overlay', async ({ context, page }) => {
    await openYouTubeListPage(page, PLAYLIST_URL, /\/playlist/);

    const videoId = await getFirstVisibleVideoId(page);
    expect(videoId, 'playlist should expose at least one visible watch video').toBeTruthy();

    await seedStoredVideo(context, videoId);

    await expectSavedOverlayVisible(page, videoId);

    await clickOverlayRemove(page, videoId);

    await expect.poll(() => getStoredVideo(context, videoId), { timeout: 15000 }).toBeNull();

    await expectSavedOverlayRemoved(page, videoId);
  });

  test('saved channel video shows extension overlay on the channel videos page', async ({ context, page }) => {
    await openYouTubeListPage(page, CHANNEL_VIDEOS_URL, /@TodorKirilov/);

    const videoId = await getFirstVisibleVideoId(page);
    expect(videoId, 'channel videos page should expose at least one visible watch video').toBeTruthy();

    await seedStoredVideo(context, videoId);

    await expectSavedOverlayVisible(page, videoId);
  });
});
