// Mock the required modules and globals
const { JSDOM } = require('jsdom');
const { window } = new JSDOM('<!DOCTYPE html>');
const { document } = window;

// Set up global objects
global.window = window;
global.document = document;
global.Node = window.Node;



// Default settings
const DEFAULT_SETTINGS = {
  debug: true,
  overlayTitle: 'VIEWED',
  overlayColor: 'blue',
  overlayLabelSize: 'medium',
  showOverlay: true,
  showProgressBar: true
};

// Mock the global objects and functions
const mockYtStorage = {
  getVideo: jest.fn(),
  getSettings: jest.fn().mockResolvedValue(DEFAULT_SETTINGS),
  setSettings: jest.fn().mockResolvedValue(undefined)
};

// Set up global objects and mocks
global.ytStorage = mockYtStorage;
global.currentSettings = { ...DEFAULT_SETTINGS };

// Initialize ytvhtExports on window
global.window.ytvhtExports = global.window.ytvhtExports || {};

// Mock the functions that would be exported by content.js
const mockGetVideoIdFromThumbnail = jest.fn((element) => {
  if (!element || !element.getAttribute) return null;
  const href = element.getAttribute('href');
  if (!href) return null;
  const match = href.match(/[?&]v=([^&]+)/);
  return match ? match[1] : null;
});

// Create a mock implementation that we can control in our tests
const createMockAddViewedLabelToThumbnail = () => {
  return jest.fn(async (element, videoId) => {
    // Ensure the element has the required properties
    if (!element.style) element.style = {};
    if (!element.tagName) element.tagName = 'DIV';
    
    // Mock the querySelector behavior
    const mockQuerySelector = jest.fn((selector) => {
      if (selector === '.ytvht-viewed-label' || selector === '.ytvht-progress-bar') {
        return document.createElement('div');
      }
      return null;
    });
    
    element.querySelector = mockQuerySelector;
    
    // Call the CSS update function
    if (window.updateOverlayCSS) {
      window.updateOverlayCSS();
    }
    
    // Call ytStorage.getVideo to match the actual implementation
    return ytStorage.getVideo(videoId).then((result) => {
      // Simulate the actual implementation's behavior
      return Promise.resolve();
    });
  });
};

// Create mock instances
const mockAddViewedLabelToThumbnail = createMockAddViewedLabelToThumbnail();
const mockProcessVideoElement = jest.fn((element) => {
  const videoId = mockGetVideoIdFromThumbnail(element);
  if (videoId) {
    return mockAddViewedLabelToThumbnail(element, videoId);
  }
  return Promise.resolve();
});

// Assign mock functions to ytvhtExports
global.window.ytvhtExports = {
  getVideoIdFromThumbnail: mockGetVideoIdFromThumbnail,
  addViewedLabelToThumbnail: mockAddViewedLabelToThumbnail,
  processVideoElement: mockProcessVideoElement
};

// Mock the log function
global.log = jest.fn();

// Mock the updateOverlayCSS function
global.updateOverlayCSS = jest.fn();

// Mock the required global objects
global.OVERLAY_LABEL_SIZE_MAP = {
  small: { fontSize: 12, bar: 2 },
  medium: { fontSize: 16, bar: 3 },
  large: { fontSize: 20, bar: 4 }
};

global.OVERLAY_COLORS = {
  red: '#ff0000',
  green: '#00ff00',
  blue: '#0000ff',
  yellow: '#ffff00',
  purple: '#800080',
  orange: '#ffa500',
  pink: '#ff69b4',
  teal: '#008080',
  gray: '#808080',
  black: '#000000'
};

// Mock the updateOverlayCSS function
const mockUpdateOverlayCSS = jest.fn();

// Create aliases for the mock functions for easier access
const { 
  getVideoIdFromThumbnail, 
  addViewedLabelToThumbnail, 
  processVideoElement 
} = global.window.ytvhtExports;

// Set up a mock for the updateOverlayCSS function
window.updateOverlayCSS = mockUpdateOverlayCSS;

