const viewData = require('../../src/feed-view-data.js');

test('adapts canonical feed records for the existing source-agnostic card and ranker boundary', async () => {
  const storage = {
    listSubscriptionFeedVideosByPublishedAt: jest.fn(async () => [{
      videoId: 'video-1', channelId: 'UC123', title: 'Upload', channelTitle: 'Channel',
      thumbnailUrl: 'https://example.test/thumb.jpg', publishedAt: 100, durationSeconds: null, isShort: null,
    }]),
    listSubscriptionRecords: jest.fn(async () => [{ channelId: 'UC123', channelTitle: 'Channel', source: 'manual' }]),
  };

  await expect(viewData.loadCanonicalFeedViewData(storage)).resolves.toEqual({
    videos: [expect.objectContaining({ videoId: 'video-1', published: 100, duration: 0, isShort: null, channelName: 'Channel' })],
    subscriptions: [expect.objectContaining({ id: 'UC123', ucid: 'UC123', channelName: 'Channel' })],
  });
});

test('records bounded persistent Home impressions separately from feed inventory', async () => {
  const values = new Map([['a', { videoId: 'a', lastShownOnHomeAt: 5, homeImpressionCount: 2, consecutiveHomeAppearances: 1 }]]);
  const storage = {
    getHomeImpression: jest.fn(async (videoId) => values.get(videoId) || null),
    putHomeImpression: jest.fn(async (record) => values.set(record.videoId, record)),
  };

  await viewData.persistHomeImpressions(storage, [{ videoId: 'a' }, { videoId: 'b' }], 10, 1);
  expect(values.get('a')).toEqual(expect.objectContaining({ lastShownOnHomeAt: 10, homeImpressionCount: 3, consecutiveHomeAppearances: 2 }));
  expect(values.has('b')).toBe(false);
});

test('projects only active, non-tombstoned subscription feed records', async () => {
  const storage = {
    listSubscriptionFeedVideosByPublishedAt: jest.fn(async () => [
      { videoId: 'active', channelId: 'UCactive', publishedAt: 30 },
      { videoId: 'tombstoned', channelId: 'UCtombstoned', publishedAt: 20 },
      { videoId: 'orphaned', channelId: 'UCorphaned', publishedAt: 10 },
    ]),
    listSubscriptionRecords: jest.fn(async () => [
      { channelId: 'UCactive', source: 'manual' },
      { channelId: 'UCtombstoned', source: 'manual' },
    ]),
    listLocalUnsubscribeTombstones: jest.fn(async () => [
      { channelId: 'UCtombstoned', unsubscribedAt: 100 },
    ]),
  };

  const data = await viewData.loadCanonicalFeedViewData(storage);

  expect(data.videos.map((video) => video.videoId)).toEqual(['active']);
  expect(data.subscriptions.map((subscription) => subscription.channelId)).toEqual(['UCactive']);
});

test('projects a repository page while preserving its raw keyset cursor', async () => {
  const storage = {
    listSubscriptionFeedVideosPageByPublishedAt: jest.fn(async () => ({
      records: [
        { videoId: 'active', channelId: 'UCactive', publishedAt: 30 },
        { videoId: 'orphaned', channelId: 'UCorphaned', publishedAt: 20 },
      ],
      nextCursor: { publishedAt: 20, videoId: 'orphaned' },
      exhausted: false,
    })),
    listSubscriptionRecords: jest.fn(async () => [
      { channelId: 'UCactive', channelTitle: 'Active channel', source: 'manual' },
    ]),
    listLocalUnsubscribeTombstones: jest.fn(async () => []),
  };

  await expect(viewData.loadCanonicalSubscriptionFeedPage(storage, {
    limit: 50,
    cursor: { publishedAt: 40, videoId: 'prior' },
  })).resolves.toEqual({
    videos: [expect.objectContaining({ videoId: 'active', channelName: 'Active channel' })],
    subscriptions: [expect.objectContaining({ channelId: 'UCactive' })],
    nextCursor: { publishedAt: 20, videoId: 'orphaned' },
    exhausted: false,
  });
  expect(storage.listSubscriptionFeedVideosPageByPublishedAt).toHaveBeenCalledWith({
    limit: 50,
    cursor: { publishedAt: 40, videoId: 'prior' },
  });
});
