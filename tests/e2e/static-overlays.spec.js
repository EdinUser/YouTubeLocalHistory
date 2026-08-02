/**
 * Static overlay contract tests: replay captured YouTube DOM under youtube.com
 * so the real content script runs without live YouTube network/consent noise.
 */

const fs = require('fs');
const path = require('path');
const { test, expect } = require('./extension-fixture');
const {
  getStoredVideo,
  seedStoredVideo: seedExtensionVideo,
} = require('./chromium-extension-storage');

const ROOT_DIR = path.resolve(__dirname, '../..');
const CAPTURE_DIR = path.join(ROOT_DIR, 'tests', 'fixtures', 'youtube-pages', 'captures');

const PLAYLIST_URL = 'https://www.youtube.com/playlist?list=PLQga0f7orXVB8fZObVcpXuX-2swTybQqR';
const CHANNEL_VIDEOS_URL = 'https://www.youtube.com/@TodorKirilov/videos';
const WATCH_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const CHANNEL_HEADER_URL = 'https://www.youtube.com/channel/UCRCraKP10Q5fSAbCimkizIA';
const SAVED_TIME = 45;
const SAVED_DURATION = 180;

function readCapture(fixtureName) {
  const fixtureDir = path.join(CAPTURE_DIR, fixtureName);
  const htmlPath = path.join(fixtureDir, 'page.html');
  const metadataPath = path.join(fixtureDir, 'metadata.json');

  if (!fs.existsSync(htmlPath) || !fs.existsSync(metadataPath)) {
    return null;
  }

  return {
    html: fs.readFileSync(htmlPath, 'utf8'),
    metadata: JSON.parse(fs.readFileSync(metadataPath, 'utf8')),
  };
}

function extractVideoIdsFromHtml(html) {
  const ids = [];
  const seen = new Set();
  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})/g,
    /%3Fv%3D([a-zA-Z0-9_-]{11})/g,
    /"videoId":"([a-zA-Z0-9_-]{11})"/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const id = match[1];
      if (!seen.has(id)) {
        ids.push(id);
        seen.add(id);
      }
    }
  }

  return ids;
}

async function seedStoredVideo(context, videoId, overrides = {}) {
  await seedExtensionVideo(context, videoId, {
    title: `Static overlay test video ${videoId}`,
    time: SAVED_TIME,
    duration: SAVED_DURATION,
    timestamp: Date.now(),
    url: `https://www.youtube.com/watch?v=${videoId}`,
    channelName: 'Static Overlay Test Channel',
    channelId: '@TodorKirilov',
    ...overrides,
  });
}

async function routeCapturedPage(page, url, html) {
  await page.route(url, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: html,
    });
  });
}

async function openCapturedPage(page, url, html) {
  await routeCapturedPage(page, url, html);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.ytlhFixture);
}

