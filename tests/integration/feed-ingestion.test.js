const contracts = require('../../src/feed-contracts.js');
const { ingestRssScan } = require('../../src/feed-ingestion.js');
const { CHANNEL_ID, RSS_ENTRY } = require('../fixtures/feed/contracts.js');

function createFeedStorage() {
  const videos = new Map();
  const states = new Map();
  return {
    getSubscriptionFeedVideo: jest.fn(async (id) => videos.get(id) || null),
    putSubscriptionFeedVideo: jest.fn(async (record) => videos.set(record.videoId, { ...record })),
    getChannelSyncState: jest.fn(async (id) => states.get(id) || null),
    putChannelSyncState: jest.fn(async (record) => states.set(record.channelId, { ...record })),
    video: (id) => videos.get(id),
    state: (id) => states.get(id)
  };
}

describe('feed ingestion boundary', () => {
  test('writes canonical videos before publishing progress and preserves enrichment on merge', async () => {
    const storage = createFeedStorage();
    const progress = jest.fn(() => expect(storage.video('video-001')).toBeTruthy());
    const scan = contracts.createRssScanResult({ channelId: CHANNEL_ID, entries: [RSS_ENTRY], fetchedAt: 100 });

    await expect(ingestRssScan(scan, { storage, now: 120, onProgress: progress })).resolves.toEqual({
      channelId: CHANNEL_ID, outcome: 'updated', insertedVideoCount: 1, completedAt: 120
    });
    expect(storage.video('video-001')).toEqual(expect.objectContaining({ discoveredAt: 120, lastSeenInFeedAt: 120, durationSeconds: null, isShort: null }));
    expect(storage.state(CHANNEL_ID)).toEqual(expect.objectContaining({ lastSuccessfulCheckAt: 120, failureCount: 0 }));

    storage.video('video-001').durationSeconds = 42;
    storage.video('video-001').isShort = false;
    await ingestRssScan(scan, { storage, now: 130 });
    expect(storage.video('video-001')).toEqual(expect.objectContaining({ discoveredAt: 120, lastSeenInFeedAt: 130, durationSeconds: 42, isShort: false }));
  });

  test('records failed and timed-out scans in sync state without writing feed inventory', async () => {
    const storage = createFeedStorage();
    const failed = contracts.createRssScanResult({ channelId: CHANNEL_ID, fetchedAt: 100, error: { code: 'network', message: 'offline' } });
    const timedOut = contracts.createRssScanResult({ channelId: CHANNEL_ID, fetchedAt: 101, error: { code: 'timeout', message: 'slow' } });

    await expect(ingestRssScan(failed, { storage, now: 120 })).resolves.toEqual(expect.objectContaining({ outcome: 'failed', insertedVideoCount: 0 }));
    await expect(ingestRssScan(timedOut, { storage, now: 130 })).resolves.toEqual(expect.objectContaining({ outcome: 'timed_out', insertedVideoCount: 0 }));
    expect(storage.putSubscriptionFeedVideo).not.toHaveBeenCalled();
    expect(storage.state(CHANNEL_ID)).toEqual(expect.objectContaining({ lastAttemptAt: 130, failureCount: 2 }));
  });
});
