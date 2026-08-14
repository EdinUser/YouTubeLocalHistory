const fs = require('fs');
const path = require('path');
const vm = require('vm');
const contracts = require('../../src/feed-contracts.js');

const refreshSource = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'feed-refresh.js'), 'utf8');
const source = refreshSource.slice(refreshSource.indexOf('function setStatus'));

function runtime({ videoIds = [], loadData, work, visibleIds = videoIds, inventoryIds = videoIds } = {}) {
  document.body.innerHTML = `
    <button id="refresh"></button>
    <button id="reloadView"></button>
    <div id="status"></div>
    <div id="feedSyncStatus"></div>
    <input id="search" value="keep me">
  `;
  const stored = {};
  const context = {
    console,
    document,
    window,
    Date,
    Number,
    Promise,
    Set,
    Array,
    Math,
    ytvhtFeedContracts: contracts,
    pendingFeedDiscovery: contracts.createPendingFeedDiscovery({ videoIds, discoveredAt: 100 }),
    pendingFeedNoticeState: { busy: false, error: '' },
    newlyShownFeedVideoIds: [],
    allVideos: inventoryIds.map((videoId) => ({ videoId })),
    watchedMap: {},
    feedFeedback: { notInterested: {} },
    shortsOnly: false,
    analyticsActive: false,
    subscriptionsActive: false,
    playlistsActive: false,
    historyActive: false,
    settingsActive: false,
    channelActive: false,
    subscriptionsChronological: false,
    subscriptionSort: 'published_desc',
    loadData: loadData || jest.fn(async () => {}),
    showFeed: jest.fn(),
    refreshActiveFeedDataView: jest.fn(),
    requestPageActiveFeedWork: jest.fn(async () => work || {
      result: { insertedVideoCount: 0, insertedVideoIds: [] },
      progress: { pending: 0 }
    }),
    chrome: {
      storage: {
        local: {
          get: jest.fn(async () => stored),
          set: jest.fn(async (values) => Object.assign(stored, values))
        }
      }
    },
    tFeed: (_key, fallback, substitutions = []) => substitutions.reduce(
      (message, value, index) => message.replace(`$${index + 1}`, value),
      fallback
    ),
    feedFormatNumber: (value) => String(value),
    feedPlural: (_key, count, singular, plural, extraSubstitutions = []) =>
      [String(count), ...extraSubstitutions].reduce(
        (message, value, index) => message.replace(`$${index + 1}`, value),
        count === 1 ? singular : plural
      )
  };
  vm.runInNewContext(source, context);
  context.showFeed.mockImplementation(() => {
    document.querySelectorAll('[data-ytvht-video-id]').forEach((card) => card.remove());
    visibleIds.forEach((videoId) => {
      const card = document.createElement('article');
      card.dataset.ytvhtVideoId = videoId;
      card.scrollIntoView = jest.fn();
      document.body.appendChild(card);
    });
  });
  return { context, stored };
}

test('an upload scan does not reload or rerender the visible feed', async () => {
  const { context } = runtime({
    work: { result: { insertedVideoCount: 2, insertedVideoIds: ['video-1', 'video-2'] }, progress: { pending: 0 } }
  });

  await context.checkForNewVideos();

  expect(context.requestPageActiveFeedWork).toHaveBeenCalledTimes(1);
  expect(context.loadData).not.toHaveBeenCalled();
  expect(context.showFeed).not.toHaveBeenCalled();
});

test('a failed upload scan shows a friendly message without exposing the technical error', async () => {
  const { context } = runtime({
    work: Promise.reject(new Error('Feed scheduler is unavailable: IndexedDB transaction failed'))
  });

  await context.checkForNewVideos();

  expect(document.getElementById('status').textContent).toContain('Could not check for new videos.');
  expect(document.getElementById('status').textContent).not.toContain('IndexedDB transaction failed');
});

test('Show verifies the discovered identities before clearing pending state', async () => {
  const loadData = jest.fn(async () => {});
  const { context, stored } = runtime({ videoIds: ['video-1', 'video-2'], loadData });

  await context.showPendingFeedVideos();

  expect(loadData).toHaveBeenCalledWith({
    requireCanonicalInventory: true,
    expectedVideoIds: ['video-1', 'video-2']
  });
  expect(context.pendingFeedDiscovery.videoIds).toEqual([]);
  expect(stored['ytvht.pendingFeedDiscovery.v1'].videoIds).toEqual([]);
  expect(context.newlyShownFeedVideoIds).toEqual(['video-1', 'video-2']);
  expect(context.subscriptionsChronological).toBe(true);
  expect(context.subscriptionSort).toBe('discovered_desc');
  expect(document.getElementById('search').value).toBe('');
  expect(context.showFeed).toHaveBeenCalledTimes(1);
});

