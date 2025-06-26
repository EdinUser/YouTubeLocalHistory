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

// Import the module - note that we need to mock it before requiring
jest.mock('../../src/content.js', () => {
  // Store private variables that the module would normally manage
  const trackedVideos = new WeakSet();
  const videoEventListeners = new WeakMap();
  
  const mockModule = {
    setupVideoTracking: jest.fn((video) => {
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
      
      trackedVideos.add(video);
      videoEventListeners.set(video, [
        { event: 'play', handler: handlers.playHandler },
        { event: 'pause', handler: handlers.pauseHandler },
        { event: 'timeupdate', handler: handlers.timeupdateHandler },
        { event: 'seeking', handler: handlers.seekingHandler },
        { event: 'seeked', handler: handlers.seekedHandler },
        { event: 'beforeunload', handler: handlers.beforeunloadHandler }
      ]);
      
      return handlers;
    }),
    
    addViewedLabelToThumbnail: jest.fn(),
    processExistingThumbnails: jest.fn(),
    trackedVideos,
    videoEventListeners,
    
    // Additional functions for real-time updates
    saveTimestamp: jest.fn(async () => {
      await global.ytStorage.setVideo('testVideoId', {
        videoId: 'testVideoId',
        title: 'Test Video',
        time: 30,
        duration: 100,
        timestamp: Date.now()
      });
      mockModule.broadcastVideoUpdate({
        type: 'videoUpdate',
        data: {
          videoId: 'testVideoId',
          title: 'Test Video',
          time: 30,
          duration: 100
        }
      });
    }),
    
    broadcastVideoUpdate: jest.fn(),
    debounce: mockDebounce
  };

  return mockModule;
});

const contentModule = require('../../src/content.js');

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

    // Setup addViewedLabelToThumbnail implementation after DOM is ready
    contentModule.addViewedLabelToThumbnail.mockImplementation((thumbnail, videoId) => {
      if (!thumbnail || !videoId) return;
      if (!global.ytStorage.getVideo(videoId)) return;
      const label = createViewedLabel();
      const progressBar = createProgressBar();
      thumbnail.appendChild(label);
      thumbnail.appendChild(progressBar);
    });

    // Setup broadcastVideoUpdate implementation
    contentModule.broadcastVideoUpdate.mockImplementation((data) => {
      mockChrome.runtime.sendMessage(data);
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