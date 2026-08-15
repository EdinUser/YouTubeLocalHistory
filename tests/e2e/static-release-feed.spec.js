const { test, expect } = require('./extension-fixture');
const { getServiceWorker, seedStoredVideo } = require('./chromium-extension-storage');

const LOCALES = ['en', 'bg', 'de', 'es', 'fr'];
const PLAYLIST_ID = 'PLv4ReferenceFixture123';
const PLAYLIST_URL = `https://www.youtube.com/playlist?list=${PLAYLIST_ID}`;
const CANONICAL_CHANNEL_ID = 'UCbackupfixture000000000001';
const LEGACY_CHANNEL_ID = 'UCbackupfixture000000000002';
const LIVE_RSS_CHANNEL_ID = 'UCuAXFkgsw1L7xaCfnd5JJOw';
const LIVE_CHANNEL_HANDLE = '@TodorKirilov';
const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
const FIRST_WATCHED_SHORT_ID = 'ShortWatch1';
const SECOND_WATCHED_SHORT_ID = 'ShortWatch2';
const DUPLICATE_TITLE_SHORT_A = 'ShortDuplicateA';
const DUPLICATE_TITLE_SHORT_B = 'ShortDuplicateB';
const REGULAR_HISTORY_ID = 'RegularWatch1';

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
      await expect(page.locator('#historySection .history-title')).toHaveText(messages.feed_history);
      await page.locator('#analyticsToggle').click();
      await expect(page.locator('#analyticsSection h2[data-i18n="tab_analytics"]')).toContainText(messages.tab_analytics);
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