test('a failed Show preserves identities and exposes a working Retry action', async () => {
  const loadData = jest.fn()
    .mockRejectedValueOnce(new Error('inventory unavailable'))
    .mockResolvedValueOnce(undefined);
  const { context } = runtime({ videoIds: ['video-1'], loadData });

  await context.showPendingFeedVideos();

  expect(context.pendingFeedDiscovery.videoIds).toEqual(['video-1']);
  expect(document.getElementById('status').textContent).toContain('inventory unavailable');
  expect(document.querySelector('#status button').textContent).toBe('Retry');

  await context.showPendingFeedVideos();
  expect(loadData).toHaveBeenCalledTimes(2);
  expect(context.pendingFeedDiscovery.videoIds).toEqual([]);
});

test('Show recovers retained IDs from a stale pending discovery after retention', async () => {
  const incomplete = new Error('The local inventory is still missing 1 discovered video.');
  incomplete.code = 'pending_inventory_incomplete';
  const loadData = jest.fn()
    .mockRejectedValueOnce(incomplete)
    .mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce(undefined);
  const { context, stored } = runtime({
    videoIds: ['expired', 'retained'],
    inventoryIds: ['retained'],
    visibleIds: ['retained'],
    loadData
  });

  await context.showPendingFeedVideos();

  expect(loadData).toHaveBeenNthCalledWith(1, {
    requireCanonicalInventory: true,
    expectedVideoIds: ['expired', 'retained']
  });
  expect(loadData).toHaveBeenNthCalledWith(2, { requireCanonicalInventory: true });
  expect(context.pendingFeedDiscovery.videoIds).toEqual([]);
  expect(stored['ytvht.pendingFeedDiscovery.v1'].videoIds).toEqual([]);
  expect(context.newlyShownFeedVideoIds).toEqual(['retained']);
  expect(document.getElementById('status').textContent).toContain('1 new video shown.');
});

test('Show clears a wholly stale pending discovery instead of offering a permanent Retry', async () => {
  const incomplete = new Error('The local inventory is still missing 2 discovered videos.');
  incomplete.code = 'pending_inventory_incomplete';
  const loadData = jest.fn()
    .mockRejectedValueOnce(incomplete)
    .mockResolvedValueOnce(undefined);
  const { context, stored } = runtime({
    videoIds: ['expired-1', 'expired-2'], inventoryIds: [], visibleIds: [], loadData
  });

  await context.showPendingFeedVideos();

  expect(context.pendingFeedDiscovery.videoIds).toEqual([]);
  expect(stored['ytvht.pendingFeedDiscovery.v1'].videoIds).toEqual([]);
  expect(document.getElementById('status').textContent).toContain('2 stale discoveries were removed');
  expect(document.querySelector('#status button')).toBeNull();
});

test('Show explains exactly why discovered videos are not shown', async () => {
  const { context } = runtime({
    videoIds: ['video-1', 'video-2'],
    inventoryIds: ['video-1', 'video-2'],
    visibleIds: ['video-1']
  });
  context.allVideos[1].isShort = true;
  context.isShort = (video) => video.isShort === true;

  await context.showPendingFeedVideos();

  expect(document.getElementById('status').textContent).toContain('1 new video shown.');
  expect(document.getElementById('status').textContent).toContain('1 new video is hidden: Shorts (1).');
});

test('concurrent scan requests reuse the active page work promise', () => {
  const feedSource = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'feed.js'), 'utf8');
  const requestSource = feedSource.slice(
    feedSource.indexOf('function requestPageActiveFeedWork'),
    feedSource.indexOf('function onStorageChanged')
  );
  const gate = new Promise(() => {});
  const context = { pageFeedWorkPromise: null, runPageActiveFeedWork: jest.fn() };
  context.runPageActiveFeedWork.mockImplementation(() => {
    context.pageFeedWorkPromise = gate;
    return gate;
  });
  vm.runInNewContext(requestSource, context);

  expect(context.requestPageActiveFeedWork()).toBe(gate);
  expect(context.requestPageActiveFeedWork()).toBe(gate);
  expect(context.runPageActiveFeedWork).toHaveBeenCalledTimes(1);
});
