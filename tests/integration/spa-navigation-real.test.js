/**
 * Real SPA / playlist navigation regression tests using the content script.
 *
 * These tests rely on a small test hook exposed from src/content.js
 * via window.__YTVHT_TEST__.navigation in test environments.
 */

'use strict';

const { mockWindowLocation } = require('../test-helpers');

// Ensure the test hook object exists before loading the content script
if (!global.window.__YTVHT_TEST__) {
  global.window.__YTVHT_TEST__ = {};
}

// Load the real content script so it registers handlers
require('../../src/content.js');

const navigation = global.window.__YTVHT_TEST__.navigation;
const core = global.window.__YTVHT_TEST__.core;

describe('SPA / playlist navigation (real content.js)', () => {
  test('Shorts metadata stays scoped to the active reel and refreshes after the DOM settles', () => {
    mockWindowLocation('https://www.youtube.com/shorts/FEIUzuptkME');
    document.title = 'No CGI—Just a Real Miniature Tsunami - YouTube';
    document.body.innerHTML = `
      <ytd-reel-video-renderer id="stale-reel">
        <video></video>
        <yt-shorts-video-title-view-model><h1>No CGI—Just a Real Miniature Tsunami</h1></yt-shorts-video-title-view-model>
        <a href="/@stale_channel/shorts">@stale_channel</a>
      </ytd-reel-video-renderer>
      <ytd-reel-video-renderer id="active-reel">
        <video id="active-short"></video>
        <yt-shorts-video-title-view-model><h1 id="active-title">HORRIBLE Chinese Car Quality!</h1></yt-shorts-video-title-view-model>
        <a id="active-channel" href="/@ACM_Cars/shorts">@ACM_Cars</a>
      </ytd-reel-video-renderer>`;

    const video = document.getElementById('active-short');
    Object.defineProperty(video, 'currentTime', { configurable: true, writable: true, value: 3 });
    Object.defineProperty(video, 'duration', { configurable: true, value: 15 });

    expect(core.getShortsMetadata(video, 'FEIUzuptkME')).toEqual({
      title: 'HORRIBLE Chinese Car Quality!',
      channelName: '@ACM_Cars',
      channelId: 'ACM_Cars',
    });
    expect(core.captureShortsSnapshot(video, 'FEIUzuptkME')).toMatchObject({
      title: 'HORRIBLE Chinese Car Quality!',
      channelName: '@ACM_Cars',
    });

    document.getElementById('active-title').textContent = 'Updated active title';
    document.getElementById('active-channel').textContent = '@UpdatedChannel';
    document.getElementById('active-channel').setAttribute('href', '/@UpdatedChannel/shorts');

    expect(core.captureShortsSnapshot(video, 'FEIUzuptkME')).toMatchObject({
      title: 'Updated active title',
      channelName: '@UpdatedChannel',
      channelId: 'UpdatedChannel',
    });
  });

  test('newer Shorts metadata wins when an older save is still in flight', async () => {
    const originalGetVideo = global.ytStorage.getVideo.getMockImplementation();
    const originalSetVideo = global.ytStorage.setVideo.getMockImplementation();
    const records = new Map();
    let releaseOlderWrite;
    let markOlderWriteStarted;
    const olderWriteGate = new Promise((resolve) => { releaseOlderWrite = resolve; });
    const olderWriteStarted = new Promise((resolve) => { markOlderWriteStarted = resolve; });

    global.ytStorage.getVideo.mockImplementation(async (videoId) => records.get(videoId) || null);
    global.ytStorage.setVideo.mockImplementation(async (videoId, record) => {
      if (record.channelName === '@PreviousChannel') {
        markOlderWriteStarted();
        await olderWriteGate;
      }
      records.set(videoId, { ...record });
    });

    try {
      const olderSave = core.saveShortsTimestamp({
        videoId: 'ShortRace01',
        time: 5,
        duration: 20,
        title: 'New Short title',
        url: 'https://www.youtube.com/shorts/ShortRace01',
        isShorts: true,
        channelName: '@PreviousChannel',
        channelId: 'PreviousChannel',
      });
      await olderWriteStarted;
      const newerSave = core.saveShortsTimestamp({
        videoId: 'ShortRace01',
        time: 5.1,
        duration: 20,
        title: 'New Short title',
        url: 'https://www.youtube.com/shorts/ShortRace01',
        isShorts: true,
        channelName: '@CorrectChannel',
        channelId: 'CorrectChannel',
      });

      releaseOlderWrite();
      await Promise.all([olderSave, newerSave]);

      expect(records.get('ShortRace01')).toMatchObject({
        channelName: '@CorrectChannel',
        channelId: 'CorrectChannel',
        time: 5.1,
      });
    } finally {
      global.ytStorage.getVideo.mockImplementation(originalGetVideo);
      global.ytStorage.setVideo.mockImplementation(originalSetVideo);
    }
  });

  test('reused Shorts video reconciles after loadstart precedes the SPA route', async () => {
    const originalGetVideo = global.ytStorage.getVideo.getMockImplementation();
    const originalSetVideo = global.ytStorage.setVideo.getMockImplementation();
    const originalSendMessage = global.chrome.runtime.sendMessage;
    const records = new Map();

    global.ytStorage.getVideo.mockImplementation(async (videoId) => records.get(videoId) || null);
    global.ytStorage.setVideo.mockImplementation(async (videoId, record) => {
      records.set(videoId, { ...record });
    });
    global.chrome.runtime.sendMessage = jest.fn();
    jest.useFakeTimers();

    try {
      core.resetVideoTrackingForTests();
      mockWindowLocation('https://www.youtube.com/shorts/FirstShort01');
      document.body.innerHTML = `
        <ytd-reel-video-renderer>
          <a id="short-route" href="/shorts/FirstShort01"></a>
          <video id="reused-short"></video>
          <yt-shorts-video-title-view-model><h1 id="short-title">First Short</h1></yt-shorts-video-title-view-model>
          <a id="short-channel" href="/@FirstChannel/shorts">@FirstChannel</a>
        </ytd-reel-video-renderer>`;

      const video = document.getElementById('reused-short');
      Object.defineProperties(video, {
        currentTime: { configurable: true, writable: true, value: 5 },
        duration: { configurable: true, value: 20 },
        paused: { configurable: true, value: true },
        readyState: { configurable: true, value: 4 },
      });
      video.getBoundingClientRect = () => ({ width: 360, height: 640 });

      core.setupVideoTracking(video);
      video.dispatchEvent(new Event('timeupdate'));
      await jest.advanceTimersByTimeAsync(600);
      expect(records.get('FirstShort01')).toMatchObject({
        title: 'First Short',
        channelId: 'FirstChannel',
      });

      // YouTube can reuse the media element and emit loadstart before changing
      // the URL and reel DOM. No later loadstart is guaranteed.
      video.dispatchEvent(new Event('loadstart'));
      mockWindowLocation('https://www.youtube.com/shorts/SecondShort02');
      document.getElementById('short-route').setAttribute('href', '/shorts/SecondShort02');
      document.getElementById('short-title').textContent = 'Second Short';
      document.getElementById('short-channel').setAttribute('href', '/@SecondChannel/shorts');
      document.getElementById('short-channel').textContent = '@SecondChannel';
      video.currentTime = 5;
      video.dispatchEvent(new Event('timeupdate'));
      await jest.advanceTimersByTimeAsync(600);

      expect(records.get('SecondShort02')).toMatchObject({
        videoId: 'SecondShort02',
        title: 'Second Short',
        channelName: '@SecondChannel',
        channelId: 'SecondChannel',
      });
    } finally {
      core.resetVideoTrackingForTests();
      jest.clearAllTimers();
      jest.useRealTimers();
      global.ytStorage.getVideo.mockImplementation(originalGetVideo);
      global.ytStorage.setVideo.mockImplementation(originalSetVideo);
      if (originalSendMessage) global.chrome.runtime.sendMessage = originalSendMessage;
      else delete global.chrome.runtime.sendMessage;
    }
  });

  test('handleSpaNavigation does not throw for new video', () => {
    document.body.innerHTML = '';
    mockWindowLocation('https://www.youtube.com/watch?v=video1');

    // Add a video element to exercise the timing reset path
    const video = document.createElement('video');
    video.currentTime = 42;
    document.body.appendChild(video);

    expect(() => navigation.handleSpaNavigation()).not.toThrow();
    // The first yt-navigate-finish for a document is not a video-to-video
    // transition. It must not erase a timestamp restored during page load.
    expect(video.currentTime).toBe(42);
    expect(navigation.getLastProcessedVideoId()).toBe('video1');
  });

  test('handleSpaNavigation clears inherited time for an actual SPA video change', () => {
    document.body.innerHTML = '';
    mockWindowLocation('https://www.youtube.com/watch?v=previousVideo');
    navigation.handleSpaNavigation();

    const video = document.createElement('video');
    video.currentTime = 42;
    document.body.appendChild(video);
    mockWindowLocation('https://www.youtube.com/watch?v=nextVideo');

    navigation.handleSpaNavigation();

    expect(video.currentTime).toBe(0);
    expect(navigation.getLastProcessedVideoId()).toBe('nextVideo');
  });

  test('checkUrlChange triggers SPA navigation for new video URL', () => {
    document.body.innerHTML = '';
    mockWindowLocation('https://www.youtube.com/watch?v=spa123');

    navigation.checkUrlChange();

    expect(navigation.getLastProcessedVideoId()).toBe('spa123');
  });

  test('checkUrlChange triggers playlist navigation for playlist URL', () => {
    document.body.innerHTML = '';
    mockWindowLocation('https://www.youtube.com/watch?v=plvid1&list=PLXYZ');

    navigation.checkUrlChange();

    expect(navigation.getLastProcessedVideoId()).toBe('plvid1');
  });

  test('handleSpaNavigation is idempotent for same video ID', () => {
    document.body.innerHTML = '';
    mockWindowLocation('https://www.youtube.com/watch?v=videoRepeat');

    const video = document.createElement('video');
    video.currentTime = 10; // Use > 5 to trigger reset
    document.body.appendChild(video);

    navigation.handleSpaNavigation();
    expect(video.currentTime).toBe(0);

    video.currentTime = 10;
    navigation.handleSpaNavigation();

    // Second call should be a no-op for navigation-driven reset
    expect(video.currentTime).toBe(10);
  });

  test('handlePlaylistNavigation does not throw in playlist context', () => {
    document.body.innerHTML = '';
    mockWindowLocation('https://www.youtube.com/watch?v=video1&list=PL123');

    const video = document.createElement('video');
    video.currentTime = 10;
    document.body.appendChild(video);

    expect(() => navigation.handlePlaylistNavigation('video2')).not.toThrow();
    expect(navigation.getLastProcessedVideoId()).toBe('video2');
  });
});
