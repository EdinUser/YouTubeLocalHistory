const { DEFAULTS, cleanupFeedData } = require('../../src/feed-retention.js');

function createStorage() {
  const videos = new Map([
    ['new', { videoId: 'new', publishedAt: 990 }],
    ['old', { videoId: 'old', publishedAt: 100 }],
    ['overflow', { videoId: 'overflow', publishedAt: 980 }],
  ]);
  const impressions = new Map([
    ['new', { videoId: 'new', lastShownOnHomeAt: 990 }],
    ['old', { videoId: 'old', lastShownOnHomeAt: 990 }],
    ['stale', { videoId: 'stale', lastShownOnHomeAt: 100 }],
  ]);
  const runs = new Map([
    ['latest', { runId: 'latest', completedAt: 990 }],
    ['old-run', { runId: 'old-run', completedAt: 100 }],
  ]);
  return {
    videos, impressions, runs,
    listSubscriptionFeedVideosByPublishedAt: jest.fn(async () => [...videos.values()].sort((a, b) => b.publishedAt - a.publishedAt)),
    deleteSubscriptionFeedVideo: jest.fn(async (id) => videos.delete(id)),
    listHomeImpressionsByLastShown: jest.fn(async () => [...impressions.values()].sort((a, b) => a.lastShownOnHomeAt - b.lastShownOnHomeAt)),
    deleteHomeImpression: jest.fn(async (id) => impressions.delete(id)),
    listFeedSyncRunsByCompletedAt: jest.fn(async () => [...runs.values()].sort((a, b) => b.completedAt - a.completedAt)),
    deleteFeedSyncRun: jest.fn(async (id) => runs.delete(id)),
  };
}

test('retains only bounded recent feed state and never receives durable-history repositories', async () => {
  const storage = createStorage();

  await expect(cleanupFeedData(storage, {
    now: 1000,
    maxFeedVideos: 1,
    maxFeedVideoAgeMs: 500,
    maxHomeImpressions: 10,
    maxHomeImpressionAgeMs: 500,
    maxDiagnostics: 10,
    maxDiagnosticAgeMs: 500,
  })).resolves.toEqual({
    retainedFeedVideos: 1,
    deletedFeedVideos: 2,
    deletedHomeImpressions: 2,
    deletedDiagnostics: 1,
  });

  expect([...storage.videos.keys()]).toEqual(['new']);
  expect([...storage.impressions.keys()]).toEqual(['new']);
  expect([...storage.runs.keys()]).toEqual(['latest']);
  expect(storage).not.toHaveProperty('deleteVideo');
  expect(storage).not.toHaveProperty('deletePlaylist');
  expect(storage).not.toHaveProperty('deleteChannelSyncState');
});

test('does not require optional observability repositories to prune feed videos', async () => {
  const storage = createStorage();
  delete storage.listHomeImpressionsByLastShown;
  delete storage.deleteHomeImpression;
  delete storage.listFeedSyncRunsByCompletedAt;
  delete storage.deleteFeedSyncRun;

  await cleanupFeedData(storage, { now: 1000, maxFeedVideos: 1, maxFeedVideoAgeMs: 500 });
  expect([...storage.videos.keys()]).toEqual(['new']);
});

test('uses documented defaults and applies count and age limits cumulatively (whichever is reached first)', async () => {
  expect(DEFAULTS).toEqual(expect.objectContaining({
    maxFeedVideos: 7500,
    maxFeedVideoAgeMs: 270 * 24 * 60 * 60 * 1000,
  }));

  const storage = createStorage();
  await cleanupFeedData(storage, {
    now: 1000,
    maxFeedVideos: 2,
    maxFeedVideoAgeMs: 15,
    maxHomeImpressions: 10,
    maxHomeImpressionAgeMs: 500,
    maxDiagnostics: 10,
    maxDiagnosticAgeMs: 500,
  });

  // `overflow` is within the count limit but too old; `old` fails both.
  expect([...storage.videos.keys()]).toEqual(['new']);
});
