/**
 * Playlist save rules exercised through the real content script test hook.
 */

'use strict';

const { mockWindowLocation } = require('../test-helpers');

if (!global.window.__YTVHT_TEST__) {
  global.window.__YTVHT_TEST__ = {};
}

global.ytStorage.setPlaylist = jest.fn().mockResolvedValue();

require('../../src/content.js');

const { loadSettings, savePlaylistInfo, saveTimestamp } = global.window.__YTVHT_TEST__.core;

const PLAYLIST_ID = 'PL_TEST_PLAYLIST';
const VIDEO_ID = 'playlist-video-1';
const DEFAULT_SETTINGS = {
  autoCleanPeriod: 90,
  paginationCount: 10,
  overlayTitle: 'viewed',
  overlayColor: 'blue',
  overlayLabelSize: 'medium',
  debug: false,
  pauseHistoryInPlaylists: false,
  version: '3.0.0',
};

function addVideo({ currentTime = 45, duration = 180 } = {}) {
  const video = document.createElement('video');
  Object.defineProperties(video, {
    currentTime: { configurable: true, writable: true, value: currentTime },
    duration: { configurable: true, value: duration },
  });
  document.body.appendChild(video);
}

describe('playlist save rules (real content.js)', () => {
  beforeEach(async () => {
    document.body.innerHTML = '';
    mockWindowLocation(`https://www.youtube.com/watch?v=${VIDEO_ID}&list=${PLAYLIST_ID}`);

    global.ytStorage.getSettings.mockResolvedValue({ ...DEFAULT_SETTINGS });
    global.ytStorage.getPlaylist.mockResolvedValue(null);
    global.ytStorage.getVideo.mockResolvedValue(null);
    global.ytStorage.setVideo.mockResolvedValue();
    global.ytStorage.setPlaylist.mockResolvedValue();
    global.ytStorage.updateStats.mockResolvedValue();

    await loadSettings();
  });

  test('global pauseHistoryInPlaylists prevents saving in playlist context', async () => {
    global.ytStorage.getSettings.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      pauseHistoryInPlaylists: true,
    });
    await loadSettings();
    addVideo();

    await saveTimestamp();

    expect(global.ytStorage.getPlaylist).not.toHaveBeenCalled();
    expect(global.ytStorage.setVideo).not.toHaveBeenCalled();
  });

  test('per-playlist ignoreVideos prevents saving when global pause is disabled', async () => {
    global.ytStorage.getPlaylist.mockResolvedValue({
      playlistId: PLAYLIST_ID,
      ignoreVideos: true,
    });
    addVideo();

    await saveTimestamp();

    expect(global.ytStorage.getPlaylist).toHaveBeenCalledWith(PLAYLIST_ID);
    expect(global.ytStorage.setVideo).not.toHaveBeenCalled();
  });

  test('non-ignored playlist saves video progress', async () => {
    global.ytStorage.getPlaylist.mockResolvedValue({
      playlistId: PLAYLIST_ID,
      ignoreVideos: false,
    });
    addVideo({ currentTime: 45, duration: 180 });

    await saveTimestamp();

    expect(global.ytStorage.setVideo).toHaveBeenCalledWith(
      VIDEO_ID,
      expect.objectContaining({
        videoId: VIDEO_ID,
        time: 45,
        duration: 180,
        url: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
      })
    );
  });

  test('playlist metadata refresh preserves ignoreVideos', async () => {
    global.ytStorage.getPlaylist.mockResolvedValue({
      playlistId: PLAYLIST_ID,
      title: 'Original title',
      ignoreVideos: true,
      customFlag: 'preserved',
    });

    await savePlaylistInfo({
      playlistId: PLAYLIST_ID,
      title: 'Refreshed title',
      url: `https://www.youtube.com/playlist?list=${PLAYLIST_ID}`,
      timestamp: 123,
    });

    expect(global.ytStorage.setPlaylist).toHaveBeenCalledWith(
      PLAYLIST_ID,
      expect.objectContaining({
        title: 'Refreshed title',
        ignoreVideos: true,
        customFlag: 'preserved',
      })
    );
  });
});
