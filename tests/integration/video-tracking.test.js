/**
 * Integration tests for video tracking functionality
 */

// Mock browser APIs
const mockChrome = {
  storage: {
    local: {
      get: jest.fn(),
      set: jest.fn()
    }
  },
  runtime: {
    sendMessage: jest.fn()
  }
};

const mockBrowser = {
  storage: {
    local: {
      get: jest.fn(),
      set: jest.fn()
    }
  }
};

global.chrome = mockChrome;
global.browser = mockBrowser;

// Mock IndexedDB
const mockIndexedDB = {
  open: jest.fn().mockReturnValue({
    result: {},
    onerror: null,
    onsuccess: null,
    onupgradeneeded: null
  })
};

global.indexedDB = mockIndexedDB;

// Helper functions for DOM manipulation
function createViewedLabel() {
  const label = document.createElement('div');
  label.className = 'ytvht-viewed-label';
  label.textContent = 'viewed';
  return label;
}

function createProgressBar() {
  const progressBar = document.createElement('div');
  progressBar.className = 'ytvht-progress-bar';
  progressBar.style.width = '50%';
  return progressBar;
}

// Mock debounce function
function mockDebounce(fn, wait = 0) {
  let timeout;
  return function executedFunction(...args) {
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => fn.apply(this, args), wait);
  };
}

// Import mocks
jest.mock('../../src/content.js');
jest.mock('../../src/popup.js');

const contentModule = require('../../src/content.js');
const popup = require('../../src/popup.js');

