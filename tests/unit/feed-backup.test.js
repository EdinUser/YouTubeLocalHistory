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
    getSubscriptionRecord: jest.fn(async (channelId) => canonicalRecords.get(channelId) || null),
    putSubscriptionRecord: jest.fn(async (record) => {
      canonicalRecords.set(record.channelId, { ...record });
      return record;
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
    ytStorage,
    ytIndexedDBStorage,
    loadData: jest.fn(async () => {}),
    loadFeedSettingsForm: jest.fn(async () => {}),
    notifySettingsChanged: jest.fn(),
    tFeed: (_key, fallback) => fallback,
  };
  vm.runInNewContext(source, context);
  return { context, canonicalRecords, ytStorage, ytIndexedDBStorage };
}

test('full backup exports legacy and canonical subscriptions without flattening their formats', async () => {
  const legacy = [{ id: '@legacy', channelName: 'Legacy channel', subscribedAt: 10 }];
  const canonical = [{
    channelId: 'UCcanonical000000000000001',
    channelTitle: 'Canonical channel',
    thumbnail: 'https://example.test/avatar.jpg',
    handle: '@canonical',
    source: 'manual',
    followedAt: 20,
  }];
  const { context } = createRuntime({ legacySubscriptions: legacy, canonicalSubscriptions: canonical });

  const backup = await context.createFeedBackupData();

  expect(backup._metadata).toEqual(expect.objectContaining({
    dataVersion: '2.1',
    type: 'yt-rewatch-full-backup',
  }));
  expect(backup.subscriptions).toEqual(legacy);
  expect(backup.canonicalSubscriptions).toEqual(canonical);
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
