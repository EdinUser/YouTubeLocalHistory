/**
 * External-contract canary for YouTube's undocumented Made-with-AI metadata.
 * Run explicitly with RUN_LIVE_AI_LABEL_CANARY=1; it is not deterministic CI.
 */
const { test, expect } = require('./extension-fixture');
const { setExtensionSettings } = require('./chromium-extension-storage');
const { dismissYouTubeConsent } = require('./youtube-consent');

const liveTest = process.env.RUN_LIVE_AI_LABEL_CANARY === '1' ? test : test.skip;
const KNOWN_AI_VIDEO_ID = 'rzekIMUxrtg';
const SEARCH_URL = `https://www.youtube.com/results?search_query=${KNOWN_AI_VIDEO_ID}`;

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

  const card = page.locator('ytd-video-renderer:visible').first();
  await card.evaluate((cardElement, videoId) => {
    const card = cardElement;
    card.id = 'ytvht-ai-live-canary-card';
    // The detector supports renderer-owned direct IDs. Reusing a real visible
    // result avoids depending on synthetic custom-element layout/lifecycle.
    card.setAttribute('video-id', videoId);
  }, KNOWN_AI_VIDEO_ID);

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
  await expect.poll(() => canaryCard.getAttribute('data-ytvht-ai-status'), { timeout: 30000 }).toBe('ai');
  await expect(canaryCard.locator('.ytvht-ai-label')).toHaveText('AI');
});