test('Channels shows Ignored as an internal tab only while tombstones exist', async ({ context }) => {
  const channelId = 'UCignoredtabfixture00000001';
  const worker = await getServiceWorker(context);
  await worker.evaluate(async (id) => {
    await ytIndexedDBStorage.putSubscriptionRecord({
      channelId: id,
      channelTitle: 'Ignored tab fixture',
      source: 'manual',
      followedAt: 1700000000000,
    });
    await ytIndexedDBStorage.putChannelSyncState({
      channelId: id,
      initializationState: 'complete',
      lastSuccessfulCheckAt: 1700000000000,
      nextEligibleCheckAt: 4102444800000,
    });
  }, channelId);

  const { page, pageErrors } = await openFeed(context);
  await page.locator('#manage').click();
  await expect(page.locator('#subscriptionTabs')).toBeHidden();

  await page.evaluate(async (id) => {
    await ytvhtLocalSubscriptionActions.unfollow(ytIndexedDBStorage, id, {
      source: 'channels',
      channelTitle: 'Ignored tab fixture',
    });
  }, channelId);
  await page.goto(`${await extensionOrigin(context)}/feed.html?review=1#channels/ignored`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).not.toHaveClass(/app-loading/);

  await expect(page.locator('#subscriptionTabs')).toBeVisible();
  await expect(page.locator('#channelsFollowingTab')).toHaveText('Following (0)');
  await expect(page.locator('#channelsIgnoredTab')).toHaveText('Ignored (1)');
  await expect(page.locator('#channelsIgnoredTab')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#subscriptionsList')).toContainText('Ignored tab fixture');
  await expect(page.locator('#subscriptionAddForm')).toBeHidden();

  await page.locator('#subscriptionsList button', { hasText: 'Follow again with re:Watch' }).click();
  await expect(page.locator('#subscriptionTabs')).toBeHidden();
  await expect(page.locator('#subscriptionsList')).toContainText('Ignored tab fixture');
  expect(await page.evaluate(async (id) => ytIndexedDBStorage.getLocalUnsubscribeTombstone(id), channelId)).toBeNull();
  expect(pageErrors).toEqual([]);
  await page.close();
});

test('subscription imports expose ignored-channel review actions from Settings and the popup helper', async ({ context }) => {
  const channelId = 'UCignoredimportfixture000001';
  const csv = `Channel Id,Channel Url,Channel Title\n${channelId},https://www.youtube.com/channel/${channelId},Ignored import fixture`;
  const worker = await getServiceWorker(context);
  await worker.evaluate(async (id) => {
    await ytIndexedDBStorage.putLocalUnsubscribeTombstone({
      channelId: id,
      channelTitle: 'Ignored import fixture',
      unsubscribedAt: 1700000000000,
      source: 'channels',
    });
  }, channelId);

  const { page, pageErrors } = await openFeed(context);
  await page.locator('#navSettings').click();
  await page.locator('#importChannelsFile').setInputFiles({
    name: 'subscriptions.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });
  const settingsReview = page.locator('#feedSettingsMessage button', { hasText: 'Review ignored channels' });
  await expect(settingsReview).toBeVisible();
  await settingsReview.click();
  await expect(page.locator('#channelsIgnoredTab')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#subscriptionsList')).toContainText('Ignored import fixture');

  const popup = await context.newPage();
  await popup.goto(`${await extensionOrigin(context)}/popup.html`, { waitUntil: 'domcontentloaded' });
  await popup.evaluate(async ({ text, name }) => {
    const status = document.createElement('div');
    status.id = 'ytvhtImportStatus';
    document.body.appendChild(status);
    const file = new File([text], name, { type: 'text/csv' });
    await handleImportSubsFile({ target: { files: [file], value: '' } });
  }, { text: csv, name: 'subscriptions.csv' });
  const popupReview = popup.locator('#ytvhtImportStatus button', { hasText: 'Review ignored channels' });
  await expect(popupReview).toBeVisible();
  const popupReviewPagePromise = context.waitForEvent('page', (candidate) => candidate !== popup && candidate !== page);
  await popupReview.click();
  const popupReviewPage = await popupReviewPagePromise;
  await popupReviewPage.waitForLoadState('domcontentloaded');
  await expect(popupReviewPage.locator('html')).not.toHaveClass(/app-loading/);
  expect(popupReviewPage.url()).toContain('feed.html#channels/ignored');
  await expect(popupReviewPage.locator('#channelsIgnoredTab')).toHaveAttribute('aria-selected', 'true');

  expect(pageErrors).toEqual([]);
  await popupReviewPage.close();
  await popup.close();
  await page.close();
});

test('feed video menus unsubscribe from Home and follow again from History', async ({ context }) => {
  const channelId = 'UCfeedmenuactionsfixture001';
  const videoId = 'FeedMenu001';
  const worker = await getServiceWorker(context);
  await worker.evaluate(async ({ channelId: id, videoId: fixtureVideoId }) => {
    await ytIndexedDBStorage.putSubscriptionRecord({
      channelId: id,
      channelTitle: 'Feed menu fixture',
      source: 'manual',
      followedAt: 1700000000000,
    });
    await ytIndexedDBStorage.putSubscriptionFeedVideo({
      videoId: fixtureVideoId,
      channelId: id,
      channelTitle: 'Feed menu fixture',
      title: 'Feed menu fixture video',
      thumbnailUrl: '',
      publishedAt: 1800000000000,
      discoveredAt: 1700000000000,
      lastSeenInFeedAt: 1700000000000,
      durationSeconds: 600,
      isShort: false,
      source: 'rss',
    });
    await ytStorage.setVideo(fixtureVideoId, {
      videoId: fixtureVideoId,
      title: 'Feed menu fixture video',
      channelName: 'Feed menu fixture',
      channelId: id,
      url: `https://www.youtube.com/watch?v=${fixtureVideoId}`,
      channelUrl: `https://www.youtube.com/channel/${id}`,
      time: 30,
      duration: 600,
      timestamp: 1700000000000,
    });
  }, { channelId, videoId });

  const { page, pageErrors } = await openFeed(context);
  const homeCard = page.locator(`.ytvht-feed-card[data-ytvht-video-id="${videoId}"]`);
  await expect(homeCard).toBeVisible();
  await homeCard.locator('.video-menu-button').click();
  await homeCard.locator('.video-menu-item', { hasText: 'Unsubscribe' }).click();
  await expect.poll(() => page.evaluate(async (id) => ({
    subscription: await ytIndexedDBStorage.getSubscriptionRecord(id),
    tombstone: await ytIndexedDBStorage.getLocalUnsubscribeTombstone(id),
  }), channelId)).toEqual({ subscription: null, tombstone: expect.objectContaining({ channelId }) });

  await page.locator('#navHistory').click();
  const historyRow = page.locator(`#historyList .yt-row[data-ytvht-video-id="${videoId}"]`);
  await expect(historyRow).toBeVisible();
  await historyRow.locator('.video-menu-button').click();
  await historyRow.locator('.video-menu-item', { hasText: 'Subscribe with re:Watch' }).click();
  await expect.poll(() => page.evaluate(async (id) => ({
    subscription: await ytIndexedDBStorage.getSubscriptionRecord(id),
    tombstone: await ytIndexedDBStorage.getLocalUnsubscribeTombstone(id),
  }), channelId)).toEqual({
    subscription: expect.objectContaining({ channelId, source: 'manual' }),
    tombstone: null,
  });

  expect(pageErrors).toEqual([]);
  await page.close();
});

test('real IndexedDB v5 data survives the v7 tombstone and AI-cache store upgrades', async ({ context }) => {
  const { page, pageErrors } = await openFeed(context);
  const preserved = await page.evaluate(async () => {
    const databaseName = 'YTLH_HybridDB';
    const channelId = 'UCv5upgradefixture00000001';
    const videoId = 'V5Upgrade01';
    const openConnection = await ytIndexedDBStorage._getDB();
    openConnection.close();
    ytIndexedDBStorage._dbPromise = null;

    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(databaseName);
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('v6 database deletion was blocked'));
    });
    await new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, 5);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('videos', { keyPath: 'videoId' }).put({
          videoId: 'LegacyHistory01', title: 'Preserved legacy history', time: 12,
        });
        request.result.createObjectStore('subscriptions', { keyPath: 'channelId' }).put({
          channelId, channelTitle: 'Preserved v5 channel', source: 'manual', followedAt: 10,
        });
        request.result.createObjectStore('subscription_feed_videos', { keyPath: 'videoId' }).put({
          videoId, channelId, title: 'Preserved v5 feed video', publishedAt: 20,
        });
        request.result.createObjectStore('channel_sync_state', { keyPath: 'channelId' }).put({
          channelId, initializationState: 'complete', lastSuccessfulCheckAt: 30,
        });
      };
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });

    const [history, subscription, feedVideo, syncState] = await Promise.all([
      ytIndexedDBStorage.getVideo('LegacyHistory01'),
      ytIndexedDBStorage.getSubscriptionRecord(channelId),
      ytIndexedDBStorage.getSubscriptionFeedVideo(videoId),
      ytIndexedDBStorage.getChannelSyncState(channelId),
    ]);
    const upgraded = await ytIndexedDBStorage._getDB();
    return {
      version: upgraded.version,
      stores: [...upgraded.objectStoreNames],
      history,
      subscription,
      feedVideo,
      syncState,
    };
  });

  expect(preserved.version).toBe(7);
  expect(preserved.stores).toContain('local_unsubscribe_tombstones');
  expect(preserved.stores).toContain('ai_label_results');
  expect(preserved.history).toEqual(expect.objectContaining({
    videoId: 'LegacyHistory01', title: 'Preserved legacy history', time: 12,
  }));
  expect(preserved.subscription).toEqual(expect.objectContaining({
    channelId: 'UCv5upgradefixture00000001', channelTitle: 'Preserved v5 channel', source: 'manual',
  }));
  expect(preserved.feedVideo).toEqual(expect.objectContaining({
    videoId: 'V5Upgrade01', channelId: 'UCv5upgradefixture00000001', title: 'Preserved v5 feed video',
  }));
  expect(preserved.syncState).toEqual(expect.objectContaining({
    channelId: 'UCv5upgradefixture00000001', initializationState: 'complete',
  }));
  expect(pageErrors).toEqual([]);
  await page.close();
});

