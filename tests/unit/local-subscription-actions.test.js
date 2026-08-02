const actions = require('../../src/local-subscription-actions.js');

const CHANNEL_ID = 'UC1234567890abcdefghijkl';

test('normalizes only explicit UC IDs and canonical YouTube channel or handle URLs', () => {
  expect(actions.normalizeInput(CHANNEL_ID)).toEqual({ channelId: CHANNEL_ID });
  expect(actions.normalizeInput(`https://www.youtube.com/channel/${CHANNEL_ID}`)).toEqual({ channelId: CHANNEL_ID });
  expect(actions.normalizeInput('youtube.com/@fixture.channel')).toEqual({ handle: '@fixture.channel' });
  expect(() => actions.normalizeInput('https://example.com/channel/' + CHANNEL_ID)).toThrow('youtube.com');
  expect(() => actions.normalizeInput('search words')).toThrow('Use a /channel');
});

test('resolves an explicitly entered handle once without credentials and refuses incomplete pages', async () => {
  const fetch = jest.fn(async () => ({ ok: true, text: async () => `{"externalId":"${CHANNEL_ID}"}` }));
  await expect(actions.resolveInput('@fixture', fetch)).resolves.toEqual({ channelId: CHANNEL_ID, handle: '@fixture' });
  expect(fetch).toHaveBeenCalledWith('https://www.youtube.com/@fixture', { credentials: 'omit' });
  await expect(actions.resolveInput('@fixture', async () => ({ ok: true, text: async () => '<html></html>' }))).rejects.toThrow('canonical channel ID');
});

test('follow queues a canonical local record exactly once and unfollow removes its paired state', async () => {
  const existing = new Map();
  const storage = {
    getSubscriptionRecord: jest.fn(async (id) => existing.get(id) || null),
    putSubscriptionRecord: jest.fn(async (record) => existing.set(record.channelId, record)),
    putChannelSyncState: jest.fn(async () => {}),
    deleteSubscriptionAndSyncState: jest.fn(async (id) => existing.delete(id)),
  };
  await expect(actions.follow(storage, { channelId: CHANNEL_ID, channelName: 'Fixture' }, 123)).resolves.toMatchObject({ status: 'followed' });
  expect(storage.putSubscriptionRecord).toHaveBeenCalledWith(expect.objectContaining({ channelId: CHANNEL_ID, source: 'manual', followedAt: 123 }));
  expect(storage.putChannelSyncState).toHaveBeenCalledWith(expect.objectContaining({ channelId: CHANNEL_ID, initializationState: 'pending', nextEligibleCheckAt: 123 }));
  await expect(actions.follow(storage, { channelId: CHANNEL_ID }, 124)).resolves.toMatchObject({ status: 'already-following' });
  expect(storage.putSubscriptionRecord).toHaveBeenCalledTimes(1);
  await actions.unfollow(storage, CHANNEL_ID);
  expect(storage.deleteSubscriptionAndSyncState).toHaveBeenCalledWith(CHANNEL_ID);
});
