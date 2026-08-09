const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'feed-backup.js'),
  'utf8'
);

function createRuntime(options = {}) {
  const canonicalRecords = new Map(
    (options.canonicalSubscriptions || []).map((record) => [record.channelId, { ...record }])
  );
  const localData = options.localData || {};
  const tombstones = new Map(
    (options.localUnsubscribeTombstones || []).map((record) => [record.channelId, { ...record }])
  );
  const ytStorage = {
    getAllVideos: jest.fn(async () => options.videos || {}),
    getAllPlaylists: jest.fn(async () => options.playlists || {}),
    getStats: jest.fn(async () => options.stats || {}),
    getSubscriptionList: jest.fn(async () => options.legacySubscriptions || []),
    getAllWatchLater: jest.fn(async () => options.watchLater || {}),
    getSettings: jest.fn(async () => options.settings || {}),
    importRecords: jest.fn(async () => ({})),
    addSubscription: jest.fn(async () => ({})),
    setWatchLater: jest.fn(async () => {}),
    setSettings: jest.fn(async () => {}),
    setStats: jest.fn(async () => {}),
  };
  const ytIndexedDBStorage = {
    listSubscriptionRecords: jest.fn(async () => [...canonicalRecords.values()].map((record) => ({ ...record }))),
    listLocalUnsubscribeTombstones: jest.fn(async () => [...tombstones.values()].map((record) => ({ ...record }))),
    getSubscriptionRecord: jest.fn(async (channelId) => canonicalRecords.get(channelId) || null),
    getLocalUnsubscribeTombstone: jest.fn(async (channelId) => tombstones.get(channelId) || null),
    putSubscriptionRecord: jest.fn(async (record) => {
      canonicalRecords.set(record.channelId, { ...record });
      return record;
    }),
    softUnfollowSubscription: jest.fn(async (channelId, tombstone) => {
      canonicalRecords.delete(channelId);
      tombstones.set(channelId, { ...tombstone });
      return { tombstone };
    }),
  };
  const chrome = {
    runtime: { getManifest: jest.fn(() => ({ version: '5.0.0' })) },
    storage: {
      local: {
        get: jest.fn(async () => ({ ...localData })),
        set: jest.fn(async () => {}),
      },
    },
  };
  const context = {
    console,
    chrome,
    ytvhtFeedContracts: require('../../src/feed-contracts.js'),
    ytStorage,
    ytIndexedDBStorage,
    loadData: jest.fn(async () => {}),
    loadFeedSettingsForm: jest.fn(async () => {}),
    notifySettingsChanged: jest.fn(),
    tFeed: (_key, fallback) => fallback,
  };
  vm.runInNewContext(source, context);
  return { context, canonicalRecords, tombstones, ytStorage, ytIndexedDBStorage };
}

test('full backup exports legacy, canonical, and local-unsubscribe records without flattening them', async () => {
  const legacy = [{ id: '@legacy', channelName: 'Legacy channel', subscribedAt: 10 }];
  const canonical = [{
    channelId: 'UCcanonical000000000000001',
    channelTitle: 'Canonical channel',
    thumbnail: 'https://example.test/avatar.jpg',
    handle: '@canonical',
    source: 'manual',
    followedAt: 20,
  }];
  const localUnsubscribeTombstones = [{
    schemaVersion: 1,
    channelId: 'UCcanonical000000000000009',
    unsubscribedAt: 30,
    source: 'channels',
    reason: 'user_unfollow'
  }];
  const { context } = createRuntime({
    legacySubscriptions: legacy,
    canonicalSubscriptions: canonical,
    localUnsubscribeTombstones
  });

  const backup = await context.createFeedBackupData();

  expect(backup._metadata).toEqual(expect.objectContaining({
    dataVersion: '2.2',
    type: 'yt-rewatch-full-backup',
  }));
  expect(backup.subscriptions).toEqual(legacy);
  expect(backup.canonicalSubscriptions).toEqual(canonical);
  expect(backup.localUnsubscribeTombstones).toEqual(localUnsubscribeTombstones);
});

test('canonical restore deduplicates by channel ID and merges without discarding current metadata', async () => {
  const channelId = 'UCcanonical000000000000002';
  const addedChannelId = 'UCcanonical000000000000003';
  const { context, canonicalRecords } = createRuntime({
    canonicalSubscriptions: [{
      channelId,
      channelTitle: 'Current title',
      thumbnail: '',
      handle: '@current',
      source: 'manual',
      followedAt: 200,
      currentOnly: true,
    }],
  });

  await context.restoreFeedBackupData({
    canonicalSubscriptions: [{
      channelId,
      channelTitle: 'Backup title',
      thumbnail: 'https://example.test/backup.jpg',
      handle: '@backup',
      source: 'takeout_csv',
      followedAt: 100,
      backupOnly: true,
    }, {
      channelId: addedChannelId,
      channelTitle: 'Restored channel',
      source: 'oauth',
      followedAt: 300,
    }],
  });

  expect([...canonicalRecords.keys()]).toEqual([channelId, addedChannelId]);
  expect(canonicalRecords.get(channelId)).toEqual(expect.objectContaining({
    channelTitle: 'Current title',
    thumbnail: 'https://example.test/backup.jpg',
    handle: '@current',
    source: 'manual',
    followedAt: 100,
    currentOnly: true,
    backupOnly: true,
  }));
  expect(canonicalRecords.get(addedChannelId)).toEqual(expect.objectContaining({
    channelTitle: 'Restored channel',
    source: 'oauth',
    followedAt: 300,
  }));
});

test('older backups without canonical subscriptions still restore through the legacy path', async () => {
  const { context, ytStorage, ytIndexedDBStorage } = createRuntime();
  const legacy = { id: '@legacy', channelName: 'Legacy channel', subscribedAt: 10 };

  await expect(context.restoreFeedBackupData({ subscriptions: [legacy] })).resolves.toBeUndefined();

  expect(ytStorage.addSubscription).toHaveBeenCalledWith(legacy);
  expect(ytIndexedDBStorage.putSubscriptionRecord).not.toHaveBeenCalled();
});

test('restore applies tombstones before subscriptions so local unsubscribe wins a conflict', async () => {
  const channelId = 'UCcanonical000000000000004';
  const { context, canonicalRecords, tombstones, ytIndexedDBStorage } = createRuntime({
    canonicalSubscriptions: [{
      channelId,
      channelTitle: 'Currently active',
      source: 'manual',
      followedAt: 10
    }]
  });

  await context.restoreFeedBackupData({
    localUnsubscribeTombstones: [{
      channelId,
      unsubscribedAt: 100,
      source: 'backup_restore',
      reason: 'user_unfollow'
    }],
    canonicalSubscriptions: [{
      channelId,
      channelTitle: 'Backup subscription',
      source: 'manual',
      followedAt: 20
    }]
  });

  expect(ytIndexedDBStorage.softUnfollowSubscription).toHaveBeenCalledWith(channelId, expect.objectContaining({
    channelId,
    unsubscribedAt: 100
  }));
  expect(canonicalRecords.has(channelId)).toBe(false);
  expect(tombstones.get(channelId)).toEqual(expect.objectContaining({ reason: 'user_unfollow' }));
  expect(ytIndexedDBStorage.putSubscriptionRecord).not.toHaveBeenCalled();
});
