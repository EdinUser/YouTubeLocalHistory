/**
 * Real SPA / playlist navigation regression tests using the content script.
 *
 * These tests rely on a small test hook exposed from src/content.js
 * via window.__YTVHT_TEST__.navigation in test environments.
 */

'use strict';

// Ensure the test hook object exists before loading the content script
if (!global.window.__YTVHT_TEST__) {
  global.window.__YTVHT_TEST__ = {};
}

// Load the real content script so it registers handlers
require('../../src/content.js');

const navigation = global.window.__YTVHT_TEST__.navigation;

describe('SPA / playlist navigation (real content.js)', () => {
  test('handleSpaNavigation does not throw for new video', () => {
    document.body.innerHTML = '';
    // Simulate being on a watch page with a video ID
    const url = new URL('https://www.youtube.com/watch?v=video1');
    delete window.location;
    Object.defineProperty(window, 'location', {
      value: url,
      writable: true
    });

    // Add a video element to exercise the timing reset path
    const video = document.createElement('video');
    video.currentTime = 42;
    document.body.appendChild(video);

    expect(() => navigation.handleSpaNavigation()).not.toThrow();
    // After SPA handling, previously playing video should be reset to 0
    expect(video.currentTime).toBe(0);
    expect(navigation.getLastProcessedVideoId()).toBe('video1');
  });

  test('checkUrlChange triggers SPA navigation for new video URL', () => {
    document.body.innerHTML = '';
    const url = new URL('https://www.youtube.com/watch?v=spa123');
    delete window.location;
    Object.defineProperty(window, 'location', {
      value: url,
      writable: true
    });

    navigation.checkUrlChange();

    expect(navigation.getLastProcessedVideoId()).toBe('spa123');
  });

  test('checkUrlChange triggers playlist navigation for playlist URL', () => {
    document.body.innerHTML = '';
    const url = new URL('https://www.youtube.com/watch?v=plvid1&list=PLXYZ');
    delete window.location;
    Object.defineProperty(window, 'location', {
      value: url,
      writable: true
    });

    navigation.checkUrlChange();

    expect(navigation.getLastProcessedVideoId()).toBe('plvid1');
  });

  test('handleSpaNavigation is idempotent for same video ID', () => {
    document.body.innerHTML = '';
    const url = new URL('https://www.youtube.com/watch?v=videoRepeat');
    delete window.location;
    Object.defineProperty(window, 'location', {
      value: url,
      writable: true
    });

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
    const url = new URL('https://www.youtube.com/watch?v=video1&list=PL123');
    delete window.location;
    Object.defineProperty(window, 'location', {
      value: url,
      writable: true
    });

    const video = document.createElement('video');
    video.currentTime = 10;
    document.body.appendChild(video);

    expect(() => navigation.handlePlaylistNavigation('video2')).not.toThrow();
    expect(navigation.getLastProcessedVideoId()).toBe('video2');
  });
});
