/** @jest-environment jsdom */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test('Channels renders local sync state and admits the next metadata batch only when its sentinel becomes visible', async () => {
  document.body.innerHTML = `
    <div id="subscriptionsList"></div><div id="subscriptionsEmpty"></div><div id="subscriptionsCount"></div>
    <button id="clearSubscriptions"></button><section id="subscriptionsSection"></section>
  `;
  const subscriptions = Array.from({ length: 20 }, (_, index) => ({
    channelId: `UC${index}`, channelName: `Fixture ${index}`, id: `UC${index}`,
    latestUploadAt: index === 0 ? Date.now() - 60_000 : 0,
    nextEligibleCheckAt: index === 0 ? Date.now() + 60_000 : 0,
    activityClass: index === 0 ? 'regular' : 'unknown',
  }));
  const batches = [];
  const observers = [];
  class FakeIntersectionObserver {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
    trigger() { this.callback([{ isIntersecting: true, target: this.target }]); }
  }
  const metadata = {
    selectHydrationBatch: jest.fn((items, processed) => items.filter((item) => !processed.has(item.channelId)).slice(0, 15)),
    needsHydration: jest.fn((item) => Boolean(item)),
    hydrateSubscriptionBatch: jest.fn(async (items, options) => {
      batches.push(items.map((item) => item.channelId));
      items.forEach((item) => options.processedIds.add(item.channelId));
    }),
  };
  const context = {
    document, AbortController, IntersectionObserver: FakeIntersectionObserver,
    subscriptionsActive: true, analyticsActive: false, playlistsActive: false,
    historyActive: false, settingsActive: false, channelActive: false,
    ytvhtFeedChannelMetadata: metadata,
    ytvhtFeedViewData: { loadCanonicalFeedViewData: jest.fn(async () => ({ subscriptions })) },
    ytIndexedDBStorage: { getChannelSyncState: jest.fn(async () => null), putSubscriptionRecord: jest.fn(async () => {}) },
    decodeHtmlEntities: (value) => value, relativeTime: () => '1 minute ago',
    tFeed: (_key, fallback, substitutions = []) => substitutions.reduce(
      (message, value, index) => message.replace(`$${index + 1}`, value),
      fallback
    ),
    feedFormatNumber: (value) => String(value),
    feedPlural: (_key, count, one, other) => (count === 1 ? one : other).replace('$1', count),
    setStatus: jest.fn(), setActiveNav: jest.fn(), showFeedStatus: jest.fn(),
    setRefreshVisible: jest.fn(), setCreatePlaylistVisible: jest.fn(), setSaveSettingsVisible: jest.fn(),
    setClearSubscriptionsVisible: jest.fn(), setClearHistoryVisible: jest.fn(), setFeedOptionsVisible: jest.fn(),
    leaveSearchPage: jest.fn(), render: jest.fn(), rememberView: jest.fn(),
    window: { addEventListener: jest.fn() }, console, Date, Promise, Number, String,
  };
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'feed-subscriptions-view.js'), 'utf8');
  vm.runInNewContext(source, context);

  await context.renderSubscriptions();
  await flush();
  await flush();

  expect(document.querySelector('#subscriptionsList').textContent).toContain('Last upload 1 minute ago · regular · Next check in 1m');
  expect(batches).toEqual([subscriptions.slice(0, 15).map((item) => item.channelId)]);
  expect(observers).toHaveLength(1);
  expect(observers[0].target.dataset.channelId).toBe('UC14');

  observers[0].trigger();
  await flush();
  await flush();
  expect(batches).toEqual([
    subscriptions.slice(0, 15).map((item) => item.channelId),
    subscriptions.slice(15).map((item) => item.channelId),
  ]);
});
