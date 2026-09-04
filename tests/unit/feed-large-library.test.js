/** @jest-environment jsdom */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');

const source = name => fs.readFileSync(path.join(__dirname, '../../src', name), 'utf8');

function createContext(channels) {
  const context = {
    document, DOMParser, setTimeout, clearTimeout,
    window: { addEventListener() {} }, localStorage: { getItem: () => null },
    localSubscriptions: channels, allVideos: [], watchedMap: {},
    releaseDateCache: {}, durationCache: {}, shortsCache: {},
    feedFeedback: { notInterested: {}, channelMore: {}, channelLess: {} },
    ytvhtSubscriptionSort: require('../../src/feed-subscription-sort.js'),
    ytvhtFeedViewData: { loadCanonicalFeedViewData: async () => ({ subscriptions: channels }) },
    ytIndexedDBStorage: { getChannelSyncState: jest.fn(async () => null) },
    ytvhtFeedChannelMetadata: { selectHydrationBatch: () => [] },
    analyticsActive: false, subscriptionsActive: false, playlistsActive: false,
    historyActive: false, settingsActive: false, channelActive: false, watchLaterActive: false,
    searchVisibleLimit: 25, SEARCH_PAGE_SIZE: 25,
    tFeed: (_key, fallback, values = []) => values.reduce((text, value, i) => text.replace(`$${i + 1}`, value), fallback),
    feedFormatNumber: value => String(value),
    feedPlural: (_key, count, one, other) => (count === 1 ? one : other).replace('$1', count),
    relativeTime: () => '1 day ago', showFeed: jest.fn(), console,
  };
  vm.createContext(context);
  const utilities = source('feed-state-utils.js');
  vm.runInContext(utilities.slice(utilities.indexOf('function decodeHtmlEntities('), utilities.indexOf('function applyLocalChannelArtwork(')), context);
  for (const file of ['feed-local-search.js', 'feed-home.js', 'feed-subscriptions-view.js']) vm.runInContext(source(file), context);
  return context;
}

function channels(count) {
  return Array.from({ length: count }, (_, index) => ({
    channelId: `UCscale${index}`, id: `UCscale${index}`, channelName: `Channel ${index}`,
    followedAt: index + 1, latestUploadAt: index + 1, lastAttemptAt: index + 1,
    activityClass: ['very_active', 'active', 'regular', 'occasional', 'rare', 'dormant'][index % 6],
  })).reverse();
}

test('a typing burst searches a 20,000-video library once and preserves merged search results', () => {
  jest.useFakeTimers();
  try {
    document.body.innerHTML = '<input id="search"><input id="unwatched" type="checkbox">';
    const subscriptions = channels(200);
    const context = createContext(subscriptions);
    context.allVideos = Array.from({ length: 12000 }, (_, index) => ({
      videoId: `video-${index}`, title: index % 100 === 0 ? `Needle lesson ${index}` : `Ordinary lesson ${index}`,
      channelId: subscriptions[index % 200].channelId, channelName: subscriptions[index % 200].channelName,
      published: index + 1, duration: 600, isShort: false, source: 'rss',
    }));
    context.watchedMap = Object.fromEntries(Array.from({ length: 10000 }, (_, offset) => {
      const index = offset + 10000;
      return [`video-${index}`, { videoId: `video-${index}`,
        title: index % 100 === 0 ? `Needle lesson ${index}` : `Ordinary lesson ${index}`,
        channelId: subscriptions[index % 200].channelId, channelName: subscriptions[index % 200].channelName,
        timestamp: index + 1, duration: 600, time: 120 }];
    }));
    let result;
    let elapsed;
    context.render = jest.fn(() => {
      if (!document.getElementById('search').value) return;
      const started = performance.now();
      result = context.currentView();
      elapsed = performance.now() - started;
    });
    const feed = source('feed.js');
    vm.runInContext(feed.slice(feed.indexOf('function setupFeedSearch()'), feed.indexOf('function init()')), context);
    context.setupFeedSearch();
    const input = document.getElementById('search');
    for (const value of ['n', 'ne', 'nee', 'need', 'needl', 'needle']) {
      input.value = value;
      input.dispatchEvent(new Event('input'));
    }
    expect(context.render).not.toHaveBeenCalled();
    jest.advanceTimersByTime(300);
    expect(context.render).toHaveBeenCalledTimes(1);
    expect(result.list).toHaveLength(200);
    expect(new Set(result.list.map(video => video.videoId)).size).toBe(200);
    expect(result.list[0].videoId).toBe('video-11900');
    expect(result.list.find(video => video.videoId === 'video-10000')).toMatchObject({ _historyOnly: false, watchedAt: 10001 });
    expect(result.list.find(video => video.videoId === 'video-19900')._historyOnly).toBe(true);
    input.value = 'pending';
    input.dispatchEvent(new Event('input'));
    input.value = '';
    input.dispatchEvent(new Event('input'));
    jest.advanceTimersByTime(300);
    expect(context.render).toHaveBeenCalledTimes(2);
    // Report CPU work separately from the debounce delay. Browser paint and
    // real-profile disk latency are outside this DOM test; avoid flaky CI limits.
    console.info(`[large library] 20,000-video search: ${Math.round(elapsed)} ms`);
  } finally {
    jest.useRealTimers();
  }
}, 30000);

test('all ten sort orders preserve 5,000 channels without mutating the input', () => {
  const records = channels(5000);
  const originalIds = records.map(record => record.channelId);
  const context = createContext(records);
  const started = performance.now();
  for (const field of ['name', 'followedAt', 'latestUploadAt', 'activity', 'lastAttemptAt']) {
    for (const direction of ['asc', 'desc']) {
      const sorted = context.sortChannelSubscriptions(records, { field, direction });
      expect(sorted).toHaveLength(5000);
      expect(new Set(sorted.map(record => record.channelId)).size).toBe(5000);
      if (field === 'activity') {
        expect(sorted[0].activityClass).toBe(direction === 'asc' ? 'dormant' : 'very_active');
      } else {
        expect(sorted[0].channelId).toBe(direction === 'asc' ? 'UCscale0' : 'UCscale4999');
      }
    }
  }
  expect(records.map(record => record.channelId)).toEqual(originalIds);
  console.info(`[large library] 5,000 channels, ten sorts: ${Math.round(performance.now() - started)} ms`);
});

test('the Channels DOM renders 2,000 followed channels with one state read per channel', async () => {
  document.body.innerHTML = '<div id="subscriptionsList"></div><div id="subscriptionsEmpty"></div><div id="subscriptionsCount"></div>';
  const context = createContext(channels(2000));
  context.subscriptionsActive = true;
  const started = performance.now();
  await context.renderSubscriptions();
  const elapsed = performance.now() - started;
  const rows = [...document.querySelectorAll('#subscriptionsList .subs-card')];
  expect(rows).toHaveLength(2000);
  expect(rows[0].dataset.channelId).toBe('UCscale0');
  expect(rows.at(-1).dataset.channelId).toBe('UCscale1999');
  expect(context.ytIndexedDBStorage.getChannelSyncState).toHaveBeenCalledTimes(2000);
  expect(document.querySelectorAll('[data-action="check"]:enabled')).toHaveLength(2000);
  console.info(`[large library] 2,000 channel cards, DOM construction: ${Math.round(elapsed)} ms`);
}, 30000);
