// Load TextEncoder/TextDecoder first
const { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// Now require JSDOM
const { JSDOM } = require('jsdom');

// Create a basic DOM environment
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://www.youtube.com/',
  runScripts: 'dangerously',
  resources: 'usable',
});

// Set global objects
global.window = dom.window;
global.document = dom.window.document;
global.navigator = {
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
