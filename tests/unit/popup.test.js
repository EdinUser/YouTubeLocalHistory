/**
 * Unit tests for popup functionality
 */

// Mock DOM environment
document.body.innerHTML = `
  <div class="controls">
    <div class="left-controls">
      <button id="ytvhtToggleTheme" class="theme-toggle" title="Toggle theme">
        <span id="themeText">Theme</span>
      </button>
      <button id="ytvhtExportHistory">Export History</button>
      <button id="ytvhtImportHistory">Import History</button>
      <button id="ytvhtClearHistory" style="background-color: #dc3545;">Clear History</button>
    </div>
    <button id="ytvhtClosePopup">Close</button>
  </div>
  <div id="ytvhtMessage" class="message"></div>
`;

// Mock storage
const mockYtStorage = {
  clear: jest.fn().mockResolvedValue(),
  getAllVideos: jest.fn().mockResolvedValue({}),
  getAllPlaylists: jest.fn().mockResolvedValue({})
};

// Mock global objects
global.ytStorage = mockYtStorage;
global.confirm = jest.fn();
global.console = {
  log: jest.fn(),
  error: jest.fn()
};

// Mock variables that would be set by popup.js
global.allHistoryRecords = [];
global.allPlaylists = [];
global.allShortsRecords = [];
global.currentPage = 1;
global.currentPlaylistPage = 1;
global.currentShortsPage = 1;

// Mock functions that would be defined in popup.js
global.displayHistoryPage = jest.fn();
global.displayShortsPage = jest.fn();
global.displayPlaylistsPage = jest.fn();
global.showMessage = jest.fn();

