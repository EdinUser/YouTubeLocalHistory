const { test, expect } = require('./extension-fixture');

test('packaged feed page exposes one live scheduler-status surface beside Refresh', async ({ context }) => {
  const worker = context.serviceWorkers().find((item) => item.url().includes('background.js'))
    || await context.waitForEvent('serviceworker', { predicate: (item) => item.url().includes('background.js') });
  const workerUrl = new URL(worker.url());
  const extensionOrigin = `${workerUrl.protocol}//${workerUrl.host}`;
  const page = await context.newPage();

  await page.goto(`${extensionOrigin}/feed.html`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#refresh')).toBeVisible();
  await expect(page.locator('#feedSyncStatus')).toHaveCount(1);
  await expect(page.locator('#feedSyncStatus')).toHaveAttribute('aria-busy', /true|false/);
  await page.close();
});

test('packaged playlists view enriches missing artwork without a page error', async ({ context }) => {
  const worker = context.serviceWorkers().find((item) => item.url().includes('background.js'))
    || await context.waitForEvent('serviceworker', { predicate: (item) => item.url().includes('background.js') });
  const extensionOrigin = `${new URL(worker.url()).protocol}//${new URL(worker.url()).host}`;
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await context.route('https://www.youtube.com/playlist?list=PLmissing-artwork', (route) => route.fulfill({ status: 404, body: '' }));
  await page.goto(`${extensionOrigin}/feed.html`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    await ytStorage.setPlaylist('PLmissing-artwork', {
      playlistId: 'PLmissing-artwork',
      title: 'Artwork fixture',
      timestamp: 1,
      items: {},
      order: []
    });
  });

  await page.locator('#navPlaylists').click();
  await expect(page.locator('#playlistsList')).toContainText('Artwork fixture');
  expect(pageErrors).toEqual([]);
  await page.close();
});

test('packaged local search stays local and Show opens the chronological subscription inventory', async ({ context }) => {
  const worker = context.serviceWorkers().find((item) => item.url().includes('background.js'))
    || await context.waitForEvent('serviceworker', { predicate: (item) => item.url().includes('background.js') });
  const workerUrl = new URL(worker.url());
  const extensionOrigin = `${workerUrl.protocol}//${workerUrl.host}`;
  const page = await context.newPage();
  const youtubeRequests = [];

  await page.goto(`${extensionOrigin}/feed.html`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    clearPageFeedWorkTimer();
    if (pageFeedWorkPromise) {
      await pageFeedWorkPromise.catch(() => {});
    }
    clearPageFeedWorkTimer();

    const channelId = 'UC1234567890abcdefghijkl';
    await ytvhtFeedViewData.persistHomeImpressions(ytIndexedDBStorage, [], Date.now());
    await ytIndexedDBStorage.putSubscriptionRecord({ channelId, channelTitle: 'Fixture Channel', source: 'manual', followedAt: 1 });
    await ytIndexedDBStorage.putSubscriptionFeedVideo({
      videoId: 'fixture-local-video', channelId, title: 'Local fixture upload',
      thumbnailUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
      publishedAt: 100, discoveredAt: 100, lastSeenInFeedAt: 100,
      durationSeconds: null, isShort: null, source: 'rss'
    });
    await loadData();
    subscriptionsChronological = false;
    showFeed();
    await ytIndexedDBStorage.putSubscriptionFeedVideo({
      videoId: 'fixture-new-video', channelId, title: 'New fixture upload',
      thumbnailUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
      publishedAt: 200, discoveredAt: 200, lastSeenInFeedAt: 200,
      durationSeconds: null, isShort: null, source: 'rss'
    });
    showNewFeedVideos(1);
  });

  await expect(page.locator('#status .btn', { hasText: 'Show' })).toBeVisible();
  await expect(page.locator('#grid')).not.toContainText('New fixture upload');
  await page.locator('#status .btn', { hasText: 'Show' }).click();
  await expect(page.locator('#grid')).toContainText('Local fixture upload');
  await expect(page.locator('#grid')).toContainText('New fixture upload');
  await expect.poll(() => page.evaluate(() => subscriptionsChronological)).toBe(true);

  context.on('request', (request) => {
    if (/youtube(?:i|\.com)/i.test(request.url())) youtubeRequests.push(request.url());
  });
  await page.locator('#search').fill('local fixture');
  await expect(page.locator('#localSearchResults')).toContainText('Local fixture upload');
  expect(youtubeRequests).toEqual([]);
  await page.close();
});

