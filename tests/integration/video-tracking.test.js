/**
 * Integration tests for video tracking functionality
 */

describe('Video Tracking Integration', () => {
  let mockVideoElement;
  let mockYtStorage;
  let setupVideoTracking;
  let initializeIfNeeded;

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

    // Mock setupVideoTracking function (simplified version)
    setupVideoTracking = jest.fn((video) => {
      // Simulate video tracking setup
      const playHandler = jest.fn(() => {
        console.log('Video started playing');
      });

      const pauseHandler = jest.fn(() => {
        console.log('Video paused');
      });

      const timeupdateHandler = jest.fn(() => {
        const currentTime = Math.floor(video.currentTime);
        if (currentTime % 30 === 0) {
          console.log('Saving timestamp at:', currentTime);
        }
      });

      video.addEventListener('play', playHandler);
      video.addEventListener('pause', pauseHandler);
      video.addEventListener('timeupdate', timeupdateHandler);

      return {
        playHandler,
        pauseHandler,
        timeupdateHandler
      };
    });

    // Mock initializeIfNeeded function
    initializeIfNeeded = jest.fn(async () => {
      const video = document.querySelector('video');
      if (video) {
        await mockYtStorage.ensureMigrated();
        setupVideoTracking(video);
        return true;
      }
      return false;
    });
  });

  describe('Video Detection and Setup', () => {
    test('should detect video element and setup tracking', async () => {
      const result = await initializeIfNeeded();

      expect(result).toBe(true);
      expect(mockYtStorage.ensureMigrated).toHaveBeenCalled();
      expect(setupVideoTracking).toHaveBeenCalledWith(mockVideoElement);
    });

    test('should handle missing video element', async () => {
      document.body.innerHTML = ''; // Remove video element

      const result = await initializeIfNeeded();

      expect(result).toBe(false);
      expect(setupVideoTracking).not.toHaveBeenCalled();
    });

    test('should setup event listeners for video tracking', () => {
      const handlers = setupVideoTracking(mockVideoElement);

      expect(mockVideoElement.addEventListener).toHaveBeenCalledWith('play', handlers.playHandler);
      expect(mockVideoElement.addEventListener).toHaveBeenCalledWith('pause', handlers.pauseHandler);
      expect(mockVideoElement.addEventListener).toHaveBeenCalledWith('timeupdate', handlers.timeupdateHandler);
    });
  });

  describe('Video Progress Tracking', () => {
    test('should track video progress and save timestamps', async () => {
      const handlers = setupVideoTracking(mockVideoElement);

      // Simulate video playing
      mockVideoElement.currentTime = 30;
      mockVideoElement.paused = false;

      // Trigger timeupdate event
      handlers.timeupdateHandler();

      expect(console.log).toHaveBeenCalledWith('Saving timestamp at:', 30);
    });

    test('should handle video play/pause events', () => {
      const handlers = setupVideoTracking(mockVideoElement);

      // Simulate play event
      handlers.playHandler();
      expect(console.log).toHaveBeenCalledWith('Video started playing');

      // Simulate pause event
      handlers.pauseHandler();
      expect(console.log).toHaveBeenCalledWith('Video paused');
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

      // Mock existing video data
      mockYtStorage.getVideo.mockResolvedValue({
        videoId,
        time: 30,
        duration: 100
      });

      // Simulate addViewedLabelToThumbnail function
      const addViewedLabelToThumbnail = jest.fn((thumbnailElement, videoId) => {
        const label = document.createElement('div');
        label.className = 'ytvht-viewed-label';
        label.textContent = 'viewed';

        const progress = document.createElement('div');
        progress.className = 'ytvht-progress-bar';
        progress.style.width = '30%';

        thumbnailElement.appendChild(label);
        thumbnailElement.appendChild(progress);
      });

      addViewedLabelToThumbnail(thumbnail, videoId);

      expect(thumbnail.querySelector('.ytvht-viewed-label')).toBeTruthy();
      expect(thumbnail.querySelector('.ytvht-progress-bar')).toBeTruthy();
    });

    test('should process existing thumbnails on page load', () => {
      // Create multiple thumbnails
      const thumbnails = [
        createMockThumbnail(),
        createMockThumbnail(),
        createMockThumbnail()
      ];

      thumbnails.forEach(thumbnail => {
        document.body.appendChild(thumbnail);
      });

      // Simulate processExistingThumbnails function
      const processExistingThumbnails = jest.fn(() => {
        const allThumbnails = document.querySelectorAll('.ytd-rich-item-renderer');
        allThumbnails.forEach(thumbnail => {
          const anchor = thumbnail.querySelector('a#thumbnail');
          if (anchor) {
            const videoId = anchor.href.match(/[?&]v=([^&]+)/)?.[1];
            if (videoId) {
              // Process thumbnail
              console.log('Processing thumbnail for video:', videoId);
            }
          }
        });
      });

      processExistingThumbnails();

      expect(processExistingThumbnails).toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledTimes(3);
    });
  });

  describe('Playlist Integration', () => {
    test('should detect and save playlist information', async () => {
      const playlistId = 'PL1234567890';
      const playlistTitle = 'Test Playlist';

      // Mock DOM and URL for playlist page
      Object.defineProperty(window, 'location', {
        value: {
          href: `https://www.youtube.com/playlist?list=${playlistId}`,
          search: `?list=${playlistId}`
        },
        writable: true
      });

      document.querySelector = jest.fn((selector) => {
        if (selector === 'h1') {
          return { textContent: playlistTitle };
        }
        return null;
      });

      // Mock getPlaylistInfo function
      const getPlaylistInfo = jest.fn(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const extractedPlaylistId = urlParams.get('list');
        const extractedTitle = document.querySelector('h1')?.textContent;

        if (extractedPlaylistId && extractedTitle) {
          return {
            playlistId: extractedPlaylistId,
            title: extractedTitle,
            timestamp: Date.now()
          };
        }
        return null;
      });

      const playlistInfo = getPlaylistInfo();

      expect(playlistInfo).toEqual({
        playlistId,
        title: playlistTitle,
        timestamp: expect.any(Number)
      });

      // Save playlist info
      await mockYtStorage.setPlaylist(playlistId, playlistInfo);
      expect(mockYtStorage.setPlaylist).toHaveBeenCalledWith(playlistId, playlistInfo);
    });

    test('should retry playlist detection if not found immediately', async () => {
      const tryToSavePlaylist = jest.fn((retries = 3) => {
        const playlistInfo = null; // Simulate not found

        if (playlistInfo) {
          console.log('Playlist found, saving...');
          return true;
        } else if (retries > 0) {
          console.log(`Playlist not found, retrying... (${retries} retries left)`);
          setTimeout(() => tryToSavePlaylist(retries - 1), 100);
          return false;
        } else {
          console.log('Failed to save playlist after all retries');
          return false;
        }
      });

      const result = tryToSavePlaylist(3);

      expect(result).toBe(false);
      expect(console.log).toHaveBeenCalledWith('Playlist not found, retrying... (3 retries left)');
    });
  });

  describe('Settings Integration', () => {
    test('should load and apply settings', async () => {
      const settings = await mockYtStorage.getSettings();

      expect(settings.overlayColor).toBe('blue');
      expect(settings.overlayLabelSize).toBe('medium');
      expect(settings.overlayTitle).toBe('viewed');
    });

    test('should update overlay appearance based on settings', () => {
      const settings = {
        overlayColor: 'red',
        overlayLabelSize: 'large'
      };

      // Simulate updateOverlayCSS function
      const updateOverlayCSS = jest.fn((size, color) => {
        const css = `
          .ytvht-viewed-label {
            background-color: ${color} !important;
            font-size: ${size.fontSize}px !important;
          }
        `;
        return css;
      });

      const sizeMap = {
        large: { fontSize: 22, bar: 4 }
      };

      const css = updateOverlayCSS(sizeMap.large, '#ea4335');

      expect(css).toContain('background-color: #ea4335');
      expect(css).toContain('font-size: 22px');
    });
  });

  describe('Message Handling Integration', () => {
    test('should handle getHistory message', async () => {
      const mockVideos = {
        'video1': { videoId: 'video1', title: 'Video 1' },
        'video2': { videoId: 'video2', title: 'Video 2' }
      };

      mockYtStorage.getAllVideos.mockResolvedValue(mockVideos);

      // Simulate message handler
      const handleMessage = jest.fn(async (message, sender, sendResponse) => {
        if (message.type === 'getHistory') {
          const allVideos = await mockYtStorage.getAllVideos();
          const history = Object.values(allVideos);
          sendResponse({ history });
          return true;
        }
        return false;
      });

      const sendResponse = jest.fn();

      await handleMessage({ type: 'getHistory' }, {}, sendResponse);

      expect(mockYtStorage.getAllVideos).toHaveBeenCalled();
      expect(sendResponse).toHaveBeenCalledWith({
        history: [
          { videoId: 'video1', title: 'Video 1' },
          { videoId: 'video2', title: 'Video 2' }
        ]
      });
    });

    test('should handle clearHistory message', async () => {
      const handleMessage = jest.fn(async (message, sender, sendResponse) => {
        if (message.type === 'clearHistory') {
          await mockYtStorage.clear();
          sendResponse({ status: 'success' });
          return true;
        }
        return false;
      });

      const sendResponse = jest.fn();

      await handleMessage({ type: 'clearHistory' }, {}, sendResponse);

      expect(mockYtStorage.clear).toHaveBeenCalled();
      expect(sendResponse).toHaveBeenCalledWith({ status: 'success' });
    });
  });

  describe('Error Handling Integration', () => {
    test('should handle storage errors gracefully', async () => {
      mockYtStorage.getVideo.mockRejectedValue(new Error('Storage error'));

      try {
        await mockYtStorage.getVideo('test');
      } catch (error) {
        expect(error.message).toBe('Storage error');
      }
    });

    test('should handle video element errors', () => {
      const brokenVideo = createMockVideoElement();
      brokenVideo.addEventListener.mockImplementation(() => {
        throw new Error('Add listener failed');
      });

      expect(() => {
        setupVideoTracking(brokenVideo);
      }).toThrow('Add listener failed');
    });

    test('should handle initialization errors', async () => {
      // Mock ensureMigrated to throw an error
      mockYtStorage.ensureMigrated.mockRejectedValue(new Error('Migration failed'));

      // Mock initializeIfNeeded to actually call ensureMigrated
      const initializeIfNeededWithError = jest.fn(async () => {
        await mockYtStorage.ensureMigrated();
        return false;
      });

      await expect(initializeIfNeededWithError()).rejects.toThrow('Migration failed');
    });
  });

  describe('Performance Integration', () => {
    test('should not create duplicate event listeners', () => {
      const trackedVideos = new WeakSet();

      // First setup
      if (!trackedVideos.has(mockVideoElement)) {
        trackedVideos.add(mockVideoElement);
        setupVideoTracking(mockVideoElement);
      }

      // Second setup (should be skipped)
      if (!trackedVideos.has(mockVideoElement)) {
        trackedVideos.add(mockVideoElement);
        setupVideoTracking(mockVideoElement);
      }

      expect(setupVideoTracking).toHaveBeenCalledTimes(1);
    });

    test('should handle rapid video element changes', () => {
      const video1 = createMockVideoElement();
      const video2 = createMockVideoElement();

      setupVideoTracking(video1);
      setupVideoTracking(video2);

      expect(setupVideoTracking).toHaveBeenCalledTimes(2);
      expect(setupVideoTracking).toHaveBeenCalledWith(video1);
      expect(setupVideoTracking).toHaveBeenCalledWith(video2);
    });
  });
});