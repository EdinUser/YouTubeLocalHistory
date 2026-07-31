const assert = require('node:assert/strict');
const { By, until } = require('selenium-webdriver');
const {
  getStoredVideo,
  launchFirefoxWithExtension,
  removeStoredVideo,
  setExtensionSettings,
} = require('./firefox-fixture');

const VIDEO_ID = 'dQw4w9WgXcQ';
const WATCH_URL = `https://www.youtube.com/watch?v=${VIDEO_ID}`;
const TARGET_TIME = 45;
const RESUME_TOLERANCE = 2;
const TEST_TIMEOUT_MS = 240000;
const RESTORE_TIMEOUT_MS = 60000;
const DEFAULT_SETTINGS = {
  autoCleanPeriod: 90,
  paginationCount: 10,
  overlayTitle: 'viewed',
  overlayColor: 'blue',
  overlayLabelSize: 'medium',
  debug: true,
  pauseHistoryInPlaylists: false,
};

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

async function openWatchPage(driver) {
  await driver.get(WATCH_URL);
  await dismissYouTubeConsent(driver);

  if (!(await driver.getCurrentUrl()).includes('/watch')) {
    await driver.get(WATCH_URL);
    await dismissYouTubeConsent(driver);
  }

  await driver.wait(until.elementLocated(By.css('video')), 30000);
}

async function skipYouTubeAdIfPossible(driver) {
  const buttons = await driver.findElements(By.css('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, button'));
  for (const button of buttons) {
    const text = `${await button.getText().catch(() => '')} ${await button.getAttribute('aria-label').catch(() => '')}`.trim();
    if (/skip/i.test(text) && await button.isDisplayed().catch(() => false)) {
      await button.click().catch(() => {});
      await sleep(500);
      return true;
    }
  }
  return false;
}

async function getVideoState(driver) {
  return driver.executeScript(() => {
    const video = document.querySelector('video');
    return {
      found: !!video,
      currentTime: video ? video.currentTime : 0,
      duration: video && Number.isFinite(video.duration) ? video.duration : 0,
      readyState: video ? video.readyState : 0,
      src: video ? video.currentSrc : '',
    };
  });
}

async function waitForPrimaryVideo(driver) {
  await waitUntil('video element', 30000, async () => {
    const state = await getVideoState(driver);
    return state.found && state.readyState >= 1 ? state : false;
  });

  await waitUntil('real long-form YouTube video instead of ad', 90000, async () => {
    await skipYouTubeAdIfPossible(driver);
    const state = await getVideoState(driver);
    return state.duration > TARGET_TIME + 20 ? state : false;
  });
}

async function setVideoTime(driver, seconds) {
  await driver.executeScript((time) => {
    const video = document.querySelector('video');
    if (!video) {
      throw new Error('video element not found');
    }

    video.muted = true;
    video.pause();
    video.currentTime = time;
  }, seconds);

  await waitUntil(`video currentTime >= ${seconds - 1}`, 15000, async () => {
    const state = await getVideoState(driver);
    return state.currentTime >= seconds - 1 ? state : false;
  });

  await driver.executeScript(() => {
    const video = document.querySelector('video');
    if (!video) {
      throw new Error('video element not found');
    }

    video.dispatchEvent(new Event('timeupdate'));
    video.dispatchEvent(new Event('seeked'));
    video.dispatchEvent(new Event('pause'));
  });
}

async function enableExtensionDebug(session) {
  await setExtensionSettings(session, DEFAULT_SETTINGS);
}

async function saveVideoAtTime(session, seconds) {
  let lastSavedTime = 0;

  for (let attempt = 0; attempt < 30; attempt++) {
    await setVideoTime(session.driver, seconds);
    await sleep(900);

    const record = await getStoredVideo(session, VIDEO_ID);
    lastSavedTime = record && typeof record.time === 'number' ? record.time : 0;
    if (lastSavedTime >= seconds - RESUME_TOLERANCE) {
      return record;
    }
  }

  throw new Error(`Expected Firefox extension to save ${seconds}s, last saved time was ${lastSavedTime}s`);
}

async function pauseVideo(driver) {
  await driver.executeScript(() => {
    const video = document.querySelector('video');
    if (video) {
      video.pause();
    }
  });
}

