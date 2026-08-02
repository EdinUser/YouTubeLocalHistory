const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

test('the feed page does not load the aggregate cache pipeline or remote YouTube search modules', () => {
  const html = read('src/feed.html');
  expect(html).not.toContain('feed-data-pipeline.js');
  expect(html).not.toContain('feed-youtube-search-core.js');
  expect(html).not.toContain('feed-youtube-search-render.js');
  expect(html).toContain('feed-scheduler.js');
});

test('the page-overlay subscription control has no feed inventory, RSS, or network ownership', () => {
  const source = read('src/content-subscriptions.js');
  expect(source).not.toContain('feedCache');
  expect(source).not.toContain('videos.xml');
  expect(source).not.toContain('fetch(');
  expect(source).toContain('putSubscriptionRecord');
  expect(source).toContain('putChannelSyncState');
});

test('extension content-script manifests no longer load the old feed-core worker dependency', () => {
  ['src/manifest.chrome.json', 'src/manifest.firefox.json'].forEach((manifestPath) => {
    const manifest = JSON.parse(read(manifestPath));
    const scripts = manifest.content_scripts[0].js;
    expect(scripts).toContain('indexeddb-storage.js');
    expect(scripts).toContain('content-subscriptions.js');
    expect(scripts).not.toContain('feed-core.js');
  });
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
  expect(feed).toContain("setPageActiveSyncStatus('Checking a low-activity channel', true);");
  expect(settings).toContain('refreshFeedSettingsInitializationProgress();');
  expect(settings).toContain('scheduler.getInitializationProgress()');
  expect(settings).toContain("/^Preparing local feed/.test(message.textContent || '')");
});
