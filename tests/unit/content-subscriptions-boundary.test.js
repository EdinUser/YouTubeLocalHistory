/** @jest-environment jsdom */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

test('the page Follow action writes only canonical local subscription state and makes no request', async () => {
  jest.useFakeTimers();
  document.head.innerHTML = '<meta property="og:title" content="Video title, not the channel">';
  document.body.innerHTML = '<ytd-watch-metadata><ytd-video-owner-renderer><div id="channel-name">Fixture channel</div></ytd-video-owner-renderer><div id="subscribe-button"><button aria-label="Subscribe to Fixture"></button></div></ytd-watch-metadata>';
  const fetch = jest.fn();
  const messages = [];
  const runtime = {
    lastError: null,
    sendMessage: jest.fn((message, callback) => {
      messages.push(message);
      callback({ result: null });
    }),
  };
  const actions = {
    follow: jest.fn(async (repo, info) => {
      await repo.putSubscriptionRecord({ ...info, source: 'manual' });
      await repo.putChannelSyncState({ channelId: info.channelId, initializationState: 'pending' });
    }),
    unfollow: jest.fn(async (repo, channelId) => repo.deleteSubscriptionAndSyncState(channelId)),
  };
  const context = {
    document, window, location: { pathname: '/channel/UC1234567890abcdefghijkl' },
    chrome: { runtime }, ytvhtLocalSubscriptionActions: actions, fetch, setTimeout, clearTimeout, Date, Promise,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'content-subscriptions.js'), 'utf8'), context);
  await jest.advanceTimersByTimeAsync(500);

  const button = document.querySelector('.ytvht-sub-btn');
  expect(button).not.toBeNull();
  const ownerHandler = jest.fn();
  document.querySelector('ytd-watch-metadata').addEventListener('click', ownerHandler);
  button.click();
  await jest.runAllTimersAsync();

  expect(actions.follow).toHaveBeenCalledWith(expect.objectContaining({
    getSubscriptionRecord: expect.any(Function), putSubscriptionRecord: expect.any(Function)
  }), expect.objectContaining({ channelId: 'UC1234567890abcdefghijkl', channelTitle: 'Fixture channel' }));
  expect(messages.filter((message) => message.type === 'localSubscriptionStore').map((message) => message.operation))
    .toEqual(expect.arrayContaining(['get', 'putSubscription', 'putSyncState']));
  expect(ownerHandler).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  jest.useRealTimers();
});
