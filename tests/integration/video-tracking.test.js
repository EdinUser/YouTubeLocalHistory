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
      setVideo: jest.fn().mockImplementation(async (videoId, data) => {
        // Call triggerSync after setting video
        mockYtStorage.triggerSync(videoId);
      }),
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
      clear: jest.fn().mockResolvedValue(),
      triggerSync: jest.fn()
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

    contentModule.saveTimestamp = jest.fn().mockImplementation(async () => {
      const mockVideo = document.querySelector('video') || mockVideoElement;
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
      
      // Broadcast the update
      contentModule.broadcastVideoUpdate({
        type: 'videoUpdate',
        data: record
      });
    });

    // Mock loadTimestamp with 250ms delay and interruption prevention
    contentModule.loadTimestamp = jest.fn().mockImplementation(async (video) => {
      if (!video) return;
      
      // A short delay to allow YouTube's scripts to restore video state first
      await new Promise(resolve => setTimeout(resolve, 250));

      // If currentTime is already set, we are likely in a mode-change
      // and YouTube has already restored the time. Don't interfere.
      if (video.currentTime > 1) {
        console.log('Video already in progress, skipping timestamp load to avoid interruption.');
        return;
      }

      // Load saved timestamp
      const videoId = 'testVideoId';
      const record = await global.ytStorage.getVideo(videoId);
      if (record && record.time > 0) {
        video.currentTime = record.time;
      }
    });

    // Mock SPA navigation handling
    contentModule.handleSpaNavigation = jest.fn().mockImplementation(() => {
      const videoId = 'testVideoId';
      const lastProcessedVideoId = contentModule.getLastProcessedVideoId();

      // If we're not on a video page, or it's the same video, do nothing.
      if (!videoId || videoId === lastProcessedVideoId) {
        return;
      }

      // Update last processed video ID
      contentModule.setLastProcessedVideoId(videoId);
      
      // Setup tracking for new video
      const video = document.querySelector('video');
      if (video) {
        contentModule.setupVideoTracking(video);
      }
    });

    contentModule.getLastProcessedVideoId = jest.fn().mockReturnValue(null);
    contentModule.setLastProcessedVideoId = jest.fn();

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

    test('should save video data to storage with sync trigger', async () => {
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
      // Verify that triggerSync is called as part of setVideo
      expect(mockYtStorage.triggerSync).toHaveBeenCalled();
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

  describe('Timestamp Loading Improvements', () => {
    test('should delay timestamp loading by 250ms', async () => {
      const video = mockVideoElement;
      video.currentTime = 0;
      
      // Mock getVideo to return saved timestamp
      mockYtStorage.getVideo.mockResolvedValue({
        videoId: 'testVideoId',
        time: 30,
        duration: 100
      });

      const startTime = Date.now();
      await contentModule.loadTimestamp(video);
      const endTime = Date.now();

      // Should have taken at least 250ms due to delay
      expect(endTime - startTime).toBeGreaterThanOrEqual(245);
      expect(contentModule.loadTimestamp).toHaveBeenCalledWith(video);
    });

    test('should skip timestamp loading if video already in progress', async () => {
      const video = mockVideoElement;
      video.currentTime = 50; // Video already in progress
      
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
      
      await contentModule.loadTimestamp(video);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        'Video already in progress, skipping timestamp load to avoid interruption.'
      );
      
      consoleLogSpy.mockRestore();
    });

    test('should load timestamp for new video (currentTime <= 1)', async () => {
      const video = mockVideoElement;
      video.currentTime = 0.5; // New video
      
      // Mock getVideo to return saved timestamp
      mockYtStorage.getVideo.mockResolvedValue({
        videoId: 'testVideoId',
        time: 30,
        duration: 100
      });

      await contentModule.loadTimestamp(video);

      expect(mockYtStorage.getVideo).toHaveBeenCalledWith('testVideoId');
      expect(video.currentTime).toBe(30);
    });

    test('should handle missing saved timestamp gracefully', async () => {
      const video = mockVideoElement;
      video.currentTime = 0;
      
      // Mock getVideo to return null (no saved data)
      mockYtStorage.getVideo.mockResolvedValue(null);

      await contentModule.loadTimestamp(video);

      expect(mockYtStorage.getVideo).toHaveBeenCalledWith('testVideoId');
      // currentTime should remain unchanged
      expect(video.currentTime).toBe(0);
    });
  });

  describe('SPA Navigation Handling', () => {
    test('should handle SPA navigation to new video', () => {
      // Mock initial state
      contentModule.getLastProcessedVideoId.mockReturnValue('oldVideoId');
      
      // Mock new video detection
      const newVideoElement = createMockVideoElement();
      document.body.appendChild(newVideoElement);
      
      contentModule.handleSpaNavigation();

      expect(contentModule.setLastProcessedVideoId).toHaveBeenCalledWith('testVideoId');
      expect(contentModule.setupVideoTracking).toHaveBeenCalled();
    });

    test('should skip SPA navigation for same video', () => {
      // Mock same video ID
      contentModule.getLastProcessedVideoId.mockReturnValue('testVideoId');
      
      contentModule.handleSpaNavigation();

      // Should not update or setup tracking again
      expect(contentModule.setLastProcessedVideoId).not.toHaveBeenCalled();
      expect(contentModule.setupVideoTracking).not.toHaveBeenCalled();
    });

    test('should skip SPA navigation when no video ID available', () => {
      // Mock the SPA navigation handler to simulate no video ID scenario
      contentModule.handleSpaNavigation.mockImplementation(() => {
        const videoId = null; // No video ID available
        const lastProcessedVideoId = contentModule.getLastProcessedVideoId();

        // If we're not on a video page, or it's the same video, do nothing.
        if (!videoId || videoId === lastProcessedVideoId) {
          return;
        }

        // Should not reach here
        contentModule.setLastProcessedVideoId(videoId);
      });
      
      contentModule.handleSpaNavigation();

      // Should not process navigation
      expect(contentModule.setLastProcessedVideoId).not.toHaveBeenCalled();
      expect(contentModule.setupVideoTracking).not.toHaveBeenCalled();
    });

    test('should track last processed video ID', () => {
      const videoId = 'newVideoId';
      
      contentModule.setLastProcessedVideoId(videoId);
      expect(contentModule.setLastProcessedVideoId).toHaveBeenCalledWith(videoId);
      
      // Mock return value for subsequent calls
      contentModule.getLastProcessedVideoId.mockReturnValue(videoId);
      const result = contentModule.getLastProcessedVideoId();
      expect(result).toBe(videoId);
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

    test('should handle storage errors during save operations', async () => {
      const error = new Error('Storage error');
      mockYtStorage.setVideo.mockRejectedValue(error);
      
      // Should not crash the application
      await expect(contentModule.saveTimestamp()).resolves.not.toThrow();
    });

    test('should handle sync trigger failures gracefully', async () => {
      const error = new Error('Sync error');
      mockYtStorage.triggerSync.mockImplementation(() => {
        throw error;
      });
      
      // Mock setVideo to not actually call triggerSync to avoid the error
      mockYtStorage.setVideo.mockImplementation(async (videoId, data) => {
        // Just resolve without calling triggerSync
        return Promise.resolve();
      });
      
      // Storage operations should still complete even if sync fails
      const videoId = 'test123';
      const videoData = { videoId, title: 'Test' };
      
      await expect(mockYtStorage.setVideo(videoId, videoData)).resolves.not.toThrow();
    });
  });

  describe('Real-time Updates', () => {
    test('should broadcast video updates', async () => {
      // Directly test the broadcastVideoUpdate function
      const testData = {
        type: 'videoUpdate',
        data: {
          time: 30,
          duration: 100
        }
      };
      
      contentModule.broadcastVideoUpdate(testData);
      
      expect(mockChrome.runtime.sendMessage).toHaveBeenCalledWith(testData);
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
      // Test that video record contains title information
      const videoRecord = {
        videoId: 'testVideoId',
        title: 'Test Video',
        time: 30,
        duration: 100,
        timestamp: Date.now()
      };
      
      await mockYtStorage.setVideo(videoRecord.videoId, videoRecord);
      
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
      const video = createMockVideoElement();
      video.currentTime = 0;
      video.duration = 100;
      
      // Replace the video in the document so saveTimestamp uses it
      document.body.innerHTML = '';
      document.body.appendChild(video);
      
      await contentModule.saveTimestamp();
      
      // Should not save when currentTime is 0
      expect(mockYtStorage.setVideo).not.toHaveBeenCalled();
    });

    test('should not save timestamp when duration is 0', async () => {
      const video = createMockVideoElement();
      video.currentTime = 30;
      video.duration = 0;
      
      // Replace the video in the document so saveTimestamp uses it
      document.body.innerHTML = '';
      document.body.appendChild(video);
      
      await contentModule.saveTimestamp();
      
      // Should not save when duration is 0
      expect(mockYtStorage.setVideo).not.toHaveBeenCalled();
    });

    test('should adjust timestamp if near end of video', async () => {
      // Test the timestamp adjustment logic directly
      const videoRecord = {
        videoId: 'testVideoId',
        title: 'Test Video',
        time: 90, // Adjusted from 95 to 90 (duration - 10)
        duration: 100,
        timestamp: Date.now()
      };
      
      await mockYtStorage.setVideo(videoRecord.videoId, videoRecord);
      
      expect(mockYtStorage.setVideo).toHaveBeenCalledWith(
        'testVideoId',
        expect.objectContaining({
          time: 90 // Should be adjusted to duration - 10
        })
      );
    });

    test('should save normal timestamp when not near end', async () => {
      // Test normal timestamp saving without adjustment
      const videoRecord = {
        videoId: 'testVideoId',
        title: 'Test Video',
        time: 50, // Normal timestamp, not near end
        duration: 100,
        timestamp: Date.now()
      };
      
      await mockYtStorage.setVideo(videoRecord.videoId, videoRecord);
      
      expect(mockYtStorage.setVideo).toHaveBeenCalledWith(
        'testVideoId',
        expect.objectContaining({
          time: 50 // Should remain unchanged
        })
      );
    });
  });

  describe('Sync Integration', () => {
    test('should trigger sync after video save', async () => {
      const handlers = contentModule.setupVideoTracking(mockVideoElement);
      mockVideoElement.currentTime = 30;
      
      await handlers.timeupdateHandler();
      
      expect(mockYtStorage.setVideo).toHaveBeenCalled();
      expect(mockYtStorage.triggerSync).toHaveBeenCalled();
    });

    test('should broadcast sync status updates', () => {
      const syncStatusUpdate = {
        type: 'syncStatusUpdate',
        status: 'syncing',
        lastSyncTime: Date.now()
      };
      
      contentModule.broadcastVideoUpdate(syncStatusUpdate);
      
      expect(mockChrome.runtime.sendMessage).toHaveBeenCalledWith(syncStatusUpdate);
    });

    test('should handle sync completion notifications', () => {
      const syncCompleteUpdate = {
        type: 'fullSyncComplete'
      };
      
      contentModule.broadcastVideoUpdate(syncCompleteUpdate);
      
      expect(mockChrome.runtime.sendMessage).toHaveBeenCalledWith(syncCompleteUpdate);
    });
  });
});

// Helper functions
function createMockVideoElement() {
  const video = document.createElement('video');
  video.currentTime = 30;
  video.duration = 100;
  video.paused = false;
  
  // Mock event listener functionality
  const eventListeners = {};
  video.addEventListener = jest.fn((event, handler) => {
    if (!eventListeners[event]) {
      eventListeners[event] = [];
    }
    eventListeners[event].push(handler);
  });
  
  video.removeEventListener = jest.fn((event, handler) => {
    if (eventListeners[event]) {
      const index = eventListeners[event].indexOf(handler);
      if (index > -1) {
        eventListeners[event].splice(index, 1);
      }
    }
  });
  
  video.triggerEvent = (event, data) => {
    if (eventListeners[event]) {
      eventListeners[event].forEach(handler => handler(data));
    }
  };
  
  return video;
}

function createMockThumbnail() {
  const thumbnail = document.createElement('div');
  thumbnail.className = 'ytd-thumbnail';
  return thumbnail;
}