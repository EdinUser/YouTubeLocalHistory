const preference = require('../../src/feed-view-preference.js');

test('explicit default view overrides the durable last view', () => {
  expect(preference.selectStartupFeedView('channels', 'home')).toBe('channels');
});

test('last default restores durable non-Settings view with a safe Home fallback', () => {
  expect(preference.selectStartupFeedView('last', 'subscriptions')).toBe('subscriptions');
  expect(preference.selectStartupFeedView('last', 'settings')).toBe('home');
  expect(preference.selectStartupFeedView('last', '')).toBe('home');
  expect(preference.shouldPersistLastView('settings')).toBe(false);
  expect(preference.shouldPersistLastView('channels')).toBe(true);
});
