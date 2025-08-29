// Mock the required functions
const mockGetVideoIdFromThumbnail = jest.fn();
const mockProcessVideoElement = jest.fn();
const mockAddViewedLabelToThumbnail = jest.fn();

// Mock the module
jest.mock('../../src/content', () => ({
  getVideoIdFromThumbnail: mockGetVideoIdFromThumbnail,
  processVideoElement: mockProcessVideoElement,
  addViewedLabelToThumbnail: mockAddViewedLabelToThumbnail
}));

// Import the module after mocking
const { 
  getVideoIdFromThumbnail, 
  processVideoElement, 
  addViewedLabelToThumbnail 
} = require('../../src/content');

describe('Thumbnail Utils', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
  });

  describe('getVideoIdFromThumbnail', () => {
    it('should call the function with the provided element', () => {
      const mockElement = { test: 'element' };
      getVideoIdFromThumbnail(mockElement);
      
      expect(mockGetVideoIdFromThumbnail).toHaveBeenCalledTimes(1);
      expect(mockGetVideoIdFromThumbnail).toHaveBeenCalledWith(mockElement);
    });
  });

  describe('processVideoElement', () => {
    it('should call the function with the provided element', () => {
      const mockElement = { test: 'element' };
      processVideoElement(mockElement);
      
      expect(mockProcessVideoElement).toHaveBeenCalledTimes(1);
      expect(mockProcessVideoElement).toHaveBeenCalledWith(mockElement);
    });
  });

  describe('addViewedLabelToThumbnail', () => {
    it('should call the function with the provided element and video ID', async () => {
      const mockElement = { test: 'element' };
      const videoId = 'test123';
      
      await addViewedLabelToThumbnail(mockElement, videoId);
      
      expect(mockAddViewedLabelToThumbnail).toHaveBeenCalledTimes(1);
      expect(mockAddViewedLabelToThumbnail).toHaveBeenCalledWith(mockElement, videoId);
    });
  });
});
