const assert = require('node:assert/strict');
const { By, Key } = require('selenium-webdriver');
const {
  getStoredPlaylist,
  getStoredVideo,
  launchFirefoxWithExtension,
  removeStoredVideo,
  setExtensionSettings,
} = require('./firefox-fixture');

const PLAYLIST_ID = 'PLQga0f7orXVB8fZObVcpXuX-2swTybQqR';
const PLAYLIST_URL = `https://www.youtube.com/playlist?list=${PLAYLIST_ID}`;
const PRIMARY_VIDEO_SELECTOR = '#movie_player video.html5-main-video, ytd-player video.html5-main-video';
const SAVE_TIME = 20;
const TEST_TIMEOUT_MS = 240000;
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
      if (lastValue && lastValue.ok !== false) return lastValue;
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
    /reject all/i,
    /alle akzeptieren/i,
    /alle ablehnen/i,
    /acceptez tout/i,
    /refuser tout/i,
    /aceptar todo/i,
    /rechazar todo/i,
    /приемам всички/i,
    /отхвърляне на всички/i,
  ];
  const selector = 'button, a, input[type="submit"], [role="button"], tp-yt-paper-button, ytd-button-renderer';
  const elements = await driver.findElements(By.css(selector));

  for (const element of elements) {
    const text = `${await element.getText().catch(() => '')} ${await element.getAttribute('aria-label').catch(() => '')} ${await element.getAttribute('value').catch(() => '')}`.trim();
    if (text && patterns.some((pattern) => pattern.test(text)) && await element.isDisplayed().catch(() => false)) {
      await element.click().catch(() => {});
      await sleep(400);
      return true;
    }
  }
  return false;
}

async function dismissYouTubeConsent(driver) {
  for (let pass = 0; pass < 4; pass++) {
    if (await clickConsentCandidate(driver)) continue;

    const frames = await driver.findElements(By.css('iframe'));
    let clicked = false;
    for (const frame of frames) {
      clicked = await withFrame(driver, frame, () => clickConsentCandidate(driver)).catch(() => false);
      if (clicked) break;
    }

    if (!clicked) {
      const body = await driver.findElements(By.css('body')).then((elements) => elements[0] || null);
      if (body) await body.sendKeys(Key.ESCAPE).catch(() => {});
      return;
    }
  }
}

async function getPageDiagnostic(driver) {
  const currentUrl = await driver.getCurrentUrl().catch(() => '');
  try {
    return await driver.executeScript(() => ({
      url: window.location.href,
      title: document.title || '',
      bodyText: (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 500),
    }));
  } catch (error) {
    return { url: currentUrl, diagnosticError: error.message };
  }
}

function isYouTubeAutomationBlock(page) {
  const url = String(page?.url || '');
  const bodyText = String(page?.bodyText || '');
  return /(^|\.)google\.com\/sorry\//i.test(url)
    || /systems have detected unusual traffic/i.test(bodyText)
    || /captcha|not a robot|verify you are human/i.test(bodyText);
}

async function openPlaylist(driver) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await driver.get(PLAYLIST_URL);
    await sleep(750);
    await dismissYouTubeConsent(driver);

    const page = await getPageDiagnostic(driver);
    if (isYouTubeAutomationBlock(page)) {
      const error = new Error(`YouTube blocked the playlist canary: ${JSON.stringify(page)}`);
      error.code = 'YOUTUBE_AUTOMATION_BLOCK';
      throw error;
    }
    if (page.url.includes(`/playlist?list=${PLAYLIST_ID}`)) return;
    await sleep(1000 * (attempt + 1));
  }

  throw new Error(`Could not open controlled playlist: ${JSON.stringify(await getPageDiagnostic(driver))}`);
}

async function getPlaylistItems(driver) {
  const result = await waitUntil('two visible controlled-playlist items', 30000, () =>
    driver.executeScript((playlistId) => {
      const seen = new Set();
      const items = [];
      for (const anchor of document.querySelectorAll('a[href*="watch?v="]')) {
        const rect = anchor.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;

        const url = new URL(anchor.href, window.location.href);
        const videoId = url.searchParams.get('v');
        if (!videoId || url.searchParams.get('list') !== playlistId || seen.has(videoId)) continue;

        seen.add(videoId);
        items.push({ videoId, href: anchor.getAttribute('href') });
        if (items.length === 2) return { ok: true, items };
      }
      return { ok: false, items };
    }, PLAYLIST_ID)
  );
  return result.items;
}

