// Jest setup file for browser extension testing

// Mock browser APIs for testing
global.chrome = {
  runtime: {
    onMessage: {
      addListener: jest.fn(),
      removeListener: jest.fn()
    },
    sendMessage: jest.fn()
  },
  storage: {
    local: {
      get: jest.fn(),
      set: jest.fn(),
      remove: jest.fn()
    }
  }
};

// Mock browser APIs for Firefox
global.browser = {
  storage: {
    local: {
      get: jest.fn(),
      set: jest.fn(),
      remove: jest.fn(),
      clear: jest.fn()
    }
  }
};

// Mock IndexedDB
global.indexedDB = {
  open: jest.fn()
};

// Mock DOM APIs
global.document = {
  querySelector: jest.fn(),
  querySelectorAll: jest.fn(),
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  createElement: jest.fn(() => ({
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    querySelector: jest.fn(),
    querySelectorAll: jest.fn()
  }))
};

global.window = {
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  location: {
    href: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
  },
  performance: {
    memory: {
      usedJSHeapSize: 1000000,
      totalJSHeapSize: 2000000,
      jsHeapSizeLimit: 5000000
    }
  }
};

// Also set performance globally for direct access
global.performance = {
  memory: {
    usedJSHeapSize: 1000000,
    totalJSHeapSize: 2000000,
    jsHeapSizeLimit: 5000000
  }
};

// Mock MutationObserver
global.MutationObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  disconnect: jest.fn()
}));

// Mock timers using jest.spyOn for easy restoration
jest.spyOn(global, 'setTimeout');
jest.spyOn(global, 'setInterval');
jest.spyOn(global, 'clearTimeout');
jest.spyOn(global, 'clearInterval');

// Mock URLSearchParams
global.URLSearchParams = jest.fn().mockImplementation((search) => {
  const params = new Map();
  if (search) {
    const searchParams = search.replace('?', '').split('&');
    searchParams.forEach(param => {
      const [key, value] = param.split('=');
      if (key && value) {
        params.set(key, value);
      }
    });
  }

  return {
    get: jest.fn((key) => params.get(key) || null),
    has: jest.fn((key) => params.has(key)),
    set: jest.fn((key, value) => params.set(key, value)),
    delete: jest.fn((key) => params.delete(key))
  };
});

// Mock console methods
global.console = {
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn()
};

// Global variables for tracking
global.thumbnailObserver = null;
global.shortsVideoObserver = null;
global.initChecker = null;
global.messageListener = null;
global.videoListeners = new WeakMap();

// Helper function to get memory usage
global.getMemoryUsage = () => {
  if (global.performance && global.performance.memory) {
    return global.performance.memory.usedJSHeapSize;
  }
  // Fallback for environments where performance.memory is not available
  return 1000000;
};

// Helper function to simulate time passing
global.advanceTimersByTime = (ms) => {
  jest.advanceTimersByTime(ms);
};

// Reset all mocks before each test
beforeEach(() => {
  jest.clearAllMocks();
  // Spy on timers before each test
  jest.spyOn(global, 'setTimeout');
  jest.spyOn(global, 'setInterval');
  jest.spyOn(global, 'clearTimeout');
  jest.spyOn(global, 'clearInterval');

  global.thumbnailObserver = null;
  global.shortsVideoObserver = null;
  global.initChecker = null;
  global.messageListener = null;
  global.videoListeners = new WeakMap();
});

// Restore all mocks after each test to prevent pollution
afterEach(() => {
  jest.restoreAllMocks();
});

// Helper function to create mock video element
global.createMockVideoElement = () => {
  const video = document.createElement('video');
  video.currentTime = 0;
  video.duration = 100;
  video.paused = true;
  video.readyState = 1;

  // Mock video methods
  video.addEventListener = jest.fn();
  video.removeEventListener = jest.fn();

  return video;
};

// Helper function to create mock thumbnail element
global.createMockThumbnail = () => {
  const thumbnail = document.createElement('div');
  thumbnail.className = 'ytd-rich-item-renderer';

  const anchor = document.createElement('a');
  anchor.id = 'thumbnail';
  anchor.href = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

  thumbnail.appendChild(anchor);
  return thumbnail;
};

// Helper function to simulate page navigation
global.simulatePageNavigation = () => {
  const beforeunloadEvent = new Event('beforeunload');
  window.dispatchEvent(beforeunloadEvent);

  // Also call cleanup function directly for testing
  if (typeof global.cleanupFunction === 'function') {
    global.cleanupFunction();
  }
};