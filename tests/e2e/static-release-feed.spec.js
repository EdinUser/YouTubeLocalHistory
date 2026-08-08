const { test, expect } = require('./extension-fixture');

const LOCALES = ['en', 'bg', 'de', 'es', 'fr'];
const PLAYLIST_ID = 'PLv4ReferenceFixture123';
const PLAYLIST_URL = `https://www.youtube.com/playlist?list=${PLAYLIST_ID}`;
const CANONICAL_CHANNEL_ID = 'UCbackupfixture000000000001';
const LEGACY_CHANNEL_ID = 'UCbackupfixture000000000002';
const LIVE_RSS_CHANNEL_ID = 'UCuAXFkgsw1L7xaCfnd5JJOw';
const LIVE_CHANNEL_HANDLE = '@TodorKirilov';
const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

async function extensionOrigin(context) {
  const worker = context.serviceWorkers().find((item) => item.url().includes('background.js'))
    || await context.waitForEvent('serviceworker', {
      predicate: (item) => item.url().includes('background.js'),
    });
  const workerUrl = new URL(worker.url());
  return `${workerUrl.protocol}//${workerUrl.host}`;
}

async function openFeed(context) {
  const page = await context.newPage();
  const pageErrors = [];
  const failedRequests = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('requestfailed', (request) => failedRequests.push(request.url()));
  await page.goto(`${await extensionOrigin(context)}/feed.html`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).not.toHaveClass(/app-loading/);
  return { page, pageErrors, failedRequests };
}

for (const locale of LOCALES) {
  test.describe(`packaged feed localization: ${locale}`, () => {
    test.use({ browserLocale: locale });

    test('localizes representative feed surfaces in Chromium', async ({ context }) => {
      const { page, pageErrors, failedRequests } = await openFeed(context);
      const uiLanguage = await page.evaluate(() => chrome.i18n.getUILanguage());
      expect(uiLanguage.toLowerCase()).toMatch(new RegExp(`^${locale}(?:-|$)`));

      const messages = await page.evaluate((keys) => Object.fromEntries(
        keys.map((key) => [key, chrome.i18n.getMessage(key)])
      ), [
        'feed_search_local', 'feed_menu', 'feed_channels', 'tab_playlists',
        'feed_history', 'tab_analytics', 'tab_settings',
      ]);

      await expect(page.locator('#search')).toHaveAttribute('placeholder', messages.feed_search_local);
      await expect(page.locator('#menuToggle')).toHaveAttribute('title', messages.feed_menu);
      await expect(page.locator('#menuToggle')).toHaveAttribute('aria-label', messages.feed_menu);

      await page.locator('#manage').click();
      await expect(page.locator('.subs-title')).toHaveText(messages.feed_channels);
      await page.locator('#navPlaylists').click();
      await expect(page.locator('.playlists-title')).toHaveText(messages.tab_playlists);
      await page.locator('#navHistory').click();
      await expect(page.locator('.history-title')).toHaveText(messages.feed_history);
      await page.locator('#analyticsToggle').click();
      await expect(page.locator('#analyticsSection .section-h')).toContainText(messages.tab_analytics);
      await page.locator('#navSettings').click();
      await expect(page.locator('.settings-title')).toHaveText(messages.tab_settings);
      const missingScripts = await page.evaluate(async () => {
        const urls = [...new Set([...document.scripts].map((script) => script.src).filter(Boolean))];
        const results = await Promise.all(urls.map(async (url) => {
          try {
            const response = await fetch(url);
            return response.ok ? null : `${url} (${response.status})`;
          } catch (error) {
            return `${url} (${error.message})`;
          }
        }));
        return results.filter(Boolean);
      });
      expect(missingScripts).toEqual([]);
      expect(pageErrors).toEqual([]);
      expect(failedRequests).toEqual([]);
      await page.close();
    });
  });
}

test('saved YouTube playlist renders as an outbound reference without hydration', async ({ context }) => {
  const youtubeRequests = [];
  const pageErrors = [];
  context.on('request', (request) => {
    if (/youtube(?:i|\.com)|youtu\.be|oembed/i.test(request.url())) {
      youtubeRequests.push(request.url());
    }
  });

  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(`${await extensionOrigin(context)}/feed.html`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).not.toHaveClass(/app-loading/);
  const localPlaylists = {
    'local-fixture': {
      id: 'local-fixture',
      title: 'Preserve this experimental local playlist',
      createdAt: 1,
      updatedAt: 2,
      items: {},
      order: [],
    },
  };

  await page.evaluate(async ({ playlistId, playlistUrl, thumbnail, local }) => {
    await ytStorage.setPlaylist(playlistId, {
      playlistId,
      title: 'V4 playlist reference',
      url: playlistUrl,
      thumbnail,
      timestamp: 1700000000000,
    });
    await chrome.storage.local.set({ localVideoPlaylists: local });
    window.__playlistReferenceFetches = [];
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, options) => {
      const url = typeof input === 'string' ? input : input && input.url;
      window.__playlistReferenceFetches.push(String(url || ''));
      return originalFetch(input, options);
    };
  }, { playlistId: PLAYLIST_ID, playlistUrl: PLAYLIST_URL, thumbnail: PIXEL, local: localPlaylists });

  await page.locator('#navPlaylists').click();
  const row = page.locator('.playlist-row', { hasText: 'V4 playlist reference' });
  await expect(row).toBeVisible();
  await expect(row.locator('.playlist-name')).toHaveAttribute('href', PLAYLIST_URL);
  await expect(row.locator('.playlist-name')).toHaveAttribute('target', '_blank');
  await expect(row.locator('.playlist-name')).toHaveAttribute('rel', /noopener/);
  await expect(row.locator('.playlist-thumb-link')).toHaveAttribute('href', PLAYLIST_URL);
  await expect(row.locator('.playlist-thumb-link')).toHaveAttribute('target', '_blank');
  await expect(row.locator('.playlist-thumb-link')).toHaveAttribute('rel', /noopener/);
  await expect(row.locator('img')).toHaveAttribute('src', PIXEL);
  await expect(row.locator('.playlist-meta')).toContainText('Saved');
  await expect(page.locator('.playlist-detail-loading')).toHaveCount(0);

  expect(await page.evaluate(() => window.__playlistReferenceFetches)).toEqual([]);
  expect(youtubeRequests).toEqual([]);
  expect(pageErrors.filter((message) => /ReferenceError|ensureConsentCookie|fetchSearchMetadata|runsText/.test(message)))
    .toEqual([]);
  expect(await page.evaluate(async () => (
    await chrome.storage.local.get('localVideoPlaylists')
  ).localVideoPlaylists)).toEqual(localPlaylists);
  await page.close();
});

