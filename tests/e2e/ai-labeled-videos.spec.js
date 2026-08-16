/**
 * Static contract for AI-labeled cards. The page is served as youtube.com so
 * the real content script and page-world bridge run; only YouTube's unstable
 * /next response is replayed locally.
 */
const { test, expect } = require('./extension-fixture');
const { getAiLabelResult, setExtensionSettings } = require('./chromium-extension-storage');

const AI_VIDEO_ID = 'AiLabel0001';
const REGULAR_VIDEO_ID = 'Regular0001';

function nextResponse(isAi) {
  return {
    contents: { twoColumnWatchNextResults: { results: { results: { contents: [
      { videoPrimaryInfoRenderer: { badges: isAi ? [{ metadataBadgeRenderer: { label: 'AI' } }] : [] } },
    ] } } } },
  };
}

function fixtureHtml() {
  return `<!doctype html><html lang="en"><head>
    <script>var ytcfg={data_:{"INNERTUBE_CLIENT_VERSION":"2.20260813.05.00","HL":"en","GL":"US"}};</script>
  </head><body>
    <ytd-rich-item-renderer id="ai-card"><a id="thumbnail" href="/watch?v=${AI_VIDEO_ID}">AI video</a></ytd-rich-item-renderer>
    <ytd-rich-item-renderer id="regular-card"><a id="thumbnail" href="/watch?v=${REGULAR_VIDEO_ID}">Regular video</a></ytd-rich-item-renderer>
  </body></html>`;
}

async function configure(page, context, mode) {
  await setExtensionSettings(context, {
    aiLabeledVideoHandling: mode,
    debug: false,
    version: '5.2.0',
  });
  let lookupCount = 0;
  await page.route('https://www.youtube.com/ai-label-static', (route) => route.fulfill({
    status: 200, contentType: 'text/html', body: fixtureHtml(),
  }));
  await page.route('https://www.youtube.com/youtubei/v1/next?**', async (route) => {
    lookupCount += 1;
    const payload = route.request().postDataJSON();
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(nextResponse(payload.videoId === AI_VIDEO_ID)) });
  });
  await page.goto('https://www.youtube.com/ai-label-static', { waitUntil: 'domcontentloaded' });
  return () => lookupCount;
}

async function expectAiCard(page, mode) {
  const card = page.locator('#ai-card');
  await expect.poll(() => card.getAttribute('data-ytvht-ai-status')).toBe('ai');
  if (mode === 'badge') await expect(card.locator('.ytvht-ai-label')).toHaveText('AI');
  if (mode === 'dim') {
    await expect(card).toHaveClass(/ytvht-ai-dimmed/);
    await expect(card.locator('.ytvht-ai-label')).toHaveText('AI');
  }
  if (mode === 'hide') await expect(card).toHaveClass(/ytvht-ai-hidden/);
}

for (const mode of ['badge', 'dim', 'hide']) {
  test(`AI static card applies ${mode} while valid non-AI cards stay unchanged`, async ({ context }) => {
    const page = await context.newPage();
    await configure(page, context, mode);
    await expectAiCard(page, mode);
    await expect.poll(() => getAiLabelResult(context, AI_VIDEO_ID)).toMatchObject({
      videoId: AI_VIDEO_ID,
      status: 'ai'
    });
    await expect(page.locator('#regular-card')).not.toHaveClass(/ytvht-ai-labeled|ytvht-ai-dimmed|ytvht-ai-hidden/);
    await page.close();
  });
}

test('migrates legacy YouTube-origin AI cache records into isolated extension storage without a lookup', async ({ context }) => {
  const page = await context.newPage();
  const lookupCount = await configure(page, context, 'off');
  const legacyRecord = {
    videoId: AI_VIDEO_ID,
    status: 'ai',
    checkedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    failureCount: 0,
    cacheVersion: 2
  };
  await page.evaluate(async (record) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('YTLH_HybridDB', 7);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('ai_label_results')) {
          request.result.createObjectStore('ai_label_results', { keyPath: 'videoId' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('ai_label_results', 'readwrite');
      const request = transaction.objectStore('ai_label_results').put(record);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    db.close();
  }, legacyRecord);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect.poll(() => getAiLabelResult(context, AI_VIDEO_ID)).toMatchObject(legacyRecord);
  expect(lookupCount()).toBe(0);
  await expect.poll(() => page.evaluate(async (videoId) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('YTLH_HybridDB', 7);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const result = await new Promise((resolve, reject) => {
      const transaction = db.transaction('ai_label_results', 'readonly');
      const request = transaction.objectStore('ai_label_results').get(videoId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return result;
  }, AI_VIDEO_ID)).toBeNull();
  await page.close();
});

test('AI cached result survives focus, Viewed redraw, and a rebuilt card without another lookup', async ({ context }) => {
  const page = await context.newPage();
  const lookupCount = await configure(page, context, 'dim');
  await expectAiCard(page, 'dim');
  await expect.poll(() => page.locator('#regular-card').getAttribute('data-ytvht-ai-status')).toBe('unlabeled');
  expect(lookupCount()).toBe(2);

  await page.evaluate(() => {
    window.dispatchEvent(new FocusEvent('focus'));
    const viewed = document.createElement('span');
    viewed.className = 'ytvht-viewed-label';
    viewed.textContent = 'Viewed';
    document.querySelector('#ai-card').appendChild(viewed);
  });
  await expect(page.locator('#ai-card')).toHaveClass(/ytvht-ai-dimmed/);

  await page.evaluate(() => {
    const original = document.querySelector('#ai-card');
    const replacement = original.cloneNode(true);
    replacement.id = 'ai-card-rebuilt';
    replacement.className = '';
    replacement.querySelectorAll('.ytvht-ai-label, .ytvht-viewed-label').forEach((node) => node.remove());
    original.replaceWith(replacement);
  });
  const rebuilt = page.locator('#ai-card-rebuilt');
  await expect(rebuilt).toHaveClass(/ytvht-ai-dimmed/);
  await expect(rebuilt.locator('.ytvht-ai-label')).toHaveText('AI');
  expect(lookupCount()).toBe(2);
  await page.close();
});