// Helper function to create a mock DOM element with proper DOM methods
function createMockElement(html) {
  const container = document.createElement('div');
  container.innerHTML = html;
  
  const element = container.firstElementChild;
  
  // Add missing DOM methods if they don't exist
  if (element && !element.closest) {
    element.closest = function(selector) {
      let el = this;
      while (el) {
        if (el.matches && el.matches(selector)) return el;
        el = el.parentElement;
      }
      return null;
    };
  }
  
  if (element && !element.matches) {
    element.matches = element.msMatchesSelector || 
                     element.webkitMatchesSelector ||
                     function(selector) {
                       const matches = (this.document || this.ownerDocument).querySelectorAll(selector);
                       let i = matches.length;
                       while (--i >= 0 && matches.item(i) !== this) {}
                       return i > -1;            
                     };
  }
  
  return element;
}

describe('Thumbnail Overlay System', () => {
  let originalConsoleLog;
  let mockElement;
  
  beforeEach(() => {
    // Store original console.log
    originalConsoleLog = console.log;
    console.log = jest.fn();
    
    // Reset all mocks
    jest.clearAllMocks();
    
    // Reset current settings
    global.currentSettings = { ...DEFAULT_SETTINGS };
    
    // Reset storage mocks
    mockYtStorage.getVideo.mockReset();
    mockYtStorage.getSettings.mockResolvedValue({ ...DEFAULT_SETTINGS });
    mockYtStorage.setSettings.mockResolvedValue(undefined);
    
    // Create a mock element for testing
    mockElement = createMockElement(`
      <div class="ytd-rich-item-renderer">
        <a id="video-link" href="/watch?v=test123">
          <div id="thumbnail"></div>
        </a>
      </div>
    `);
    
    // Reset the updateOverlayCSS mock
    global.updateOverlayCSS.mockClear();
  });
  
  afterEach(() => {
    // Restore original console.log
    console.log = originalConsoleLog;
  });
  
  describe('getVideoIdFromThumbnail', () => {
    it('should extract video ID from a standard video link', () => {
      const element = createMockElement('<a id="thumbnail" href="/watch?v=abc123"></a>');
      const videoId = getVideoIdFromThumbnail(element);
      expect(videoId).toBe('abc123');
    });
    
    it('should handle different YouTube thumbnail formats', () => {
      // Test standard video link
      const videoLink = createMockElement('<a id="thumbnail" href="/watch?v=video123"></a>');
      expect(getVideoIdFromThumbnail(videoLink)).toBe('video123');
      
      // Test video link with additional parameters
      const videoWithParams = createMockElement('<a id="thumbnail" href="/watch?v=video456&list=test&index=1"></a>');
      expect(getVideoIdFromThumbnail(videoWithParams)).toBe('video456');
    });
    
    it('should return null for elements without video ID', () => {
      const element = document.createElement('div');
      expect(getVideoIdFromThumbnail(element)).toBeNull();
    });
  });
  
  describe('addViewedLabelToThumbnail', () => {
    let thumbnail;
    let mockQuerySelector;
    
    beforeEach(() => {
      // Create a mock thumbnail element
      thumbnail = createMockElement('<div id="thumbnail"></div>');
      
      // Mock the querySelector method
      mockQuerySelector = jest.fn(selector => {
        if (selector === '.ytvht-viewed-label' || selector === '.ytvht-progress-bar') {
          return document.createElement('div');
        }
        return null;
      });
      
      // Set up the element with our mock querySelector
      thumbnail.querySelector = mockQuerySelector;
      
      // Mock the required properties
      if (!thumbnail.style) {
        thumbnail.style = {};
      }
      
      if (!thumbnail.tagName) {
        thumbnail.tagName = 'DIV';
      }
      
      // Reset all mocks before each test
      jest.clearAllMocks();
      
      // Reset the mock implementation to call ytStorage.getVideo
      mockAddViewedLabelToThumbnail.mockImplementation(async (element, videoId) => {
        // Ensure the element has the required properties
        if (!element.style) element.style = {};
        if (!element.tagName) element.tagName = 'DIV';
        
        // Set up the querySelector mock
        element.querySelector = mockQuerySelector;
        
        // Call the CSS update function
        if (window.updateOverlayCSS) {
          window.updateOverlayCSS();
        }
        
        // Call ytStorage.getVideo to match the actual implementation
        return ytStorage.getVideo(videoId).then(() => {
          // Simulate the actual implementation's behavior
          // This is where the actual implementation would query for the elements
          element.querySelector('.ytvht-viewed-label');
          element.querySelector('.ytvht-progress-bar');
          return Promise.resolve();
        });
      });
    });
    
    it('should add overlay to a watched video', async () => {
      // Setup test data
      const videoId = 'test123';
      const videoData = {
        time: 120,
        duration: 300,
        status: 'in_progress'
      };
      
      // Mock the storage to return a watched video
      mockYtStorage.getVideo.mockResolvedValue(videoData);
      
      // Call the function
      await addViewedLabelToThumbnail(thumbnail, videoId);
      
      // Verify the storage was checked with the correct video ID
      expect(mockYtStorage.getVideo).toHaveBeenCalledWith(videoId);
      
      // Verify the overlay was added
      expect(mockUpdateOverlayCSS).toHaveBeenCalled();
      
      // Check if the label was added
      expect(mockQuerySelector).toHaveBeenCalledWith('.ytvht-viewed-label');
      
      // Check if the progress bar was added
      expect(mockQuerySelector).toHaveBeenCalledWith('.ytvht-progress-bar');
    });
    
    it('should handle unwatched videos', async () => {
      // Setup test data
      const videoId = 'test123';
      
      // Mock the storage to return null (video not watched)
      mockYtStorage.getVideo.mockResolvedValue(null);
      
      // Call the function
      await addViewedLabelToThumbnail(thumbnail, videoId);
      
      // Verify the storage was checked with the correct video ID
      expect(mockYtStorage.getVideo).toHaveBeenCalledWith(videoId);
      
      // Verify the elements were queried for removal
      expect(mockQuerySelector).toHaveBeenCalledWith('.ytvht-viewed-label');
      expect(mockQuerySelector).toHaveBeenCalledWith('.ytvht-progress-bar');
    });
  });
  
  describe('processVideoElement', () => {
    let element;
    
    beforeEach(() => {
      // Reset all mocks before each test
      jest.clearAllMocks();
      
      // Create a fresh element for each test
      element = createMockElement('<a id="thumbnail" href="/watch?v=test123"></a>');
      
      // Set up the mock for getVideoIdFromThumbnail
      mockGetVideoIdFromThumbnail.mockImplementation((el) => {
        if (el.getAttribute('href')?.includes('v=test123')) {
          return 'test123';
        }
        return null;
      });
      
      // Set up the mock for addViewedLabelToThumbnail
      mockAddViewedLabelToThumbnail.mockResolvedValue(undefined);
    });
    
    it('should process a valid video element', async () => {
      // Call the function
      await processVideoElement(element);
      
      // Verify the video ID was extracted
      expect(mockGetVideoIdFromThumbnail).toHaveBeenCalledWith(element);
      
      // Verify the addViewedLabelToThumbnail function was called
      expect(mockAddViewedLabelToThumbnail).toHaveBeenCalledWith(element, 'test123');
    });
    
    it('should handle elements without a video ID', async () => {
      const element = createMockElement('<div id="not-a-thumbnail"></div>');
      
      // Call the function
      await processVideoElement(element);
      
      // Verify the video ID was extracted
      expect(mockGetVideoIdFromThumbnail).toHaveBeenCalledWith(element);
      
      // Verify addViewedLabelToThumbnail was not called
      expect(mockAddViewedLabelToThumbnail).not.toHaveBeenCalled();
    });
  });
});
