/**
 * External-contract canary for YouTube's undocumented Made-with-AI metadata.
 * Run explicitly with RUN_LIVE_AI_LABEL_CANARY=1; it is not deterministic CI.
 */
const { test, expect } = require('./extension-fixture');
const { setExtensionSettings } = require('./chromium-extension-storage');
const { dismissYouTubeConsent } = require('./youtube-consent');

const liveTest = process.env.RUN_LIVE_AI_LABEL_CANARY === '1' ? test : test.skip;
const KNOWN_AI_VIDEO_IDS = ['hm4xejC2B70', 'x3vCeDsNxJ4', '6FME5SDKbnw'];
const AI_SOURCE_CHANNEL_ID = 'UCJ5XcWu45V7Jg1XbSqJD8yg';
const MAX_CHANNEL_CANDIDATES = 3;
const PREFERRED_AI_VIDEO_IDS = process.env.YTVHT_AI_CANARY_FORCE_CHANNEL === '1' ? [] : KNOWN_AI_VIDEO_IDS;
const SEARCH_URL = `https://www.youtube.com/results?search_query=${KNOWN_AI_VIDEO_IDS[0]}`;

async function selectAvailableAiVideo(page) {
  return page.evaluate(async ({ knownVideoIds, channelId, maxChannelCandidates }) => {
    const scripts = [...document.scripts].map((script) => script.textContent || '').join('\n');
    const clientVersion = scripts.match(/"INNERTUBE_CLIENT_VERSION"\s*:\s*"([^"]+)"/)?.[1];
    if (!clientVersion) return { videoId: null, checks: [{ state: 'missing-client-version' }] };
    const checks = [];
    const checkVideoIds = async (videoIds, source) => {
      for (const videoId of videoIds) {
        try {
          const response = await fetch('/youtubei/v1/next?prettyPrint=false&alt=json', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({
              videoId,
              racyCheckOk: true,
              contentCheckOk: true,
              context: { client: { clientName: 'WEB', clientVersion, hl: 'en', gl: 'US' } },
            }),
          });
          const payload = response.ok ? await response.json() : null;
          const contents = payload?.contents?.twoColumnWatchNextResults?.results?.results?.contents;
          const primary = contents?.find((item) => item?.videoPrimaryInfoRenderer)?.videoPrimaryInfoRenderer;
          const isAi = primary?.badges?.some((badge) => {
            const renderer = badge?.metadataBadgeRenderer;
            return renderer?.label === 'AI' || /made with ai/i.test(renderer?.accessibilityData?.label || '');
          }) === true;
          const state = !response.ok ? `http-${response.status}` : !primary ? 'unavailable' : isAi ? 'ai' : 'unlabeled';
          checks.push({ videoId, source, state });
          if (isAi) return { videoId, source, checks };
        } catch (error) {
          checks.push({ videoId, source, state: 'request-failed', error: error?.message || String(error) });
        }
      }
      return null;
    };

    const knownMatch = await checkVideoIds(knownVideoIds, 'curated');
    if (knownMatch) return knownMatch;

    try {
      const feedResponse = await fetch(`/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`, {
        credentials: 'same-origin',
      });
      if (!feedResponse.ok) {
        checks.push({ source: 'channel-feed', state: `http-${feedResponse.status}` });
        return { videoId: null, checks };
      }
      const feedXml = await feedResponse.text();
      const channelVideoIds = [...new Set(
        [...feedXml.matchAll(/<yt:videoId>([\w-]{11})<\/yt:videoId>/g)].map((match) => match[1])
      )].filter((videoId) => !knownVideoIds.includes(videoId)).slice(0, maxChannelCandidates);
      if (!channelVideoIds.length) {
        checks.push({ source: 'channel-feed', state: 'empty' });
        return { videoId: null, checks };
      }
      const channelMatch = await checkVideoIds(channelVideoIds, 'channel-feed');
      if (channelMatch) return channelMatch;
    } catch (error) {
      checks.push({ source: 'channel-feed', state: 'request-failed', error: error?.message || String(error) });
    }
    return { videoId: null, checks };
  }, {
    knownVideoIds: PREFERRED_AI_VIDEO_IDS,
    channelId: AI_SOURCE_CHANNEL_ID,
    maxChannelCandidates: MAX_CHANNEL_CANDIDATES,
  });
}