test('Home and Subscriptions paginate stable 50-card pages without duplicates', async ({ context }) => {
  const channelId = 'UCphase3paginationfixture001';
  const videoIds = Array.from({ length: 120 }, (_, index) => `Page${String(index).padStart(3, '0')}`);
  const worker = await getServiceWorker(context);
  await worker.evaluate(async ({ channelId: id, videoIds: ids }) => {
    await ytIndexedDBStorage.putSubscriptionRecord({
      channelId: id,
      channelTitle: 'Phase 3 pagination fixture',
      source: 'manual',
      followedAt: 1700000000000,
    });
    await Promise.all(ids.map((videoId) => ytIndexedDBStorage.putSubscriptionFeedVideo({
      videoId,
      channelId: id,
      title: `Pagination ${videoId}`,
      thumbnailUrl: '',
      publishedAt: 1800000000000,
      discoveredAt: 1700000000000,
      lastSeenInFeedAt: 1700000000000,
      durationSeconds: 600,
      isShort: false,
      source: 'rss',
    })));
  }, { channelId, videoIds });

  const { page, pageErrors } = await openFeed(context);
  const cards = page.locator('#grid .ytvht-feed-card');
  await expect(cards).toHaveCount(50);
  expect(new Set(await cards.evaluateAll((items) => items.map((item) => item.dataset.ytvhtVideoId))).size).toBe(50);
  await page.evaluate(() => {
    window.__phase3HomeCards = [...document.querySelectorAll('#grid .ytvht-feed-card')];
  });

  await page.locator('#feedPaginationSentinel').evaluate((sentinel) => sentinel.scrollIntoView({ block: 'center' }));
  await expect(cards).toHaveCount(100);
  expect(await page.evaluate(() => window.__phase3HomeCards.every(
    (card, index) => card === document.querySelectorAll('#grid .ytvht-feed-card')[index]
  ))).toBe(true);
  await page.locator('#feedPaginationSentinel').evaluate((sentinel) => sentinel.scrollIntoView({ block: 'center' }));
  await expect(cards).toHaveCount(120);
  expect(new Set(await cards.evaluateAll((items) => items.map((item) => item.dataset.ytvhtVideoId))).size).toBe(120);
  expect(await page.evaluate(() => window.__phase3HomeCards.every(
    (card, index) => card === document.querySelectorAll('#grid .ytvht-feed-card')[index]
  ))).toBe(true);

  await page.locator('#navSubscriptions').click();
  await expect(cards).toHaveCount(50);
  await page.evaluate(async (id) => {
    await ytIndexedDBStorage.putSubscriptionFeedVideo({
      videoId: 'InsertedAfterFirstPage',
      channelId: id,
      title: 'Inserted after first page',
      thumbnailUrl: '',
      publishedAt: 1900000000000,
      discoveredAt: Date.now(),
      lastSeenInFeedAt: Date.now(),
      durationSeconds: 600,
      isShort: false,
      source: 'rss',
    });
  }, channelId);

  await page.locator('#feedPaginationSentinel').evaluate((sentinel) => sentinel.scrollIntoView({ block: 'center' }));
  await expect(cards).toHaveCount(100);
  await page.locator('#feedPaginationSentinel').evaluate((sentinel) => sentinel.scrollIntoView({ block: 'center' }));
  await expect(cards).toHaveCount(120);
  const subscriptionIds = await cards.evaluateAll((items) => items.map((item) => item.dataset.ytvhtVideoId));
  expect(subscriptionIds).not.toContain('InsertedAfterFirstPage');
  expect(new Set(subscriptionIds).size).toBe(120);
  expect(subscriptionIds.slice(0, 3)).toEqual(['Page119', 'Page118', 'Page117']);
  expect(subscriptionIds.slice(-3)).toEqual(['Page002', 'Page001', 'Page000']);

  await page.evaluate((ids) => {
    ids.forEach((videoId) => { watchedMap[videoId] = { videoId, time: 1 }; });
    const unwatched = document.getElementById('unwatched');
    unwatched.checked = true;
    unwatched.dispatchEvent(new Event('change', { bubbles: true }));
  }, ['InsertedAfterFirstPage', ...videoIds.slice(50)]);
  await expect(cards).toHaveCount(50);
  await expect(page.locator('#feedPaginationSentinel')).toBeHidden();
  expect(await cards.evaluateAll((items) => items.map((item) => item.dataset.ytvhtVideoId)))
    .toEqual(videoIds.slice(0, 50).reverse());

  await page.evaluate((ids) => {
    ids.forEach((videoId) => { watchedMap[videoId] = { videoId, time: 1 }; });
    render();
  }, videoIds.slice(0, 50));
  await expect(cards).toHaveCount(0);
  await expect(page.locator('#empty')).toBeVisible();
  expect(pageErrors).toEqual([]);
  await page.close();
});

