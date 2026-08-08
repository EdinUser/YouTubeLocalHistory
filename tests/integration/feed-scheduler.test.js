const contracts = require('../../src/feed-contracts.js');
const { ingestRssScan } = require('../../src/feed-ingestion.js');
const { FeedScheduler } = require('../../src/feed-scheduler.js');

const CHANNEL_A = 'UC1234567890abcdefghijkl';
const CHANNEL_B = 'UC9876543210abcdefghijkl';
const HISTORY_ONLY = 'UC1111111111abcdefghijkl';

function createStorage(subscriptions = []) {
  const states = new Map();
  const videos = new Map();
  const syncRuns = new Map();
  const impressions = new Map();
  const durableHistory = new Map([['history-1', { videoId: 'history-1', position: 42 }]]);
  const durablePlaylists = new Map([['playlist-1', { playlistId: 'playlist-1', title: 'Keep me' }]]);
  return {
    listSubscriptionRecords: jest.fn(async () => subscriptions),
    getChannelSyncState: jest.fn(async (channelId) => states.get(channelId) || null),
    listChannelSyncStates: jest.fn(async () => [...states.values()]),
    putChannelSyncState: jest.fn(async (state) => states.set(state.channelId, { ...state })),
    getEligibleChannelSyncStates: jest.fn(async (at, limit = 0) => [...states.values()]
      .filter((state) => Number(state.nextEligibleCheckAt || 0) <= at)
      .sort((a, b) => Number(a.nextEligibleCheckAt || 0) - Number(b.nextEligibleCheckAt || 0))
      .slice(0, limit || undefined)),
    claimChannelSyncState: jest.fn(async (channelId, { runId, now, leaseMs }) => {
      const state = states.get(channelId);
      if (!state || Number(state.scanLeaseUntil || 0) > now) return { claimed: false, state: state || null };
      const claimed = { ...state, scanRunId: runId, scanLeaseUntil: now + leaseMs };
      states.set(channelId, claimed);
      return { claimed: true, state: claimed };
    }),
    releaseChannelSyncState: jest.fn(async (channelId, runId, partial) => {
      const state = states.get(channelId);
      if (!state || state.scanRunId !== runId) return false;
      states.set(channelId, { ...state, ...partial, scanLeaseUntil: null, scanRunId: null });
      return true;
    }),
    getSubscriptionFeedVideo: jest.fn(async (videoId) => videos.get(videoId) || null),
    putSubscriptionFeedVideo: jest.fn(async (video) => videos.set(video.videoId, { ...video })),
    deleteSubscriptionFeedVideo: jest.fn(async (videoId) => videos.delete(videoId)),
    listSubscriptionFeedVideosByPublishedAt: jest.fn(async () => [...videos.values()]
      .sort((a, b) => Number(b.publishedAt || 0) - Number(a.publishedAt || 0))),
    getHomeImpression: jest.fn(async (videoId) => impressions.get(videoId) || null),
    putHomeImpression: jest.fn(async (impression) => impressions.set(impression.videoId, { ...impression })),
    deleteHomeImpression: jest.fn(async (videoId) => impressions.delete(videoId)),
    listHomeImpressionsByLastShown: jest.fn(async () => [...impressions.values()]
      .sort((a, b) => Number(b.lastShownOnHomeAt || 0) - Number(a.lastShownOnHomeAt || 0))),
    putFeedSyncRun: jest.fn(async (run) => syncRuns.set(run.runId, { ...run })),
    deleteFeedSyncRun: jest.fn(async (runId) => syncRuns.delete(runId)),
    listFeedSyncRunsByCompletedAt: jest.fn(async () => [...syncRuns.values()]
      .sort((a, b) => Number(b.completedAt || 0) - Number(a.completedAt || 0))),
    state: (channelId) => states.get(channelId),
    syncRun: (runId) => syncRuns.get(runId),
    feedVideos: videos,
    homeImpressions: impressions,
    feedSyncRuns: syncRuns,
    durableHistory,
    durablePlaylists,
  };
}

function successfulScan(channelId, fetchedAt = 100) {
  return contracts.createRssScanResult({
    channelId,
    fetchedAt,
    entries: [{ videoId: `video-${channelId}`, title: 'Upload', publishedAt: 90 }],
  });
}

