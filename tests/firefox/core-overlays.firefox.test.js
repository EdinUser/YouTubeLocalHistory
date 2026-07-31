const assert = require('node:assert/strict');
const { By } = require('selenium-webdriver');
const {
  getStoredVideo,
  launchFirefoxWithExtension,
  seedStoredVideo: seedExtensionVideo,
} = require('./firefox-fixture');

const PLAYLIST_URL = 'https://www.youtube.com/playlist?list=PLQga0f7orXVB8fZObVcpXuX-2swTybQqR';
const CHANNEL_VIDEOS_URL = 'https://www.youtube.com/@TodorKirilov/videos';
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

async function withFrame(driver, frame, fn) {
  await driver.switchTo().frame(frame);
  try {
    return await fn();
  } finally {
    await driver.switchTo().defaultContent();
  }
}

async function clickConsentCandidate(driver) {
  const patterns = [
    /accept all/i,
    /i agree/i,
    /^agree$/i,
    /got it/i,
    /^ok$/i,
    /consent/i,
    /reject all/i,
    /alle akzeptieren/i,
    /alle ablehnen/i,
    /acceptez tout/i,
    /refuser tout/i,
    /aceptar todo/i,
    /rechazar todo/i,
  ];

  const elements = await driver.findElements(By.css('button, a, tp-yt-paper-button, ytd-button-renderer'));
  for (const element of elements) {
    const text = `${await element.getText().catch(() => '')} ${await element.getAttribute('aria-label').catch(() => '')}`.trim();
    if (!text || !patterns.some((pattern) => pattern.test(text))) {
      continue;
    }

    if (await element.isDisplayed().catch(() => false)) {
      await element.click().catch(() => {});
      await sleep(400);
      return true;
    }
  }

  return false;
}

async function dismissYouTubeConsent(driver) {
  for (let pass = 0; pass < 4; pass++) {
    if (await clickConsentCandidate(driver)) {
      continue;
    }

    const frames = await driver.findElements(By.css('iframe'));
    let clicked = false;
    for (const frame of frames) {
      clicked = await withFrame(driver, frame, () => clickConsentCandidate(driver)).catch(() => false);
      if (clicked) {
        break;
      }
    }

    if (!clicked) {
      return;
    }
  }
}

async function openYouTubeListPage(driver, url, expectedUrlPattern) {
  let lastError;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await driver.get(url);
      await dismissYouTubeConsent(driver);

      const currentUrl = await driver.getCurrentUrl();
      if (expectedUrlPattern.test(currentUrl)) {
        return;
      }
    } catch (error) {
      lastError = error;
    }

    await sleep(1000 * (attempt + 1));
  }

  if (lastError) {
    throw lastError;
  }
  throw new Error(`Expected URL to match ${expectedUrlPattern}, got ${await driver.getCurrentUrl()}`);
}

async function getFirstVisibleVideoId(driver) {
  const result = await waitUntil('visible watch video ID', 30000, async () =>
    driver.executeScript(() => {
      const anchors = [...document.querySelectorAll('a[href*="watch?v="]')];
      for (const anchor of anchors) {
        const rect = anchor.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;

        try {
          const videoId = new URL(anchor.href, window.location.href).searchParams.get('v');
          if (videoId) return { ok: true, videoId };
        } catch {
          /* continue */
        }
      }

      return { ok: false, videoId: null };
    })
  );

  return result.videoId;
}

async function seedStoredVideo(session, videoId) {
  await seedExtensionVideo(session, videoId, {
    title: `Overlay test video ${videoId}`,
    time: SAVED_TIME,
    duration: SAVED_DURATION,
    timestamp: Date.now(),
    url: `https://www.youtube.com/watch?v=${videoId}`,
    channelName: 'Overlay Test Channel',
    channelId: '@TodorKirilov',
  });
}

async function getOverlayState(driver, videoId) {
  return driver.executeScript((id) => {
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
      return { ok: false, containerFound: false, labelFound: false, progressFound: false, removeFound: false };
    }

    for (const container of containers) {
      const label = container.querySelector('.ytvht-viewed-label');
      const progress = container.querySelector('.ytvht-progress-bar');
      const remove = container.querySelector('.ytvht-remove-button');

      if (label || progress || remove) {
        return {
          ok: !!label && !!progress && !!remove && label.textContent.trim() === 'viewed' && progress.style.width === '25%',
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
      ok: false,
      containerFound: true,
      labelFound: false,
      labelText: '',
      progressFound: false,
      progressWidth: '',
      removeFound: false,
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

async function expectSavedOverlayVisible(driver, videoId) {
  await waitUntil('saved overlay visible', 30000, () => getOverlayState(driver, videoId));
}

async function expectSavedOverlayRemoved(driver, videoId) {
  await waitUntil('saved overlay removed', 15000, async () => {
    const state = await getOverlayState(driver, videoId);
    return {
      ...state,
      ok: state.containerFound && !state.labelFound && !state.progressFound && !state.removeFound,
    };
  });
}

async function runScenario(name, fn) {
  const timeout = setTimeout(() => {
    console.error(`Firefox overlay test "${name}" exceeded ${TEST_TIMEOUT_MS}ms`);
    process.exit(1);
  }, TEST_TIMEOUT_MS);

  const session = await launchFirefoxWithExtension();

  try {
    await fn(session);
    console.log(`Firefox overlay passed: ${name}`);
  } finally {
    clearTimeout(timeout);
    await session.cleanup();
  }
}

async function main() {
  await runScenario('playlist overlay and remove', async (session) => {
    await openYouTubeListPage(session.driver, PLAYLIST_URL, /\/playlist/);

    const videoId = await getFirstVisibleVideoId(session.driver);
    assert.ok(videoId, 'playlist should expose at least one visible watch video');

    await seedStoredVideo(session, videoId);
    await expectSavedOverlayVisible(session.driver, videoId);

    await clickOverlayRemove(session.driver, videoId);
    await waitUntil('stored playlist video removed', 15000, async () => ({
      ok: (await getStoredVideo(session, videoId)) === null,
    }));

    await expectSavedOverlayRemoved(session.driver, videoId);
  });

  await runScenario('channel videos overlay', async (session) => {
    await openYouTubeListPage(session.driver, CHANNEL_VIDEOS_URL, /@TodorKirilov/);

    const videoId = await getFirstVisibleVideoId(session.driver);
    assert.ok(videoId, 'channel videos page should expose at least one visible watch video');

    await seedStoredVideo(session, videoId);
    await expectSavedOverlayVisible(session.driver, videoId);
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
