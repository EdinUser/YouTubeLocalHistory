function createSchemaDatabase() {
  const stores = new Map();
  const objectStoreNames = {
    contains: (name) => stores.has(name)
  };
  const database = {
    objectStoreNames,
    createObjectStore: (name, options) => {
      const indexes = new Map();
      const store = {
        keyPath: options.keyPath,
        indexNames: { contains: (indexName) => indexes.has(indexName) },
        createIndex: (indexName, keyPath, indexOptions) => {
          indexes.set(indexName, { keyPath, options: indexOptions });
        },
        _indexes: indexes
      };
      stores.set(name, store);
      return store;
    },
    close: jest.fn()
  };
  return {
    database,
    stores,
    transaction: { objectStore: (name) => stores.get(name) }
  };
}

function createRequest(result, error = null) {
  const request = {};
  queueMicrotask(() => {
    request.result = result;
    request.error = error;
    if (error) request.onerror?.();
    else request.onsuccess?.();
  });
  return request;
}

function createMemoryStore(keyName, records = new Map()) {
  return {
    get: (key) => createRequest(records.get(key) || null),
    put: (record) => {
      const key = record[keyName];
      records.set(key, { ...record });
      return createRequest(key);
    },
    delete: (key) => {
      records.delete(key);
      return createRequest(undefined);
    },
    getAll: () => createRequest(Array.from(records.values()).map((record) => ({ ...record }))),
    index: (indexName) => ({
      openCursor: (range, direction) => {
        const values = Array.from(records.values())
          .filter((record) => {
            if (!range) return true;
            if (typeof range === 'object' && range.upperBound !== undefined) {
              return Number(record[indexName] || 0) <= Number(range.upperBound);
            }
            return record[indexName] === range;
          })
          .sort((a, b) => {
            const factor = direction === 'prev' ? -1 : 1;
            const indexDifference = Number(a[indexName] || 0) - Number(b[indexName] || 0);
            if (indexDifference) return factor * indexDifference;
            return factor * String(a[keyName]).localeCompare(String(b[keyName]));
          });
        const request = {};
        let index = 0;
        const next = () => {
          queueMicrotask(() => {
            const value = values[index++];
            request.onsuccess?.({
              target: {
                result: value ? {
                  value,
                  key: value[indexName],
                  primaryKey: value[keyName],
                  delete: () => records.delete(value[keyName]),
                  continue: next
                } : null
              }
            });
          });
        };
        next();
        return request;
      }
    })
  };
}

function createRepositoryStorage(IndexedDBStorage) {
  const stores = {
    videos: createMemoryStore('videoId'),
    subscriptions: createMemoryStore('channelId'),
    subscription_feed_videos: createMemoryStore('videoId'),
    channel_sync_state: createMemoryStore('channelId'),
    local_unsubscribe_tombstones: createMemoryStore('channelId'),
    home_impressions: createMemoryStore('videoId'),
    feed_sync_runs: createMemoryStore('runId')
  };
  const storage = new IndexedDBStorage();
  storage._withStore = async (storeName, _mode, callback) => callback(stores[storeName]);
  storage._withStores = async (storeNames, _mode, callback) => callback(Object.fromEntries(storeNames.map((name) => [name, stores[name]])));
  return storage;
}

