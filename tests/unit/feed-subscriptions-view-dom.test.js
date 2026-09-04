/** @jest-environment jsdom */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('Channels sorting', () => {
  const records = [
    { channelId: 'UCz', channelName: 'Zulu', followedAt: 100, latestUploadAt: 500, activityClass: 'active', lastAttemptAt: 300 },
    { channelId: 'UCa', channelName: 'alpha', followedAt: 300, latestUploadAt: 200, activityClass: 'active', lastAttemptAt: 100 },
    { channelId: 'UCb', channelName: 'Beta 10', followedAt: 200, latestUploadAt: 300, activityClass: 'very_active', lastAttemptAt: 200 },
    { channelId: 'UCc', channelName: 'Beta 2', followedAt: 400, latestUploadAt: 100, activityClass: 'dormant' },
    { channelId: 'UCu', channelName: 'Unknown', followedAt: 50, activityClass: 'unknown' },
    { channelId: 'UCt', channelName: 'Aardvark', followedAt: 500, latestUploadAt: 500, activityClass: 'active', lastAttemptAt: 400 },
  ];
  function load(saved = null) {
    const context = {
      localStorage: { getItem: jest.fn(() => saved) },
      decodeHtmlEntities: (value) => value, window: { addEventListener: jest.fn() },
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../src/feed-subscriptions-view.js'), 'utf8'), context);
    return context;
  }
  test.each([
    ['name', 'asc', ['UCt', 'UCa', 'UCc', 'UCb', 'UCu', 'UCz']],
    ['name', 'desc', ['UCz', 'UCu', 'UCb', 'UCc', 'UCa', 'UCt']],
    ['followedAt', 'desc', ['UCt', 'UCc', 'UCa', 'UCb', 'UCz', 'UCu']],
    ['followedAt', 'asc', ['UCu', 'UCz', 'UCb', 'UCa', 'UCc', 'UCt']],
    ['latestUploadAt', 'desc', ['UCt', 'UCz', 'UCb', 'UCa', 'UCc', 'UCu']],
    ['latestUploadAt', 'asc', ['UCc', 'UCa', 'UCb', 'UCt', 'UCz', 'UCu']],
    ['activity', 'desc', ['UCb', 'UCt', 'UCz', 'UCa', 'UCc', 'UCu']],
    ['activity', 'asc', ['UCc', 'UCt', 'UCz', 'UCa', 'UCb', 'UCu']],
    ['lastAttemptAt', 'asc', ['UCc', 'UCu', 'UCa', 'UCb', 'UCz', 'UCt']],
    ['lastAttemptAt', 'desc', ['UCt', 'UCz', 'UCb', 'UCa', 'UCc', 'UCu']],
  ])('%s %s sorts known values and handles ties/missing data', (field, direction, expected) => {
    const original = [...records];
    expect(load().sortChannelSubscriptions(records, { field, direction }).map((record) => record.channelId)).toEqual(expected);
    expect(records).toEqual(original);
  });
  test.each([null, '{broken', '{"field":"unsupported","direction":"asc"}', '{"field":"name","direction":"invalid"}'])('missing or invalid preference %s defaults to name A–Z', (saved) => {
    expect(load(saved).sortChannelSubscriptions(records).map((record) => record.channelId)).toEqual(['UCt', 'UCa', 'UCc', 'UCb', 'UCu', 'UCz']);
  });
  test('restores both field and direction', () => {
    expect(load('{"field":"activity","direction":"asc"}').sortChannelSubscriptions(records).map((record) => record.channelId))
      .toEqual(['UCc', 'UCt', 'UCz', 'UCa', 'UCb', 'UCu']);
  });
  test('orders all activity classes including reactivated channels', () => {
    const classes = ['unknown', 'rare', 'reactivated', 'active', 'dormant', 'occasional', 'regular', 'very_active'];
    const channels = classes.map((activityClass) => ({ channelId: `UC${activityClass}`, activityClass }));
    expect(load().sortChannelSubscriptions(channels, { field: 'activity', direction: 'desc' }).map((record) => record.activityClass))
      .toEqual(['very_active', 'active', 'regular', 'occasional', 'reactivated', 'rare', 'dormant', 'unknown']);
  });
});

describe('per-channel check feedback and recovery', () => {
  test.each([
    ['failed', { outcomes: { failed: 1 }, skippedCount: 0 }, 'Checked 1 channels · 1 failed · 0 deferred.'],
    ['timed out', { outcomes: { timed_out: 1 }, skippedCount: 0 }, 'Checked 1 channels · 1 failed · 0 deferred.'],
    ['deferred', { outcomes: {}, skippedCount: 1 }, 'Checked 0 channels · 0 failed · 1 deferred.'],
    ['rejected', new Error('internal failure details'), 'Could not check for new videos. Please try again.'],
  ])('%s checks restore the button, survive rerendering, and allow another attempt', async (_label, outcome, message) => {
    document.body.innerHTML = '<div id="subscriptionsList"></div><div id="subscriptionsEmpty"></div><div id="subscriptionsCount"></div>';
    const subscription = { channelId: 'UCfeedback', channelName: 'Feedback channel' };
    let finish;
    let reject;
    const pending = new Promise((resolve, fail) => { finish = resolve; reject = fail; });
    const scheduler = { runManual: jest.fn(() => pending) };
    const context = {
      document, subscriptionsActive: true, window: { addEventListener: jest.fn() },
      localStorage: { getItem: () => null },
      ensureSharedFeedScheduler: () => scheduler,
      ytvhtFeedViewData: { loadCanonicalFeedViewData: async () => ({ subscriptions: [subscription] }) },
      ytIndexedDBStorage: { getChannelSyncState: jest.fn(async () => null) },
      ytvhtFeedChannelMetadata: { selectHydrationBatch: () => [] },
      decodeHtmlEntities: value => value,
      tFeed: (_key, fallback, values = []) => values.reduce((text, value, i) => text.replace(`$${i + 1}`, value), fallback),
      feedFormatNumber: value => String(value),
      feedPlural: (_key, count, one, other) => (count === 1 ? one : other).replace('$1', count),
      console: { warn: jest.fn(), error: jest.fn() },
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../src/feed-subscriptions-view.js'), 'utf8'), context);
    await context.renderSubscriptions();
    const button = document.querySelector('[data-action="check"]');
    const running = context.checkSubscriptionForNewVideos(subscription, button);
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.textContent).toBe('Checking…');
    // Another render while a check runs must retain its busy state, and
    // even a programmatic duplicate request must not start another scan.
    await context.renderSubscriptions();
    const replacement = document.querySelector('[data-action="check"]');
    expect(replacement.disabled).toBe(true);
    await context.checkSubscriptionForNewVideos(subscription, replacement);
    expect(scheduler.runManual).toHaveBeenCalledTimes(1);
    if (outcome instanceof Error) reject(outcome);
    else finish(outcome);
    await running;
    const ready = document.querySelector('[data-action="check"]');
    expect(ready.disabled).toBe(false);
    expect(ready.getAttribute('aria-busy')).toBe('false');
    expect(ready.textContent).toBe('Check for new videos');
    expect(document.querySelector('[role="status"]').textContent).toBe(message);
    expect(document.body.textContent).not.toContain('internal failure details');

    scheduler.runManual.mockResolvedValueOnce({ outcomes: { unchanged: 1 }, skippedCount: 0 });
    await context.checkSubscriptionForNewVideos(subscription, ready);
    expect(scheduler.runManual).toHaveBeenCalledTimes(2);
    expect(scheduler.runManual).toHaveBeenLastCalledWith({ channelIds: ['UCfeedback'] });
    expect(document.querySelector('[role="status"]').textContent).toBe('Checked 1 channels · 0 failed · 0 deferred.');
  });
});

test('Channels renders local sync state and admits the next metadata batch only when its sentinel becomes visible', async () => {
  document.body.innerHTML = `
    <div id="subscriptionsList"></div><div id="subscriptionsEmpty"></div><div id="subscriptionsCount"></div>
    <div id="subscriptionTabs" hidden>
      <button id="channelsFollowingTab"></button><button id="channelsIgnoredTab" hidden></button>
    </div>
    <form id="subscriptionAddForm"><input><button type="submit"></button></form>
    <div id="subscriptionAddStatus"></div>
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
  let tombstones = [];
  const actions = {
    follow: jest.fn(async () => {
      tombstones = [];
      return { status: 'followed', restored: true };
    }),
    unfollow: jest.fn(async () => ({ status: 'unfollowed' })),
  };
  const scheduler = { initializeSubscriptions: jest.fn(async () => {}), runManual: jest.fn(async () => ({
    outcomes: { updated: 1, unchanged: 0, failed: 0, timed_out: 0 }, skippedCount: 0, insertedVideoIds: []
  })) };
  const tombstone = {
    channelId: 'UCignored',
    channelTitle: 'Ignored fixture',
    unsubscribedAt: 100,
    source: 'channels',
    reason: 'user_unfollow',
  };
  tombstones = [tombstone];
  const context = {
    document, AbortController, IntersectionObserver: FakeIntersectionObserver,
    subscriptionsActive: true, analyticsActive: false, playlistsActive: false,
    historyActive: false, settingsActive: false, channelActive: false,
    ytvhtFeedChannelMetadata: metadata,
    ytvhtFeedViewData: { loadCanonicalFeedViewData: jest.fn(async () => ({ subscriptions })) },
    ytvhtLocalSubscriptionActions: actions,
    ytIndexedDBStorage: {
    getChannelSyncState: jest.fn(async (channelId) => channelId === 'UC0' ? {
      rssAttempts: [
        { at: 1_700_000_000_000, status: 200, code: 'success', message: '' },
        { at: 1_700_000_060_000, status: 404, code: 'http', message: 'RSS returned HTTP 404' },
      ],
    } : null),
      putSubscriptionRecord: jest.fn(async () => {}),
      listLocalUnsubscribeTombstones: jest.fn(async () => tombstones),
    },
    ensureSharedFeedScheduler: jest.fn(() => scheduler),
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
  expect(document.querySelector('#subscriptionsList').textContent).not.toContain('Ignored fixture');
  expect(document.querySelector('#subscriptionTabs').hidden).toBe(false);
  expect(document.querySelector('#channelsFollowingTab').textContent).toBe('Following (20)');
  expect(document.querySelector('#channelsIgnoredTab').textContent).toBe('Ignored (1)');
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

  document.querySelector('#channelsIgnoredTab').click();
  await flush();
  expect(document.querySelector('#subscriptionsList').textContent).toContain('Ignored fixture');
  expect(document.querySelector('#subscriptionsList').textContent).not.toContain('Fixture 0');
  expect(document.querySelector('#subscriptionAddForm').style.display).toBe('none');
  expect(document.querySelector('#channelsIgnoredTab').getAttribute('aria-selected')).toBe('true');

  [...document.querySelectorAll('#subscriptionsList button')]
    .find((button) => button.textContent === 'Follow again with re:Watch')
    .click();
  await flush();
  await flush();
  expect(actions.follow).toHaveBeenCalledWith(context.ytIndexedDBStorage, expect.objectContaining({
    channelId: tombstone.channelId,
    channelTitle: tombstone.channelTitle,
  }));
  expect(scheduler.initializeSubscriptions).toHaveBeenCalledWith([tombstone.channelId]);
  expect(document.querySelector('#subscriptionTabs').hidden).toBe(true);
  expect(document.querySelector('#subscriptionsList').textContent).toContain('Fixture 0');

  document.querySelector('[data-channel-id="UC0"] [data-action="check"]').click();
  expect(document.querySelector('[data-channel-id="UC0"] [data-action="check"]').disabled).toBe(true);
  await flush();
  expect(scheduler.runManual).toHaveBeenCalledWith({ channelIds: ['UC0'] });
  expect(document.querySelector('[data-channel-id="UC0"]').textContent).toContain('Checked 1 channels · 0 failed · 0 deferred.');

  // Update storage after rendering; Log must not use the old captured row.
  context.ytIndexedDBStorage.getChannelSyncState.mockResolvedValueOnce({ rssAttempts: [
    { at: 1_700_000_000_000, status: 200, message: 'Fresh read' },
    { at: 1_700_000_060_000, status: 404, message: 'Fresh failure' }
  ] });

  [...document.querySelectorAll('#subscriptionsList button')]
    .find((button) => button.textContent === 'Log')
    .click();
  await flush();
  const rssLog = document.querySelector('.rss-log-dialog');
  expect(rssLog.textContent).toContain('Fresh read');
  expect(rssLog.textContent).toContain('HTTP 200');
  expect(rssLog.textContent).toContain('HTTP 404');
  expect(rssLog.querySelectorAll('.success')).toHaveLength(1);
  expect(rssLog.querySelectorAll('.failure')).toHaveLength(1);

  rssLog.remove();
  context.ytIndexedDBStorage.getChannelSyncState.mockRejectedValueOnce(new Error('read failed'));
  await context.showSubscriptionRssLog(subscriptions[0]);
  expect(document.querySelector('.rss-log-dialog').textContent).toContain('Could not load the RSS read log.');

  context.ytvhtFeedViewData.loadCanonicalFeedViewData.mockRejectedValueOnce(new Error('database unavailable'));
  await context.renderSubscriptions();
  expect(document.querySelector('#subscriptionTabs').hidden).toBe(true);
  expect(document.querySelector('#subscriptionsList').textContent).toBe('Could not load channels. Try again.');
});