test('Analytics restores local skipped and unfinished insights with switchable channel metrics', async ({ context }) => {
  const records = [
    { videoId: 'AnalyticsLongest', title: 'Longest unfinished fixture', channelName: 'Longest Channel', channelId: 'UCLongestAnalyticsFixture', time: 1000, duration: 7200 },
    { videoId: 'AnalyticsWatchLong', title: 'Watch-time long fixture', channelName: 'Watch Time Channel', channelId: 'UCWatchTimeAnalyticsFixture', time: 60, duration: 1000 },
    { videoId: 'AnalyticsWatchShort', title: 'Watch-time Short fixture', channelName: 'Watch Time Channel', channelId: 'UCWatchTimeAnalyticsFixture', time: 340, duration: 40, isShorts: true },
    { videoId: 'AnalyticsCount1', title: 'Count one', channelName: 'Video Count Channel', channelId: 'UCVideoCountAnalyticsFixture', time: 100, duration: 300 },
    { videoId: 'AnalyticsCount2', title: 'Count two', channelName: 'Video Count Channel', channelId: 'UCVideoCountAnalyticsFixture', time: 100, duration: 300 },
    { videoId: 'AnalyticsCount3', title: 'Count three', channelName: 'Video Count Channel', channelId: 'UCVideoCountAnalyticsFixture', time: 100, duration: 300 },
    { videoId: 'AnalyticsAlphaSkip', title: 'Alpha skipped', channelName: 'Alpha Skipped', channelId: 'UCAlphaSkippedAnalytics', time: 50, duration: 600 },
    { videoId: 'AnalyticsZetaSkip', title: 'Zeta skipped', channelName: 'Zeta Skipped', channelId: 'UCZetaSkippedAnalytics', time: 50, duration: 1000 },
    { videoId: 'AnalyticsNoId', title: 'No channel ID fixture', channelName: 'No ID Channel', time: 80, duration: 300 },
    { videoId: 'AnalyticsComplete', title: 'Completed long fixture', channelName: '', channelId: '', time: 900, duration: 1000 },
    { videoId: 'AnalyticsExcludedShort', title: 'Excluded Short fixture', channelName: 'Excluded Short Channel', channelId: 'UCExcludedShortAnalytics', time: 0, duration: 9000, isShorts: true },
  ];
  const { page, pageErrors } = await openFeed(context);
  await page.evaluate(async (items) => {
    await Promise.all(items.map((record) => ytStorage.setVideo(record.videoId, {
      ...record,
      url: `https://www.youtube.com/watch?v=${record.videoId}`,
      timestamp: 1700000000000,
    })));
  }, records);

  await page.locator('#analyticsToggle').click();
  const topRows = page.locator('#anTopChannels .an-channel-row');
  await expect(topRows).toHaveCount(6);
  await expect(topRows.first().locator('.an-channel-name')).toHaveText('Longest Channel');
  await expect(page.locator('#anTopChannelsMetric')).toHaveText('Ranked by local watch time');
  await expect(page.locator('[data-analytics-channel-sort="watchTime"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#anTopChannels .an-channel-row', { hasText: 'Watch Time Channel' }))
    .toContainText('2 videos');
  await expect(topRows.first().locator('.an-channel-name'))
    .toHaveAttribute('href', 'https://www.youtube.com/channel/UCLongestAnalyticsFixture');
  const noIdChannel = page.locator('#anTopChannels .an-channel-row', { hasText: 'No ID Channel' })
    .locator('.an-channel-name');
  await expect(noIdChannel).toHaveText('No ID Channel');
  await expect(noIdChannel).not.toHaveAttribute('href');
  expect(await noIdChannel.evaluate((element) => element.tagName)).toBe('DIV');

  await page.locator('[data-analytics-channel-sort="videos"]').click();
  await expect(topRows.first().locator('.an-channel-name')).toHaveText('Video Count Channel');
  await expect(page.locator('#anTopChannelsMetric')).toHaveText('Ranked by watched video records');
  await expect(page.locator('[data-analytics-channel-sort="videos"]')).toHaveAttribute('aria-pressed', 'true');

  const skippedRows = page.locator('#anSkippedChannels .an-channel-row');
  await expect(skippedRows).toHaveCount(3);
  await expect(skippedRows.first().locator('.an-channel-name')).toHaveText('Alpha Skipped');
  await expect(skippedRows.first().locator('.an-channel-name'))
    .toHaveAttribute('href', 'https://www.youtube.com/channel/UCAlphaSkippedAnalytics');
  await expect(page.locator('#anSkippedChannels')).not.toContainText('Excluded Short Channel');

  const unfinished = page.locator('#anLongestUnfinished .an-continue');
  await expect(unfinished).toHaveCount(4);
  await expect(unfinished.first().locator('.an-continue-title')).toHaveText('Longest unfinished fixture');
  await expect(unfinished.first()).toHaveAttribute('href', /watch\?v=AnalyticsLongest&t=1000/);
  await expect(page.locator('#anLongestUnfinished')).not.toContainText('Excluded Short fixture');
  await expect(page.locator('[data-i18n="feed_analytics_skipped_metric"]')).toContainText('under 10%');
  await expect(page.locator('[data-i18n="feed_analytics_unfinished_metric"]')).toContainText('under 90%');

  await page.evaluate(async (videoIds) => {
    await Promise.all(videoIds.map((videoId) => ytStorage.removeVideo(videoId)));
    await renderAnalytics();
  }, records.map((record) => record.videoId));
  await expect(page.locator('#anTopChannels')).toContainText('Your most-watched channels will appear here.');
  await expect(page.locator('#anSkippedChannels')).toContainText('No skipped channels found.');
  await expect(page.locator('#anLongestUnfinished')).toContainText('No unfinished long videos found.');
  expect(pageErrors).toEqual([]);
  await page.close();
});

