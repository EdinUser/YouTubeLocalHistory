/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'feed-watchlater-view.js'), 'utf8');

function createRuntime(items, options = {}) {
  document.body.innerHTML = `
    <div id="watchLaterList"></div><div id="watchLaterEmpty"></div><div id="watchLaterCount"></div>
    <div id="watchLaterSection"></div><div id="historySection"></div><div id="analyticsSection"></div>
    <div id="subscriptionsSection"></div><div id="playlistsSection"></div><div id="settingsSection"></div>
    <div id="channelSection"></div><div id="localHeading"></div><div id="grid"></div><div id="localSearchResults"></div>
    <div id="empty"></div><div id="ytSection"></div><div class="chips"></div>`;
  const ytStorage = {
    getAllWatchLater: jest.fn(async () => items),
    setWatchLater: jest.fn(async (videoId, item) => { items[videoId] = item; }),
    removeWatchLater: jest.fn(async (videoId) => { delete items[videoId]; })
  };
  const context = {
    document, ytStorage, watchedMap: {}, console, Promise,
    fetch: options.fetch || jest.fn(),
    tFeed: (_key, fallback, args = []) => args.reduce((text, arg, index) => text.replace(`$${index + 1}`, arg), fallback),
    feedPlural: (_key, count, one, other) => `${count} ${count === 1 ? one.replace('$1 ', '') : other.replace('$1 ', '')}`,
    buildResultRow: jest.fn((video) => {
      const row = document.createElement('div');
      row.dataset.ytvhtVideoId = video.videoId;
      const actions = document.createElement('div'); actions.className = 'yt-row-actions'; row.appendChild(actions);
      return row;
    }),
    rememberView: jest.fn(), setRefreshVisible: jest.fn(), setCreatePlaylistVisible: jest.fn(), setSaveSettingsVisible: jest.fn(),
    setClearSubscriptionsVisible: jest.fn(), setClearHistoryVisible: jest.fn(), setFeedOptionsVisible: jest.fn(), showFeedStatus: jest.fn(),
    leaveSearchPage: jest.fn(), setActiveNav: jest.fn(),
    analyticsActive: false, subscriptionsActive: false, playlistsActive: false, historyActive: false,
    settingsActive: false, channelActive: false, watchLaterActive: false
  };
  vm.runInNewContext(source, context);
  return context;
}

test('renders locally saved Watch Later videos newest first and removes a video', async () => {
  const items = {
    older: { videoId: 'older', title: 'Older', addedAt: 1 },
    newer: { videoId: 'newer', title: 'Newer', addedAt: 2 }
  };
  const context = createRuntime(items);

  await context.renderWatchLater();
  expect([...document.querySelectorAll('#watchLaterList .history-row')].map((row) => row.dataset.ytvhtVideoId))
    .toEqual(['newer', 'older']);
  expect(document.getElementById('watchLaterCount').textContent).toBe('2 saved videos');

  document.querySelector('#watchLaterList .history-remove').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(context.ytStorage.removeWatchLater).toHaveBeenCalledWith('newer');
  expect(document.querySelectorAll('#watchLaterList .history-row')).toHaveLength(1);
});

test('opens Watch Later as its own full-page view', async () => {
  const context = createRuntime({});
  context.showWatchLater();

  expect(context.rememberView).toHaveBeenCalledWith('watchlater');
  expect(context.watchLaterActive).toBe(true);
  expect(document.getElementById('watchLaterSection').style.display).toBe('block');
  expect(context.setActiveNav).toHaveBeenCalledWith('navWatchLater');
});

test('repairs missing Watch Later metadata from YouTube oEmbed', async () => {
  const items = {
    missing: { videoId: 'missing', title: '', channelName: '', addedAt: 1 }
  };
  const fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({ title: 'Recovered title', author_name: 'Recovered channel' })
  }));
  const context = createRuntime(items, { fetch });

  await context.renderWatchLater();

  expect(fetch).toHaveBeenCalledWith(expect.stringContaining('youtube.com/oembed?url='));
  expect(context.ytStorage.setWatchLater).toHaveBeenCalledWith('missing', expect.objectContaining({
    title: 'Recovered title', channelName: 'Recovered channel'
  }));
});
