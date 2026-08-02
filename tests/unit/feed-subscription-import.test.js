const { importCanonicalSubscriptions } = require('../../src/feed-subscription-import.js');

const CHANNEL = 'UC1234567890abcdefghijkl';

function createStorage(existing = []) {
  const records = new Map(existing.map((record) => [record.channelId, { ...record }]));
  return {
    getSubscriptionRecord: jest.fn(async (channelId) => records.get(channelId) || null),
    putSubscriptionRecord: jest.fn(async (record) => records.set(record.channelId, { ...record })),
    records,
  };
}

test('imports only canonical explicit subscriptions and separately reports initialization handoff', async () => {
  const storage = createStorage();
  const { outcome, queuedChannelIds } = await importCanonicalSubscriptions(storage, [
    { ucid: CHANNEL, title: 'Imported channel' },
    { ucid: '@not-canonical', title: 'Skipped' },
  ], { now: 100 });

  expect(outcome).toMatchObject({ found: 2, valid: 1, added: 1, skipped: 1, initializationQueued: 1 });
  expect(queuedChannelIds).toEqual([CHANNEL]);
  expect(storage.records.get(CHANNEL)).toEqual(expect.objectContaining({ source: 'takeout_csv', followedAt: 100 }));
});

test('merges an existing explicit subscription without changing its source or requeuing it', async () => {
  const storage = createStorage([{ channelId: CHANNEL, channelTitle: 'Old title', source: 'manual', followedAt: 50 }]);
  const { outcome, queuedChannelIds } = await importCanonicalSubscriptions(storage, [{ ucid: CHANNEL, title: 'New title' }], { now: 100 });

  expect(outcome).toMatchObject({ added: 0, updated: 1, initializationQueued: 0 });
  expect(queuedChannelIds).toEqual([]);
  expect(storage.records.get(CHANNEL)).toEqual(expect.objectContaining({ source: 'manual', followedAt: 50, channelTitle: 'New title' }));
});
