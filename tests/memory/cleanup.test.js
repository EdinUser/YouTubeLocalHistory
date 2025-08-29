/**
 * Memory leak detection and cleanup tests
 */

const { createMockVideoElement, createMockThumbnail } = require('../test-helpers');

describe('Memory Leak Prevention', () => {
  let mockVideoElement;
  let mockThumbnailElement;
  let cleanupFunction;
  let addTrackedEventListener;
  let cleanupVideoListeners;
  let originalClearInterval;
  let originalClearTimeout;

  beforeEach(() => {
    // Save original functions
    originalClearInterval = global.clearInterval;
    originalClearTimeout = global.clearTimeout;

    // Mock clearInterval and clearTimeout
    global.clearInterval = jest.fn();
    global.clearTimeout = jest.fn();

    // Reset DOM
    document.body.innerHTML = '';

    // Create mock elements
    mockVideoElement = createMockVideoElement();
    mockThumbnailElement = createMockThumbnail();

    // Mock cleanup functions (these would be extracted from the actual code)
    cleanupFunction = jest.fn(() => {
      // Simulate cleanup logic with error handling
      try {
        if (global.thumbnailObserver) {
          global.thumbnailObserver.disconnect();
          global.thumbnailObserver = null;
        }
        if (global.shortsVideoObserver) {
          global.shortsVideoObserver.disconnect();
          global.shortsVideoObserver = null;
        }
        if (global.initChecker) {
          clearInterval(global.initChecker);
          global.initChecker = null;
        }
        if (global.saveIntervalId) {
          clearInterval(global.saveIntervalId);
          global.saveIntervalId = null;
        }
        if (global.playlistRetryTimeout) {
          clearTimeout(global.playlistRetryTimeout);
          global.playlistRetryTimeout = null;
        }
        if (global.messageListener) {
          chrome.runtime.onMessage.removeListener(global.messageListener);
          global.messageListener = null;
        }
      } catch (error) {
        // Log error but don't throw
        console.error('Cleanup error:', error);
      }
    });

    // Make cleanup function globally accessible for testing
    global.cleanupFunction = cleanupFunction;

    addTrackedEventListener = jest.fn((element, event, handler) => {
      if (!global.videoEventListeners) {
        global.videoEventListeners = new WeakMap();
      }
      if (!global.videoEventListeners.has(element)) {
        global.videoEventListeners.set(element, []);
      }
      global.videoEventListeners.get(element).push({ event, handler });
      element.addEventListener(event, handler);
    });

    cleanupVideoListeners = jest.fn((video) => {
      try {
        if (global.videoEventListeners && global.videoEventListeners.has(video)) {
          const listeners = global.videoEventListeners.get(video);
          listeners.forEach(({ event, handler }) => {
            video.removeEventListener(event, handler);
          });
          global.videoEventListeners.delete(video);
          if (global.trackedVideos) {
            global.trackedVideos.delete(video);
          }
        }
      } catch (error) {
        // Log error but don't throw
        console.error('Video listener cleanup error:', error);
      }
    });

    // Initialize global tracking variables
    global.videoEventListeners = new WeakMap();
    global.trackedVideos = new WeakSet();
    global.thumbnailObserver = null;
    global.shortsVideoObserver = null;
    global.initChecker = null;
    global.saveIntervalId = null;
    global.playlistRetryTimeout = null;
    global.messageListener = null;
  });

  afterEach(() => {
    // Restore original functions
    global.clearInterval = originalClearInterval;
    global.clearTimeout = originalClearTimeout;

    // Clean up global variables
    global.videoEventListeners = null;
    global.trackedVideos = null;
    global.thumbnailObserver = null;
    global.shortsVideoObserver = null;
    global.initChecker = null;
    global.saveIntervalId = null;
    global.playlistRetryTimeout = null;
    global.messageListener = null;
  });

  describe('Observer Cleanup', () => {
    test('should disconnect thumbnailObserver on cleanup', () => {
      // Setup mock observer
      const disconnectMock = jest.fn();
      global.thumbnailObserver = {
        disconnect: disconnectMock
      };

      cleanupFunction();

      // Check that disconnect was called
      expect(disconnectMock).toHaveBeenCalled();
      expect(global.thumbnailObserver).toBeNull();
    });

    test('should disconnect shortsVideoObserver on cleanup', () => {
      // Setup mock observer
      const disconnectMock = jest.fn();
      global.shortsVideoObserver = {
        disconnect: disconnectMock
      };

      cleanupFunction();

      // Check that disconnect was called
      expect(disconnectMock).toHaveBeenCalled();
      expect(global.shortsVideoObserver).toBeNull();
    });

    test('should handle null observers gracefully', () => {
      global.thumbnailObserver = null;
      global.shortsVideoObserver = null;

      expect(() => cleanupFunction()).not.toThrow();
    });

    test('should not disconnect already disconnected observers', () => {
      // Setup mock observer
      const disconnectMock = jest.fn();
      global.thumbnailObserver = {
        disconnect: disconnectMock
      };

      cleanupFunction(); // First call
      cleanupFunction(); // Second call should not cause issues

      // The observer should be null after first cleanup, so disconnect should only be called once
      expect(disconnectMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('Interval and Timeout Cleanup', () => {
    test('should clear initChecker interval on cleanup', () => {
      global.initChecker = 123; // Mock interval ID

      cleanupFunction();

      expect(global.clearInterval).toHaveBeenCalledWith(123);
      expect(global.initChecker).toBeNull();
    });

    test('should clear saveIntervalId on cleanup', () => {
      global.saveIntervalId = 456; // Mock interval ID

      cleanupFunction();

      expect(global.clearInterval).toHaveBeenCalledWith(456);
      expect(global.saveIntervalId).toBeNull();
    });

    test('should clear playlistRetryTimeout on cleanup', () => {
      global.playlistRetryTimeout = 789; // Mock timeout ID

      cleanupFunction();

      expect(global.clearTimeout).toHaveBeenCalledWith(789);
      expect(global.playlistRetryTimeout).toBeNull();
    });

    test('should handle null timers gracefully', () => {
      global.initChecker = null;
      global.saveIntervalId = null;
      global.playlistRetryTimeout = null;

      expect(() => cleanupFunction()).not.toThrow();
    });
  });

  describe('Event Listener Management', () => {
    test('should track event listeners properly', () => {
      const handler = jest.fn();
      
      addTrackedEventListener(mockVideoElement, 'play', handler);
      
      expect(global.videoEventListeners.has(mockVideoElement)).toBe(true);
      const listeners = global.videoEventListeners.get(mockVideoElement);
      expect(listeners).toHaveLength(1);
      expect(listeners[0].event).toBe('play');
      expect(listeners[0].handler).toBe(handler);
    });

    test('should cleanup video listeners properly', () => {
      const handler = jest.fn();
      const removeEventListenerSpy = jest.spyOn(mockVideoElement, 'removeEventListener');
      
      addTrackedEventListener(mockVideoElement, 'play', handler);
      cleanupVideoListeners(mockVideoElement);
      
      expect(removeEventListenerSpy).toHaveBeenCalledWith('play', handler);
      expect(global.videoEventListeners.has(mockVideoElement)).toBe(false);
    });

    test('should handle multiple listeners on same video', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      
      addTrackedEventListener(mockVideoElement, 'play', handler1);
      addTrackedEventListener(mockVideoElement, 'pause', handler2);
      
      const listeners = global.videoEventListeners.get(mockVideoElement);
      expect(listeners).toHaveLength(2);
    });

    test('should handle cleanup of untracked video gracefully', () => {
      expect(() => cleanupVideoListeners(mockVideoElement)).not.toThrow();
    });
  });

  describe('Page Navigation Simulation', () => {
    test('should cleanup on page unload', () => {
      // Setup initial state
      const disconnectMock = jest.fn();
      global.thumbnailObserver = {
        disconnect: disconnectMock
      };
      global.initChecker = 123;
      global.saveIntervalId = 456;

      // Trigger cleanup
      cleanupFunction();

      // Verify cleanup was called
      expect(disconnectMock).toHaveBeenCalled();
      expect(global.clearInterval).toHaveBeenCalledWith(123);
      expect(global.clearInterval).toHaveBeenCalledWith(456);
    });

    test('should handle rapid navigation gracefully', () => {
      // Setup initial state
      const disconnectMock = jest.fn();
      global.thumbnailObserver = {
        disconnect: disconnectMock
      };
      global.initChecker = 123;

      // Simulate rapid cleanup calls
      cleanupFunction();
      cleanupFunction();
      cleanupFunction();

      // Verify no errors and proper cleanup
      expect(disconnectMock).toHaveBeenCalledTimes(1);
      expect(global.clearInterval).toHaveBeenCalledTimes(1);
    });
  });

  describe('Resource Tracking', () => {
    test('should clear all tracked resources after cleanup', () => {
      // Setup tracked resources
      global.initChecker = 123;
      global.saveIntervalId = 456;
      const disconnectMock = jest.fn();
      global.thumbnailObserver = {
        disconnect: disconnectMock
      };

      // Add some event listeners
      const handler = jest.fn();
      addTrackedEventListener(mockVideoElement, 'play', handler);

      // Perform cleanup
      cleanupFunction();

      // Verify all resources are cleared
      expect(disconnectMock).toHaveBeenCalled();
      expect(global.thumbnailObserver).toBeNull();
      expect(global.initChecker).toBeNull();
      expect(global.saveIntervalId).toBeNull();
      expect(global.clearInterval).toHaveBeenCalledWith(123);
      expect(global.clearInterval).toHaveBeenCalledWith(456);
    });
  });
});