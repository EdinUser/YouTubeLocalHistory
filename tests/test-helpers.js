/**
 * Test helper functions for creating mock DOM elements
 */

/**
 * Creates a mock video element with basic functionality
 * @returns {HTMLVideoElement} A mock video element
 */
function createMockVideoElement() {
  // Create a plain object instead of a real video element to avoid read-only property issues
  const eventListeners = {};
  
  const video = {
    currentTime: 30,
    paused: false,
    volume: 1.0,
    muted: false,
    playbackRate: 1.0,
    // Mock duration as a getter to simulate the read-only property
    get duration() {
      return 100;
    },
    // Mock other properties as needed
    readyState: 4, // HAVE_ENOUGH_DATA
    networkState: 1, // NETWORK_IDLE
    // Mock methods
    play: jest.fn().mockResolvedValue(undefined),
    pause: jest.fn(),
    load: jest.fn(),
    // Add other video methods as needed
    addTextTrack: jest.fn(() => ({
      addCue: jest.fn(),
      removeCue: jest.fn()
    })),
    // Mock event listener functionality
    addEventListener: jest.fn((event, handler) => {
      if (!eventListeners[event]) {
        eventListeners[event] = [];
      }
      eventListeners[event].push(handler);
    }),
    
    removeEventListener: jest.fn((event, handler) => {
      if (eventListeners[event]) {
        const index = eventListeners[event].indexOf(handler);
        if (index > -1) {
          eventListeners[event].splice(index, 1);
        }
      }
    }),
    
    // Helper method to trigger events on the video
    triggerEvent: (event, data) => {
      if (eventListeners[event]) {
        eventListeners[event].forEach(handler => handler(data));
      }
    },
    
    // Mock other DOM element properties
    nodeType: 1,
    tagName: 'VIDEO',
    getAttribute: jest.fn(),
    setAttribute: jest.fn(),
    removeAttribute: jest.fn(),
    querySelector: jest.fn(),
    querySelectorAll: jest.fn(() => []),
    appendChild: jest.fn(),
    removeChild: jest.fn(),
    classList: {
      add: jest.fn(),
      remove: jest.fn(),
      contains: jest.fn(() => false),
      toggle: jest.fn()
    },
    style: {}
  };
  
  // Helper method to trigger events on the video
  video.triggerEvent = (event, data) => {
    if (eventListeners[event]) {
      eventListeners[event].forEach(handler => handler(data));
    }
  };
  
  return video;
}

/**
 * Creates a mock thumbnail element
 * @returns {HTMLElement} A mock thumbnail element
 */
function createMockThumbnail() {
  const thumbnail = document.createElement('div');
  thumbnail.className = 'ytd-thumbnail';
  thumbnail.querySelector = jest.fn();
  thumbnail.closest = jest.fn(() => document.createElement('div'));
  return thumbnail;
}

// Export the functions for use in test files
module.exports = {
  createMockVideoElement,
  createMockThumbnail
};