async function clickPlaylistItem(driver, item) {
  await driver.executeScript((href) => {
    const anchor = [...document.querySelectorAll('a[href*="watch?v="]')]
      .find((candidate) => candidate.getAttribute('href') === href);
    if (!anchor) throw new Error(`Playlist link not found for ${href}`);
    anchor.click();
  }, item.href);

  await waitUntil(`playlist video ${item.videoId}`, 30000, async () => {
    const url = new URL(await driver.getCurrentUrl());
    const video = await driver.executeScript((selector) => {
      const element = document.querySelector(selector);
      return { found: !!element, readyState: element ? element.readyState : 0 };
    }, PRIMARY_VIDEO_SELECTOR);
    return {
      ok: url.pathname === '/watch'
        && url.searchParams.get('v') === item.videoId
        && url.searchParams.get('list') === PLAYLIST_ID
        && video.found,
      url: url.href,
      video,
    };
  });
}

async function skipYouTubeAdIfPossible(driver) {
  const buttons = await driver.findElements(By.css('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, button'));
  for (const button of buttons) {
    const text = `${await button.getText().catch(() => '')} ${await button.getAttribute('aria-label').catch(() => '')}`.trim();
    if (/skip/i.test(text) && await button.isDisplayed().catch(() => false)) {
      await button.click().catch(() => {});
      await sleep(500);
      return;
    }
  }
}

async function saveCurrentPlaylistVideo(session, videoId) {
  const { driver } = session;
  await waitUntil('real playlist video instead of ad', 90000, async () => {
    await skipYouTubeAdIfPossible(driver);
    const state = await driver.executeScript((selector) => {
      const video = document.querySelector(selector);
      return {
        found: !!video,
        duration: video && Number.isFinite(video.duration) ? video.duration : 0,
      };
    }, PRIMARY_VIDEO_SELECTOR);
    return { ...state, ok: state.found && state.duration > SAVE_TIME + 10 };
  });

  let lastSavedTime = 0;
  for (let attempt = 0; attempt < 30; attempt++) {
    await driver.executeScript((time, selector) => {
      const video = document.querySelector(selector);
      if (!video) throw new Error('Playlist video element not found');
      video.muted = true;
      video.pause();
      video.currentTime = time;
      video.dispatchEvent(new Event('timeupdate'));
      video.dispatchEvent(new Event('seeked'));
      video.dispatchEvent(new Event('pause'));
    }, SAVE_TIME, PRIMARY_VIDEO_SELECTOR);
    await sleep(900);

    const record = await getStoredVideo(session, videoId);
    lastSavedTime = record && typeof record.time === 'number' ? record.time : 0;
    if (lastSavedTime >= SAVE_TIME - 1) return;
  }

  throw new Error(`Expected Firefox to save ${videoId} at ${SAVE_TIME}s; last saved time was ${lastSavedTime}s`);
}

async function expectPlaylistReference(session, videoId) {
  const record = await waitUntil('saved outbound playlist reference', 30000, async () => {
    const value = await getStoredPlaylist(session, PLAYLIST_ID);
    return { ok: !!value && value.videoId === videoId, value };
  }).then((result) => result.value);

  assert.equal(record.playlistId, PLAYLIST_ID);
  assert.ok(typeof record.title === 'string' && /\S/.test(record.title), 'playlist title should be extracted from live YouTube DOM');
  assert.equal(record.url, PLAYLIST_URL);
  assert.equal(typeof record.timestamp, 'number');
  assert.equal(typeof record.lastUpdated, 'number');
  assert.equal(record.videoId, videoId);
  assert.equal(Object.prototype.hasOwnProperty.call(record, 'localItems'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(record, 'videoCount'), false);
}

async function main() {
  const timeout = setTimeout(() => {
    console.error(`Firefox controlled playlist canary exceeded ${TEST_TIMEOUT_MS}ms`);
    process.exit(1);
  }, TEST_TIMEOUT_MS);
  const session = await launchFirefoxWithExtension();

  try {
    await setExtensionSettings(session, DEFAULT_SETTINGS);
    await openPlaylist(session.driver);

    const [firstItem, secondItem] = await getPlaylistItems(session.driver);
    assert.notEqual(firstItem.videoId, secondItem.videoId);
    await removeStoredVideo(session, firstItem.videoId);
    await removeStoredVideo(session, secondItem.videoId);

    await clickPlaylistItem(session.driver, firstItem);
    await saveCurrentPlaylistVideo(session, firstItem.videoId);
    await expectPlaylistReference(session, firstItem.videoId);

    await clickPlaylistItem(session.driver, secondItem);
    await saveCurrentPlaylistVideo(session, secondItem.videoId);
    await expectPlaylistReference(session, secondItem.videoId);

    assert.ok(await getStoredVideo(session, firstItem.videoId));
    assert.ok(await getStoredVideo(session, secondItem.videoId));
    console.log(`Firefox controlled playlist canary passed for ${PLAYLIST_ID}`);
  } finally {
    clearTimeout(timeout);
    await session.cleanup();
  }
}

main().catch((error) => {
  if (error.code === 'YOUTUBE_AUTOMATION_BLOCK') {
    console.warn('Firefox controlled playlist canary skipped: Google blocked the live YouTube request.');
    return;
  }
  console.error(error);
  process.exitCode = 1;
});
