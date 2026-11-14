/** @jest-environment jsdom */

'use strict';

const { mockWindowLocation } = require('../test-helpers');

const VIDEO_ID = 'restore-user-seek-video';
const SAVED_TIME = 45;
const USER_SEEK_TIME = 10;

if (!global.window.__YTVHT_TEST__) {
  global.window.__YTVHT_TEST__ = {};
}

mockWindowLocation(`https://www.youtube.com/watch?v=${VIDEO_ID}`);

require('../../src/content.js');

const {
  getPendingRestoreForTests,
  handleVideoMutations,
  resetVideoTrackingForTests,
  setupVideoTracking
} = global.window.__YTVHT_TEST__.core;

function createVideo({ currentTime = 0, duration = 0, readyState = 0, paused = true } = {}) {
  const video = document.createElement('video');
  let time = currentTime;
  let mediaDuration = duration;
  let mediaReadyState = readyState;
  let mediaPaused = paused;
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
    paused: {
      configurable: true,
      get: () => mediaPaused,
      set: (value) => { mediaPaused = value; }
    }
  });
  return video;
}

function createPlayer(video) {
  const player = document.createElement('div');
  player.id = 'movie_player';
  const progressBar = document.createElement('div');
  progressBar.className = 'ytp-progress-bar-container';
  video.className = 'video-stream html5-main-video';
  player.append(video, progressBar);
  document.body.append(player);
  return { player, progressBar };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function makePlayable(video) {
  video.readyState = 4;
  video.dispatchEvent(new Event('loadeddata'));
  video.dispatchEvent(new Event('canplay'));
}

function seekWithProgressBar(video, progressBar, time) {
  video.currentTime = time;
  progressBar.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  video.dispatchEvent(new Event('seeking'));
  video.dispatchEvent(new Event('seeked'));
}

function seekWithKeyboard(video, key, time) {
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  video.currentTime = time;
  video.dispatchEvent(new Event('seeking'));
  video.dispatchEvent(new Event('seeked'));
}

function dispatchPointerMove(target, buttons = 1) {
  const event = new Event('pointermove', { bubbles: true });
  Object.defineProperty(event, 'buttons', { value: buttons });
  target.dispatchEvent(event);
}

function seekWithShortcutElement(video, element, time) {
  element.addEventListener('click', (event) => event.preventDefault());
  document.body.append(element);
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  video.currentTime = time;
  video.dispatchEvent(new Event('seeking'));
  video.dispatchEvent(new Event('seeked'));
}

describe('user seeks after a restore', () => {
  beforeEach(() => {
    resetVideoTrackingForTests();
    document.body.innerHTML = '';
    mockWindowLocation(`https://www.youtube.com/watch?v=${VIDEO_ID}`);
    global.ytStorage.getVideo.mockResolvedValue({ videoId: VIDEO_ID, time: SAVED_TIME });
    global.ytStorage.setVideo.mockClear();
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

  test('keeps a backward seek made through the progress bar after the initial restore', async () => {
    const video = createVideo({ duration: 213, readyState: 4 });
    const { progressBar } = createPlayer(video);

    setupVideoTracking(video);
    await settle();
    expect(video.currentTime).toBe(SAVED_TIME);
    video.dispatchEvent(new Event('seeked'));
    await settle();

    seekWithProgressBar(video, progressBar, USER_SEEK_TIME);

    // Longer than the save debounce and the fallback restore delay so every
    // late restore path has had a chance to pull the playhead back.
    await new Promise((resolve) => setTimeout(resolve, 1200));

    expect(video.currentTime).toBe(USER_SEEK_TIME);
    expect(getPendingRestoreForTests()).toBeNull();
    expect(global.ytStorage.setVideo).toHaveBeenCalledWith(
      VIDEO_ID,
      expect.objectContaining({ time: USER_SEEK_TIME })
    );
  });

  test('drops a restore that is still waiting for playable media when the user seeks', async () => {
    const video = createVideo({ duration: 213, readyState: 1 });
    const { progressBar } = createPlayer(video);

    setupVideoTracking(video);
    await settle();
    expect(getPendingRestoreForTests()).toBeNull();

    seekWithProgressBar(video, progressBar, USER_SEEK_TIME);
    makePlayable(video);
    await new Promise((resolve) => setTimeout(resolve, 700));

    expect(video.currentTime).toBe(USER_SEEK_TIME);
    expect(getPendingRestoreForTests()).toBeNull();
  });

  test('drops a restore that is still waiting for metadata when the user seeks', async () => {
    const video = createVideo({ duration: 0, readyState: 0 });
    const { progressBar } = createPlayer(video);

    setupVideoTracking(video);
    await settle();

    seekWithProgressBar(video, progressBar, USER_SEEK_TIME);

    video.duration = 213;
    video.readyState = 4;
    video.dispatchEvent(new Event('loadedmetadata'));
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 700));

    expect(video.currentTime).toBe(USER_SEEK_TIME);
    expect(getPendingRestoreForTests()).toBeNull();
  });

  test('recognizes a seek made with YouTube keyboard shortcuts', async () => {
    const video = createVideo({ duration: 213, readyState: 1 });
    createPlayer(video);

    setupVideoTracking(video);
    await settle();

    seekWithKeyboard(video, 'ArrowRight', USER_SEEK_TIME);
    makePlayable(video);
    await new Promise((resolve) => setTimeout(resolve, 700));

    expect(video.currentTime).toBe(USER_SEEK_TIME);
    expect(getPendingRestoreForTests()).toBeNull();
  });

  test('keeps a seek made at the end of a long progress-bar drag', async () => {
    const video = createVideo({ duration: 213, readyState: 1 });
    const { progressBar } = createPlayer(video);

    setupVideoTracking(video);
    await settle();

    progressBar.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    // Outlast the intent window, then keep dragging. Only the movement keeps
    // the intent fresh, so this fails without the pointermove listener.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    dispatchPointerMove(progressBar, 1);
    video.currentTime = USER_SEEK_TIME;
    video.dispatchEvent(new Event('seeking'));
    video.dispatchEvent(new Event('seeked'));

    makePlayable(video);
    await new Promise((resolve) => setTimeout(resolve, 700));

    expect(video.currentTime).toBe(USER_SEEK_TIME);
    expect(getPendingRestoreForTests()).toBeNull();
  });

  test.each([
    ['a timestamp link', () => {
      const link = document.createElement('a');
      link.href = `https://www.youtube.com/watch?v=${VIDEO_ID}&t=${USER_SEEK_TIME}s`;
      return link;
    }],
    ['a chapter list item', () => document.createElement('ytd-macro-markers-list-item-renderer')],
    ['a transcript segment', () => document.createElement('ytd-transcript-segment-renderer')]
  ])('keeps a seek made by clicking %s', async (_label, createElement) => {
    const video = createVideo({ duration: 213, readyState: 1 });
    createPlayer(video);

    setupVideoTracking(video);
    await settle();

    seekWithShortcutElement(video, createElement(), USER_SEEK_TIME);
    makePlayable(video);
    await new Promise((resolve) => setTimeout(resolve, 700));

    expect(video.currentTime).toBe(USER_SEEK_TIME);
    expect(getPendingRestoreForTests()).toBeNull();
  });

  test('still restores a new video after a user seek on the previous one', async () => {
    const video = createVideo({ duration: 213, readyState: 4 });
    document.body.append(video);
    setupVideoTracking(video);
    await settle();
    expect(video.currentTime).toBe(SAVED_TIME);
    video.dispatchEvent(new Event('seeked'));

    // User redirects the playhead on the first video.
    video.dispatchEvent(new Event('pointerdown'));
    video.currentTime = USER_SEEK_TIME;
    video.dispatchEvent(new Event('seeking'));
    video.dispatchEvent(new Event('seeked'));

    // The same <video> element is reused for the next video.
    mockWindowLocation('https://www.youtube.com/watch?v=next-video');
    video.currentTime = 0;
    video.readyState = 1;
    video.dispatchEvent(new Event('loadstart'));
    video.duration = 213;
    video.dispatchEvent(new Event('loadedmetadata'));
    await settle();
    makePlayable(video);
    await new Promise((resolve) => setTimeout(resolve, 550));

    expect(video.currentTime).toBe(SAVED_TIME);
    video.dispatchEvent(new Event('seeked'));
  });
});

describe('seek intent detection guards', () => {
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

  test('keeps the save guard active until the first restore is resolved', async () => {
    const video = createVideo({ duration: 213, readyState: 1 });
    createPlayer(video);
    setupVideoTracking(video);
    await settle();

    // A pre-restore progress save must not overwrite the stored position.
    video.currentTime = 2;
    video.dispatchEvent(new Event('seeked'));
    await new Promise((resolve) => setTimeout(resolve, 700));

    expect(video.currentTime).toBe(SAVED_TIME);
    video.dispatchEvent(new Event('seeked'));
  });

  test('ignores keyboard input typed into a text field', async () => {
    const video = createVideo({ duration: 213, readyState: 1 });
    createPlayer(video);
    setupVideoTracking(video);
    await settle();

    const input = document.createElement('input');
    document.body.append(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    video.currentTime = USER_SEEK_TIME;
    video.dispatchEvent(new Event('seeking'));
    video.dispatchEvent(new Event('seeked'));

    makePlayable(video);
    await new Promise((resolve) => setTimeout(resolve, 700));

    // The seek had no player-level intent, so the scheduled restore wins.
    expect(video.currentTime).toBe(SAVED_TIME);
    video.dispatchEvent(new Event('seeked'));
  });

  test('does not treat a playlist link as a seek shortcut', async () => {
    const video = createVideo({ duration: 213, readyState: 1 });
    createPlayer(video);
    setupVideoTracking(video);
    await settle();

    const link = document.createElement('a');
    link.href = `https://www.youtube.com/watch?v=${VIDEO_ID}&list=PL1234567890`;
    link.addEventListener('click', (event) => event.preventDefault());
    document.body.append(link);
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    video.currentTime = USER_SEEK_TIME;
    video.dispatchEvent(new Event('seeking'));
    video.dispatchEvent(new Event('seeked'));

    makePlayable(video);
    await new Promise((resolve) => setTimeout(resolve, 700));

    // `list=` is not a timestamp, so the scheduled restore wins.
    expect(video.currentTime).toBe(SAVED_TIME);
    video.dispatchEvent(new Event('seeked'));
  });

  test('ignores modified keyboard shortcuts that cannot move the playhead', async () => {
    const video = createVideo({ duration: 213, readyState: 1 });
    createPlayer(video);
    setupVideoTracking(video);
    await settle();

    document.body.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      ctrlKey: true,
      bubbles: true
    }));
    video.currentTime = USER_SEEK_TIME;
    video.dispatchEvent(new Event('seeking'));
    video.dispatchEvent(new Event('seeked'));

    makePlayable(video);
    await new Promise((resolve) => setTimeout(resolve, 700));

    expect(video.currentTime).toBe(SAVED_TIME);
    video.dispatchEvent(new Event('seeked'));
  });

  test('does not undo a seek after a tracked video element is reparented', async () => {
    const firstParent = document.createElement('div');
    const secondParent = document.createElement('div');
    const video = createVideo({ duration: 213, readyState: 4 });
    document.body.append(firstParent, secondParent);
    firstParent.append(video);
    setupVideoTracking(video);
    await settle();
    video.dispatchEvent(new Event('seeked'));
    await settle();

    firstParent.removeChild(video);
    secondParent.append(video);
    handleVideoMutations([
      { addedNodes: [], removedNodes: [video] },
      { addedNodes: [video], removedNodes: [] }
    ]);

    video.currentTime = USER_SEEK_TIME;
    video.dispatchEvent(new Event('seeking'));
    video.dispatchEvent(new Event('seeked'));
    await new Promise((resolve) => setTimeout(resolve, 700));

    expect(video.currentTime).toBe(USER_SEEK_TIME);
  });
});
