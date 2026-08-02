/** @jest-environment jsdom */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

test('the page Follow action writes only canonical local subscription state and makes no request', async () => {
  jest.useFakeTimers();
  document.head.innerHTML = '<meta property="og:title" content="Fixture channel">';
  document.body.innerHTML = '<div><div id="subscribe-button"></div></div>';
  const fetch = jest.fn();
  const storage = {
    getSubscriptionRecord: jest.fn(async () => null),
    putSubscriptionRecord: jest.fn(async () => {}),
    putChannelSyncState: jest.fn(async () => {}),
    deleteSubscriptionAndSyncState: jest.fn(async () => {}),
  };
  const context = {
    document, window, location: { pathname: '/channel/UC1234567890abcdefghijkl' },
    ytIndexedDBStorage: storage, fetch, setTimeout, clearTimeout, Date, Promise,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'content-subscriptions.js'), 'utf8'), context);
  await jest.advanceTimersByTimeAsync(500);

  const button = document.querySelector('.ytvht-sub-btn');
  expect(button).not.toBeNull();
  button.click();
  await jest.runAllTimersAsync();

  expect(storage.putSubscriptionRecord).toHaveBeenCalledWith(expect.objectContaining({
    channelId: 'UC1234567890abcdefghijkl', source: 'manual'
  }));
  expect(storage.putChannelSyncState).toHaveBeenCalledWith(expect.objectContaining({ initializationState: 'pending' }));
  expect(fetch).not.toHaveBeenCalled();
  jest.useRealTimers();
});
