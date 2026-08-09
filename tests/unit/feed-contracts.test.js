const contracts = require('../../src/feed-contracts.js');
const { FIXED_NOW, CHANNEL_ID, RSS_ENTRY } = require('../fixtures/feed/contracts.js');

describe('feed contracts', () => {
  test('shares the paging and analytics boundary semantics', () => {
    expect(contracts.FEED_PAGE_SIZE).toBe(50);
    expect(contracts.WATCH_SKIP_RATIO).toBe(0.1);
    expect(contracts.WATCH_COMPLETION_RATIO).toBe(0.9);
    expect(contracts.LONG_VIDEO_MIN_DURATION_SECONDS).toBe(600);
  });

  test('tracks pending discoveries by stable video identity instead of a count', () => {
    expect(contracts.createPendingFeedDiscovery({
      videoIds: ['video-b', ' video-a ', 'video-b', ''],
      discoveredAt: FIXED_NOW
    })).toEqual({
      videoIds: ['video-b', 'video-a'],
      discoveredAt: FIXED_NOW
    });
  });

  test('defines a durable canonical local-unsubscribe tombstone', () => {
    expect(contracts.LOCAL_UNSUBSCRIBE_TOMBSTONE_STORE).toBe('local_unsubscribe_tombstones');
    expect(contracts.createLocalUnsubscribeTombstone({
      channelId: CHANNEL_ID,
      unsubscribedAt: FIXED_NOW,
      source: 'video_menu'
    })).toEqual({
      schemaVersion: 1,
      channelId: CHANNEL_ID,
      unsubscribedAt: FIXED_NOW,
      source: 'video_menu',
      reason: 'user_unfollow'
    });
    expect(() => contracts.createLocalUnsubscribeTombstone({
      channelId: '@not-canonical',
      unsubscribedAt: FIXED_NOW
    })).toThrow('channelId must be a canonical channel ID');
  });

  test('normalizes a successful RSS scan into canonical feed entries', () => {
    const result = contracts.createRssScanResult({
      channelId: CHANNEL_ID,
      entries: [RSS_ENTRY],
      fetchedAt: FIXED_NOW
    });

    expect(result).toEqual({
      channelId: CHANNEL_ID,
      fetchedAt: FIXED_NOW,
      error: null,
      entries: [{
        videoId: 'video-001',
        channelId: CHANNEL_ID,
        title: 'Fixture upload',
        thumbnailUrl: 'https://i.ytimg.com/vi/video-001/mqdefault.jpg',
        publishedAt: 1735603200000,
        discoveredAt: 0,
        lastSeenInFeedAt: 0,
        durationSeconds: null,
        isShort: null,
        source: 'rss'
      }]
    });
  });

  test('accepts only the agreed scan error taxonomy', () => {
    expect(contracts.createScanError({ code: 'timeout' })).toEqual({ code: 'timeout', message: 'timeout' });
    expect(() => contracts.createScanError({ code: 'consent' })).toThrow('unsupported scan error code');
  });

  test('failed scans retain the error and do not expose partial entries', () => {
    const result = contracts.createRssScanResult({
      channelId: CHANNEL_ID,
      entries: [RSS_ENTRY],
      fetchedAt: FIXED_NOW,
      error: { code: 'http', message: 'service unavailable', status: 503 }
    });

    expect(result.entries).toEqual([]);
    expect(result.error).toEqual({ code: 'http', message: 'service unavailable', status: 503 });
  });

  test('keeps foreground progress independent from Home ranking policy', () => {
    expect(contracts.createForegroundProgress({
      runId: 'foreground-1', completed: 4, total: 12,
      insertedVideoIds: ['video-1', 'video-2', 'video-1'], active: true
    })).toEqual({
      runId: 'foreground-1', completed: 4, total: 12,
      insertedVideoCount: 2, insertedVideoIds: ['video-1', 'video-2'], active: true
    });
    expect(() => contracts.createForegroundProgress({
      runId: 'foreground-1', completed: 13, total: 12, active: true
    })).toThrow('completed cannot exceed total');
  });

  test('limits terminal outcomes to the agreed taxonomy', () => {
    expect(contracts.createTerminalResult({
      channelId: CHANNEL_ID, outcome: 'unchanged', insertedVideoIds: [], completedAt: FIXED_NOW
    })).toEqual({
      channelId: CHANNEL_ID, outcome: 'unchanged', insertedVideoCount: 0,
      insertedVideoIds: [], completedAt: FIXED_NOW
    });
    expect(() => contracts.createTerminalResult({
      channelId: CHANNEL_ID, outcome: 'cancelled', completedAt: FIXED_NOW
    })).toThrow('unsupported scan outcome');
  });
});
