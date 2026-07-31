const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  getStoredVideo,
  launchFirefoxWithExtension,
  seedStoredVideo: seedExtensionVideo,
} = require('./firefox-fixture');
const { startStaticFixtureServer } = require('./static-fixture-server');

const ROOT_DIR = path.resolve(__dirname, '../..');
const CAPTURE_DIR = path.join(ROOT_DIR, 'tests', 'fixtures', 'youtube-pages', 'captures');
const SAVED_TIME = 45;
const SAVED_DURATION = 180;
const TEST_TIMEOUT_MS = 120000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(description, timeoutMs, fn) {
  const deadline = Date.now() + timeoutMs;
  let lastValue;
  let lastError;

  while (Date.now() < deadline) {
    try {
      lastValue = await fn();
      if (lastValue && lastValue.ok !== false) {
        return lastValue;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(500);
  }

  const detail = lastError ? lastError.message : JSON.stringify(lastValue);
  throw new Error(`Timed out waiting for ${description}. Last result: ${detail}`);
}

function readCapture(fixtureName) {
  const fixtureDir = path.join(CAPTURE_DIR, fixtureName);
  const htmlPath = path.join(fixtureDir, 'page.html');
  const metadataPath = path.join(fixtureDir, 'metadata.json');

  if (!fs.existsSync(htmlPath) || !fs.existsSync(metadataPath)) {
    throw new Error(
      `Missing ${fixtureName} capture. Run: npm run fixtures:youtube:download -- --only ${fixtureName} --headless`
    );
  }

  return {
    html: fs.readFileSync(htmlPath, 'utf8'),
    metadata: JSON.parse(fs.readFileSync(metadataPath, 'utf8')),
  };
}

function readOptionalCapture(fixtureName) {
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

async function seedStoredVideo(session, videoId, overrides = {}) {
  await seedExtensionVideo(session, videoId, {
    title: `Firefox static overlay test video ${videoId}`,
    time: SAVED_TIME,
    duration: SAVED_DURATION,
    timestamp: Date.now(),
    url: `https://www.youtube.com/watch?v=${videoId}`,
    channelName: 'Firefox Static Overlay Test Channel',
    channelId: '@TodorKirilov',
    ...overrides,
  });
}

async function openFixturePage(driver, url) {
  await driver.get(url);
  await waitUntil('fixture page marker', 15000, async () => {
    const marker = await driver.executeScript(() => document.documentElement.dataset.ytlhFixture || '');
    return { ok: !!marker, marker };
  });
}

async function getOverlayState(driver, videoId) {
  return driver.executeScript((id) => {
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
      ok:
        !!visible &&
        visible.labelCount === 1 &&
        visible.labelText === 'viewed' &&
        visible.progressCount === 1 &&
        visible.progressWidth === '25%' &&
        visible.removeCount === 1,
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

async function clickOverlayRemove(driver, videoId) {
  await driver.executeScript((id) => {
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

async function expectSavedOverlayVisible(driver, videoId, expectedProgressWidth = '25%', description = 'saved overlay visible') {
  await waitUntil(description, 20000, async () => {
    const state = await getOverlayState(driver, videoId);
    return {
      ...state,
      ok:
        state.labelFound &&
        state.labelText === 'viewed' &&
        state.progressFound &&
        state.progressWidth === expectedProgressWidth &&
        state.removeFound,
    };
  });
}

async function expectNoOverlayVisible(driver, videoId) {
  await waitUntil('no overlay visible', 10000, async () => {
    const state = await getOverlayState(driver, videoId);
    return {
      ...state,
      ok:
        state.containerCount > 0 &&
        !state.labelFound &&
        !state.progressFound &&
        !state.removeFound &&
        state.maxLabelCount === 0 &&
        state.maxProgressCount === 0 &&
        state.maxRemoveCount === 0,
    };
  });
}

async function expectNoDuplicateOverlays(driver, videoId) {
  await waitUntil('no duplicate overlays', 10000, async () => {
    const state = await getOverlayState(driver, videoId);
    return {
      ...state,
      ok: state.maxLabelCount === 1 && state.maxProgressCount === 1 && state.maxRemoveCount === 1,
    };
  });
}

async function expectSavedOverlayRemoved(driver, videoId) {
  await waitUntil('saved overlay removed', 10000, async () => {
    const state = await getOverlayState(driver, videoId);
    return {
      ...state,
      ok: state.containerCount > 0 && !state.labelFound && !state.progressFound && !state.removeFound,
    };
  });
}

async function getRenderableVideoIds(driver, excludeVideoIds = []) {
  return driver.executeScript((excluded) => {
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

async function appendFreshVideoNode(driver, videoId) {
  await driver.executeScript((id) => {
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
    clone.setAttribute('data-firefox-static-overlay-clone', id);
    source.parentElement.appendChild(clone);
  }, videoId);
}

async function forceOverlayReprocess(driver) {
  await driver.executeScript(() => {
    window.dispatchEvent(new Event('scroll'));
    document.body.appendChild(document.createComment('force firefox static overlay mutation'));
  });
}

async function replacePageWithCapturedHtml(driver, url, html) {
  await driver.executeScript(
    (nextUrl, nextHtml) => {
      const nextDocument = new DOMParser().parseFromString(nextHtml, 'text/html');
      document.title = nextDocument.title;
      document.body.innerHTML = nextDocument.body.innerHTML;
      for (const { name, value } of [...nextDocument.documentElement.attributes]) {
        document.documentElement.setAttribute(name, value);
      }
      window.history.pushState({}, '', nextUrl);
      window.dispatchEvent(new PopStateEvent('popstate'));
      window.dispatchEvent(new CustomEvent('yt-navigate-finish'));
      document.body.appendChild(document.createComment('force firefox static spa replacement mutation'));
    },
    url,
    html
  );

  await waitUntil('fixture page marker after replacement', 15000, async () => {
    const marker = await driver.executeScript(() => document.documentElement.dataset.ytlhFixture || '');
    return { ok: !!marker, marker };
  });
}

async function runScenario(name, fn) {
  const timeout = setTimeout(() => {
    console.error(`Firefox static overlay test "${name}" exceeded ${TEST_TIMEOUT_MS}ms`);
    process.exit(1);
  }, TEST_TIMEOUT_MS);

  const session = await launchFirefoxWithExtension();

  try {
    await fn(session);
    console.log(`Firefox static overlay passed: ${name}`);
  } finally {
    clearTimeout(timeout);
    await session.cleanup();
  }
}

async function main() {
  const playlist = readCapture('controlled-playlist');
  const channel = readCapture('controlled-channel-videos');
  const watch = readOptionalCapture('rick-watch');
  const server = await startStaticFixtureServer({
    '/playlist': playlist.html,
    '/channel-videos': channel.html,
    ...(watch ? { '/watch': watch.html } : {}),
  });

  try {
    await runScenario('playlist overlay and remove', async (session) => {
      const [videoId, unsavedVideoId] = extractVideoIdsFromHtml(playlist.html);
      assert.ok(videoId, 'controlled playlist fixture should contain at least one watch video');
      assert.ok(unsavedVideoId, 'controlled playlist fixture should contain a second watch video');

      await seedStoredVideo(session, videoId);
      await openFixturePage(session.driver, `${server.origin}/playlist?list=PLQga0f7orXVB8fZObVcpXuX-2swTybQqR`);

      await expectSavedOverlayVisible(session.driver, videoId);
      await expectNoOverlayVisible(session.driver, unsavedVideoId);
      await forceOverlayReprocess(session.driver);
      await expectNoDuplicateOverlays(session.driver, videoId);

      await clickOverlayRemove(session.driver, videoId);
      await waitUntil('stored playlist video removed', 10000, async () => ({
        ok: (await getStoredVideo(session, videoId)) === null,
      }));
      await expectSavedOverlayRemoved(session.driver, videoId);
      await forceOverlayReprocess(session.driver);
      await expectSavedOverlayRemoved(session.driver, videoId);
      await expectNoOverlayVisible(session.driver, unsavedVideoId);
    });

    await runScenario('channel appended node overlay', async (session) => {
      const [initialVideoId, appendedVideoId, unsavedVideoId] = extractVideoIdsFromHtml(channel.html);
      assert.ok(initialVideoId, 'controlled channel fixture should contain at least one watch video');
      assert.ok(appendedVideoId, 'controlled channel fixture should contain a second watch video');
      assert.ok(unsavedVideoId, 'controlled channel fixture should contain a third watch video');

      await seedStoredVideo(session, initialVideoId, { time: 90, duration: 180 });
      await openFixturePage(session.driver, `${server.origin}/channel-videos`);

      await expectSavedOverlayVisible(session.driver, initialVideoId, '50%', 'initial channel overlay visible');
      await expectNoDuplicateOverlays(session.driver, initialVideoId);
      await expectNoOverlayVisible(session.driver, unsavedVideoId);

      await seedStoredVideo(session, appendedVideoId);
      await appendFreshVideoNode(session.driver, appendedVideoId);

      await expectSavedOverlayVisible(session.driver, appendedVideoId, '25%', 'appended channel overlay visible');
      await expectNoDuplicateOverlays(session.driver, appendedVideoId);
    });

    if (watch) {
      await runScenario('watch recommendation overlay', async (session) => {
        const [watchVideoId] = extractVideoIdsFromHtml(watch.html);
        assert.equal(watchVideoId, 'dQw4w9WgXcQ', 'watch fixture should contain the watched video ID');

        await openFixturePage(session.driver, `${server.origin}/watch?v=dQw4w9WgXcQ`);

        const [recommendationVideoId, unsavedRecommendationId] = await getRenderableVideoIds(session.driver, [
          watchVideoId,
        ]);
        assert.ok(recommendationVideoId, 'watch fixture should contain at least one recommendation video');
        assert.ok(unsavedRecommendationId, 'watch fixture should contain a second recommendation video');

        await seedStoredVideo(session, recommendationVideoId, { time: 60, duration: 200 });
        await openFixturePage(session.driver, `${server.origin}/watch?v=dQw4w9WgXcQ`);

        await expectSavedOverlayVisible(session.driver, recommendationVideoId, '30%', 'watch recommendation overlay visible');
        await expectNoOverlayVisible(session.driver, unsavedRecommendationId);

        await forceOverlayReprocess(session.driver);
        await expectNoDuplicateOverlays(session.driver, recommendationVideoId);
        await expectNoOverlayVisible(session.driver, unsavedRecommendationId);
      });
    } else {
      console.log(
        'Firefox static overlay skipped: watch recommendation overlay. Run: npm run fixtures:youtube:download -- --only rick-watch --headless'
      );
    }

    await runScenario('SPA DOM replacement overlay', async (session) => {
      const [playlistVideoId] = extractVideoIdsFromHtml(playlist.html);
      const [channelVideoId] = extractVideoIdsFromHtml(channel.html);
      assert.ok(playlistVideoId, 'controlled playlist fixture should contain at least one watch video');
      assert.ok(channelVideoId, 'controlled channel fixture should contain at least one watch video');

      await seedStoredVideo(session, playlistVideoId);
      await seedStoredVideo(session, channelVideoId, { time: 75, duration: 150 });
      await openFixturePage(session.driver, `${server.origin}/playlist?list=PLQga0f7orXVB8fZObVcpXuX-2swTybQqR`);

      await expectSavedOverlayVisible(session.driver, playlistVideoId);
      assert.equal((await getOverlayState(session.driver, channelVideoId)).containerCount, 0);

      await replacePageWithCapturedHtml(session.driver, `${server.origin}/channel-videos`, channel.html);

      await expectSavedOverlayVisible(session.driver, channelVideoId, '50%', 'replacement channel overlay visible');
      await expectNoDuplicateOverlays(session.driver, channelVideoId);
      assert.equal((await getOverlayState(session.driver, playlistVideoId)).containerCount, 0);
    });
  } finally {
    await server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