test('packaged feed renders cached inventory before a controlled initialization scan reports progress', async ({ context }) => {
  const worker = context.serviceWorkers().find((item) => item.url().includes('background.js'))
    || await context.waitForEvent('serviceworker', { predicate: (item) => item.url().includes('background.js') });
  const extensionOrigin = `${new URL(worker.url()).protocol}//${new URL(worker.url()).host}`;
  const page = await context.newPage();
  await page.goto(`${extensionOrigin}/feed.html`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).not.toHaveClass(/app-loading/);
  await expect(page.locator('#feedSyncStatus')).toHaveAttribute('aria-busy', 'false');

  await page.evaluate(async () => {
    clearPageFeedWorkTimer();
    const channelId = 'UC1234567890abcdefghijkl';
    const thumbnailUrl = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
    await ytIndexedDBStorage.putSubscriptionRecord({ channelId, channelTitle: 'Progress fixture', source: 'manual', followedAt: 1 });
    await ytIndexedDBStorage.putSubscriptionFeedVideo({
      videoId: 'cached-progress-video', channelId, title: 'Cached fixture upload', thumbnailUrl,
      publishedAt: 100, discoveredAt: 100, lastSeenInFeedAt: 100, durationSeconds: null, isShort: null, source: 'rss'
    });
    await ytIndexedDBStorage.putChannelSyncState({ channelId, initializationState: 'pending', nextEligibleCheckAt: 0, scanLeaseUntil: null, scanRunId: null });
    await loadData();
    subscriptionsChronological = true;
    showFeed();
    const scheduler = ensureSharedFeedScheduler();
    scheduler.fetchChannelRss = () => new Promise((resolve) => { window.__releaseFixtureScan = resolve; });
    window.__fixtureRun = requestPageActiveFeedWork();
  });

  await expect(page.locator('#grid')).toContainText('Cached fixture upload');
  await expect(page.locator('#feedSyncStatus')).toContainText('Scanning channels');
  await expect.poll(() => page.evaluate(() => typeof window.__releaseFixtureScan)).toBe('function');
  await page.evaluate(() => window.__releaseFixtureScan(ytvhtFeedContracts.createRssScanResult({
    channelId: 'UC1234567890abcdefghijkl', fetchedAt: Date.now(), entries: [{
      videoId: 'scanned-progress-video', title: 'Scanned fixture upload', publishedAt: Date.now(),
      thumbnailUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='
    }]
  })));
  await page.evaluate(() => window.__fixtureRun);
  await expect(page.locator('#status .btn', { hasText: 'Show' })).toBeVisible();
  await expect(page.locator('#grid')).not.toContainText('Scanned fixture upload');
  await page.close();
});

test('packaged RSS client uses credentials omitted without creating a consent cookie', async ({ context }) => {
  const worker = context.serviceWorkers().find((item) => item.url().includes('background.js'))
    || await context.waitForEvent('serviceworker', { predicate: (item) => item.url().includes('background.js') });
  const extensionOrigin = `${new URL(worker.url()).protocol}//${new URL(worker.url()).host}`;
  const page = await context.newPage();
  await page.goto(`${extensionOrigin}/feed.html`, { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(async () => {
    const originalFetch = window.fetch;
    let options;
    window.fetch = async (_url, requestOptions) => {
      options = requestOptions;
      return { ok: true, text: async () => '<feed xmlns="http://www.w3.org/2005/Atom"></feed>' };
    };
    const before = document.cookie;
    await ytvhtRssClient.fetchChannelRss('UC1234567890abcdefghijkl');
    const after = document.cookie;
    window.fetch = originalFetch;
    return { credentials: options.credentials, before, after };
  });
  expect(result).toEqual({ credentials: 'omit', before: '', after: '' });
  await page.close();
});

test('opening Home regenerates only local inventory and does not start a Home-owned request', async ({ context }) => {
  const worker = context.serviceWorkers().find((item) => item.url().includes('background.js'))
    || await context.waitForEvent('serviceworker', { predicate: (item) => item.url().includes('background.js') });
  const extensionOrigin = `${new URL(worker.url()).protocol}//${new URL(worker.url()).host}`;
  const page = await context.newPage();
  await page.goto(`${extensionOrigin}/feed.html`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    const channelId = 'UC1234567890abcdefghijkl';
    await ytIndexedDBStorage.putSubscriptionRecord({ channelId, channelTitle: 'Home fixture', source: 'manual', followedAt: 1 });
    await ytIndexedDBStorage.putSubscriptionFeedVideo({
      videoId: 'home-fixture-video', channelId, title: 'Home fixture upload',
      thumbnailUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
      publishedAt: 100, discoveredAt: 100, lastSeenInFeedAt: 100, durationSeconds: null, isShort: null, source: 'rss'
    });
    await loadData();
    let requestCount = 0;
    const originalFetch = window.fetch;
    window.fetch = (...args) => { requestCount += 1; return originalFetch(...args); };
    window.__homeRequestCount = () => requestCount;
    window.__resetHomeRequestCount = () => { requestCount = 0; };
    subscriptionsChronological = true;
    showFeed();
  });
  const requestsDuringHomeOpen = await page.evaluate(() => {
    window.__resetHomeRequestCount();
    document.querySelector('#navHome').click();
    return window.__homeRequestCount();
  });
  await expect(page.locator('#grid')).toContainText('Home fixture upload');
  expect(requestsDuringHomeOpen).toBe(0);
  await page.close();
});

test('subscription import reports its local outcome and initialization handoff in Settings', async ({ context }) => {
  const worker = context.serviceWorkers().find((item) => item.url().includes('background.js'))
    || await context.waitForEvent('serviceworker', { predicate: (item) => item.url().includes('background.js') });
  const extensionOrigin = `${new URL(worker.url()).protocol}//${new URL(worker.url()).host}`;
  const page = await context.newPage();
  await page.goto(`${extensionOrigin}/feed.html`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    showSettings();
    const { outcome, queuedChannelIds } = await ytvhtFeedSubscriptionImport.importCanonicalSubscriptions(ytIndexedDBStorage, [
      { channelId: 'UC1234567890abcdefghijkl', title: 'Imported fixture' },
      { channelId: 'not-a-channel', title: 'Invalid fixture' },
    ], { now: 100 });
    const scheduler = ensureSharedFeedScheduler();
    await scheduler.initializeSubscriptions(queuedChannelIds);
    const progress = await scheduler.getInitializationProgress();
    setFeedSettingsMessage(`Imported ${outcome.added} subscriptions; ${outcome.initializationQueued} queued. Preparing local feed: ${progress.completed} of ${progress.total} channels scanned; ${progress.pending} remaining.`);
  });
  await expect(page.locator('#feedSettingsMessage')).toContainText('Imported 1 subscriptions; 1 queued. Preparing local feed: 0 of 1 channels scanned; 1 remaining.');
  await page.close();
});

