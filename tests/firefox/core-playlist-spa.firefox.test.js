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
const MINIMUM_SAVED_TIME = 10;
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
      const player = document.querySelector('#movie_player');
      return {
        found: !!element,
        readyState: element ? element.readyState : 0,
        playerVideoId: typeof player?.getVideoData === 'function'
          ? player.getVideoData()?.video_id || ''
          : '',
      };
    }, PRIMARY_VIDEO_SELECTOR);
    return {
      ok: url.pathname === '/watch'
        && url.searchParams.get('v') === item.videoId
        && url.searchParams.get('list') === PLAYLIST_ID
        && video.found
        && video.playerVideoId === item.videoId,
      url: url.href,
      video,
    };
  });
}

async function skipYouTubeAdIfPossible(driver) {
  const buttons = await driver.findElements(By.css('.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, button'));
  for (const button of buttons) {
    const text = `${await button.getText().catch(() => '')} ${await button.getAttribute('aria-label').catch(() => '')}`.trim();
    if (/skip/i.test(text) && await button.isDisplayed().catch(() => false)) {
      const clicked = await button.click()
        .then(() => true)
        .catch(() => false);
      if (!clicked) continue;
      await sleep(500);
      return true;
    }
  }
  return false;
}

async function waitForMainPlaylistMedia(driver, videoId) {
  const deadline = Date.now() + 90000;
  let nextForcedLoadAt = Date.now() + 10000;
  let forcedLoadAttempts = 0;
  let lastState = null;

  while (Date.now() < deadline) {
    const skipped = await skipYouTubeAdIfPossible(driver);
    const forceContentLoad = !skipped
      && forcedLoadAttempts < 3
      && Date.now() >= nextForcedLoadAt;
    lastState = await driver.executeScript((selector, expectedVideoId, skippedAd, forceLoad) => {
      const video = document.querySelector(selector);
      const player = document.querySelector('#movie_player');
      const playerVideoId = typeof player?.getVideoData === 'function'
        ? player.getVideoData()?.video_id || ''
        : '';
      const adPlaying = !!player && (
        player.classList.contains('ad-showing')
        || player.classList.contains('ad-interrupting')
      );
      let forcedContentLoad = false;
      // Firefox can leave an unskippable pre-roll paused during automation.
      // Let it complete through accelerated playback, then use the same
      // bounded player-API fallback as the Chromium playlist canary.
      if (video && adPlaying && !skippedAd) {
        video.muted = true;
        if (typeof player?.mute === 'function') player.mute();
        video.playbackRate = 16;
        if (video.paused) {
          if (typeof player?.playVideo === 'function') player.playVideo();
          video.play().catch(() => {});
        }
        if (forceLoad && typeof player?.loadVideoById === 'function') {
          try {
            player.loadVideoById(expectedVideoId, 0);
            forcedContentLoad = true;
          } catch (_) {
            // Keep accelerated playback as the fallback if this page does not
            // expose YouTube's player API in the expected form.
          }
        }
      } else if (video && video.playbackRate !== 1) {
        video.playbackRate = 1;
      }
      return {
        found: !!video,
        duration: video && Number.isFinite(video.duration) ? video.duration : 0,
        currentTime: video?.currentTime || 0,
        paused: video?.paused ?? true,
        playbackRate: video?.playbackRate || 0,
        playerVideoId,
        adPlaying,
        forcedContentLoad,
        canForceContentLoad: typeof player?.loadVideoById === 'function',
        ready: !!video
          && !adPlaying
          && playerVideoId === expectedVideoId
          && Number.isFinite(video.duration)
          && video.duration > 30,
      };
    }, PRIMARY_VIDEO_SELECTOR, videoId, skipped, forceContentLoad);
    if (forceContentLoad) {
      forcedLoadAttempts += 1;
      nextForcedLoadAt = Date.now() + 10000;
    }
    if (lastState.ready) return;
    await sleep(1000);
  }

  throw new Error(`Expected the main playlist media after any pre-roll ad; last state: ${JSON.stringify(lastState)}`);
}

async function saveCurrentPlaylistVideo(session, videoId) {
  const { driver } = session;
  await waitForMainPlaylistMedia(driver, videoId);

  let lastSavedTime = 0;
  for (let attempt = 0; attempt < 30; attempt++) {
    const seekResult = await driver.executeAsyncScript((time, selector, done) => {
      const run = async () => {
        const player = document.querySelector('#movie_player');
        const video = document.querySelector(selector);
        if (!video) throw new Error('Playlist video element not found');
        video.muted = true;
        if (typeof player?.mute === 'function') player.mute();
        if (typeof player?.seekTo === 'function') {
          player.seekTo(time, true);
        } else {
          video.currentTime = time;
        }

        const deadline = Date.now() + 3000;
        while (video.currentTime < time - 1 && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        if (typeof player?.pauseVideo === 'function') player.pauseVideo();
        video.pause();
        video.dispatchEvent(new Event('timeupdate'));
        video.dispatchEvent(new Event('pause'));
        return video.currentTime;
      };

      run()
        .then((value) => done({ ok: true, value }))
        .catch((error) => done({ ok: false, error: error?.message || String(error) }));
    }, SAVE_TIME, PRIMARY_VIDEO_SELECTOR);
    if (!seekResult?.ok) {
      throw new Error(seekResult?.error || 'Failed to seek the Firefox playlist video');
    }
    const mediaTime = seekResult.value;
    await sleep(900);

    const record = await getStoredVideo(session, videoId);
    lastSavedTime = record && typeof record.time === 'number' ? record.time : 0;
    // YouTube may clamp a seek to its currently buffered range. Match the
    // Chromium canary by requiring meaningful saved progress only after the
    // real player has accepted the seek.
    if (mediaTime < MINIMUM_SAVED_TIME) continue;
    if (lastSavedTime >= MINIMUM_SAVED_TIME) return;
  }

  throw new Error(`Expected Firefox to save ${videoId} beyond ${MINIMUM_SAVED_TIME}s; last saved time was ${lastSavedTime}s`);
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