test('canonical v5 subscriptions round-trip through backup without duplicates', async ({ context }) => {
  const { page, pageErrors } = await openFeed(context);
  const result = await page.evaluate(async ({ canonicalId, legacyId }) => {
    await ytIndexedDBStorage.deleteSubscriptionRecord(canonicalId);
    await ytStorage.removeSubscription(legacyId);
    const original = {
      channelId: canonicalId,
      channelTitle: 'Canonical backup fixture',
      thumbnail: 'https://example.test/canonical-avatar.jpg',
      handle: '@canonicalbackupfixture',
      source: 'manual',
      followedAt: 1700000000000,
      importedAt: 1700000001000,
    };
    await ytIndexedDBStorage.putSubscriptionRecord(original);

    const backup = await createFeedBackupData();
    await ytIndexedDBStorage.deleteSubscriptionRecord(canonicalId);
    await restoreFeedBackupData(backup);
    await restoreFeedBackupData(backup);

    const restored = await ytIndexedDBStorage.getSubscriptionRecord(canonicalId);
    const duplicateCount = (await ytIndexedDBStorage.listSubscriptionRecords())
      .filter((record) => record.channelId === canonicalId).length;

    const legacyRecord = {
      id: legacyId,
      channelName: 'Legacy backup fixture',
      ucid: legacyId,
      subscribedAt: 1600000000000,
    };
    await restoreFeedBackupData({ subscriptions: [legacyRecord] });
    const restoredLegacy = await ytStorage.getSubscription(legacyId);

    await ytIndexedDBStorage.deleteSubscriptionRecord(canonicalId);
    await ytStorage.removeSubscription(legacyId);
    return {
      dataVersion: backup._metadata.dataVersion,
      exported: backup.canonicalSubscriptions.find((record) => record.channelId === canonicalId),
      restored,
      duplicateCount,
      restoredLegacy,
    };
  }, { canonicalId: CANONICAL_CHANNEL_ID, legacyId: LEGACY_CHANNEL_ID });

  expect(result.dataVersion).toBe('2.1');
  expect(result.exported).toEqual(expect.objectContaining({
    channelId: CANONICAL_CHANNEL_ID,
    source: 'manual',
    followedAt: 1700000000000,
  }));
  expect(result.restored).toEqual(result.exported);
  expect(result.duplicateCount).toBe(1);
  expect(result.restoredLegacy).toEqual(expect.objectContaining({
    id: LEGACY_CHANNEL_ID,
    channelName: 'Legacy backup fixture',
    subscribedAt: 1600000000000,
  }));
  expect(pageErrors).toEqual([]);
  await page.close();
});

test.describe('retained privileged network access (live YouTube)', () => {
  test.skip(
    process.env.RUN_LIVE_PERMISSION_CANARY !== '1',
    'Set RUN_LIVE_PERMISSION_CANARY=1 after confirming Proton VPN is disabled.'
  );

  test('retained YouTube host permission canary', async ({ context }, testInfo) => {
    testInfo.setTimeout(120000);
    const { page, pageErrors } = await openFeed(context);
    const result = await page.evaluate(async ({ rssChannelId, handle }) => {
      const resolved = await ytvhtLocalSubscriptionActions.resolveInput(handle, fetch);
      const rss = await ytvhtRssClient.fetchChannelRss(rssChannelId, { timeoutMs: 30000 });
      const hydrated = await ytvhtFeedChannelMetadata.hydrateChannel({
        channelId: resolved.channelId,
        channelTitle: '',
        url: `https://www.youtube.com/channel/${resolved.channelId}`,
      }, { fetch, now: 1700000000000 });
      return {
        rssError: rss.error,
        rssEntries: rss.entries.length,
        resolved,
        channelTitle: hydrated.channelTitle || '',
        metadataHydratedAt: hydrated.metadataHydratedAt || 0,
        metadataRetryAfter: hydrated.metadataRetryAfter || 0,
      };
    }, { rssChannelId: LIVE_RSS_CHANNEL_ID, handle: LIVE_CHANNEL_HANDLE });

    expect(result.rssError).toBeNull();
    expect(result.rssEntries).toBeGreaterThan(0);
    expect(result.resolved.channelId).toMatch(/^UC[\w-]+$/);
    expect(result.resolved.handle).toBe(LIVE_CHANNEL_HANDLE);
    expect(result.channelTitle).toMatch(/\S/);
    expect(result.metadataHydratedAt).toBe(1700000000000);
    expect(result.metadataRetryAfter).toBe(0);
    expect(pageErrors).toEqual([]);
    await page.close();
  });
});