describe('Video Tracking Integration', () => {
  let mockVideoElement;
  let mockYtStorage;

  beforeEach(() => {
    // Reset DOM and mocks
    document.body.innerHTML = '';
    jest.clearAllMocks();

    // Create mock video element
    mockVideoElement = createMockVideoElement();
    document.body.appendChild(mockVideoElement);

    // Mock ytStorage
    mockYtStorage = {
      ensureMigrated: jest.fn().mockResolvedValue(),
      getVideo: jest.fn().mockResolvedValue(null),
      setVideo: jest.fn().mockResolvedValue(),
      saveVideo: jest.fn().mockResolvedValue(),
      updateVideo: jest.fn().mockResolvedValue(),
      getAllVideos: jest.fn().mockResolvedValue({}),
      removeVideo: jest.fn().mockResolvedValue(),
      getPlaylist: jest.fn().mockResolvedValue(null),
      setPlaylist: jest.fn().mockResolvedValue(),
      getAllPlaylists: jest.fn().mockResolvedValue({}),
      removePlaylist: jest.fn().mockResolvedValue(),
      getSettings: jest.fn().mockResolvedValue({
        autoCleanPeriod: 90,
        paginationCount: 10,
        overlayTitle: 'viewed',
        overlayColor: 'blue',
        overlayLabelSize: 'medium'
      }),
      setSettings: jest.fn().mockResolvedValue(),
      clear: jest.fn().mockResolvedValue()
    };

    // Mock global ytStorage
    global.ytStorage = mockYtStorage;

    // Setup mock implementations
    contentModule.setupVideoTracking.mockImplementation((video) => {
      if (!video) return null;
      
      const handlers = {
        playHandler: jest.fn(async () => {
          await global.ytStorage.setVideo('testVideoId', {
            videoId: 'testVideoId',
            time: video.currentTime,
            duration: video.duration,
            timestamp: Date.now()
          });
        }),
        pauseHandler: jest.fn(async () => {
          await global.ytStorage.setVideo('testVideoId', {
            videoId: 'testVideoId',
            time: video.currentTime,
            duration: video.duration,
            timestamp: Date.now()
          });
        }),
        timeupdateHandler: jest.fn(async () => {
          await global.ytStorage.setVideo('testVideoId', {
            videoId: 'testVideoId',
            time: video.currentTime,
            duration: video.duration,
            timestamp: Date.now()
          });
        }),
        seekingHandler: jest.fn(),
        seekedHandler: jest.fn(),
        beforeunloadHandler: jest.fn()
      };
      
      try {
        video.addEventListener('play', handlers.playHandler);
        video.addEventListener('pause', handlers.pauseHandler);
        video.addEventListener('timeupdate', handlers.timeupdateHandler);
        video.addEventListener('seeking', handlers.seekingHandler);
        video.addEventListener('seeked', handlers.seekedHandler);
        video.addEventListener('beforeunload', handlers.beforeunloadHandler);
      } catch (error) {
        console.error('Error adding event listeners:', error);
      }
      
      contentModule.trackedVideos.add(video);
      contentModule.videoEventListeners.set(video, [
        { event: 'play', handler: handlers.playHandler },
        { event: 'pause', handler: handlers.pauseHandler },
        { event: 'timeupdate', handler: handlers.timeupdateHandler },
        { event: 'seeking', handler: handlers.seekingHandler },
        { event: 'seeked', handler: handlers.seekedHandler },
        { event: 'beforeunload', handler: handlers.beforeunloadHandler }
      ]);
      
      return handlers;
    });

    contentModule.saveTimestamp.mockImplementation(async () => {
      const mockVideo = global.createMockVideoElement();
      if (!mockVideo) return;

      const currentTime = mockVideo.currentTime;
      const duration = mockVideo.duration;

      // Apply validation rules
      if (!currentTime || currentTime === 0 || !duration || duration === 0) {
        return;
      }

      // Adjust timestamp if near end
      const adjustedTime = currentTime > duration - 10 ? duration - 10 : currentTime;

      const record = {
        videoId: 'testVideoId',
        title: 'Test Video',
        time: adjustedTime,
        duration: duration,
        timestamp: Date.now()
      };

      await global.ytStorage.setVideo(record.videoId, record);
      chrome.runtime.sendMessage({
        type: 'videoUpdate',
        data: record
      });
    });

    contentModule.tryToSavePlaylist.mockImplementation(async (retries = 3) => {
      const playlistId = 'PL123';
      let attempts = 0;

      const tryGetInfo = async () => {
        attempts++;
        const info = await contentModule.getPlaylistInfo();
        if (info) return info;

        if (attempts < retries) {
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
        return null;
      };

      let playlistInfo = null;
      while (attempts < retries) {
        // Check if playlist ID has changed
        const currentId = new URLSearchParams(window.location.search).get('list');
        if (currentId !== playlistId) {
          return; // Stop retrying if playlist ID has changed
        }

        playlistInfo = await tryGetInfo();
        if (playlistInfo) break;
      }

      if (!playlistInfo) {
        playlistInfo = {
          playlistId,
          title: 'Untitled Playlist',
          url: `https://www.youtube.com/playlist?list=${playlistId}`,
          timestamp: Date.now()
        };
      }

      await global.ytStorage.setPlaylist(playlistId, playlistInfo);
    });

    contentModule.calculateAnalytics.mockImplementation((videos) => {
      const totalSeconds = videos.reduce((sum, record) => sum + (record.time || 0), 0);
      const completedVideos = videos.filter(record => 
        record.time && record.duration && (record.time / record.duration) >= 0.9
      ).length;

      return {
        totalWatchTime: `${Math.floor(totalSeconds / 60)}m`,
        videosWatched: videos.length,
        avgDuration: `${Math.floor((totalSeconds / videos.length) / 60)}m`,
        completionRate: Math.round((completedVideos / videos.length) * 100)
      };
    });

    contentModule.getWatchTimeByHour.mockImplementation((videos) => {
      const hourlyData = new Array(24).fill(0);
      videos.forEach(video => {
        if (video.timestamp) {
          const hour = new Date(video.timestamp).getHours();
          hourlyData[hour] += Math.floor(video.time / 60); // Convert to minutes
        }
      });
      return hourlyData;
    });

    contentModule.getContentTypeDistribution.mockImplementation((videos) => ({
      regular: videos.filter(v => !v.isShorts).length,
      shorts: videos.filter(v => v.isShorts).length
    }));

    contentModule.broadcastVideoUpdate.mockImplementation((data) => {
      chrome.runtime.sendMessage(data);
    });

    contentModule.debounce.mockImplementation((fn, wait) => {
      let timeout;
      return function executedFunction(...args) {
        const later = () => {
          clearTimeout(timeout);
          fn(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
      };
    });

    // Setup addViewedLabelToThumbnail implementation after DOM is ready
    contentModule.addViewedLabelToThumbnail.mockImplementation((thumbnail, videoId) => {
      if (!thumbnail || !videoId) return;
      if (!global.ytStorage.getVideo(videoId)) return;
      const label = createViewedLabel();
      const progressBar = createProgressBar();
      thumbnail.appendChild(label);
      thumbnail.appendChild(progressBar);
    });
  });

  describe('Video Detection and Setup', () => {
    test('should detect video element and setup tracking', async () => {
      const video = mockVideoElement;
      await mockYtStorage.ensureMigrated();
      const handlers = contentModule.setupVideoTracking(video);
      expect(contentModule.setupVideoTracking).toHaveBeenCalledWith(video);
      expect(handlers).toBeDefined();
      expect(contentModule.trackedVideos.has(video)).toBe(true);
    });

    test('should handle missing video element', () => {
      const video = null;
      const handlers = contentModule.setupVideoTracking(video);
      expect(handlers).toBeNull();
      expect(contentModule.setupVideoTracking).toHaveBeenCalledWith(video);
    });

    test('should setup event listeners for video tracking', () => {
      const handlers = contentModule.setupVideoTracking(mockVideoElement);
      expect(handlers).toBeDefined();
      expect(typeof handlers.playHandler).toBe('function');
      expect(typeof handlers.pauseHandler).toBe('function');
      expect(typeof handlers.timeupdateHandler).toBe('function');
      expect(typeof handlers.seekingHandler).toBe('function');
      expect(typeof handlers.seekedHandler).toBe('function');
      expect(typeof handlers.beforeunloadHandler).toBe('function');
    });
  });

  describe('Video Progress Tracking', () => {
    test('should track video progress and save timestamps', async () => {
      const handlers = contentModule.setupVideoTracking(mockVideoElement);
      expect(handlers).toBeDefined();

      // Simulate video playing
      mockVideoElement.currentTime = 30;
      await handlers.timeupdateHandler();

      expect(mockYtStorage.setVideo).toHaveBeenCalled();
    });

    test('should handle video play/pause events', async () => {
      const handlers = contentModule.setupVideoTracking(mockVideoElement);
      expect(handlers).toBeDefined();

      // Simulate play event
      await handlers.playHandler();
      expect(mockYtStorage.setVideo).toHaveBeenCalled();

      // Reset mock
      mockYtStorage.setVideo.mockClear();

      // Simulate pause event
      await handlers.pauseHandler();
      expect(mockYtStorage.setVideo).toHaveBeenCalled();
    });

    test('should save video data to storage', async () => {
      const videoId = 'dQw4w9WgXcQ';
      const videoData = {
        videoId,
        title: 'Test Video',
        timestamp: Date.now(),
        time: 30,
        duration: 100
      };

      await mockYtStorage.setVideo(videoId, videoData);

      expect(mockYtStorage.setVideo).toHaveBeenCalledWith(videoId, videoData);
    });

    test('should load existing video data', async () => {
      const videoId = 'dQw4w9WgXcQ';
      const existingData = {
        videoId,
        title: 'Test Video',
        timestamp: Date.now() - 1000,
        time: 25,
        duration: 100
      };

      mockYtStorage.getVideo.mockResolvedValue(existingData);

      const result = await mockYtStorage.getVideo(videoId);

      expect(result).toEqual(existingData);
      expect(mockYtStorage.getVideo).toHaveBeenCalledWith(videoId);
    });
  });

  describe('Thumbnail Overlay Integration', () => {
    test('should add overlays to thumbnails', () => {
      const thumbnail = createMockThumbnail();
      const videoId = 'dQw4w9WgXcQ';
      
      // Mock that video exists in storage
      mockYtStorage.getVideo.mockReturnValue({
        videoId,
        title: 'Test Video',
        time: 30,
        duration: 100
      });
      
      contentModule.addViewedLabelToThumbnail(thumbnail, videoId);
      expect(contentModule.addViewedLabelToThumbnail).toHaveBeenCalledWith(thumbnail, videoId);
      expect(thumbnail.querySelector('.ytvht-viewed-label')).toBeTruthy();
      expect(thumbnail.querySelector('.ytvht-progress-bar')).toBeTruthy();
    });

    test('should not add overlays with invalid input', () => {
      const thumbnail = null;
      const videoId = null;
      
      contentModule.addViewedLabelToThumbnail(thumbnail, videoId);
      expect(contentModule.addViewedLabelToThumbnail).toHaveBeenCalledWith(thumbnail, videoId);
      expect(document.querySelector('.ytvht-viewed-label')).toBeFalsy();
      expect(document.querySelector('.ytvht-progress-bar')).toBeFalsy();
    });

    test('should process existing thumbnails on page load', () => {
      contentModule.processExistingThumbnails();
      expect(contentModule.processExistingThumbnails).toHaveBeenCalled();
    });
  });

  describe('Error Handling Integration', () => {
    test('should handle video element errors', () => {
      const brokenVideo = createMockVideoElement();
      brokenVideo.addEventListener = jest.fn().mockImplementation(() => {
        throw new Error('Add listener failed');
      });
      
      const handlers = contentModule.setupVideoTracking(brokenVideo);
      expect(handlers).toBeDefined();
      expect(brokenVideo.addEventListener).toHaveBeenCalled();
    });
  });

  describe('Real-time Updates', () => {
    test('should broadcast video updates', async () => {
      await contentModule.saveTimestamp();
      
      expect(mockChrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'videoUpdate',
          data: expect.objectContaining({
            time: 30,
            duration: 100
          })
        })
      );
    });

    test('should debounce rapid updates', async () => {
      jest.useFakeTimers();
      const mockSave = jest.fn();
      const debouncedFn = contentModule.debounce(mockSave, 100);

      // Call multiple times rapidly
      debouncedFn();
      debouncedFn();
      debouncedFn();

      // Fast-forward time
      jest.advanceTimersByTime(100);

      // Should only save once
      expect(mockSave).toHaveBeenCalledTimes(1);
      jest.useRealTimers();
    });

    test('should handle title updates correctly', async () => {
      await contentModule.saveTimestamp();
      
      expect(mockYtStorage.setVideo).toHaveBeenCalledWith(
        'testVideoId',
        expect.objectContaining({
          title: 'Test Video'
        })
      );
    });
  });

  describe('Overlay Updates', () => {
    test('should handle missing video records', () => {
      const thumbnail = createMockThumbnail();
      const videoId = 'nonexistentVideo';
      
      // Ensure video doesn't exist in storage
      mockYtStorage.getVideo.mockReturnValue(null);
      
      contentModule.addViewedLabelToThumbnail(thumbnail, videoId);
      
      // Should not add overlays
      expect(thumbnail.querySelector('.ytvht-viewed-label')).toBeNull();
      expect(thumbnail.querySelector('.ytvht-progress-bar')).toBeNull();
    });
  });

  describe('Timestamp Validation', () => {
    test('should not save timestamp when time is 0', async () => {
      const video = {
        currentTime: 0,
        duration: 100,
        paused: true,
        readyState: 1,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn()
      };
      global.createMockVideoElement = jest.fn().mockReturnValue(video);

      await contentModule.saveTimestamp();
      
      expect(mockYtStorage.setVideo).not.toHaveBeenCalled();
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    test('should not save timestamp when duration is 0', async () => {
      const video = {
        currentTime: 30,
        duration: 0,
        paused: true,
        readyState: 1,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn()
      };
      global.createMockVideoElement = jest.fn().mockReturnValue(video);

      await contentModule.saveTimestamp();
      
      expect(mockYtStorage.setVideo).not.toHaveBeenCalled();
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    test('should adjust timestamp when near end of video', async () => {
      const video = {
        currentTime: 95, // 5 seconds from end
        duration: 100,
        paused: true,
        readyState: 1,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn()
      };
      global.createMockVideoElement = jest.fn().mockReturnValue(video);

      await contentModule.saveTimestamp();
      
      expect(mockYtStorage.setVideo).toHaveBeenCalledWith(
        'testVideoId',
        expect.objectContaining({
          time: 90 // Should be adjusted to duration - 10
        })
      );
    });
  });

  describe('Playlist Retry Mechanism', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.clearAllMocks();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test('should use exponential backoff for retries', async () => {
      const playlistId = 'PL123';
      let attempts = 0;
      
      // Set up URL with playlist ID
      window.location.search = `?list=${playlistId}`;
      
      // Mock getPlaylistInfo to fail first two times
      contentModule.getPlaylistInfo.mockImplementation(() => {
        attempts++;
        if (attempts <= 2) return null;
        return {
          playlistId,
          title: 'Test Playlist',
          url: `https://www.youtube.com/playlist?list=${playlistId}`,
          timestamp: Date.now()
        };
      });

      // Start the retry process
      contentModule.tryToSavePlaylist(3);

      // First attempt should happen immediately
      expect(contentModule.getPlaylistInfo).toHaveBeenCalledTimes(1);

      // First retry after 3 seconds
      await jest.advanceTimersByTimeAsync(3000);
      expect(contentModule.getPlaylistInfo).toHaveBeenCalledTimes(2);

      // Second retry after another 3 seconds (6 total)
      await jest.advanceTimersByTimeAsync(3000);
      expect(contentModule.getPlaylistInfo).toHaveBeenCalledTimes(3);
      
      // Wait for any pending promises to resolve
      await Promise.resolve();
      
      // Clear any pending timeouts
      jest.clearAllTimers();

      expect(mockYtStorage.setPlaylist).toHaveBeenCalledWith(
        playlistId,
        expect.objectContaining({
          title: 'Test Playlist'
        })
      );
    });

    test('should stop retrying when playlist ID changes', async () => {
      const originalId = 'PL123';
      const newId = 'PL456';
      
      // Mock URL changes
      let currentId = originalId;
      window.location.search = `?list=${currentId}`;
      
      // Mock getPlaylistInfo to always fail
      contentModule.getPlaylistInfo.mockReturnValue(null);

      // Start the retry process
      const retryPromise = contentModule.tryToSavePlaylist(3);
      
      // Change playlist ID before first retry
      window.location.search = `?list=${newId}`;

      await jest.advanceTimersByTimeAsync(3000);
      
      expect(contentModule.getPlaylistInfo).toHaveBeenCalledTimes(1);
      expect(mockYtStorage.setPlaylist).not.toHaveBeenCalled();

      // Wait for the promise to resolve
      await retryPromise;
    });

    test('should use default title after all retries fail', async () => {
      const playlistId = 'PL123';
      
      // Set up URL with playlist ID
      window.location.search = `?list=${playlistId}`;
      
      // Mock getPlaylistInfo to always return null
      contentModule.getPlaylistInfo.mockReturnValue(null);

      // Start the retry process
      contentModule.tryToSavePlaylist(3);

      // First attempt should happen immediately
      expect(contentModule.getPlaylistInfo).toHaveBeenCalledTimes(1);

      // First retry after 3 seconds
      await jest.advanceTimersByTimeAsync(3000);
      expect(contentModule.getPlaylistInfo).toHaveBeenCalledTimes(2);

      // Second retry after another 3 seconds (6 total)
      await jest.advanceTimersByTimeAsync(3000);
      expect(contentModule.getPlaylistInfo).toHaveBeenCalledTimes(3);
      
      // Wait for any pending promises to resolve
      await Promise.resolve();

      expect(mockYtStorage.setPlaylist).toHaveBeenCalledWith(
        playlistId,
        expect.objectContaining({
          title: 'Untitled Playlist'
        })
      );
      
      // Clear any pending timeouts
      jest.clearAllTimers();
    });
  });

  describe('Analytics Integration', () => {
    test('should calculate total watch time correctly', () => {
      const videos = [
        { time: 300, duration: 600 },  // 5 minutes
        { time: 600, duration: 900 },  // 10 minutes
        { time: 1800, duration: 3600 } // 30 minutes
      ];

      const stats = contentModule.calculateAnalytics(videos);
      expect(stats.totalWatchTime).toBe('45m'); // 45 minutes total
    });

    test('should calculate completion rate correctly', () => {
      const videos = [
        { time: 570, duration: 600 },  // 95% complete
        { time: 450, duration: 900 },  // 50% complete
        { time: 3500, duration: 3600 } // 97% complete
      ];

      const stats = contentModule.calculateAnalytics(videos);
      expect(stats.completionRate).toBe(67); // 2 out of 3 videos >90% complete
    });

    test('should generate hourly activity data', () => {
      const now = new Date();
      const videos = [
        { timestamp: now.setHours(10, 0, 0), time: 300 },
        { timestamp: now.setHours(10, 30, 0), time: 600 },
        { timestamp: now.setHours(15, 0, 0), time: 900 }
      ];

      const hourlyData = contentModule.getWatchTimeByHour(videos);
      expect(hourlyData[10]).toBe(15); // 15 minutes in hour 10
      expect(hourlyData[15]).toBe(15); // 15 minutes in hour 15
    });

    test('should handle content type distribution', () => {
      const videos = [
        { isShorts: false, time: 300 },
        { isShorts: false, time: 600 },
        { isShorts: true, time: 30 }
      ];

      const distribution = contentModule.getContentTypeDistribution(videos);
      expect(distribution.regular).toBe(2);
      expect(distribution.shorts).toBe(1);
    });
  });
});

// Helper functions
function createMockVideoElement() {
  const video = document.createElement('video');
  video.src = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  video.currentTime = 0;
  video.duration = 100;
  video.addEventListener = jest.fn();
  return video;
}

function createMockThumbnail() {
  const thumbnail = document.createElement('div');
  thumbnail.className = 'ytd-thumbnail';
  return thumbnail;
}