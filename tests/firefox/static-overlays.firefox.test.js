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

async function seedStoredVideo(session, videoId) {
  await seedExtensionVideo(session, videoId, {
    title: `Firefox static overlay test video ${videoId}`,
    time: SAVED_TIME,
    duration: SAVED_DURATION,
    timestamp: Date.now(),
    url: `https://www.youtube.com/watch?v=${videoId}`,
    channelName: 'Firefox Static Overlay Test Channel',
    channelId: '@TodorKirilov',
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
            'ytd-playlist-video-renderer, ytd-playlist-panel-video-renderer, yt-lockup-view-model, ytd-video-renderer, ytd-rich-item-renderer, ytd-grid-video-renderer'
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
          'ytd-playlist-video-renderer, ytd-playlist-panel-video-renderer, yt-lockup-view-model, ytd-video-renderer, ytd-rich-item-renderer, ytd-grid-video-renderer'
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
        'ytd-playlist-video-renderer, ytd-playlist-panel-video-renderer, yt-lockup-view-model, ytd-video-renderer, ytd-rich-item-renderer, ytd-grid-video-renderer'
      ) || anchor;
    const clone = source.cloneNode(true);

    clone.querySelectorAll('.ytvht-viewed-label, .ytvht-progress-bar, .ytvht-remove-button').forEach((node) => {
      node.remove();
    });
    clone.setAttribute('data-firefox-static-overlay-clone', id);
    source.parentElement.appendChild(clone);
  }, videoId);
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
  const server = await startStaticFixtureServer({
    '/playlist': playlist.html,
    '/channel-videos': channel.html,
  });

  try {
    await runScenario('playlist overlay and remove', async (session) => {
      const [videoId] = extractVideoIdsFromHtml(playlist.html);
      assert.ok(videoId, 'controlled playlist fixture should contain at least one watch video');

      await seedStoredVideo(session, videoId);
      await openFixturePage(session.driver, `${server.origin}/playlist?list=PLQga0f7orXVB8fZObVcpXuX-2swTybQqR`);

      await waitUntil('saved overlay visible', 20000, () => getOverlayState(session.driver, videoId));
      await expectNoDuplicateOverlays(session.driver, videoId);

      await clickOverlayRemove(session.driver, videoId);
      await waitUntil('stored playlist video removed', 10000, async () => ({
        ok: (await getStoredVideo(session, videoId)) === null,
      }));
      await expectSavedOverlayRemoved(session.driver, videoId);
    });

    await runScenario('channel appended node overlay', async (session) => {
      const [initialVideoId, appendedVideoId] = extractVideoIdsFromHtml(channel.html);
      assert.ok(initialVideoId, 'controlled channel fixture should contain at least one watch video');
      assert.ok(appendedVideoId, 'controlled channel fixture should contain a second watch video');

      await seedStoredVideo(session, initialVideoId);
      await openFixturePage(session.driver, `${server.origin}/channel-videos`);

      await waitUntil('initial channel overlay visible', 20000, () => getOverlayState(session.driver, initialVideoId));
      await expectNoDuplicateOverlays(session.driver, initialVideoId);

      await seedStoredVideo(session, appendedVideoId);
      await appendFreshVideoNode(session.driver, appendedVideoId);

      await waitUntil('appended channel overlay visible', 20000, () => getOverlayState(session.driver, appendedVideoId));
      await expectNoDuplicateOverlays(session.driver, appendedVideoId);
    });
  } finally {
    await server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