describe('v6 IndexedDB feed repositories', () => {
  const CHANNEL_ID = 'UC1234567890abcdefghijkl';

  afterEach(() => {
    jest.resetModules();
    delete global.indexedDB;
    delete global.IDBKeyRange;
    delete global.ytIndexedDBStorage;
  });

  test('creates the v6 tombstone store without changing the existing feed indexes', async () => {
    const schema = createSchemaDatabase();
    global.indexedDB = {
      open: jest.fn(() => {
        const request = {};
        queueMicrotask(() => {
          request.result = schema.database;
          request.onupgradeneeded?.({ target: { result: schema.database, transaction: schema.transaction } });
          request.onsuccess?.();
        });
        return request;
      })
    };

    const dbModule = require('../../src/indexeddb-storage.js');
    await dbModule.openDatabase();

    expect(dbModule.DB_VERSION).toBe(6);
    expect(schema.stores.get(dbModule.STORE_SUBSCRIPTIONS).keyPath).toBe('channelId');
    expect(Array.from(schema.stores.get(dbModule.STORE_SUBSCRIPTIONS)._indexes.keys()))
      .toEqual(expect.arrayContaining(['followedAt', 'source']));
    expect(Array.from(schema.stores.get(dbModule.STORE_SUBSCRIPTION_FEED_VIDEOS)._indexes.keys()))
      .toEqual(expect.arrayContaining(['publishedAt', 'channelId', 'lastSeenInFeedAt']));
    expect(Array.from(schema.stores.get(dbModule.STORE_CHANNEL_SYNC_STATE)._indexes.keys()))
      .toEqual(expect.arrayContaining(['nextEligibleCheckAt', 'lastSuccessfulCheckAt', 'retryAfter']));
    expect(Array.from(schema.stores.get(dbModule.STORE_HOME_IMPRESSIONS)._indexes.keys()))
      .toEqual(expect.arrayContaining(['lastShownOnHomeAt']));
    expect(schema.stores.get(dbModule.STORE_FEED_SYNC_RUNS).keyPath).toBe('runId');
    expect(Array.from(schema.stores.get(dbModule.STORE_FEED_SYNC_RUNS)._indexes.keys()))
      .toEqual(expect.arrayContaining(['completedAt']));
    expect(schema.stores.get(dbModule.STORE_LOCAL_UNSUBSCRIBE_TOMBSTONES).keyPath).toBe('channelId');
    expect(Array.from(schema.stores.get(dbModule.STORE_LOCAL_UNSUBSCRIBE_TOMBSTONES)._indexes.keys()))
      .toEqual(expect.arrayContaining(['unsubscribedAt', 'source']));
  });

  test('accepts only explicit canonical subscriptions and keeps them in the v5 repository', async () => {
    const { IndexedDBStorage } = require('../../src/indexeddb-storage.js');
    const storage = createRepositoryStorage(IndexedDBStorage);

    await storage.putSubscriptionRecord({
      channelId: CHANNEL_ID,
      channelTitle: 'Imported channel',
      source: 'takeout_csv',
      followedAt: 20
    });
    await storage.putSubscriptionRecord({
      channelId: 'UC9876543210abcdefghijkl',
      source: 'manual',
      followedAt: 10
    });

    await expect(storage.putSubscriptionRecord({
      channelId: CHANNEL_ID,
      source: 'history_inferred'
    })).rejects.toThrow('explicit source');
    await expect(storage.putSubscriptionRecord({
      channelId: '@not-a-canonical-id',
      source: 'manual'
    })).rejects.toThrow('canonical channelId');

    expect((await storage.listSubscriptionRecords()).map((record) => record.channelId))
      .toEqual([CHANNEL_ID, 'UC9876543210abcdefghijkl']);
  });

  test('stores feed videos independently and queries them chronologically', async () => {
    const { IndexedDBStorage } = require('../../src/indexeddb-storage.js');
    const storage = createRepositoryStorage(IndexedDBStorage);

    await storage.putSubscriptionFeedVideo({ videoId: 'old', channelId: CHANNEL_ID, publishedAt: 10 });
    await storage.putSubscriptionFeedVideo({ videoId: 'new', channelId: CHANNEL_ID, publishedAt: 20 });

    expect((await storage.listSubscriptionFeedVideosByPublishedAt()).map((record) => record.videoId))
      .toEqual(['new', 'old']);
    await expect(storage.putSubscriptionFeedVideo({ videoId: 'missing-channel' }))
      .rejects.toThrow('videoId and channelId');
  });

  test('paginates equal publication timestamps by video ID without shifting after a newer insert', async () => {
    const { IndexedDBStorage } = require('../../src/indexeddb-storage.js');
    const storage = createRepositoryStorage(IndexedDBStorage);
    const videoIds = Array.from({ length: 55 }, (_, index) => `same-${String(index).padStart(2, '0')}`);
    await Promise.all(videoIds.map((videoId) => storage.putSubscriptionFeedVideo({
      videoId,
      channelId: CHANNEL_ID,
      publishedAt: 10,
    })));

    const first = await storage.listSubscriptionFeedVideosPageByPublishedAt({ limit: 50 });
    expect(first.records).toHaveLength(50);
    expect(first.records[0].videoId).toBe('same-54');
    expect(first.records[49].videoId).toBe('same-05');
    expect(first).toEqual(expect.objectContaining({
      nextCursor: { publishedAt: 10, videoId: 'same-05' },
      exhausted: false,
    }));

    await storage.putSubscriptionFeedVideo({ videoId: 'inserted-newer', channelId: CHANNEL_ID, publishedAt: 20 });
    global.IDBKeyRange = { upperBound: (upperBound) => ({ upperBound }) };
    const second = await storage.listSubscriptionFeedVideosPageByPublishedAt({
      limit: 50,
      cursor: first.nextCursor,
    });
    expect(second.records.map((record) => record.videoId)).toEqual([
      'same-04', 'same-03', 'same-02', 'same-01', 'same-00',
    ]);
    expect(second.exhausted).toBe(true);
    expect(new Set(first.records.concat(second.records).map((record) => record.videoId)).size).toBe(55);
  });

  test('claims and releases a sync-state lease without a scheduler runtime', async () => {
    const { IndexedDBStorage } = require('../../src/indexeddb-storage.js');
    const storage = createRepositoryStorage(IndexedDBStorage);
    await storage.putChannelSyncState({ channelId: CHANNEL_ID, scanLeaseUntil: 0 });

    const claim = await storage.claimChannelSyncState(CHANNEL_ID, {
      runId: 'run-1', now: 100, leaseMs: 30
    });
    expect(claim).toEqual({
      claimed: true,
      state: expect.objectContaining({ channelId: CHANNEL_ID, scanRunId: 'run-1', scanLeaseUntil: 130 })
    });
    expect((await storage.claimChannelSyncState(CHANNEL_ID, {
      runId: 'run-2', now: 110, leaseMs: 30
    })).claimed).toBe(false);
    await expect(storage.releaseChannelSyncState(CHANNEL_ID, 'run-2')).resolves.toBe(false);
    await expect(storage.releaseChannelSyncState(CHANNEL_ID, 'run-1', { nextEligibleCheckAt: 200 })).resolves.toBe(true);
    expect(await storage.getChannelSyncState(CHANNEL_ID)).toEqual(expect.objectContaining({
      scanLeaseUntil: null,
      scanRunId: null,
      nextEligibleCheckAt: 200
    }));
  });

  test('soft unfollow tombstones the channel and removes its active feed state', async () => {
    const { IndexedDBStorage } = require('../../src/indexeddb-storage.js');
    const storage = createRepositoryStorage(IndexedDBStorage);
    await storage.putSubscriptionRecord({
      channelId: CHANNEL_ID,
      channelTitle: 'Retained review title',
      source: 'manual',
      followedAt: 10
    });
    await storage.putChannelSyncState({ channelId: CHANNEL_ID, scanLeaseUntil: 500, scanRunId: 'active-run' });
    await storage.putSubscriptionFeedVideo({ videoId: 'retained-feed-video', channelId: CHANNEL_ID, publishedAt: 10 });
    await storage.putVideo({ videoId: 'watched-history-video', channelId: CHANNEL_ID, time: 42, duration: 100 });

    await storage.deleteSubscriptionAndSyncState(CHANNEL_ID, {
      unsubscribedAt: 100,
      source: 'channels',
      reason: 'user_unfollow'
    });
    expect(await storage.getSubscriptionRecord(CHANNEL_ID)).toBeNull();
    expect(await storage.getChannelSyncState(CHANNEL_ID)).toBeNull();
    expect(await storage.getSubscriptionFeedVideo('retained-feed-video')).toBeNull();
    expect(await storage.getVideo('watched-history-video')).toEqual(expect.objectContaining({
      channelId: CHANNEL_ID,
      time: 42
    }));
    expect(await storage.getLocalUnsubscribeTombstone(CHANNEL_ID)).toEqual(expect.objectContaining({
      channelId: CHANNEL_ID,
      channelTitle: 'Retained review title',
      unsubscribedAt: 100,
      source: 'channels',
      reason: 'user_unfollow'
    }));
  });

  test('deletes cached feed records by channel ID without touching other channels', async () => {
    const { IndexedDBStorage } = require('../../src/indexeddb-storage.js');
    const storage = createRepositoryStorage(IndexedDBStorage);
    await storage.putSubscriptionFeedVideo({ videoId: 'remove-1', channelId: CHANNEL_ID, publishedAt: 20 });
    await storage.putSubscriptionFeedVideo({ videoId: 'keep-1', channelId: 'UC9876543210abcdefghijkl', publishedAt: 10 });

    await expect(storage.deleteSubscriptionFeedVideosByChannelId(CHANNEL_ID)).resolves.toBe(1);
    expect(await storage.getSubscriptionFeedVideo('remove-1')).toBeNull();
    expect(await storage.getSubscriptionFeedVideo('keep-1')).not.toBeNull();
  });

  test('queries only sync states eligible at the requested time', async () => {
    global.IDBKeyRange = { upperBound: jest.fn((value) => ({ upperBound: value })) };
    const { IndexedDBStorage } = require('../../src/indexeddb-storage.js');
    const storage = createRepositoryStorage(IndexedDBStorage);
    await storage.putChannelSyncState({ channelId: CHANNEL_ID, nextEligibleCheckAt: 100 });
    await storage.putChannelSyncState({ channelId: 'UC9876543210abcdefghijkl', nextEligibleCheckAt: 200 });

    expect((await storage.getEligibleChannelSyncStates(150)).map((record) => record.channelId))
      .toEqual([CHANNEL_ID]);
    expect(global.IDBKeyRange.upperBound).toHaveBeenCalledWith(150);
  });

  test('keeps Home impression state separate from feed video records', async () => {
    const { IndexedDBStorage } = require('../../src/indexeddb-storage.js');
    const storage = createRepositoryStorage(IndexedDBStorage);

    await storage.putHomeImpression({
      videoId: 'video-1',
      lastShownOnHomeAt: 100,
      homeImpressionCount: 2,
      consecutiveHomeAppearances: 1
    });

    expect(await storage.getHomeImpression('video-1')).toEqual(expect.objectContaining({
      homeImpressionCount: 2,
      consecutiveHomeAppearances: 1
    }));
    expect(await storage.getSubscriptionFeedVideo('video-1')).toBeNull();
  });

  test('stores compact feed scan summaries independently from feed inventory', async () => {
    const { IndexedDBStorage } = require('../../src/indexeddb-storage.js');
    const storage = createRepositoryStorage(IndexedDBStorage);
    await storage.putFeedSyncRun({ runId: 'run-1', completedAt: 10, total: 2, outcomes: { updated: 1 } });
    await storage.putFeedSyncRun({ runId: 'run-2', completedAt: 20, total: 1, outcomes: { unchanged: 1 } });

    expect((await storage.listFeedSyncRunsByCompletedAt()).map((run) => run.runId)).toEqual(['run-2', 'run-1']);
    await storage.deleteFeedSyncRun('run-2');
    expect((await storage.listFeedSyncRunsByCompletedAt()).map((run) => run.runId)).toEqual(['run-1']);
  });
});
