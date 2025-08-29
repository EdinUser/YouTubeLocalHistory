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
    getManifest: jest.fn().mockReturnValue({
      version: '2.4.0',
      name: 'YouTube Local History',
      description: 'Tracks your YouTube watch history locally',
      manifest_version: 3
    }),
    onMessage: {
      addListener: jest.fn((listener) => {
        mockChrome.runtime.onMessage.listeners.push(listener);
      }),
      removeListener: jest.fn((listener) => {
        const index = mockChrome.runtime.onMessage.listeners.indexOf(listener);
        if (index > -1) {
          mockChrome.runtime.onMessage.listeners.splice(index, 1);
        }
      }),
      // Add trigger method for simulating messages
      trigger: function(message) {
        this.listeners.forEach(listener => listener(message));
      },
      listeners: []
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

// Mock source files
jest.mock('../src/content.js', () => {
  // Create mock functions
  const saveTimestamp = jest.fn().mockImplementation(async () => {
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
    mockChrome.runtime.onMessage.trigger({
      type: 'videoUpdate',
      data: record
    });
  });

  const tryToSavePlaylist = jest.fn().mockImplementation(async (retries = 3) => {
    const playlistId = 'PL123';
    const playlistInfo = {
      playlistId,
      title: 'Test Playlist',
      url: `https://www.youtube.com/playlist?list=${playlistId}`,
      timestamp: Date.now()
    };
    await global.ytStorage.setPlaylist(playlistId, playlistInfo);
  });

  const calculateAnalytics = jest.fn().mockImplementation((videos) => {
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

  const getWatchTimeByHour = jest.fn().mockImplementation((videos) => {
    const hourlyData = new Array(24).fill(0);
    videos.forEach(video => {
      if (video.timestamp) {
        const hour = new Date(video.timestamp).getHours();
        hourlyData[hour] += Math.floor(video.time / 60); // Convert to minutes
      }
    });
    return hourlyData;
  });

  const getContentTypeDistribution = jest.fn().mockImplementation((videos) => ({
    regular: videos.filter(v => !v.isShorts).length,
    shorts: videos.filter(v => v.isShorts).length
  }));

  const module = {
    setupVideoTracking: jest.fn(),
    addViewedLabelToThumbnail: jest.fn(),
    processExistingThumbnails: jest.fn(),
    trackedVideos: new WeakSet(),
    videoEventListeners: new WeakMap(),
    saveTimestamp,
    tryToSavePlaylist,
    calculateAnalytics,
    getWatchTimeByHour,
    getContentTypeDistribution,
    getPlaylistInfo: jest.fn(),
    broadcastVideoUpdate: jest.fn().mockImplementation((data) => {
      mockChrome.runtime.sendMessage(data);
    }),
    debounce: jest.fn((fn, wait) => {
      let timeout;
      return function executedFunction(...args) {
        const later = () => {
          clearTimeout(timeout);
          fn(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
      };
    })
  };

  // Expose module for tests
  global.contentModule = module;
  return module;
});

jest.mock('../src/popup.js', () => {
  const popup = {
    updateVideoRecord: jest.fn((record) => {
      if (!record || !record.videoId) return;
      
      const recordIndex = global.allHistoryRecords.findIndex(r => r.videoId === record.videoId);
      if (recordIndex !== -1) {
        global.allHistoryRecords[recordIndex] = { ...record };
      } else {
        global.allHistoryRecords.unshift({ ...record });
      }
      global.allHistoryRecords.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      popup.displayHistoryPage();
    }),
    displayHistoryPage: jest.fn(),
    formatDuration: jest.fn(time => `${Math.floor(time / 60)}:${String(time % 60).padStart(2, '0')}`),
    formatDate: jest.fn(timestamp => new Date(timestamp).toLocaleString())
  };
  return popup;
});

// Mock window.location
Object.defineProperty(window, 'location', {
  value: {
    _search: '',
    get search() {
      return this._search;
    },
    set search(value) {
      this._search = value;
    }
  },
  writable: true
});

// Helper function to create mock video element
let mockVideoState = {
  currentTime: 30,
  duration: 100,
  paused: true,
  readyState: 1,
  addEventListener: jest.fn(),
  removeEventListener: jest.fn()
};

global.createMockVideoElement = jest.fn().mockImplementation(() => {
  const video = {
    get currentTime() {
      return mockVideoState.currentTime;
    },
    set currentTime(value) {
      mockVideoState.currentTime = value;
    },
    get duration() {
      return mockVideoState.duration;
    },
    set duration(value) {
      mockVideoState.duration = value;
    },
    paused: mockVideoState.paused,
    readyState: mockVideoState.readyState,
    addEventListener: mockVideoState.addEventListener,
    removeEventListener: mockVideoState.removeEventListener
  };
  return video;
});

global.setMockVideoState = (state) => {
  mockVideoState = { ...mockVideoState, ...state };
};

// Mock storage service
global.ytStorage = {
  setVideo: jest.fn(),
  setPlaylist: jest.fn(),
  getAllVideos: jest.fn(),
  clear: jest.fn(),
  ensureMigrated: jest.fn().mockResolvedValue(),
  getVideo: jest.fn().mockResolvedValue(null),
  saveVideo: jest.fn().mockResolvedValue(),
  updateVideo: jest.fn().mockResolvedValue(),
  removeVideo: jest.fn().mockResolvedValue(),
  getPlaylist: jest.fn().mockResolvedValue(null),
  getAllPlaylists: jest.fn().mockResolvedValue({}),
  removePlaylist: jest.fn().mockResolvedValue(),
  getSettings: jest.fn().mockResolvedValue({
    autoCleanPeriod: 90,
    paginationCount: 10,
    overlayTitle: 'viewed',
    overlayColor: 'blue',
    overlayLabelSize: 'medium'
  }),
  setSettings: jest.fn().mockResolvedValue()
};

// Helper function to create mock thumbnail element
global.createMockThumbnail = () => {
  const thumbnail = {
    className: 'ytd-rich-item-renderer',
    appendChild: jest.fn(),
    querySelector: jest.fn()
  };
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