test('feed scan, reload, and Show keep distinct browser semantics', async ({ context }) => {
  const channelId = 'UCphase2browserfixture000001';
  const seedVideoIds = Array.from({ length: 60 }, (_, index) => `PhaseSeed${String(index).padStart(2, '0')}`);
  const discoveredVideoId = 'PhaseNew001';
  const retryVideoId = 'PhaseRetry1';
  const filteredVideoId = 'PhaseShort1';
  const worker = await getServiceWorker(context);
  await worker.evaluate(async ({ channelId: id, videoIds }) => {
    await ytIndexedDBStorage.putSubscriptionRecord({
      channelId: id,
      channelTitle: 'Phase 2 browser fixture',
      source: 'manual',
      followedAt: 1700000000000,
    });
    await ytIndexedDBStorage.putChannelSyncState({
      channelId: id,
      initializationState: 'complete',
      lastAttemptAt: 1700000000000,
      lastSuccessfulCheckAt: 1700000000000,
      nextEligibleCheckAt: 4102444800000,
    });
    await Promise.all(videoIds.map((videoId, index) => ytIndexedDBStorage.putSubscriptionFeedVideo({
      videoId,
      channelId: id,
      title: `Seed video ${index}`,
      thumbnailUrl: '',
      publishedAt: 1800000000000 - index,
      discoveredAt: 1700000000000,
      lastSeenInFeedAt: 1700000000000,
      durationSeconds: 600,
      isShort: false,
      source: 'rss',
    })));
  }, { channelId, videoIds: seedVideoIds });

  const { page, pageErrors } = await openFeed(context);
  await expect(page.locator('#refresh')).toHaveText('Check for new videos');
  await expect(page.locator('#reloadView')).toHaveText('Reload view');
  await expect(page.locator('.ytvht-feed-card')).not.toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, 500));

  const stableSnapshot = await page.evaluate(async ({ id, channelId: fixtureChannelId }) => {
    const grid = document.getElementById('grid');
    const visibleAnchor = () => Array.from(grid.querySelectorAll('[data-ytvht-video-id]'))
      .map((card) => ({ videoId: card.dataset.ytvhtVideoId, top: card.getBoundingClientRect().top }))
      .find((card) => card.top >= 0);
    const before = { html: grid.innerHTML, anchor: visibleAnchor() };
    await ytIndexedDBStorage.putSubscriptionFeedVideo({
      videoId: id,
      channelId: fixtureChannelId,
      title: 'Newly discovered fixture',
      thumbnailUrl: '',
      publishedAt: 1900000000000,
      discoveredAt: Date.now(),
      lastSeenInFeedAt: Date.now(),
      durationSeconds: 900,
      isShort: false,
      source: 'rss',
    });
    await showNewFeedVideos([id]);
    return {
      sameHtml: before.html === grid.innerHTML,
      beforeAnchor: before.anchor,
      afterAnchor: visibleAnchor(),
    };
  }, { id: discoveredVideoId, channelId });
  expect(stableSnapshot.sameHtml).toBe(true);
  expect(stableSnapshot.afterAnchor.videoId).toBe(stableSnapshot.beforeAnchor.videoId);
  expect(Math.abs(stableSnapshot.afterAnchor.top - stableSnapshot.beforeAnchor.top)).toBeLessThanOrEqual(1);
  await expect(page.locator('#status')).toContainText('1 new subscription video available');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).not.toHaveClass(/app-loading/);
  await expect(page.locator('#status')).toContainText('1 new subscription video available');
  expect(await page.evaluate(async () => (
    await chrome.storage.local.get('ytvht.pendingFeedDiscovery.v1')
  )['ytvht.pendingFeedDiscovery.v1'].videoIds)).toEqual([discoveredVideoId]);

  await page.evaluate(() => {
    window.__phase2ScrolledTo = null;
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function scrollIntoView(options) {
      window.__phase2ScrolledTo = { videoId: this.dataset.ytvhtVideoId || null, options };
      if (original) original.call(this, options);
    };
  });
  await page.locator('#status button').click();
  await expect(page.locator('.ytvht-feed-card').first())
    .toHaveAttribute('data-ytvht-video-id', discoveredVideoId);
  await expect.poll(() => page.evaluate(() => window.__phase2ScrolledTo?.videoId))
    .toBe(discoveredVideoId);
  expect(await page.evaluate(async () => (
    await chrome.storage.local.get('ytvht.pendingFeedDiscovery.v1')
  )['ytvht.pendingFeedDiscovery.v1'].videoIds)).toEqual([]);

  const reloadSchedulerCalls = await page.evaluate(async () => {
    const original = requestPageActiveFeedWork;
    let calls = 0;
    requestPageActiveFeedWork = (...args) => {
      calls += 1;
      return original(...args);
    };
    document.getElementById('reloadView').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    requestPageActiveFeedWork = original;
    return calls;
  });
  expect(reloadSchedulerCalls).toBe(0);
  await expect(page.locator('#status')).toContainText('View reloaded.');

  await page.evaluate(async (id) => showNewFeedVideos([id]), retryVideoId);
  await page.locator('#status button').click();
  await expect(page.locator('#status')).toContainText('1 stale discovery was removed from the new-videos notice.');
  expect(await page.evaluate(() => pendingFeedDiscovery.videoIds)).toEqual([]);

  await page.evaluate(async ({ id, channelId: fixtureChannelId }) => {
    await ytIndexedDBStorage.putSubscriptionFeedVideo({
      videoId: id,
      channelId: fixtureChannelId,
      title: 'Filtered Shorts fixture',
      thumbnailUrl: '',
      publishedAt: 1960000000000,
      discoveredAt: Date.now(),
      lastSeenInFeedAt: Date.now(),
      durationSeconds: 30,
      isShort: true,
      source: 'rss',
    });
    await showNewFeedVideos([id]);
  }, { id: filteredVideoId, channelId });
  await page.locator('#status button').click();
  await expect(page.locator('#status')).toContainText('0 new videos shown. 1 new video is hidden: Shorts (1).');

  const concurrent = await page.evaluate(async () => {
    clearPageFeedWorkTimer();
    const original = runPageActiveFeedWork;
    let calls = 0;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    pageFeedWorkPromise = null;
    runPageActiveFeedWork = () => {
      calls += 1;
      pageFeedWorkPromise = gate;
      return gate;
    };
    const first = requestPageActiveFeedWork();
    const second = requestPageActiveFeedWork();
    const samePromise = first === second;
    release();
    await gate;
    pageFeedWorkPromise = null;
    runPageActiveFeedWork = original;
    return { calls, samePromise };
  });
  expect(concurrent).toEqual({ calls: 1, samePromise: true });
  expect(pageErrors).toEqual([]);
  await page.close();
});

