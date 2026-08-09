// Load TextEncoder/TextDecoder first
const { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// Use Jest's built-in jsdom (see jest.config.js testEnvironmentOptions). Do not assign
// global.window to a second JSDOM instance — Jest's global *is* the Window, and replacing
// global.window breaks window.location / window.window invariants.

global.navigator = {
  ...global.navigator,
  userAgent: 'node.js',
};

// Mock the browser and chrome APIs
global.browser = {
  storage: {
    local: {
      get: jest.fn(),
      set: jest.fn(),
    },
  },
};

global.chrome = {
  runtime: {
    getManifest: () => ({ version: '3.0.0' }),
    onMessage: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
    },
  },
  storage: {
    local: {
      get: jest.fn(),
      set: jest.fn(),
    },
  },
};

// Lightweight content-script module globals. Tests that require src/content.js
// only need the content script to initialize and expose hooks; individual
// helper modules have their own focused tests.
global.window.YTVHTContentCss = {
  injectCSS: jest.fn(),
  updateOverlayCSS: jest.fn(),
};

require('../src/content-url.js');
require('../src/content-playlists.js');

global.window.YTVHTContentThumbnails = {
  create: () => ({
    thumbnailObserver: { observe: jest.fn(), disconnect: jest.fn() },
    processExistingThumbnails: jest.fn(),
    processVideoElement: jest.fn(),
    startRemovedElementCleanupObserver: jest.fn(),
  }),
};

global.window.YTVHTContentMessages = {
  create: () => jest.fn(),
};

global.window.YTVHTContentInfo = {
  create: () => ({
    showExtensionInfo: jest.fn(),
  }),
};

global.window.YTVHTContentImport = {
  create: () => ({
    maybeShowImportOverlayFromHash: jest.fn(),
  }),
};

// Minimal global ytStorage stub so the real content script
// can be required in tests without throwing during initialize/loadSettings.
global.ytStorage = {
  getSettings: jest.fn().mockResolvedValue(null),
  setSettings: jest.fn().mockResolvedValue(),
  ensureMigrated: jest.fn().mockResolvedValue(),
  getVideo: jest.fn().mockResolvedValue(null),
  setVideo: jest.fn().mockResolvedValue(),
  getPlaylist: jest.fn().mockResolvedValue(null),
  getAllPlaylists: jest.fn().mockResolvedValue({}),
  updateStats: jest.fn().mockResolvedValue(),
};