test('a reload reconstructs and resumes pending initialization from durable channel state', async ({ context }) => {
  const worker = context.serviceWorkers().find((item) => item.url().includes('background.js'))
    || await context.waitForEvent('serviceworker', { predicate: (item) => item.url().includes('background.js') });
  const extensionOrigin = `${new URL(worker.url()).protocol}//${new URL(worker.url()).host}`;
  await context.route('https://www.youtube.com/feeds/videos.xml**', (route) => route.fulfill({
    status: 200, contentType: 'application/atom+xml', body: '<feed xmlns="http://www.w3.org/2005/Atom"></feed>'
  }));
  const page = await context.newPage();
  await page.goto(`${extensionOrigin}/feed.html`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    const completed = 'UC1234567890abcdefghijkl';
    const pending = 'UC9876543210abcdefghijkl';
    await ytIndexedDBStorage.putSubscriptionRecord({ channelId: completed, channelTitle: 'Completed fixture', source: 'manual', followedAt: 1 });
    await ytIndexedDBStorage.putSubscriptionRecord({ channelId: pending, channelTitle: 'Pending fixture', source: 'manual', followedAt: 1 });
    await ytIndexedDBStorage.putChannelSyncState({ channelId: completed, initializationState: 'complete', lastAttemptAt: 1, lastSuccessfulCheckAt: 1, nextEligibleCheckAt: Date.now() + 86_400_000, scanLeaseUntil: null, scanRunId: null });
    await ytIndexedDBStorage.putChannelSyncState({ channelId: pending, initializationState: 'pending', nextEligibleCheckAt: 0, scanLeaseUntil: null, scanRunId: null });
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(async () => {
    const state = await ytIndexedDBStorage.getChannelSyncState('UC9876543210abcdefghijkl');
    return state && state.initializationState;
  })).toBe('complete');
  await page.close();
});

test('page-active idle work runs eligible dormant maintenance only after foreground work is empty', async ({ context }) => {
  const worker = context.serviceWorkers().find((item) => item.url().includes('background.js'))
    || await context.waitForEvent('serviceworker', { predicate: (item) => item.url().includes('background.js') });
  const extensionOrigin = `${new URL(worker.url()).protocol}//${new URL(worker.url()).host}`;
  const page = await context.newPage();
  await page.goto(`${extensionOrigin}/feed.html`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    const channelId = 'UC5555555555abcdefghijkl';
    await ytIndexedDBStorage.putSubscriptionRecord({ channelId, channelTitle: 'Dormant fixture', source: 'manual', followedAt: 1 });
    await ytIndexedDBStorage.putChannelSyncState({
      channelId, initializationState: 'complete', lastAttemptAt: 1, lastSuccessfulCheckAt: 1,
      activityClass: 'dormant', nextEligibleCheckAt: 0, scanLeaseUntil: null, scanRunId: null
    });
    const scheduler = ensureSharedFeedScheduler();
    scheduler.fetchChannelRss = async (id) => ytvhtFeedContracts.createRssScanResult({ channelId: id, fetchedAt: Date.now(), entries: [] });
    await requestPageActiveFeedWork();
  });
  await expect.poll(() => page.evaluate(async () => Boolean((await ytIndexedDBStorage.getChannelSyncState('UC5555555555abcdefghijkl'))?.dormantMaintenanceAt))).toBe(true);
  await page.close();
});
