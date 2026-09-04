const fs = require('fs');
const path = require('path');
const vm = require('vm');

const feedSource = fs.readFileSync(path.join(__dirname, '../../src/feed.js'), 'utf8');
const popupSource = fs.readFileSync(path.join(__dirname, '../../src/popup-search.js'), 'utf8');

beforeEach(() => {
  jest.useFakeTimers();
  document.body.innerHTML = '<input id="search">';
});
afterEach(() => jest.useRealTimers());

function feed() {
  const context = {
    document, setTimeout, clearTimeout, searchVisibleLimit: 60, SEARCH_PAGE_SIZE: 30,
    analyticsActive: false, subscriptionsActive: false, playlistsActive: false,
    historyActive: false, settingsActive: false, channelActive: false, watchLaterActive: false,
    render: jest.fn(), showFeed: jest.fn()
  };
  vm.runInNewContext(feedSource.slice(feedSource.indexOf('function setupFeedSearch()'), feedSource.indexOf('function init()')), context);
  context.setupFeedSearch();
  return context;
}

function input(value) {
  const el = document.getElementById('search');
  el.value = value;
  el.dispatchEvent(new Event('input'));
  return el;
}

test('feed renders only the settled query and Enter flushes without a duplicate render', () => {
  const context = feed();
  ['r', 're', 'rel', 'reload'].forEach(input);
  expect(context.render).not.toHaveBeenCalled();
  jest.advanceTimersByTime(300);
  expect(context.render).toHaveBeenCalledTimes(1);
  input('reload now').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
  expect(context.render).toHaveBeenCalledTimes(2);
  jest.advanceTimersByTime(300);
  expect(context.render).toHaveBeenCalledTimes(2);
});

test('feed clear is immediate and navigation-cleared queries do not reopen search', () => {
  const context = feed();
  input('pending');
  input('');
  expect(context.render).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(300);
  expect(context.render).toHaveBeenCalledTimes(1);
  input('another');
  document.getElementById('search').value = '';
  context.settingsActive = true;
  jest.advanceTimersByTime(300);
  expect(context.showFeed).not.toHaveBeenCalled();
});

test('feed waits for IME composition to finish', () => {
  const context = feed();
  const el = document.getElementById('search');
  el.value = '検索';
  el.dispatchEvent(new InputEvent('input', { isComposing: true }));
  jest.advanceTimersByTime(300);
  expect(context.render).not.toHaveBeenCalled();
  el.dispatchEvent(new CompositionEvent('compositionend'));
  jest.advanceTimersByTime(300);
  expect(context.render).toHaveBeenCalledTimes(1);
});

test('popup debounces the search work itself and cancelled queries never execute', () => {
  const context = { console, document, setTimeout, clearTimeout };
  vm.createContext(context);
  vm.runInContext(popupSource, context);
  context.smartSearch = jest.fn(async () => {});
  vm.runInContext('globalSearchInput = document.getElementById("search")', context);
  ['r', 're', 'reload'].forEach(value => {
    document.getElementById('search').value = value;
    context.schedulePopupSearch(value);
  });
  expect(context.smartSearch).not.toHaveBeenCalled();
  jest.advanceTimersByTime(300);
  expect(context.smartSearch).toHaveBeenCalledTimes(1);
  expect(context.smartSearch).toHaveBeenCalledWith('reload');
  context.schedulePopupSearch('cancelled');
  context.cancelPendingPopupSearch();
  jest.advanceTimersByTime(300);
  expect(context.smartSearch).toHaveBeenCalledTimes(1);
});
