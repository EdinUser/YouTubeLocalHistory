const assert = require('node:assert/strict');
const { By, Key } = require('selenium-webdriver');
const {
  getStoredVideo,
  launchFirefoxWithExtension,
  openFirefoxExtensionPage,
  removeStoredVideo,
  setExtensionSettings,
} = require('./firefox-fixture');
const {
  advanceToNextOrganicShort,
  isReadyOrganicShortState,
} = require('../e2e/shorts-canary-navigation');

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
      ok: isReadyOrganicShortState(state, {
        previousVideoId: expectedDifferentFrom,
        expectedVideoId,
      }),
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

function assertStoredShortIsComplete(record, videoId) {
  assert.equal(record?.videoId, videoId);
  assert.equal(record?.isShorts, true);
  assert.equal(record?.url, `https://www.youtube.com/shorts/${videoId}`);
  assert.ok(normalizeText(record?.title), 'the stored Short should have a title');
  assert.ok(normalizeText(record?.channelName), 'the stored Short should have a channel name');
  assert.ok(normalizeText(record?.channelId), 'the stored Short should have a channel ID');
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

async function waitForStoredShort(session, videoId, active, timeoutMs = 15000) {
  const result = await waitUntil(`stored Short ${videoId} with current metadata`, timeoutMs, async () => {
    const record = await getStoredVideo(session, videoId);
    const metadataMatches = !active || (
      record?.videoId === active.videoId &&
      record?.url === `https://www.youtube.com/shorts/${active.videoId}` &&
      normalizeText(record?.title) === normalizeText(active.title) &&
      normalizeText(record?.channelName) === normalizeText(active.channelName) &&
      record?.channelId === active.channelId
    );
    return { ok: !!record && record.isShorts === true && metadataMatches, record };
  });
  return result.record;
}

async function waitForStoredShortMatchesCurrentActive(session, videoId, timeoutMs = 15000) {
  const result = await waitUntil(`stored Short ${videoId} matching the settled active reel`, timeoutMs, async () => {
    const [record, active] = await Promise.all([
      getStoredVideo(session, videoId),
      activeShortState(session.driver),
    ]);
    const metadataMatches = !!record
      && isReadyOrganicShortState(active, { expectedVideoId: videoId })
      && normalizeText(record.title) === normalizeText(active.title)
      && normalizeText(record.channelName) === normalizeText(active.channelName)
      && record.channelId === active.channelId;
    return { ok: metadataMatches, record, active };
  });
  return result.record;
}

async function advanceShortsViewport(driver, attempt) {
  const controls = await driver.findElements(By.css([
    '#navigation-button-down button',
    'button#navigation-button-down',
  ].join(', ')));
  for (const control of controls) {
    if (await control.isDisplayed().catch(() => false)) {
      await control.click();
      return;
    }
  }

  await driver.executeScript(() => document.activeElement?.blur()).catch(() => {});
  const body = await driver.findElement(By.css('body'));
  await body.sendKeys(attempt > 1 && attempt % 2 === 0 ? Key.PAGE_DOWN : Key.ARROW_DOWN);
}

async function advanceToNextShort(driver, previousVideoId) {
  return advanceToNextOrganicShort({
    previousVideoId,
    maxAttempts: 5,
    advance: (attempt) => advanceShortsViewport(driver, attempt),
    waitForOrganic: () => waitForActiveShort(driver, previousVideoId, '', 10000),
    readState: () => activeShortState(driver),
  });
}

async function findFirstOrganicShort(driver) {
  return advanceToNextOrganicShort({
    previousVideoId: '',
    maxAttempts: 6,
    // Inspect the entry reel first. If YouTube opens on an ad or another
    // metadata-incomplete reel, traverse just as we do after a scroll.
    advance: (attempt) => attempt === 0
      ? Promise.resolve()
      : advanceShortsViewport(driver, attempt - 1),
    waitForOrganic: () => waitForActiveShort(driver, '', '', 10000),
    readState: () => activeShortState(driver),
  });
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
  const postSaveState = await dispatchTrackedSave(session.driver);
  assert.equal(postSaveState.videoId, direct.videoId);
  // YouTube may temporarily detach the channel bar while processing the
  // synthetic media events. The extension intentionally preserves the last
  // complete snapshot, so compare storage with the settled pre-save state.
  const record = await waitForStoredShortMatchesCurrentActive(session, direct.videoId);
  assertStoredShortIsComplete(record, direct.videoId);
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

    const first = await findFirstOrganicShort(session.driver);
    await removeStoredVideo(session, first.videoId);
    const postSaveFirst = await dispatchTrackedSave(session.driver);
    assert.equal(postSaveFirst.videoId, first.videoId);
    const initialRecord = await waitForStoredShortMatchesCurrentActive(session, first.videoId);
    assertStoredShortIsComplete(initialRecord, first.videoId);

    await removeStoredVideo(session, first.videoId);
    const second = await advanceToNextShort(session.driver, first.videoId);
    const postSaveSecond = await dispatchTrackedSave(session.driver);
    assert.equal(postSaveSecond.videoId, second.videoId);
    const secondRecord = await waitForStoredShortMatchesCurrentActive(session, second.videoId);
    assertStoredShortIsComplete(secondRecord, second.videoId);

    const outgoingRecord = await waitForStoredShort(session, first.videoId, initialRecord, 10000);
    assertStoredShortMatchesActive(outgoingRecord, initialRecord);

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
