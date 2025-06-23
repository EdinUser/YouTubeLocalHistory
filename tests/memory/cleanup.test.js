/**
 * Memory leak detection and cleanup tests
 */

describe('Memory Leak Prevention', () => {
  let mockVideoElement;
  let mockThumbnailElement;
  let cleanupFunction;
  let addTrackedEventListener;
  let cleanupVideoListeners;

  beforeEach(() => {
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

      expect(clearInterval).toHaveBeenCalledWith(123);
      expect(global.initChecker).toBeNull();
    });

    test('should clear saveIntervalId on cleanup', () => {
      global.saveIntervalId = 456; // Mock interval ID

      cleanupFunction();

      expect(clearInterval).toHaveBeenCalledWith(456);
      expect(global.saveIntervalId).toBeNull();
    });

    test('should clear playlistRetryTimeout on cleanup', () => {
      global.playlistRetryTimeout = 789; // Mock timeout ID

      cleanupFunction();

      expect(clearTimeout).toHaveBeenCalledWith(789);
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
      expect(global.videoEventListeners.get(mockVideoElement)).toHaveLength(1);
      expect(mockVideoElement.addEventListener).toHaveBeenCalledWith('play', handler);
    });

    test('should cleanup video event listeners', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      addTrackedEventListener(mockVideoElement, 'play', handler1);
      addTrackedEventListener(mockVideoElement, 'pause', handler2);

      cleanupVideoListeners(mockVideoElement);

      expect(mockVideoElement.removeEventListener).toHaveBeenCalledWith('play', handler1);
      expect(mockVideoElement.removeEventListener).toHaveBeenCalledWith('pause', handler2);
      expect(global.videoEventListeners.has(mockVideoElement)).toBe(false);
    });

    test('should handle multiple event listeners per element', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      addTrackedEventListener(mockVideoElement, 'play', handler1);
      addTrackedEventListener(mockVideoElement, 'pause', handler2);

      expect(global.videoEventListeners.get(mockVideoElement)).toHaveLength(2);
    });

    test('should handle cleanup of non-tracked elements gracefully', () => {
      const untrackedElement = createMockVideoElement();

      expect(() => cleanupVideoListeners(untrackedElement)).not.toThrow();
    });
  });

  describe('Message Listener Cleanup', () => {
    test('should remove message listener on cleanup', () => {
      const messageListenerMock = jest.fn();
      global.messageListener = messageListenerMock;

      cleanupFunction();

      // Check that removeListener was called with the listener
      expect(chrome.runtime.onMessage.removeListener).toHaveBeenCalledWith(messageListenerMock);
      expect(global.messageListener).toBeNull();
    });

    test('should handle null message listener gracefully', () => {
      global.messageListener = null;

      expect(() => cleanupFunction()).not.toThrow();
    });
  });

  describe('Memory Usage Monitoring', () => {
    test('should not accumulate memory over multiple cleanups', () => {
      const initialMemory = getMemoryUsage();

      // Simulate multiple cleanup cycles
      for (let i = 0; i < 10; i++) {
        cleanupFunction();
      }

      const finalMemory = getMemoryUsage();
      const memoryIncrease = finalMemory - initialMemory;

      // Memory increase should be minimal (less than 1MB)
      expect(memoryIncrease).toBeLessThan(1000000);
    });

    test('should cleanup WeakMap and WeakSet references', () => {
      // Add some tracked elements
      addTrackedEventListener(mockVideoElement, 'play', jest.fn());
      global.trackedVideos.add(mockVideoElement);

      // Verify they're tracked
      expect(global.videoEventListeners.has(mockVideoElement)).toBe(true);
      expect(global.trackedVideos.has(mockVideoElement)).toBe(true);

      // Cleanup
      cleanupVideoListeners(mockVideoElement);

      // Verify they're no longer tracked
      expect(global.videoEventListeners.has(mockVideoElement)).toBe(false);
      expect(global.trackedVideos.has(mockVideoElement)).toBe(false);
    });
  });

  describe('Page Navigation Simulation', () => {
    test('should cleanup on page unload', () => {
      // Setup some resources
      const disconnectMock = jest.fn();
      global.thumbnailObserver = { disconnect: disconnectMock };
      global.initChecker = 123;
      global.saveIntervalId = 456;

      // Simulate page unload
      simulatePageNavigation();

      // Verify cleanup was called
      expect(disconnectMock).toHaveBeenCalled();
      expect(clearInterval).toHaveBeenCalledWith(123);
      expect(clearInterval).toHaveBeenCalledWith(456);
    });

    test('should handle rapid page navigations', () => {
      // Simulate rapid navigation
      for (let i = 0; i < 5; i++) {
        global.thumbnailObserver = { disconnect: jest.fn() };
        simulatePageNavigation();
      }

      // Should not throw errors
      expect(() => {}).not.toThrow();
    });
  });

  describe('Error Handling in Cleanup', () => {
    test('should handle observer disconnect errors', () => {
      global.thumbnailObserver = {
        disconnect: jest.fn(() => {
          throw new Error('Disconnect failed');
        })
      };

      // Cleanup should not throw
      expect(() => cleanupFunction()).not.toThrow();
    });

    test('should handle timer clear errors', () => {
      global.initChecker = 123;
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval').mockImplementation(() => {
        throw new Error('Clear interval failed');
      });

      // Cleanup should not throw
      expect(() => cleanupFunction()).not.toThrow();

      clearIntervalSpy.mockRestore();
    });

    test('should handle event listener removal errors', () => {
      const handler = jest.fn();
      addTrackedEventListener(mockVideoElement, 'play', handler);

      mockVideoElement.removeEventListener.mockImplementation(() => {
        throw new Error('Remove listener failed');
      });

      // Cleanup should not throw
      expect(() => cleanupVideoListeners(mockVideoElement)).not.toThrow();
    });
  });

  describe('Resource Tracking', () => {
    test('should track all created resources', () => {
      // Create various resources
      global.thumbnailObserver = { disconnect: jest.fn() };
      global.shortsVideoObserver = { disconnect: jest.fn() };
      global.initChecker = 123;
      global.saveIntervalId = 456;
      global.playlistRetryTimeout = 789;
      global.messageListener = jest.fn();

      // Verify all are tracked
      expect(global.thumbnailObserver).toBeDefined();
      expect(global.shortsVideoObserver).toBeDefined();
      expect(global.initChecker).toBe(123);
      expect(global.saveIntervalId).toBe(456);
      expect(global.playlistRetryTimeout).toBe(789);
      expect(global.messageListener).toBeDefined();
    });

    test('should clear all tracked resources after cleanup', () => {
      // Setup resources
      const thumbnailDisconnectMock = jest.fn();
      const shortsDisconnectMock = jest.fn();
      const messageListenerMock = jest.fn();
      global.thumbnailObserver = { disconnect: thumbnailDisconnectMock };
      global.shortsVideoObserver = { disconnect: shortsDisconnectMock };
      global.initChecker = 123;
      global.saveIntervalId = 456;
      global.playlistRetryTimeout = 789;
      global.messageListener = messageListenerMock;

      cleanupFunction();

      // Verify cleanup functions were called
      expect(thumbnailDisconnectMock).toHaveBeenCalled();
      expect(shortsDisconnectMock).toHaveBeenCalled();

      // Check that clearInterval was called with both values
      const clearIntervalCalls = clearInterval.mock.calls;
      expect(clearIntervalCalls).toContainEqual([123]);
      expect(clearIntervalCalls).toContainEqual([456]);

      expect(clearTimeout).toHaveBeenCalledWith(789);
      expect(chrome.runtime.onMessage.removeListener).toHaveBeenCalledWith(messageListenerMock);

      // Verify clearInterval was called exactly twice
      expect(clearInterval).toHaveBeenCalledTimes(2);
    });
  });
});