test('Shorts renders watched Shorts and updates without a feed reload', async ({ context }) => {
  const firstUrl = `https://www.youtube.com/shorts/${FIRST_WATCHED_SHORT_ID}`;
  const secondUrl = `https://www.youtube.com/shorts/${SECOND_WATCHED_SHORT_ID}`;
  await seedStoredVideo(context, FIRST_WATCHED_SHORT_ID, {
    title: 'First watched Shorts fixture',
    time: 8,
    duration: 24,
    timestamp: 1700000000000,
    url: firstUrl,
    isShorts: true,
    channelName: 'Fixture Shorts Channel',
    channelId: '@fixture-shorts',
  });
  for (const [videoId, timestamp] of [
    [DUPLICATE_TITLE_SHORT_A, 1600000000000],
    [DUPLICATE_TITLE_SHORT_B, 1600000001000],
  ]) {
    await seedStoredVideo(context, videoId, {
      title: 'Stale duplicated Shorts title',
      time: 2,
      duration: 15,
      timestamp,
      url: `https://www.youtube.com/shorts/${videoId}`,
      isShorts: true,
      channelName: 'Unknown',
      channelId: 'Unknown',
    });
  }
  const worker = await getServiceWorker(context);
  await worker.evaluate(async (videoId) => {
    await ytIndexedDBStorage.putSubscriptionFeedVideo({
      videoId,
      channelId: 'UCShortsCollisionFixture',
      title: 'RSS copy without Shorts classification',
      thumbnailUrl: 'https://i.ytimg.com/vi/ShortWatch1/hqdefault.jpg',
      publishedAt: 2000000000000,
      discoveredAt: 2000000000000,
      lastSeenInFeedAt: 2000000000000,
      durationSeconds: null,
      isShort: null,
      source: 'rss',
    });
  }, FIRST_WATCHED_SHORT_ID);

  const { page, pageErrors } = await openFeed(context);
  await page.locator('#navShorts').click();

  const firstCard = page.locator(
    `.ytvht-feed-card[data-ytvht-video-id="${FIRST_WATCHED_SHORT_ID}"]`
  );
  await expect(firstCard).toBeVisible();
  await expect(firstCard.locator('.ytvht-card-title')).toHaveAttribute('href', firstUrl);
  await expect(page.locator(
    `.ytvht-feed-card[data-ytvht-video-id="${DUPLICATE_TITLE_SHORT_A}"]`
  )).toBeVisible();
  await expect(page.locator(
    `.ytvht-feed-card[data-ytvht-video-id="${DUPLICATE_TITLE_SHORT_B}"]`
  )).toBeVisible();

  await seedStoredVideo(context, SECOND_WATCHED_SHORT_ID, {
    title: 'Second watched Shorts fixture',
    time: 3,
    duration: 18,
    timestamp: 1700000001000,
    url: secondUrl,
    isShorts: true,
    channelName: 'Fixture Shorts Channel',
    channelId: '@fixture-shorts',
  });

  const secondCard = page.locator(
    `.ytvht-feed-card[data-ytvht-video-id="${SECOND_WATCHED_SHORT_ID}"]`
  );
  await expect(secondCard).toBeVisible();
  await expect(page.locator('.ytvht-feed-card').first())
    .toHaveAttribute('data-ytvht-video-id', SECOND_WATCHED_SHORT_ID);

  await seedStoredVideo(context, REGULAR_HISTORY_ID, {
    title: 'Regular history fixture',
    time: 30,
    duration: 300,
    timestamp: 1700000002000,
    url: `https://www.youtube.com/watch?v=${REGULAR_HISTORY_ID}`,
    channelName: 'Regular Fixture Channel',
    channelId: '@regular-fixture',
  });
  await page.locator('#navHistory').click();
  await expect(page.locator(
    `.history-row[data-ytvht-video-id="${REGULAR_HISTORY_ID}"]`
  )).toBeVisible();
  await expect(page.locator('.history-row[data-ytvht-video-id^="Short"]')).toHaveCount(0);
  await expect(page.locator('#historyCount')).toContainText('1 history entry');
  expect(pageErrors).toEqual([]);
  await page.close();
});

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

test('canonical subscriptions round-trip through backup without duplicates', async ({ context }) => {
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

  expect(result.dataVersion).toBe('2.2');
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
