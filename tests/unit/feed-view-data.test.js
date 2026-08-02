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