describe('shared feed scheduler', () => {
  test('recovers expired leases and creates initialization state only for explicit subscriptions', async () => {
    const storage = createStorage([
      { channelId: CHANNEL_A, source: 'manual' },
      { channelId: CHANNEL_B, source: 'takeout_csv' },
      { channelId: HISTORY_ONLY, source: 'history_inferred' },
    ]);
    await storage.putChannelSyncState({ channelId: CHANNEL_A, scanLeaseUntil: 90, scanRunId: 'dead-run' });
    const scheduler = new FeedScheduler({ storage, clock: () => 100 });

    await expect(scheduler.start()).resolves.toEqual({ recoveredLeaseCount: 1, initializedChannelCount: 1 });
    expect(storage.state(CHANNEL_A)).toEqual(expect.objectContaining({ scanLeaseUntil: null, scanRunId: null }));
    expect(storage.state(CHANNEL_B)).toEqual(expect.objectContaining({ initializationState: 'pending', nextEligibleCheckAt: 100 }));
    expect(storage.state(HISTORY_ONLY)).toBeUndefined();
  });

  test('runs a bounded, resumable initialization batch and publishes compact progress', async () => {
    const storage = createStorage([
      { channelId: CHANNEL_A, source: 'manual' },
      { channelId: CHANNEL_B, source: 'takeout_csv' },
    ]);
    let now = 100;
    const fetchChannelRss = jest.fn(async (channelId) => successfulScan(channelId, now));
    const scheduler = new FeedScheduler({
      storage, clock: () => now, fetchChannelRss, ingestRssScan,
      successfulCheckIntervalMs: 1000,
    });
    const snapshots = [];
    scheduler.subscribe((snapshot) => snapshots.push(snapshot));

    await scheduler.initializeSubscriptions();
    await expect(scheduler.getInitializationProgress()).resolves.toEqual({ completed: 0, total: 2, pending: 2 });
    await expect(scheduler.runInitialization({ limit: 1, concurrency: 1, runId: 'initial-1' })).resolves.toEqual({
      runId: 'initial-1', completed: 1, total: 1, insertedVideoCount: 1, active: false,
    });
    expect(fetchChannelRss).toHaveBeenCalledTimes(1);
    await expect(scheduler.getInitializationProgress()).resolves.toEqual({ completed: 1, total: 2, pending: 1 });
    expect(snapshots).toEqual([
      { runId: 'initial-1', completed: 0, total: 1, insertedVideoCount: 0, active: true },
      { runId: 'initial-1', completed: 1, total: 1, insertedVideoCount: 1, active: false },
    ]);

    now = 101;
    await scheduler.runInitialization({ limit: 2, concurrency: 1, runId: 'initial-2' });
    expect(fetchChannelRss).toHaveBeenCalledTimes(2);
    expect(storage.state(CHANNEL_A).initializationState).toBe('complete');
    expect(storage.state(CHANNEL_B).initializationState).toBe('complete');
    expect(storage.syncRun('initial-2')).toEqual(expect.objectContaining({
      kind: 'initialization', total: 1, completed: 1, insertedVideoCount: 1,
      outcomes: expect.objectContaining({ updated: 1 })
    }));
  });

  test('selects pending initialization before applying its finite batch limit', async () => {
    const storage = createStorage([
      { channelId: CHANNEL_A, source: 'manual' },
      { channelId: CHANNEL_B, source: 'takeout_csv' },
    ]);
    await storage.putChannelSyncState({ channelId: CHANNEL_A, initializationState: 'complete', lastSuccessfulCheckAt: 1, nextEligibleCheckAt: 0 });
    await storage.putChannelSyncState({ channelId: CHANNEL_B, initializationState: 'pending', nextEligibleCheckAt: 0 });
    const fetchChannelRss = jest.fn(async (channelId) => successfulScan(channelId));
    const scheduler = new FeedScheduler({ storage, clock: () => 100, fetchChannelRss, ingestRssScan });

    await scheduler.runInitialization({ limit: 1, runId: 'initial-priority' });
    expect(fetchChannelRss).toHaveBeenCalledWith(CHANNEL_B, expect.any(Object));
  });

  test('initializes recent local-history channels before older-history and never-seen subscriptions', async () => {
    const channelC = 'UC2222222222abcdefghijkl';
    const storage = createStorage([
      { channelId: CHANNEL_A, source: 'manual' },
      { channelId: CHANNEL_B, source: 'takeout_csv' },
      { channelId: channelC, source: 'manual' },
    ]);
    const fetchChannelRss = jest.fn(async (channelId) => successfulScan(channelId));
    const scheduler = new FeedScheduler({
      storage, clock: () => 100, fetchChannelRss, ingestRssScan,
      recentHistoryChannelIds: [CHANNEL_B],
      historyChannelIds: [CHANNEL_A, CHANNEL_B],
    });

    await scheduler.initializeSubscriptions();
    await scheduler.runInitialization({ limit: 3, concurrency: 1, runId: 'history-priority' });
    expect(fetchChannelRss.mock.calls.map(([channelId]) => channelId)).toEqual([CHANNEL_B, CHANNEL_A, channelC]);
  });

  test('maps each scheduler activity class to its bounded current-time eligibility interval', () => {
    const scheduler = new FeedScheduler({ storage: createStorage(), successfulCheckIntervalMs: 1 });
    expect(Object.fromEntries(Object.keys(scheduler.activityIntervalsMs).map((activityClass) =>
      [activityClass, scheduler.activityIntervalMs(activityClass)]
    ))).toEqual(scheduler.activityIntervalsMs);
  });

  test('pause and cancel stop new initialization claims while preserving durable pending state for resume', async () => {
    const storage = createStorage([
      { channelId: CHANNEL_A, source: 'manual' },
      { channelId: CHANNEL_B, source: 'takeout_csv' },
    ]);
    const scheduler = new FeedScheduler({
      storage, clock: () => 100, ingestRssScan,
      fetchChannelRss: jest.fn(async (channelId) => successfulScan(channelId)),
    });
    await scheduler.initializeSubscriptions();

    scheduler.pause();
    await expect(scheduler.runInitialization({ limit: 2, concurrency: 1, runId: 'paused' }))
      .resolves.toEqual(expect.objectContaining({ completed: 0, total: 2, active: false }));
    expect(scheduler.fetchChannelRss).not.toHaveBeenCalled();
    expect(storage.state(CHANNEL_A).initializationState).toBe('pending');

    scheduler.resume();
    scheduler.fetchChannelRss.mockImplementationOnce(async (channelId) => {
      scheduler.cancel('cancelled');
      return successfulScan(channelId);
    });
    await expect(scheduler.runInitialization({ limit: 2, concurrency: 1, runId: 'cancelled' }))
      .resolves.toEqual(expect.objectContaining({ completed: 1, total: 2, active: false }));
    expect(storage.state(CHANNEL_A).initializationState).toBe('complete');
    expect(storage.state(CHANNEL_B).initializationState).toBe('pending');

    await scheduler.runInitialization({ limit: 2, concurrency: 1, runId: 'resumed' });
    expect(storage.state(CHANNEL_B).initializationState).toBe('complete');
  });

  test('uses leases across runners and recalculates failure eligibility from the current result time', async () => {
    const storage = createStorage([{ channelId: CHANNEL_A, source: 'manual' }]);
    await storage.putChannelSyncState({ channelId: CHANNEL_A, initializationState: 'pending', nextEligibleCheckAt: 0, failureCount: 0 });
    let now = 500;
    const failedScan = contracts.createRssScanResult({
      channelId: CHANNEL_A, fetchedAt: now, error: { code: 'network', message: 'offline' },
    });
    const fetchChannelRss = jest.fn(async () => failedScan);
    const one = new FeedScheduler({ storage, clock: () => now, fetchChannelRss, ingestRssScan, retryBaseMs: 100, retryMaxMs: 100 });
    const two = new FeedScheduler({ storage, clock: () => now, fetchChannelRss, ingestRssScan, retryBaseMs: 100, retryMaxMs: 100 });

    await Promise.all([one.runForeground({ runId: 'one' }), two.runForeground({ runId: 'two' })]);
    expect(fetchChannelRss).toHaveBeenCalledTimes(1);
    expect(storage.state(CHANNEL_A)).toEqual(expect.objectContaining({
      failureCount: 1, retryAfter: 600, nextEligibleCheckAt: 600, scanLeaseUntil: null, scanRunId: null,
    }));
  });

  test('marks an unavailable RSS channel complete and defers another 404 for a long interval', async () => {
    const storage = createStorage([{ channelId: CHANNEL_A, source: 'manual' }]);
    await storage.putChannelSyncState({ channelId: CHANNEL_A, initializationState: 'pending', nextEligibleCheckAt: 0 });
    const now = 500;
    const fetchChannelRss = jest.fn(async () => contracts.createRssScanResult({
      channelId: CHANNEL_A,
      fetchedAt: now,
      error: { code: 'http', status: 404, message: 'RSS feed unavailable' }
    }));
    const scheduler = new FeedScheduler({
      storage, clock: () => now, fetchChannelRss, ingestRssScan, unavailableChannelRetryMs: 1000
    });

    await scheduler.runInitialization({ runId: 'unavailable' });

    expect(storage.state(CHANNEL_A)).toEqual(expect.objectContaining({
      initializationState: 'complete', unavailableStatus: 404, unavailableAt: now,
      retryAfter: null, nextEligibleCheckAt: 1500, scanLeaseUntil: null
    }));
  });

  test('uses learned activity to schedule a very active channel more often than a regular feed check', async () => {
    const storage = createStorage([{ channelId: CHANNEL_A, source: 'manual' }]);
    const day = 24 * 60 * 60 * 1000;
    const now = 1000 * day;
    await storage.putChannelSyncState({ channelId: CHANNEL_A, initializationState: 'pending', nextEligibleCheckAt: 0 });
    const fetchChannelRss = jest.fn(async () => contracts.createRssScanResult({
      channelId: CHANNEL_A,
      fetchedAt: now,
      entries: Array.from({ length: 10 }, (_, index) => ({
        videoId: `active-${index}`, title: 'Upload', publishedAt: now - index * 13 * 60 * 60 * 1000
      }))
    }));
    const scheduler = new FeedScheduler({
      storage, clock: () => now, fetchChannelRss, ingestRssScan,
      successfulCheckIntervalMs: 5 * 60 * 1000
    });

    await scheduler.runInitialization({ runId: 'active-classification' });

    expect(storage.state(CHANNEL_A)).toEqual(expect.objectContaining({
      activityClass: 'very_active', uploads7d: 10,
      nextEligibleCheckAt: now + 60 * 60 * 1000
    }));
  });

  test('runs one fair dormant-maintenance scan only while the page is active and foreground work is empty', async () => {
    const storage = createStorage([
      { channelId: CHANNEL_A, source: 'manual', followedAt: 0 },
      { channelId: CHANNEL_B, source: 'manual', followedAt: 990 },
    ]);
    await storage.putChannelSyncState({ channelId: CHANNEL_A, activityClass: 'dormant', lastSuccessfulCheckAt: 0, nextEligibleCheckAt: 0 });
    await storage.putChannelSyncState({ channelId: CHANNEL_B, activityClass: 'rare', lastSuccessfulCheckAt: 900, nextEligibleCheckAt: 0 });
    const fetchChannelRss = jest.fn(async (channelId) => successfulScan(channelId, 1000));
    const scheduler = new FeedScheduler({ storage, clock: () => 1000, fetchChannelRss, ingestRssScan, newSubscriptionBonusMs: 50 });

    await expect(scheduler.runDormantMaintenance({ pageActive: false })).resolves.toEqual({ ran: false, reason: 'page_inactive', terminal: null });
    await expect(scheduler.runDormantMaintenance({ pageActive: true, runId: 'dormant-1' })).resolves.toEqual(expect.objectContaining({
      ran: true,
      terminal: expect.objectContaining({ channelId: CHANNEL_A, outcome: 'updated' }),
    }));
    expect(fetchChannelRss).toHaveBeenCalledTimes(1);
    expect(storage.state(CHANNEL_A)).toEqual(expect.objectContaining({
      activityClass: 'reactivated', dormantMaintenanceAt: 1000, scanLeaseUntil: null,
    }));
  });

  test('does not run dormant maintenance while any higher-priority channel is due', async () => {
    const storage = createStorage([{ channelId: CHANNEL_A, source: 'manual' }, { channelId: CHANNEL_B, source: 'manual' }]);
    await storage.putChannelSyncState({ channelId: CHANNEL_A, activityClass: 'dormant', nextEligibleCheckAt: 0 });
    await storage.putChannelSyncState({ channelId: CHANNEL_B, activityClass: 'regular', nextEligibleCheckAt: 0 });
    const fetchChannelRss = jest.fn();
    const scheduler = new FeedScheduler({ storage, clock: () => 1000, fetchChannelRss, ingestRssScan });

    await expect(scheduler.runDormantMaintenance({ pageActive: true })).resolves.toEqual({ ran: false, reason: 'foreground_due', terminal: null });
    expect(fetchChannelRss).not.toHaveBeenCalled();
  });

  test('keeps due dormant and rare channels out of foreground work so page-active idle maintenance owns them', async () => {
    const storage = createStorage([{ channelId: CHANNEL_A, source: 'manual' }]);
    await storage.putChannelSyncState({ channelId: CHANNEL_A, activityClass: 'dormant', nextEligibleCheckAt: 0 });
    const fetchChannelRss = jest.fn(async (channelId) => successfulScan(channelId, 1000));
    const scheduler = new FeedScheduler({ storage, clock: () => 1000, fetchChannelRss, ingestRssScan });

    await expect(scheduler.runForeground()).resolves.toEqual(expect.objectContaining({ total: 0, completed: 0 }));
    expect(fetchChannelRss).not.toHaveBeenCalled();
    await expect(scheduler.runDormantMaintenance({ pageActive: true, runId: 'idle-owner' })).resolves.toEqual(expect.objectContaining({ ran: true }));
  });

  test('runs retention after ingestion across a thousands-record feed without touching durable data', async () => {
    const storage = createStorage([{ channelId: CHANNEL_A, source: 'manual' }]);
    const now = 2_000_000_000_000;
    for (let index = 0; index < 7501; index += 1) {
      storage.feedVideos.set(`seed-${index}`, {
        videoId: `seed-${index}`, channelId: CHANNEL_A, publishedAt: now - index * 1000
      });
    }
    storage.homeImpressions.set('seed-0', { videoId: 'seed-0', lastShownOnHomeAt: now });
    storage.homeImpressions.set('seed-7500', { videoId: 'seed-7500', lastShownOnHomeAt: now });
    storage.homeImpressions.set('orphan', { videoId: 'orphan', lastShownOnHomeAt: now });
    for (let index = 0; index < 100; index += 1) {
      storage.feedSyncRuns.set(`prior-${index}`, { runId: `prior-${index}`, completedAt: now - index });
    }
    await storage.putChannelSyncState({ channelId: CHANNEL_A, initializationState: 'complete', nextEligibleCheckAt: 0 });
    const historyBefore = JSON.stringify([...storage.durableHistory]);
    const playlistsBefore = JSON.stringify([...storage.durablePlaylists]);
    const scheduler = new FeedScheduler({
      storage,
      clock: () => now,
      fetchChannelRss: async () => contracts.createRssScanResult({
        channelId: CHANNEL_A,
        fetchedAt: now,
        entries: [{ videoId: 'newly-ingested', title: 'New upload', publishedAt: now + 1 }]
      }),
      ingestRssScan
    });

    await scheduler.runForeground({ limit: 1, concurrency: 1, runId: 'retention-run' });

    expect(storage.feedVideos.size).toBe(7500);
    expect(storage.feedVideos.has('newly-ingested')).toBe(true);
    expect(storage.feedVideos.has('seed-7499')).toBe(false);
    expect(storage.feedVideos.has('seed-7500')).toBe(false);
    expect([...storage.homeImpressions.keys()].sort()).toEqual(['seed-0']);
    expect(storage.feedSyncRuns.size).toBe(100);
    expect(storage.feedSyncRuns.has('prior-99')).toBe(false);
    expect(JSON.stringify([...storage.durableHistory])).toBe(historyBefore);
    expect(JSON.stringify([...storage.durablePlaylists])).toBe(playlistsBefore);
  });
});