async function getOverlayState(page, videoId) {
  return page.evaluate((id) => {
    function findVideoContainers() {
      const anchors = [...document.querySelectorAll('a[href*="watch?v="]')];
      const containers = [];

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
            'ytd-playlist-video-renderer, ytd-playlist-panel-video-renderer, yt-lockup-view-model, ytd-video-renderer, ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer'
          ) || anchor;

        if (container && !containers.includes(container)) {
          containers.push(container);
        }
      }

      return containers;
    }

    const containers = findVideoContainers();
    const states = containers.map((container) => ({
      labelCount: container.querySelectorAll('.ytvht-viewed-label').length,
      labelText: container.querySelector('.ytvht-viewed-label')?.textContent.trim() || '',
      progressCount: container.querySelectorAll('.ytvht-progress-bar').length,
      progressWidth: container.querySelector('.ytvht-progress-bar')?.style.width || '',
      removeCount: container.querySelectorAll('.ytvht-remove-button').length,
    }));

    const visible = states.find((state) => state.labelCount || state.progressCount || state.removeCount);

    return {
      containerCount: containers.length,
      labelFound: !!visible?.labelCount,
      labelText: visible?.labelText || '',
      progressFound: !!visible?.progressCount,
      progressWidth: visible?.progressWidth || '',
      removeFound: !!visible?.removeCount,
      maxLabelCount: Math.max(0, ...states.map((state) => state.labelCount)),
      maxProgressCount: Math.max(0, ...states.map((state) => state.progressCount)),
      maxRemoveCount: Math.max(0, ...states.map((state) => state.removeCount)),
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
          'ytd-playlist-video-renderer, ytd-playlist-panel-video-renderer, yt-lockup-view-model, ytd-video-renderer, ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer'
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

async function expectSavedOverlayVisible(page, videoId, expectedProgressWidth = '25%') {
  await expect
    .poll(() => getOverlayState(page, videoId), { timeout: 20000 })
    .toMatchObject({
      labelFound: true,
      labelText: 'viewed',
      progressFound: true,
      progressWidth: expectedProgressWidth,
      removeFound: true,
    });
}

async function expectNoOverlayVisible(page, videoId) {
  await expect
    .poll(() => getOverlayState(page, videoId), { timeout: 10000 })
    .toMatchObject({
      containerCount: expect.any(Number),
      labelFound: false,
      progressFound: false,
      removeFound: false,
      maxLabelCount: 0,
      maxProgressCount: 0,
      maxRemoveCount: 0,
    });

  expect((await getOverlayState(page, videoId)).containerCount, `fixture should contain video ${videoId}`).toBeGreaterThan(0);
}

async function expectNoDuplicateOverlays(page, videoId) {
  await expect
    .poll(() => getOverlayState(page, videoId), { timeout: 10000 })
    .toMatchObject({
      maxLabelCount: 1,
      maxProgressCount: 1,
      maxRemoveCount: 1,
    });
}

async function expectSavedOverlayRemoved(page, videoId) {
  await expect
    .poll(() => getOverlayState(page, videoId), { timeout: 10000 })
    .toMatchObject({
      labelFound: false,
      progressFound: false,
      removeFound: false,
    });
}

async function getRenderableVideoIds(page, excludeVideoIds = []) {
  return page.evaluate((excluded) => {
    const excludedIds = new Set(excluded);
    const ids = [];
    const seen = new Set();
    const anchors = [...document.querySelectorAll('a[href*="watch?v="]')];

    for (const anchor of anchors) {
      let videoId = null;
      try {
        videoId = new URL(anchor.href, window.location.href).searchParams.get('v');
      } catch {
        videoId = null;
      }

      if (!videoId || seen.has(videoId) || excludedIds.has(videoId)) continue;

      const container = anchor.closest(
        'ytd-playlist-video-renderer, ytd-playlist-panel-video-renderer, yt-lockup-view-model, ytd-video-renderer, ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer'
      );
      if (!container) continue;

      ids.push(videoId);
      seen.add(videoId);
    }

    return ids;
  }, excludeVideoIds);
}

async function appendFreshVideoNode(page, videoId) {
  await page.evaluate((id) => {
    const anchors = [...document.querySelectorAll('a[href*="watch?v="]')];
    const anchor = anchors.find((candidate) => {
      try {
        return new URL(candidate.href, window.location.href).searchParams.get('v') === id;
      } catch {
        return false;
      }
    });

    if (!anchor) {
      throw new Error(`Source node not found for ${id}`);
    }

    const source =
      anchor.closest(
        'ytd-playlist-video-renderer, ytd-playlist-panel-video-renderer, yt-lockup-view-model, ytd-video-renderer, ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer'
      ) || anchor;
    const clone = source.cloneNode(true);

    clone.querySelectorAll('.ytvht-viewed-label, .ytvht-progress-bar, .ytvht-remove-button').forEach((node) => {
      node.remove();
    });
    clone.setAttribute('data-static-overlay-clone', id);
    source.parentElement.appendChild(clone);
  }, videoId);
}

async function forceOverlayReprocess(page) {
  await page.evaluate(() => {
    window.dispatchEvent(new Event('scroll'));
    document.body.appendChild(document.createComment('force static overlay mutation'));
  });
}

async function replacePageWithCapturedHtml(page, url, html) {
  await page.evaluate(
    ({ nextUrl, nextHtml }) => {
      const nextDocument = new DOMParser().parseFromString(nextHtml, 'text/html');
      document.title = nextDocument.title;
      document.body.innerHTML = nextDocument.body.innerHTML;
      for (const { name, value } of [...nextDocument.documentElement.attributes]) {
        document.documentElement.setAttribute(name, value);
      }
      window.history.pushState({}, '', nextUrl);
      window.dispatchEvent(new PopStateEvent('popstate'));
      window.dispatchEvent(new CustomEvent('yt-navigate-finish'));
      document.body.appendChild(document.createComment('force static spa replacement mutation'));
    },
    { nextUrl: url, nextHtml: html }
  );

  await page.waitForFunction(() => document.documentElement.dataset.ytlhFixture);
}

test.describe('Static overlays (captured YouTube DOM)', () => {
  test('captured canonical channel header receives one independent re:Watch subscribe companion', async ({ page }) => {
    const capture = readCapture('controlled-channel-header');
    test.skip(!capture, 'Run `npm run fixtures:youtube:download -- --only controlled-channel-header --headless` first.');
    await openCapturedPage(page, CHANNEL_HEADER_URL, capture.html);
    await expect(page.locator('.ytvht-sub-btn')).toHaveCount(1);
    await expect(page.locator('.ytvht-sub-btn')).toHaveText('Subscribe with re:Watch');
    await forceOverlayReprocess(page);
    await expect(page.locator('.ytvht-sub-btn')).toHaveCount(1);
  });

  test('captured playlist item gets overlay once and overlay remove deletes storage', async ({ context, page }) => {
    const capture = readCapture('controlled-playlist');
    test.skip(!capture, 'Run `npm run fixtures:youtube:download -- --only controlled-playlist` first.');

    const [videoId, unsavedVideoId] = extractVideoIdsFromHtml(capture.html);
    expect(videoId, 'controlled playlist fixture should contain at least one watch video').toBeTruthy();
    expect(unsavedVideoId, 'controlled playlist fixture should contain a second watch video').toBeTruthy();

    await seedStoredVideo(context, videoId);
    await openCapturedPage(page, PLAYLIST_URL, capture.html);

    await expectSavedOverlayVisible(page, videoId);
    await expectNoOverlayVisible(page, unsavedVideoId);

    await forceOverlayReprocess(page);
    await expectNoDuplicateOverlays(page, videoId);

    await clickOverlayRemove(page, videoId);

    await expect.poll(() => getStoredVideo(context, videoId), { timeout: 10000 }).toBeNull();
    await expectSavedOverlayRemoved(page, videoId);

    await forceOverlayReprocess(page);
    await expectSavedOverlayRemoved(page, videoId);
    await expectNoOverlayVisible(page, unsavedVideoId);
  });

  test('captured channel page processes saved videos added after initial load', async ({ context, page }) => {
    const capture = readCapture('controlled-channel-videos');
    test.skip(!capture, 'Run `npm run fixtures:youtube:download -- --only controlled-channel-videos` first.');

    const [initialVideoId, appendedVideoId, unsavedVideoId] = extractVideoIdsFromHtml(capture.html);
    expect(initialVideoId, 'controlled channel fixture should contain at least one watch video').toBeTruthy();
    expect(appendedVideoId, 'controlled channel fixture should contain a second watch video').toBeTruthy();
    expect(unsavedVideoId, 'controlled channel fixture should contain a third watch video').toBeTruthy();

    await seedStoredVideo(context, initialVideoId, { time: 90, duration: 180 });
    await openCapturedPage(page, CHANNEL_VIDEOS_URL, capture.html);

    await expectSavedOverlayVisible(page, initialVideoId, '50%');
    await expectNoDuplicateOverlays(page, initialVideoId);
    await expectNoOverlayVisible(page, unsavedVideoId);

    await seedStoredVideo(context, appendedVideoId);
    await appendFreshVideoNode(page, appendedVideoId);

    await expectSavedOverlayVisible(page, appendedVideoId);
    await expectNoDuplicateOverlays(page, appendedVideoId);
  });

  test('captured watch page marks saved recommendation items only', async ({ context, page }) => {
    const capture = readCapture('rick-watch');
    test.skip(!capture, 'Run `npm run fixtures:youtube:download -- --only rick-watch --headless` first.');

    const [watchVideoId] = extractVideoIdsFromHtml(capture.html);
    expect(watchVideoId, 'watch fixture should contain the watched video ID').toBe('dQw4w9WgXcQ');

    await openCapturedPage(page, WATCH_URL, capture.html);

    const [recommendationVideoId, unsavedRecommendationId] = await getRenderableVideoIds(page, [watchVideoId]);
    expect(recommendationVideoId, 'watch fixture should contain at least one recommendation video').toBeTruthy();
    expect(unsavedRecommendationId, 'watch fixture should contain a second recommendation video').toBeTruthy();

    await seedStoredVideo(context, recommendationVideoId, { time: 60, duration: 200 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.documentElement.dataset.ytlhFixture);

    await expectSavedOverlayVisible(page, recommendationVideoId, '30%');
    await expectNoOverlayVisible(page, unsavedRecommendationId);

    await forceOverlayReprocess(page);
    await expectNoDuplicateOverlays(page, recommendationVideoId);
    await expectNoOverlayVisible(page, unsavedRecommendationId);
  });

  test('SPA-style DOM replacement processes the new captured list surface', async ({ context, page }) => {
    const playlist = readCapture('controlled-playlist');
    const channel = readCapture('controlled-channel-videos');
    test.skip(
      !playlist || !channel,
      'Run `npm run fixtures:youtube:download -- --only controlled-playlist,controlled-channel-videos --headless` first.'
    );

    const [playlistVideoId] = extractVideoIdsFromHtml(playlist.html);
    const [channelVideoId] = extractVideoIdsFromHtml(channel.html);
    expect(playlistVideoId, 'controlled playlist fixture should contain at least one watch video').toBeTruthy();
    expect(channelVideoId, 'controlled channel fixture should contain at least one watch video').toBeTruthy();

    await seedStoredVideo(context, playlistVideoId);
    await seedStoredVideo(context, channelVideoId, { time: 75, duration: 150 });
    await openCapturedPage(page, PLAYLIST_URL, playlist.html);

    await expectSavedOverlayVisible(page, playlistVideoId);
    expect((await getOverlayState(page, channelVideoId)).containerCount).toBe(0);

    await replacePageWithCapturedHtml(page, CHANNEL_VIDEOS_URL, channel.html);

    await expectSavedOverlayVisible(page, channelVideoId, '50%');
    await expectNoDuplicateOverlays(page, channelVideoId);
    expect((await getOverlayState(page, playlistVideoId)).containerCount).toBe(0);
  });
});
