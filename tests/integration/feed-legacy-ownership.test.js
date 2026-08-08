const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const exists = (relativePath) => fs.existsSync(path.join(ROOT, relativePath));
const REMOVED_LEGACY_MODULES = [
  'src/feed-core.js',
  'src/feed-data-pipeline.js',
  'src/feed-youtube-search-core.js',
  'src/feed-youtube-search-render.js',
];

test('legacy aggregate, backfill, and remote-search modules are absent from source and feed packaging', () => {
  const html = read('src/feed.html');
  const build = read('build.sh');
  REMOVED_LEGACY_MODULES.forEach((modulePath) => {
    expect(exists(modulePath)).toBe(false);
    expect(html).not.toContain(path.basename(modulePath));
    expect(build).not.toContain(path.basename(modulePath));
  });
  expect(html).toContain('feed-scheduler.js');
});

test('dormant playlist hydration and remote-search message endpoints are removed', () => {
  const background = read('src/background.js');
  const contentMessages = read('src/content-messages.js');
  const removedEndpoints = [
    'getPlaylistMetadata',
    'fetchYouTubeSearchPage',
    'fetchYouTubeSearchContinuation',
    'fetchYouTubeSearchPageInTab',
    'fetchYouTubeSearchContinuationInTab',
  ];
  removedEndpoints.forEach((endpoint) => {
    expect(background).not.toContain(endpoint);
    expect(contentMessages).not.toContain(endpoint);
  });
  expect(background).not.toContain('youtubei.googleapis.com');
  expect(background).not.toContain('/youtubei/v1/');
});

test('the page-overlay subscription control has no feed inventory, RSS, or network ownership', () => {
  const source = read('src/content-subscriptions.js');
  const actions = read('src/local-subscription-actions.js');
  expect(source).not.toContain('feedCache');
  expect(source).not.toContain('videos.xml');
  expect(source).not.toContain('fetch(');
  expect(source).toContain('ytvhtLocalSubscriptionActions.follow');
  expect(actions).toContain('putSubscriptionRecord');
  expect(actions).toContain('putChannelSyncState');
  expect(actions).not.toContain('videos.xml');
});

test('both manifests expose only the permissions and host needed by shipped behavior', () => {
  ['src/manifest.chrome.json', 'src/manifest.firefox.json'].forEach((manifestPath) => {
    const manifest = JSON.parse(read(manifestPath));
    const scripts = manifest.content_scripts[0].js;
    expect(manifest.permissions).toEqual([
      'storage',
      'unlimitedStorage',
      'scripting',
      'contextMenus',
    ]);
    expect(manifest.host_permissions).toEqual(['*://*.youtube.com/*']);
    expect(scripts).toContain('indexeddb-storage.js');
    expect(scripts).toContain('content-subscriptions.js');
    expect(scripts).not.toContain('feed-core.js');
  });
});

test('retained privileged capabilities have active local-feed or context-menu callers', () => {
  const background = read('src/background.js');
  expect(background).toContain('chrome.contextMenus.create');
  expect(background).toContain('chrome.scripting.executeScript');
  expect(read('src/rss-client.js')).toContain("credentials: 'omit'");
  expect(read('src/feed-channel-metadata.js')).toContain("credentials: 'omit'");
  expect(read('src/local-subscription-actions.js')).toContain("credentials: 'omit'");
});

test('feed views do not depend on the removed aggregate-pipeline refresh global', () => {
  expect(read('src/feed-subscriptions-view.js')).not.toContain('isRefreshing');
});

test('the new-inventory Show action opens chronological Subscriptions, never a reranked Home or channel management', () => {
  const source = read('src/feed-refresh.js');
  const noticeStart = source.indexOf('function renderFeedNotice()');
  const noticeEnd = source.indexOf('function showNewFeedVideos', noticeStart);
  const notice = source.slice(noticeStart, noticeEnd);

  expect(notice).toContain('subscriptionsChronological = true;');
  expect(notice).toContain('showFeed();');
  expect(notice).not.toContain('showSubscriptions();');
});

test('the loaded feed search is explicitly local and cannot issue remote search requests', () => {
  const html = read('src/feed.html');
  const search = read('src/feed-local-search.js');
  expect(html).toContain('feed_search_local');
  expect(html).not.toContain('Search YouTube');
  expect(html).not.toContain('id="ytSection"');
  expect(search).toContain('buildLocalIndex');
  expect(search).not.toContain('fetch(');
  expect(search).not.toContain('youtubei');
  expect(search).not.toContain('ensureConsentCookie');
});

test('feed cards expose a shared live watched-overlay update boundary', () => {
  expect(read('src/feed-cards.js')).toContain('refreshWatchedOverlayForVideo');
  expect(read('src/feed-cards.js')).toContain('dataset.ytvhtVideoId');
  expect(read('src/feed-subscribe-results.js')).toContain('dataset.ytvhtVideoId');
  expect(read('src/feed.js')).toContain("key.startsWith('video_')");
});

test('normal feed work is page-active and schedules bounded continuation rather than a background runner', () => {
  const source = read('src/feed.js');
  expect(source).toContain('INITIALIZATION_CONTINUATION_DELAY_MS');
  expect(source).toContain('schedulePageFeedWork(INITIALIZATION_CONTINUATION_DELAY_MS)');
  expect(source).toContain('feedRefreshIntervalMs');
  expect(source).toContain('DORMANT_MAINTENANCE_WAKE_DELAY_MS');
  expect(source).toContain('dormant && dormant.ran ? DORMANT_MAINTENANCE_WAKE_DELAY_MS : intervalMs');
  expect(source).toContain("window.addEventListener('unload', clearPageFeedWorkTimer");
  expect(read('src/background.js')).not.toContain('runPageActiveFeedWork');
});

test('feed-page scheduler derives initialization priority from local watch records only', () => {
  const source = read('src/feed.js');
  expect(source).toContain('function initializationHistoryPriority()');
  expect(source).toContain('Object.values(watchedMap || {})');
  expect(source).toContain('recentHistoryChannelIds');
  expect(source).toContain('historyChannelIds');
  expect(source).toContain('...initializationHistoryPriority()');
});

test('settings refreshes stale initialization progress and dormant work has a visible shared status', () => {
  const feed = read('src/feed.js');
  const settings = read('src/feed-settings.js');
  expect(feed).toContain("tFeed('feed_checking_low_activity', 'Checking a low-activity channel')");
  expect(settings).toContain('refreshFeedSettingsInitializationProgress();');
  expect(settings).toContain('scheduler.getInitializationProgress()');
  expect(settings).toContain("'feed_initialization_progress'");
});
