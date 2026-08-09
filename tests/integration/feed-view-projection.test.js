const contracts = require('../../src/feed-contracts.js');
const { ingestRssScan } = require('../../src/feed-ingestion.js');
const { loadCanonicalFeedViewData } = require('../../src/feed-view-data.js');

const CHANNEL = 'UC1234567890abcdefghijkl';

function createStorage() {
  const videos = new Map();
  const states = new Map();
  return {
    getSubscriptionFeedVideo: async (id) => videos.get(id) || null,
    putSubscriptionFeedVideo: async (record) => videos.set(record.videoId, { ...record }),
    getChannelSyncState: async (id) => states.get(id) || null,
    putChannelSyncState: async (record) => states.set(record.channelId, { ...record }),
    listSubscriptionFeedVideosByPublishedAt: async () => [...videos.values()].sort((a, b) => b.publishedAt - a.publishedAt),
    listSubscriptionRecords: async () => [{ channelId: CHANNEL, channelTitle: 'Fixture channel', source: 'manual' }],
  };
}

test('one ingested RSS inventory projects chronologically into the canonical view model with unknown metadata renderable', async () => {
  const storage = createStorage();
  const scan = contracts.createRssScanResult({
    channelId: CHANNEL,
    fetchedAt: 100,
    entries: [
      { videoId: 'older', title: 'Older', publishedAt: 10 },
      { videoId: 'newer', title: 'Newer', publishedAt: 20 },
    ],
  });
  await ingestRssScan(scan, { storage, now: 100 });

  const data = await loadCanonicalFeedViewData(storage);
  expect(data.videos.map((video) => video.videoId)).toEqual(['newer', 'older']);
  expect(data.videos[0]).toEqual(expect.objectContaining({
    channelName: 'Fixture channel', duration: 0, isShort: null, url: expect.stringContaining('newer'),
  }));
});
