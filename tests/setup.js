// Jest setup file for browser extension testing

// Mock browser APIs
const mockChrome = {
  storage: {
    local: {
      get: jest.fn(),
      set: jest.fn()
    }
  },
  runtime: {
    sendMessage: jest.fn(),
    onMessage: {
      addListener: jest.fn(),
      removeListener: jest.fn()
    }
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

// Mock IndexedDB
const mockIDBRequest = {
  result: {},
  error: null,
  transaction: {
    objectStore: jest.fn().mockReturnValue({
      put: jest.fn(),
      get: jest.fn(),
      getAll: jest.fn(),
      delete: jest.fn(),
      clear: jest.fn()
    })
  },
  onerror: null,
  onsuccess: null,
  onupgradeneeded: null
};

const mockIndexedDB = {
  open: jest.fn().mockReturnValue(mockIDBRequest),
  deleteDatabase: jest.fn()
};

// Setup global mocks
global.chrome = mockChrome;
global.browser = mockBrowser;
global.indexedDB = mockIndexedDB;

// Mock DOM APIs that might not be in jsdom
global.HTMLMediaElement.prototype.play = jest.fn();
global.HTMLMediaElement.prototype.pause = jest.fn();
global.HTMLMediaElement.prototype.load = jest.fn();

// Mock MutationObserver
global.MutationObserver = class {
  constructor(callback) {
    this.callback = callback;
    this.observe = jest.fn();
    this.disconnect = jest.fn();
    this.takeRecords = jest.fn();
  }
};

// Mock WeakRef if not available (Node < 14)
if (typeof WeakRef === 'undefined') {
  global.WeakRef = class WeakRef {
    constructor(target) {
      this.target = target;
    }
    deref() {
      return this.target;
    }
  };
}

// Mock FinalizationRegistry if not available (Node < 14)
if (typeof FinalizationRegistry === 'undefined') {
  global.FinalizationRegistry = class FinalizationRegistry {
    constructor(callback) {
      this.callback = callback;
    }
    register() {}
    unregister() {}
  };
}

// Helper to trigger DOM events
global.triggerEvent = (element, eventName) => {
  const event = new Event(eventName);
  element.dispatchEvent(event);
};

// Reset all mocks between tests
beforeEach(() => {
  jest.clearAllMocks();
  
  // Reset storage mocks
  mockChrome.storage.local.get.mockReset();
  mockChrome.storage.local.set.mockReset();
  mockBrowser.storage.local.get.mockReset();
  mockBrowser.storage.local.set.mockReset();
  
  // Reset IndexedDB mock
  mockIndexedDB.open.mockReset();
  mockIndexedDB.open.mockReturnValue(mockIDBRequest);
  
  // Reset DOM
  document.body.innerHTML = '';
});

// Cleanup after each test
afterEach(() => {
  // Clean up any remaining event listeners
  jest.restoreAllMocks();
});

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

// Mock source files
jest.mock('../src/content.js', () => {
  const setupVideoTracking = jest.fn((video) => ({
    playHandler: jest.fn(),
    pauseHandler: jest.fn(),
    timeupdateHandler: jest.fn(),
    seekingHandler: jest.fn(),
    seekedHandler: jest.fn(),
    beforeunloadHandler: jest.fn()
  }));

  const addViewedLabelToThumbnail = jest.fn((thumbnail, videoId) => {
    const mockLabel = {
      className: 'ytvht-viewed-label'
    };
    const mockProgressBar = {
      className: 'ytvht-progress-bar'
    };
    thumbnail.appendChild = jest.fn();
    thumbnail.appendChild(mockLabel);
    thumbnail.appendChild(mockProgressBar);
  });

  const processExistingThumbnails = jest.fn();
  const trackedVideos = new WeakSet();
  const videoEventListeners = new WeakMap();

  return {
    setupVideoTracking,
    addViewedLabelToThumbnail,
    processExistingThumbnails,
    trackedVideos,
    videoEventListeners
  };
});

jest.mock('../src/popup.js', () => ({
    updateVideoRecord: jest.fn((record) => {
        if (!record || !record.videoId) return;
        
        const recordIndex = global.allHistoryRecords.findIndex(r => r.videoId === record.videoId);
        if (recordIndex !== -1) {
            global.allHistoryRecords[recordIndex] = record;
        } else {
            global.allHistoryRecords.unshift(record);
            global.allHistoryRecords.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        }
    }),
    displayHistoryPage: jest.fn(),
    formatDuration: jest.fn(time => `${Math.floor(time / 60)}:${String(time % 60).padStart(2, '0')}`),
    formatDate: jest.fn(timestamp => new Date(timestamp).toLocaleString())
}));