async function searchPageState(page) {
  return page.evaluate(() => {
    const url = new URL(window.location.href);
    const bodyText = document.body?.innerText || '';
    const accessBlock = [
      /unusual traffic/i,
      /captcha/i,
      /not a robot/i,
      /verify you are human/i,
    ].find((pattern) => pattern.test(bodyText));
    const visibleVideoRenderer = [...document.querySelectorAll('ytd-video-renderer')]
      .some((renderer) => {
        const rect = renderer.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
    return {
      url: url.href,
      onSearchPage: url.hostname === 'www.youtube.com' && url.pathname === '/results',
      hasClientScripts: document.scripts.length > 0,
      hasExtensionStyles: !!document.querySelector('#ytvht-styles'),
      hasVisibleVideoRenderer: visibleVideoRenderer,
      accessBlock: accessBlock ? String(accessBlock) : '',
    };
  });
}

async function openLiveSearch(page) {
  let lastState = null;
  let lastError = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded' });
      await dismissYouTubeConsent(page);

      lastState = await searchPageState(page);
      if (lastState.accessBlock) return lastState;

      await expect.poll(async () => {
        lastState = await searchPageState(page);
        return {
          onSearchPage: lastState.onSearchPage,
          hasClientScripts: lastState.hasClientScripts,
          hasExtensionStyles: lastState.hasExtensionStyles,
          hasVisibleVideoRenderer: lastState.hasVisibleVideoRenderer,
        };
      }, { timeout: 10000 }).toEqual({
        onSearchPage: true,
        hasClientScripts: true,
        hasExtensionStyles: true,
        hasVisibleVideoRenderer: true,
      });
      return lastState;
    } catch (error) {
      lastError = error;
      lastState = await searchPageState(page).catch(() => lastState);
      await page.waitForTimeout(1000 * (attempt + 1));
    }
  }

  throw new Error(
    `Could not open an extension-initialized YouTube search page after 3 attempts. `
    + `Last state: ${JSON.stringify(lastState)}. Last error: ${lastError?.message || '(none)'}`
  );
}

liveTest('live YouTube /next response marks a known AI-disclosed video', async ({ context, page }) => {
  test.setTimeout(120000);
  await setExtensionSettings(context, {
    aiLabeledVideoHandling: 'off',
    debug: false,
    version: '5.2.0',
  });
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) console.log(`[live AI canary] navigated to ${frame.url()}`);
  });
  page.on('console', (message) => {
    if (message.text().includes('[YTVHT AI]')) console.log(`[live AI canary] ${message.text()}`);
  });
  const searchState = await openLiveSearch(page);
  test.skip(!!searchState.accessBlock, `YouTube access blocked by ${searchState.accessBlock}`);
  const selected = await selectAvailableAiVideo(page);
  if (!selected.videoId) {
    throw new Error(`No available AI-disclosed canary video. Fixture checks: ${JSON.stringify(selected.checks)}`);
  }

  const card = page.locator('ytd-video-renderer:visible').first();
  await card.evaluate((cardElement, videoId) => {
    const card = cardElement;
    card.id = 'ytvht-ai-live-canary-card';
    // The detector supports renderer-owned direct IDs. Reusing a real visible
    // result avoids depending on synthetic custom-element layout/lifecycle.
    card.setAttribute('video-id', videoId);
  }, selected.videoId);

  const canaryCard = page.locator('#ytvht-ai-live-canary-card');
  await expect(canaryCard).toBeVisible();
  await canaryCard.scrollIntoViewIfNeeded();
  await expect.poll(() => page.evaluate(() => new Promise((resolve) => {
    const cardElement = document.querySelector('#ytvht-ai-live-canary-card');
    const observer = new IntersectionObserver(([entry]) => {
      observer.disconnect();
      resolve(entry?.isIntersecting === true);
    });
    observer.observe(cardElement);
  })), { timeout: 10000 }).toBe(true);
  await setExtensionSettings(context, {
    aiLabeledVideoHandling: 'badge',
    debug: false,
    version: '5.2.0',
  });
  await expect(canaryCard).toBeAttached();
  await expect.poll(() => canaryCard.getAttribute('data-ytvht-ai-status'), { timeout: 30000 }).toBeTruthy();
  expect(
    await canaryCard.getAttribute('data-ytvht-ai-status'),
    `Extension did not recognize selected live fixture ${selected.videoId}; checks: ${JSON.stringify(selected.checks)}`
  ).toBe('ai');
  await expect(canaryCard.locator('.ytvht-ai-label')).toHaveText('AI');
});