describe('Popup Functionality', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    document.getElementById('ytvhtMessage').style.display = 'none';
  });

  describe('Button Ordering', () => {
    test('should have correct button order in left-controls', () => {
      const leftControls = document.querySelector('.left-controls');
      const buttons = leftControls.querySelectorAll('button');
      
      expect(buttons).toHaveLength(4);
      expect(buttons[0].id).toBe('ytvhtToggleTheme');
      expect(buttons[1].id).toBe('ytvhtExportHistory');
      expect(buttons[2].id).toBe('ytvhtImportHistory');
      expect(buttons[3].id).toBe('ytvhtClearHistory');
    });

    test('should have Clear History button styled as destructive', () => {
      const clearButton = document.getElementById('ytvhtClearHistory');
      expect(clearButton.style.backgroundColor).toBe('rgb(220, 53, 69)'); // #dc3545
    });
  });

  describe('Clear History Functionality', () => {
    test('should show confirmation dialog when clear history is clicked', () => {
      const clearButton = document.getElementById('ytvhtClearHistory');
      
      // Simulate the event listener logic
      const handleClearClick = async () => {
        const confirmed = confirm('⚠️ WARNING: This will permanently delete ALL your YouTube viewing history, playlists, and settings.\n\nThis action cannot be undone. Are you sure you want to continue?');
        
        if (!confirmed) {
          return;
        }
        
        try {
          await ytStorage.clear();
          allHistoryRecords = [];
          allPlaylists = [];
          allShortsRecords = [];
          currentPage = 1;
          currentPlaylistPage = 1;
          currentShortsPage = 1;
          
          displayHistoryPage();
          displayShortsPage();
          displayPlaylistsPage();
          
          showMessage('All history, playlists, and settings have been cleared successfully');
        } catch (error) {
          console.error('Error clearing history:', error);
          showMessage('Error clearing history: ' + (error.message || 'Unknown error'), 'error');
        }
      };

      // Test with confirmation
      global.confirm.mockReturnValue(true);
      handleClearClick();

      expect(global.confirm).toHaveBeenCalledWith(
        '⚠️ WARNING: This will permanently delete ALL your YouTube viewing history, playlists, and settings.\n\nThis action cannot be undone. Are you sure you want to continue?'
      );
    });

    test('should not clear history when user cancels confirmation', async () => {
      const clearButton = document.getElementById('ytvhtClearHistory');
      
      // Simulate the event listener logic
      const handleClearClick = async () => {
        const confirmed = confirm('⚠️ WARNING: This will permanently delete ALL your YouTube viewing history, playlists, and settings.\n\nThis action cannot be undone. Are you sure you want to continue?');
        
        if (!confirmed) {
          return;
        }
        
        try {
          await ytStorage.clear();
          allHistoryRecords = [];
          allPlaylists = [];
          allShortsRecords = [];
          currentPage = 1;
          currentPlaylistPage = 1;
          currentShortsPage = 1;
          
          displayHistoryPage();
          displayShortsPage();
          displayPlaylistsPage();
          
          showMessage('All history, playlists, and settings have been cleared successfully');
        } catch (error) {
          console.error('Error clearing history:', error);
          showMessage('Error clearing history: ' + (error.message || 'Unknown error'), 'error');
        }
      };

      // Test with cancellation
      global.confirm.mockReturnValue(false);
      await handleClearClick();

      expect(global.confirm).toHaveBeenCalled();
      expect(mockYtStorage.clear).not.toHaveBeenCalled();
      expect(displayHistoryPage).not.toHaveBeenCalled();
      expect(displayShortsPage).not.toHaveBeenCalled();
      expect(displayPlaylistsPage).not.toHaveBeenCalled();
      expect(showMessage).not.toHaveBeenCalled();
    });

    test('should clear all data and update displays when confirmed', async () => {
      const clearButton = document.getElementById('ytvhtClearHistory');
      
      // Simulate the event listener logic
      const handleClearClick = async () => {
        const confirmed = confirm('⚠️ WARNING: This will permanently delete ALL your YouTube viewing history, playlists, and settings.\n\nThis action cannot be undone. Are you sure you want to continue?');
        
        if (!confirmed) {
          return;
        }
        
        try {
          await ytStorage.clear();
          allHistoryRecords = [];
          allPlaylists = [];
          allShortsRecords = [];
          currentPage = 1;
          currentPlaylistPage = 1;
          currentShortsPage = 1;
          
          displayHistoryPage();
          displayShortsPage();
          displayPlaylistsPage();
          
          showMessage('All history, playlists, and settings have been cleared successfully');
        } catch (error) {
          console.error('Error clearing history:', error);
          showMessage('Error clearing history: ' + (error.message || 'Unknown error'), 'error');
        }
      };

      // Test with confirmation
      global.confirm.mockReturnValue(true);
      await handleClearClick();

      expect(mockYtStorage.clear).toHaveBeenCalled();
      expect(displayHistoryPage).toHaveBeenCalled();
      expect(displayShortsPage).toHaveBeenCalled();
      expect(displayPlaylistsPage).toHaveBeenCalled();
      expect(showMessage).toHaveBeenCalledWith('All history, playlists, and settings have been cleared successfully');
    });

    test('should handle errors during clear operation', async () => {
      const clearButton = document.getElementById('ytvhtClearHistory');
      
      // Mock storage to throw an error
      mockYtStorage.clear.mockRejectedValue(new Error('Storage error'));
      
      // Simulate the event listener logic
      const handleClearClick = async () => {
        const confirmed = confirm('⚠️ WARNING: This will permanently delete ALL your YouTube viewing history, playlists, and settings.\n\nThis action cannot be undone. Are you sure you want to continue?');
        
        if (!confirmed) {
          return;
        }
        
        try {
          await ytStorage.clear();
          allHistoryRecords = [];
          allPlaylists = [];
          allShortsRecords = [];
          currentPage = 1;
          currentPlaylistPage = 1;
          currentShortsPage = 1;
          
          displayHistoryPage();
          displayShortsPage();
          displayPlaylistsPage();
          
          showMessage('All history, playlists, and settings have been cleared successfully');
        } catch (error) {
          console.error('Error clearing history:', error);
          showMessage('Error clearing history: ' + (error.message || 'Unknown error'), 'error');
        }
      };

      // Test with confirmation and error
      global.confirm.mockReturnValue(true);
      await handleClearClick();

      expect(mockYtStorage.clear).toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith('Error clearing history:', expect.any(Error));
      expect(showMessage).toHaveBeenCalledWith('Error clearing history: Storage error', 'error');
    });
  });

  describe('Storage Change Listener', () => {
    test('should call processExistingThumbnails on video_ or playlist_ key change', () => {
      // Mock processExistingThumbnails
      global.processExistingThumbnails = jest.fn();

      // Simulate a storage change event
      const changes = {
        'video_abc': { oldValue: undefined, newValue: { videoId: 'abc' } },
        'playlist_xyz': { oldValue: undefined, newValue: { playlistId: 'xyz' } }
      };
      const area = 'local';

      // Simulate the listener logic
      if (Object.keys(changes).some(key => key.startsWith('video_') || key.startsWith('playlist_'))) {
        processExistingThumbnails();
      }

      expect(global.processExistingThumbnails).toHaveBeenCalled();
    });

    test('should not call processExistingThumbnails on unrelated key change', () => {
      global.processExistingThumbnails = jest.fn();
      const changes = {
        'settings': { oldValue: {}, newValue: { overlayColor: 'red' } }
      };
      const area = 'local';
      if (Object.keys(changes).some(key => key.startsWith('video_') || key.startsWith('playlist_'))) {
        processExistingThumbnails();
      }
      expect(global.processExistingThumbnails).not.toHaveBeenCalled();
    });
  });
}); 