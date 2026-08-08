/** @jest-environment jsdom */

'use strict';

const { mockWindowLocation } = require('../test-helpers');

if (!global.window.__YTVHT_TEST__) {
  global.window.__YTVHT_TEST__ = {};
}

require('../../src/content.js');

const {
  getPendingRestoreForTests,
  getPrimaryVideo,
  handleVideoMutations,
  resetVideoTrackingForTests,
  setupVideoTracking
} = global.window.__YTVHT_TEST__.core;
const VIDEO_ID = 'restore-media-transition-video';
const SAVED_TIME = 45;

function createVideo({ currentTime = 0, duration = 0, readyState = 0 } = {}) {
  const video = document.createElement('video');
  let time = currentTime;
  let mediaDuration = duration;
  let mediaReadyState = readyState;
  Object.defineProperties(video, {
    currentTime: {
      configurable: true,
      get: () => time,
      set: (value) => { time = value; }
    },
    duration: {
      configurable: true,
      get: () => mediaDuration,
      set: (value) => { mediaDuration = value; }
    },
    readyState: {
      configurable: true,
      get: () => mediaReadyState,
      set: (value) => { mediaReadyState = value; }
    },
    paused: { configurable: true, get: () => true }
  });
  return video;
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function settleMediaTransition() {
  await new Promise((resolve) => setTimeout(resolve, 550));
  await settle();
}

function makePlayable(video) {
  video.readyState = 4;
  video.dispatchEvent(new Event('loadeddata'));
  video.dispatchEvent(new Event('canplay'));
}

describe('restore through replacement media', () => {
  beforeEach(() => {
    resetVideoTrackingForTests();
    document.body.innerHTML = '';
    mockWindowLocation(`https://www.youtube.com/watch?v=${VIDEO_ID}`);
    global.ytStorage.getVideo.mockResolvedValue({ videoId: VIDEO_ID, time: SAVED_TIME });
    global.ytStorage.getSettings.mockResolvedValue({
      autoCleanPeriod: 90,
      paginationCount: 10,
      overlayTitle: 'viewed',
      overlayColor: 'blue',
      overlayLabelSize: 'medium'
    });
  });

  afterEach(() => {
    resetVideoTrackingForTests();
  });

  test('defers a restore from short media to replacement long-form media and confirms it', async () => {
    const preRoll = createVideo({ duration: 15, readyState: 1 });
    document.body.append(preRoll);
    setupVideoTracking(preRoll);
    await settle();

    expect(preRoll.currentTime).toBe(0);

    const mainVideo = createVideo({ readyState: 0 });
    document.body.replaceChildren(mainVideo);
    setupVideoTracking(mainVideo);
    mainVideo.dispatchEvent(new Event('loadstart'));
    mainVideo.duration = 213;
    mainVideo.readyState = 1;
    mainVideo.dispatchEvent(new Event('loadedmetadata'));
    await settle();

    expect(mainVideo.currentTime).toBe(0);
    makePlayable(mainVideo);
    await settleMediaTransition();

    expect(mainVideo.currentTime).toBe(SAVED_TIME);
    mainVideo.dispatchEvent(new Event('seeked'));
    expect(mainVideo.currentTime).toBe(SAVED_TIME);
  });

  test('allows only one replacement tracker to claim the pending restore', async () => {
    const preRoll = createVideo({ duration: 15, readyState: 1 });
    document.body.append(preRoll);
    setupVideoTracking(preRoll);
    await settle();
    expect(preRoll.currentTime).toBe(0);

    const firstReplacement = createVideo({ readyState: 0 });
    const secondReplacement = createVideo({ readyState: 0 });
    document.body.replaceChildren(firstReplacement, secondReplacement);
    setupVideoTracking(firstReplacement);
    setupVideoTracking(secondReplacement);
    firstReplacement.duration = 213;
    firstReplacement.readyState = 1;
    firstReplacement.dispatchEvent(new Event('loadedmetadata'));
    await settle();
    secondReplacement.duration = 213;
    secondReplacement.readyState = 1;
    secondReplacement.dispatchEvent(new Event('loadedmetadata'));
    await settle();

    expect(firstReplacement.currentTime).toBe(0);
    makePlayable(firstReplacement);
    await settleMediaTransition();

    expect(firstReplacement.currentTime).toBe(SAVED_TIME);
    expect(secondReplacement.currentTime).toBe(0);
    firstReplacement.dispatchEvent(new Event('seeked'));
  });

  test('preserves an in-flight seek when YouTube reparents the same player', async () => {
    const firstParent = document.createElement('div');
    const secondParent = document.createElement('div');
    const mainVideo = createVideo({ duration: 213, readyState: 4 });
    document.body.append(firstParent, secondParent);
    firstParent.append(mainVideo);
    setupVideoTracking(mainVideo);
    await settle();

    expect(mainVideo.currentTime).toBe(SAVED_TIME);
    expect(getPendingRestoreForTests()?.ownerVideo).toBe(mainVideo);

    firstParent.removeChild(mainVideo);
    secondParent.append(mainVideo);
    handleVideoMutations([
      { addedNodes: [], removedNodes: [mainVideo] },
      { addedNodes: [mainVideo], removedNodes: [] }
    ]);
    mainVideo.dispatchEvent(new Event('seeked'));

    expect(getPendingRestoreForTests()).toBeNull();
  });

  test('retries an unconfirmed seek on a genuinely replaced primary player', async () => {
    const firstVideo = createVideo({ duration: 213, readyState: 4 });
    document.body.append(firstVideo);
    setupVideoTracking(firstVideo);
    await settle();

    expect(firstVideo.currentTime).toBe(SAVED_TIME);
    expect(getPendingRestoreForTests()?.ownerVideo).toBe(firstVideo);

    const replacement = createVideo({ duration: 213, readyState: 4 });
    document.body.replaceChildren(replacement);
    handleVideoMutations([
      { addedNodes: [replacement], removedNodes: [firstVideo] }
    ]);
    await settleMediaTransition();

    expect(replacement.currentTime).toBe(SAVED_TIME);
    expect(getPendingRestoreForTests()?.ownerVideo).toBe(replacement);
    replacement.dispatchEvent(new Event('seeked'));
    expect(getPendingRestoreForTests()).toBeNull();
  });

  test('prefers the YouTube main player over a blank auxiliary video', () => {
    const auxiliaryVideo = createVideo();
    const player = document.createElement('div');
    player.id = 'movie_player';
    const mainVideo = createVideo({ duration: 213, readyState: 1 });
    mainVideo.className = 'video-stream html5-main-video';
    player.append(mainVideo);
    document.body.append(auxiliaryVideo, player);

    expect(getPrimaryVideo()).toBe(mainVideo);
  });
});