async function clearYouTubeOriginState(driver) {
  await driver.executeAsyncScript((done) => {
    Promise.resolve()
      .then(async () => {
        localStorage.clear();
        sessionStorage.clear();

        if ('caches' in window) {
          const names = await caches.keys();
          await Promise.all(names.map((name) => caches.delete(name)));
        }

        if (indexedDB.databases) {
          const dbs = await indexedDB.databases();
          await Promise.all(
            dbs
              .filter((db) => db.name)
              .map(
                (db) =>
                  new Promise((resolve) => {
                    const request = indexedDB.deleteDatabase(db.name);
                    request.onsuccess = resolve;
                    request.onerror = resolve;
                    request.onblocked = resolve;
                  })
              )
          );
        }
      })
      .then(() => done(true))
      .catch((error) => done(String(error && error.message ? error.message : error)));
  });

  await driver.manage().deleteAllCookies();
}

async function expectPlayerAtOrAfterSavedTime(driver, label) {
  const state = await waitUntil(label, RESTORE_TIMEOUT_MS, async () => {
    await skipYouTubeAdIfPossible(driver);
    const current = await getVideoState(driver);
    return {
      ...current,
      ok: current.currentTime >= TARGET_TIME - RESUME_TOLERANCE,
    };
  });

  assert.ok(
    state.currentTime >= TARGET_TIME - RESUME_TOLERANCE,
    `${label}: expected player >= ${TARGET_TIME - RESUME_TOLERANCE}s, got ${state.currentTime}s`
  );
}

async function main() {
  const timeout = setTimeout(() => {
    console.error(`Firefox Rick resume test exceeded ${TEST_TIMEOUT_MS}ms`);
    process.exit(1);
  }, TEST_TIMEOUT_MS);

  const session = await launchFirefoxWithExtension();

  try {
    await enableExtensionDebug(session);
    await removeStoredVideo(session, VIDEO_ID);

    await openWatchPage(session.driver);
    await waitForPrimaryVideo(session.driver);

    const startingState = await session.driver.executeScript(() => {
      const video = document.querySelector('video');
      video.pause();
      return { currentTime: video.currentTime, duration: video.duration };
    });
    assert.ok(
      startingState.currentTime < 10,
      `fresh Firefox profile should not inherit YouTube resume time, got ${startingState.currentTime}s`
    );

    const savedRecord = await saveVideoAtTime(session, TARGET_TIME);
    assert.equal(savedRecord.videoId, VIDEO_ID);
    assert.equal(savedRecord.url, WATCH_URL);
    assert.ok(
      savedRecord.time >= TARGET_TIME - RESUME_TOLERANCE,
      `expected saved record >= ${TARGET_TIME - RESUME_TOLERANCE}s, got ${savedRecord.time}s`
    );

    await pauseVideo(session.driver);

    await session.driver.get('https://www.youtube.com/results?search_query=firefox+webdriver+testing');
    await dismissYouTubeConsent(session.driver);
    await clearYouTubeOriginState(session.driver);

    const preservedRecord = await getStoredVideo(session, VIDEO_ID);
    assert.ok(preservedRecord, 'extension record should remain after clearing YouTube origin state');
    assert.ok(
      preservedRecord.time >= TARGET_TIME - RESUME_TOLERANCE,
      `expected preserved record >= ${TARGET_TIME - RESUME_TOLERANCE}s, got ${preservedRecord.time}s`
    );

    await session.driver.get(WATCH_URL);
    await dismissYouTubeConsent(session.driver);
    await waitForPrimaryVideo(session.driver);
    await expectPlayerAtOrAfterSavedTime(session.driver, 'returning to saved video should restore timestamp');

    await pauseVideo(session.driver);
    await session.driver.navigate().refresh();
    await dismissYouTubeConsent(session.driver);
    await waitForPrimaryVideo(session.driver);
    await expectPlayerAtOrAfterSavedTime(session.driver, 'reloading saved video should restore timestamp');

    console.log(`Firefox Rick resume passed at ${TARGET_TIME}s for ${VIDEO_ID}`);
  } finally {
    clearTimeout(timeout);
    await session.cleanup();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
