const assert = require('node:assert/strict');
const { By, Key } = require('selenium-webdriver');
const {
  getStoredVideo,
  launchFirefoxWithExtension,
  openFirefoxExtensionPage,
  removeStoredVideo,
  setExtensionSettings,
} = require('./firefox-fixture');

const HOME_URL = 'https://www.youtube.com/';
const TEST_TIMEOUT_MS = 240000;
const DEFAULT_SETTINGS = {
  autoCleanPeriod: 'forever',
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
    /accept all/i, /i agree/i, /^agree$/i, /got it/i, /^ok$/i, /reject all/i,
    /alle akzeptieren/i, /alle ablehnen/i, /acceptez tout/i, /refuser tout/i,
    /aceptar todo/i, /rechazar todo/i, /приемам всички/i, /отхвърляне на всички/i,
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

async function pageDiagnostic(driver) {
  const currentUrl = await driver.getCurrentUrl().catch(() => '');
  return driver.executeScript(() => ({
    url: window.location.href,
    title: document.title || '',
    bodyText: (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 500),
  })).catch((error) => ({ url: currentUrl, diagnosticError: error.message }));
}

function isYouTubeAutomationBlock(page) {
  const url = String(page?.url || '');
  const bodyText = String(page?.bodyText || '');
  return /(^|\.)google\.com\/sorry\//i.test(url)
    || /systems have detected unusual traffic/i.test(bodyText)
    || /captcha|not a robot|verify you are human/i.test(bodyText);
}

async function activeShortState(driver) {
  return driver.executeScript(() => {
    const videos = [...document.querySelectorAll('video')];
    const visible = (video) => {
      const rect = video.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const video = videos.find((candidate) => visible(candidate) && !candidate.paused && candidate.readyState >= 1)
      || videos.find((candidate) => visible(candidate) && candidate.readyState >= 1)
      || null;
    const reel = video?.closest('ytd-reel-video-renderer') || null;
    const videoId = window.location.pathname.match(/^\/shorts\/([^/?#]+)/)?.[1] || '';
    const reelVideoId = [...(reel?.querySelectorAll('a[href*="/shorts/"]') || [])]
      .map((link) => (link.getAttribute('href') || '').match(/\/shorts\/([\w-]+)/)?.[1] || '')
      .find(Boolean) || '';
    const titleEl = reel?.querySelector([
      'yt-shorts-video-title-view-model h1',
      'yt-shorts-video-title-view-model h2',
      'yt-shorts-video-title-view-model [aria-label]',
      'a.ytp-title-link[href*="/shorts/"]',
      'yt-shorts-video-title-view-model',
    ].join(', '));
    const channelLink = reel?.querySelector([
      'yt-reel-channel-bar-view-model a[href^="/@"]',
      'yt-reel-channel-bar-view-model a[href^="/channel/"]',
      'a[href^="/@"][href$="/shorts"]',
      'a[href*="youtube.com/@"][href$="/shorts"]',
      'a[href^="/channel/"]',
      'a[href*="youtube.com/channel/"]',
      'ytd-channel-name a',
      '#owner-name a',
      'a[href^="/@"]',
    ].join(', '));
    const channelHref = channelLink?.getAttribute('href') || '';
    const channelId = channelHref.match(/\/channel\/([^/?#]+)/)?.[1]
      || channelHref.match(/\/@([^/?#]+)/)?.[1]
      || '';
    return {
      videoId,
      reelVideoId,
      found: !!video,
      duration: video && Number.isFinite(video.duration) ? video.duration : 0,
      readyState: video ? video.readyState : 0,
      title: (titleEl?.getAttribute('aria-label') || titleEl?.textContent || '').trim(),
      channelName: (channelLink?.textContent || '').trim(),
      channelId,
    };
  });
}

async function waitForActiveShort(driver, expectedDifferentFrom = '', expectedVideoId = '', timeoutMs = 60000) {
  return waitUntil('an active Shorts player', timeoutMs, async () => {
    const state = await activeShortState(driver);
    return {
      ...state,
      ok: state.found
        && state.readyState >= 1
        && state.duration > 0
        && !!state.videoId
        && state.videoId !== expectedDifferentFrom
        && (!expectedVideoId || state.videoId === expectedVideoId)
        && state.reelVideoId === state.videoId
        && !!state.title
        && !!state.channelName
        && !!state.channelId,
    };
  });
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function assertStoredShortMatchesActive(record, active) {
  assert.equal(record?.videoId, active.videoId);
  assert.equal(record?.isShorts, true);
  assert.equal(record?.url, `https://www.youtube.com/shorts/${active.videoId}`);
  assert.equal(normalizeText(record?.title), normalizeText(active.title));
  assert.equal(normalizeText(record?.channelName), normalizeText(active.channelName));
  assert.equal(record?.channelId, active.channelId);
}

async function openShortsFromYouTubeMenu(driver) {
  await driver.get(HOME_URL);
  await sleep(750);
  await dismissYouTubeConsent(driver);

  const page = await pageDiagnostic(driver);
  if (isYouTubeAutomationBlock(page)) {
    const error = new Error(`YouTube blocked the Shorts canary: ${JSON.stringify(page)}`);
    error.code = 'YOUTUBE_AUTOMATION_BLOCK';
    throw error;
  }

  await waitUntil('the YouTube Shorts menu link', 30000, () => driver.executeScript(() => {
    const entries = [...document.querySelectorAll(
      'ytd-guide-entry-renderer, ytd-mini-guide-entry-renderer, a, [role="link"]'
    )];
    const entry = entries.find((candidate) => {
      const label = `${candidate.textContent || ''} ${candidate.getAttribute('aria-label') || ''} ${candidate.getAttribute('title') || ''}`
        .replace(/\s+/g, ' ')
        .trim();
      return /(^|\s)shorts($|\s)/i.test(label);
    });
    if (!entry) return { ok: false };
    const target = entry.matches('a, [role="link"]')
      ? entry
      : entry.querySelector('a, [role="link"]') || entry;
    target.click();
    return { ok: true };
  }));
  await waitForActiveShort(driver);
}

async function dispatchTrackedSave(driver) {
  await driver.executeScript(() => {
    const videos = [...document.querySelectorAll('video')].filter((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && candidate.readyState >= 1;
    });
    const video = videos.find((candidate) => !candidate.paused) || videos[0];
    if (!video) throw new Error('Active Shorts video element not found');

    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 10;
    video.muted = true;
    video.currentTime = Math.min(5, Math.max(1, duration / 2));
    video.dispatchEvent(new Event('timeupdate'));
    video.dispatchEvent(new Event('seeked'));
    video.dispatchEvent(new Event('pause'));
  });
  await sleep(900);
  return activeShortState(driver);
}

async function waitForStoredShort(session, videoId, timeoutMs = 15000) {
  const result = await waitUntil(`stored Short ${videoId}`, timeoutMs, async () => {
    const record = await getStoredVideo(session, videoId);
    return { ok: !!record && record.isShorts === true, record };
  });
  return result.record;
}

async function advanceToNextShort(driver, previousVideoId) {
  let lastError;
  for (let attempt = Number(false); attempt < 3; attempt++) {
    if (attempt === 0) {
      await waitUntil('the next Shorts control', 30000, async () => {
        const buttons = await driver.findElements(By.css('button'));
        for (const button of buttons) {
          const label = await button.getAttribute('aria-label').catch(() => '');
          if (/next video/i.test(label || '') && await button.isDisplayed().catch(() => false)) {
            await button.click();
            return { ok: true };
          }
        }
        return { ok: false };
      });
    } else {
      const body = await driver.findElement(By.css('body'));
      await body.sendKeys(attempt === 1 ? Key.ARROW_DOWN : Key.PAGE_DOWN);
    }

    try {
      return await waitForActiveShort(driver, previousVideoId, '', 10000);
    } catch (error) {
      lastError = error;
      if (attempt < 2) await sleep(500);
    }
  }

  throw lastError || new Error(`Failed to advance from Short ${previousVideoId}`);
}

async function verifyDirectLoad(session, active) {
  await removeStoredVideo(session, active.videoId);
  await session.driver.get(`https://www.youtube.com/shorts/${active.videoId}`);
  await sleep(750);
  await dismissYouTubeConsent(session.driver);
  const page = await pageDiagnostic(session.driver);
  if (isYouTubeAutomationBlock(page)) {
    const error = new Error(`YouTube blocked the direct Shorts canary: ${JSON.stringify(page)}`);
    error.code = 'YOUTUBE_AUTOMATION_BLOCK';
    throw error;
  }
  const direct = await waitForActiveShort(session.driver, '', active.videoId);
  const savedDirect = await dispatchTrackedSave(session.driver);
  assert.equal(savedDirect.videoId, direct.videoId);
  const record = await waitForStoredShort(session, direct.videoId);
  assertStoredShortMatchesActive(record, savedDirect);
}

async function verifyFeedPlacement(session, videoIds) {
  await openFirefoxExtensionPage(session, 'feed.html');
  await waitUntil('the extension feed', 15000, () => session.driver.executeScript(() => ({
    ok: !document.documentElement.classList.contains('app-loading'),
  })));
  await session.driver.findElement(By.css('#navShorts')).click();
  await waitUntil('both Shorts in the Shorts view', 15000, () => session.driver.executeScript((ids) => {
    const visibleIds = [...document.querySelectorAll('.ytvht-feed-card[data-ytvht-video-id]')]
      .map((card) => card.dataset.ytvhtVideoId);
    return { ok: ids.every((id) => visibleIds.includes(id)), visibleIds };
  }, videoIds));
  await session.driver.findElement(By.css('#navHistory')).click();
  await waitUntil('Shorts excluded from History', 15000, () => session.driver.executeScript((ids) => {
    const historyIds = [...document.querySelectorAll('.history-row[data-ytvht-video-id]')]
      .map((row) => row.dataset.ytvhtVideoId);
    return { ok: ids.every((id) => !historyIds.includes(id)), historyIds };
  }, videoIds));
}

async function main() {
  const timeout = setTimeout(() => {
    console.error(`Firefox Shorts SPA canary exceeded ${TEST_TIMEOUT_MS}ms`);
    process.exit(1);
  }, TEST_TIMEOUT_MS);
  const session = await launchFirefoxWithExtension();

  try {
    await setExtensionSettings(session, DEFAULT_SETTINGS);
    await openShortsFromYouTubeMenu(session.driver);

    const first = await waitForActiveShort(session.driver);
    await removeStoredVideo(session, first.videoId);
    const savedFirst = await dispatchTrackedSave(session.driver);
    assert.equal(savedFirst.videoId, first.videoId);
    const initialRecord = await waitForStoredShort(session, first.videoId);
    assertStoredShortMatchesActive(initialRecord, savedFirst);

    await removeStoredVideo(session, first.videoId);
    const second = await advanceToNextShort(session.driver, first.videoId);
    const savedSecond = await dispatchTrackedSave(session.driver);
    assert.equal(savedSecond.videoId, second.videoId);
    const secondRecord = await waitForStoredShort(session, second.videoId);
    assertStoredShortMatchesActive(secondRecord, savedSecond);

    const outgoingRecord = await waitForStoredShort(session, first.videoId, 10000);
    assertStoredShortMatchesActive(outgoingRecord, savedFirst);

    await verifyDirectLoad(session, second);
    await verifyFeedPlacement(session, [first.videoId, second.videoId]);
    console.log(`Firefox Shorts canary passed for ${first.videoId} -> ${second.videoId}`);
  } catch (error) {
    error.message = `${error.message}\nPage diagnostic: ${JSON.stringify(await pageDiagnostic(session.driver))}`;
    throw error;
  } finally {
    clearTimeout(timeout);
    await session.cleanup();
  }
}

main().catch((error) => {
  if (error.code === 'YOUTUBE_AUTOMATION_BLOCK') {
    console.warn('Firefox Shorts SPA canary skipped: Google blocked the live YouTube request.');
    return;
  }
  console.error(error);
  process.exitCode = 1;
});
