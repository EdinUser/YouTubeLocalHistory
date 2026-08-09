/** @jest-environment jsdom */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

test('the page Follow action writes only canonical local subscription state and makes no request', async () => {
  jest.useFakeTimers();
  document.head.innerHTML = '<meta property="og:title" content="Video title, not the channel">';
  document.body.innerHTML = '<yt-page-header-renderer><ytd-video-owner-renderer><div id="channel-name">Fixture channel</div></ytd-video-owner-renderer><div id="subscribe-button"><button aria-label="Subscribe to Fixture"></button></div></yt-page-header-renderer>';
  const fetch = jest.fn();
  const messages = [];
  const runtime = {
    lastError: null,
    getURL: jest.fn((file) => `chrome-extension://fixture/${file}`),
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
    chrome: { runtime }, browser: undefined, ytvhtLocalSubscriptionActions: actions, fetch, setTimeout, clearTimeout, Date, Promise,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'content-subscriptions.js'), 'utf8'), context);
  await jest.advanceTimersByTimeAsync(500);

  const button = document.querySelector('.ytvht-sub-btn');
  expect(button).not.toBeNull();
  expect(button.querySelector('.ytvht-sub-btn-icon').getAttribute('src')).toBe('chrome-extension://fixture/icon48.png');
  const ownerHandler = jest.fn();
  document.querySelector('yt-page-header-renderer').addEventListener('click', ownerHandler);
  button.click();
  await jest.runAllTimersAsync();

  expect(actions.follow).toHaveBeenCalledWith(expect.objectContaining({
    getSubscriptionRecord: expect.any(Function), putSubscriptionRecord: expect.any(Function)
  }), expect.objectContaining({ channelId: 'UC1234567890abcdefghijkl', channelTitle: 'Fixture channel' }));
  expect(messages.filter((message) => message.type === 'localSubscriptionStore').map((message) => message.operation))
    .toEqual(expect.arrayContaining(['get', 'putSubscription', 'putSyncState']));
  expect(ownerHandler).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();

  // YouTube can retain the companion while replacing/reordering its own
  // Subscribe control during SPA navigation. The retained button must bind to
  // the new channel and move back to the control's right-hand side.
  const nativeContainer = document.querySelector('#subscribe-button');
  nativeContainer.parentNode.insertBefore(button, nativeContainer);
  context.location.pathname = '/channel/UC0987654321abcdefghijkl';
  document.querySelector('#channel-name').textContent = 'Second fixture channel';
  window.dispatchEvent(new window.Event('yt-navigate-finish'));
  await jest.advanceTimersByTimeAsync(500);

  expect(nativeContainer.nextElementSibling).toBe(button);
  button.click();
  await jest.runAllTimersAsync();
  expect(actions.follow).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
    channelId: 'UC0987654321abcdefghijkl', channelTitle: 'Second fixture channel'
  }));
  jest.useRealTimers();
});
