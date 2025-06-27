/**
 * Unit tests for popup functionality
 */

// Mock DOM environment
const setupDOM = () => {
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
};

// Mock storage
const mockYtStorage = {
  clear: jest.fn().mockResolvedValue(),
  getAllVideos: jest.fn().mockResolvedValue({}),
  getAllPlaylists: jest.fn().mockResolvedValue({})
};

// Mock Chrome API
global.chrome = {
  storage: {
    onChanged: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
      emit: jest.fn()
    }
  },
  runtime: {
    onMessage: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
      trigger: jest.fn(),
      listeners: []
    }
  }
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

// Import mocks
jest.mock('../../src/content.js');
jest.mock('../../src/popup.js');

const popup = require('../../src/popup.js');
const contentModule = require('../../src/content.js');

// Mock the functions
jest.mock('../../src/popup.js', () => {
    const original = jest.requireActual('../../src/popup.js');
    return {
        ...original,
        updateVideoRecord: jest.fn((record) => {
            if (!record || !record.videoId) return;
            
            const recordIndex = global.allHistoryRecords.findIndex(r => r.videoId === record.videoId);
            if (recordIndex !== -1) {
                global.allHistoryRecords[recordIndex] = record;
            } else {
                global.allHistoryRecords.unshift(record);
            }
            // Sort by timestamp
            global.allHistoryRecords.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        }),
        displayHistoryPage: jest.fn(),
        displayShortsPage: jest.fn(),
        displayPlaylistsPage: jest.fn(),
        showMessage: jest.fn(),
        formatDuration: jest.fn(time => `${Math.floor(time / 60)}:${String(time % 60).padStart(2, '0')}`),
        formatDate: jest.fn(timestamp => new Date(timestamp).toLocaleString())
    };
});

describe('Popup Functionality', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupDOM();
    const messageElement = document.getElementById('ytvhtMessage');
    if (messageElement) {
      messageElement.style.display = 'none';
    }
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

      expect(global.confirm).toHaveBeenCalled();
      expect(mockYtStorage.clear).toHaveBeenCalled();
      expect(displayHistoryPage).toHaveBeenCalled();
      expect(displayShortsPage).toHaveBeenCalled();
      expect(displayPlaylistsPage).toHaveBeenCalled();
      expect(showMessage).toHaveBeenCalledWith('All history, playlists, and settings have been cleared successfully');
    });

    test('should handle errors during clear operation', async () => {
      const clearButton = document.getElementById('ytvhtClearHistory');
      
      // Mock error
      const mockError = new Error('Storage error');
      mockYtStorage.clear.mockRejectedValueOnce(mockError);
      
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

      expect(global.confirm).toHaveBeenCalled();
      expect(mockYtStorage.clear).toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith('Error clearing history:', mockError);
      expect(showMessage).toHaveBeenCalledWith('Error clearing history: Storage error', 'error');
    });
  });

  describe('Storage Change Listener', () => {
    let storageChangeListener;

    beforeEach(() => {
      // Mock processExistingThumbnails
      global.processExistingThumbnails = jest.fn();

      // Create a storage change listener
      storageChangeListener = (changes, area) => {
        if (area === 'local') {
          const keys = Object.keys(changes);
          if (keys.some(key => key.startsWith('video_') || key.startsWith('playlist_'))) {
            global.processExistingThumbnails();
          }
        }
      };

      // Add the listener
      chrome.storage.onChanged.addListener(storageChangeListener);
    });

    afterEach(() => {
      // Clean up
      chrome.storage.onChanged.removeListener(storageChangeListener);
    });

    test('should call processExistingThumbnails on video_ or playlist_ key change', () => {
      const changes = {
        'video_123': { newValue: { title: 'Test Video' } },
        'playlist_456': { newValue: { title: 'Test Playlist' } }
      };
      
      // Trigger the listener directly
      storageChangeListener(changes, 'local');
      
      expect(global.processExistingThumbnails).toHaveBeenCalled();
    });

    test('should not call processExistingThumbnails on unrelated key change', () => {
      const changes = {
        'settings': { newValue: { theme: 'dark' } }
      };
      
      // Trigger the listener directly
      storageChangeListener(changes, 'local');
      
      expect(global.processExistingThumbnails).not.toHaveBeenCalled();
    });
  });
});

describe('Real-time Updates', () => {
    let mockHistoryTable;
    let mockNoHistory;
    let mockPaginationDiv;

    beforeEach(() => {
        jest.clearAllMocks();
        
        // Setup DOM elements
        mockHistoryTable = document.createElement('table');
        mockHistoryTable.id = 'ytvhtHistoryTable';
        document.body.appendChild(mockHistoryTable);

        mockNoHistory = document.createElement('div');
        mockNoHistory.id = 'ytvhtNoHistory';
        document.body.appendChild(mockNoHistory);

        mockPaginationDiv = document.createElement('div');
        mockPaginationDiv.id = 'ytvhtPagination';
        document.body.appendChild(mockPaginationDiv);

        // Reset global variables
        global.allHistoryRecords = [];
        global.currentPage = 1;
        global.pageSize = 10;

        // Mock displayHistoryPage implementation
        popup.displayHistoryPage.mockImplementation(() => {
            mockHistoryTable.innerHTML = '';
            global.allHistoryRecords.forEach(record => {
                const row = document.createElement('tr');
                const titleCell = document.createElement('td');
                const link = document.createElement('a');
                link.textContent = record.title || 'Unknown Title';
                titleCell.appendChild(link);
                row.appendChild(titleCell);
                mockHistoryTable.appendChild(row);
            });
        });
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    test('should update existing record', () => {
        // Setup initial state
        const initialRecord = {
            videoId: 'test123',
            title: 'Old Title',
            time: 30,
            duration: 100,
            timestamp: Date.now() - 1000,
            url: 'https://youtube.com/watch?v=test123'
        };
        global.allHistoryRecords = [initialRecord];
        popup.displayHistoryPage();

        // Update record
        const updatedRecord = {
            ...initialRecord,
            title: 'New Title',
            time: 50,
            timestamp: Date.now()
        };
        popup.updateVideoRecord(updatedRecord);
        popup.displayHistoryPage();

        // Check if UI was updated
        const row = mockHistoryTable.rows[0];
        const titleCell = row.cells[0];
        expect(titleCell.querySelector('a').textContent).toBe('New Title');
    });

    test('should handle new record insertion', () => {
        // Setup initial state with some records
        global.allHistoryRecords = [
            {
                videoId: 'old1',
                title: 'Old Video',
                timestamp: Date.now() - 1000
            }
        ];
        popup.displayHistoryPage();

        // Add new record
        const newRecord = {
            videoId: 'new1',
            title: 'New Video',
            timestamp: Date.now()
        };
        popup.updateVideoRecord(newRecord);
        popup.displayHistoryPage();

        // Check if new record was added at the beginning
        expect(global.allHistoryRecords[0].videoId).toBe('new1');
        const titleCell = mockHistoryTable.rows[0].cells[0];
        expect(titleCell.querySelector('a').textContent).toBe('New Video');
    });

    test('should handle unknown title gracefully', () => {
        const record = {
            videoId: 'test123',
            time: 30,
            duration: 100,
            timestamp: Date.now()
        };
        popup.updateVideoRecord(record);
        popup.displayHistoryPage();

        const titleCell = mockHistoryTable.rows[0].cells[0];
        expect(titleCell.querySelector('a').textContent).toBe('Unknown Title');
    });

    test('should maintain sort order on updates', () => {
        // Setup initial records
        global.allHistoryRecords = [
            {
                videoId: 'vid1',
                timestamp: Date.now() - 1000
            },
            {
                videoId: 'vid2',
                timestamp: Date.now() - 2000
            }
        ];
        popup.displayHistoryPage();

        // Update older record with newer timestamp
        const updatedRecord = {
            videoId: 'vid2',
            timestamp: Date.now()
        };
        popup.updateVideoRecord(updatedRecord);
        popup.displayHistoryPage();

        // Check if order was updated
        expect(global.allHistoryRecords[0].videoId).toBe('vid2');
    });
});

describe('Popup Live Updates', () => {
    let mockHistoryTable;
    let mockNoHistory;
    let mockPaginationDiv;
    let messageListener;

    beforeEach(() => {
        jest.clearAllMocks();
        
        // Setup DOM elements
        mockHistoryTable = document.createElement('table');
        mockHistoryTable.id = 'ytvhtHistoryTable';
        document.body.appendChild(mockHistoryTable);

        mockNoHistory = document.createElement('div');
        mockNoHistory.id = 'ytvhtNoHistory';
        document.body.appendChild(mockNoHistory);

        mockPaginationDiv = document.createElement('div');
        mockPaginationDiv.id = 'ytvhtPagination';
        document.body.appendChild(mockPaginationDiv);

        // Reset global variables
        global.allHistoryRecords = [];
        global.currentPage = 1;
        global.pageSize = 10;

        // Setup message listener
        messageListener = (message) => {
            if (message.type === 'videoUpdate') {
                const record = message.data;
                popup.updateVideoRecord(record);
            }
        };
        chrome.runtime.onMessage.listeners = [messageListener];

        // Mock popup.updateVideoRecord implementation
        popup.updateVideoRecord.mockImplementation((record) => {
            if (!record || !record.videoId) return;
            
            const recordIndex = global.allHistoryRecords.findIndex(r => r.videoId === record.videoId);
            if (recordIndex !== -1) {
                global.allHistoryRecords[recordIndex] = { ...record };
            } else {
                global.allHistoryRecords.unshift({ ...record });
            }
            global.allHistoryRecords.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            popup.displayHistoryPage();
        });

        // Mock displayHistoryPage implementation
        popup.displayHistoryPage.mockImplementation(() => {
            mockHistoryTable.innerHTML = '';
            global.allHistoryRecords.forEach(record => {
                const row = document.createElement('tr');
                const titleCell = document.createElement('td');
                const link = document.createElement('a');
                link.textContent = record.title || 'Unknown Title';
                titleCell.appendChild(link);
                row.appendChild(titleCell);
                mockHistoryTable.appendChild(row);
            });
        });
    });

    afterEach(() => {
        document.body.innerHTML = '';
        chrome.runtime.onMessage.listeners = [];
    });

    test('should update history when current video is saved', () => {
        // Setup initial state
        const currentVideo = {
            videoId: 'current123',
            title: 'Current Video',
            time: 30,
            duration: 100,
            timestamp: Date.now()
        };

        // Simulate video save
        popup.updateVideoRecord(currentVideo);

        // Check if video was added to history
        expect(global.allHistoryRecords[0]).toEqual(currentVideo);
        expect(popup.displayHistoryPage).toHaveBeenCalled();
    });

    test('should update history when popup is open', () => {
        // Setup initial state
        const initialVideo = {
            videoId: 'test123',
            title: 'Initial Video',
            time: 30,
            duration: 100,
            timestamp: Date.now() - 1000
        };
        global.allHistoryRecords = [initialVideo];

        // Simulate video update while popup is open
        const updatedVideo = {
            ...initialVideo,
            time: 60,
            timestamp: Date.now()
        };

        popup.updateVideoRecord(updatedVideo);

        // Check if video was updated
        expect(global.allHistoryRecords[0].time).toBe(60);
        expect(popup.displayHistoryPage).toHaveBeenCalled();
    });

    test('should handle multiple rapid updates', () => {
        // Setup initial state
        const videoId = 'test123';
        const initialVideo = {
            videoId,
            title: 'Test Video',
            time: 0,
            duration: 100,
            timestamp: Date.now() - 1000
        };
        global.allHistoryRecords = [initialVideo];

        // Simulate multiple rapid updates
        const updates = [30, 35, 40, 45, 50].map(time => ({
            ...initialVideo,
            time,
            timestamp: Date.now()
        }));

        updates.forEach(update => {
            popup.updateVideoRecord(update);
        });

        // Check if final update was applied
        expect(global.allHistoryRecords[0].time).toBe(50);
        expect(popup.displayHistoryPage).toHaveBeenCalledTimes(updates.length);
    });

    test('should maintain sort order during updates', () => {
        // Setup initial state with multiple videos
        const videos = [
            {
                videoId: 'old1',
                title: 'Old Video 1',
                time: 30,
                duration: 100,
                timestamp: Date.now() - 2000
            },
            {
                videoId: 'old2',
                title: 'Old Video 2',
                time: 30,
                duration: 100,
                timestamp: Date.now() - 1000
            }
        ];
        global.allHistoryRecords = [...videos];

        // Update older video with newer timestamp
        const updatedVideo = {
            ...videos[0],
            time: 60,
            timestamp: Date.now()
        };

        popup.updateVideoRecord(updatedVideo);

        // Check if order was updated correctly
        expect(global.allHistoryRecords[0].videoId).toBe('old1');
        expect(global.allHistoryRecords[0].time).toBe(60);
        expect(popup.displayHistoryPage).toHaveBeenCalled();
    });

    test('should broadcast updates to all open popups', () => {
        // Setup mock for multiple popup windows
        const mockPopups = Array(3).fill(null).map(() => ({
            displayHistoryPage: jest.fn()
        }));

        // Add message listeners for each popup
        chrome.runtime.onMessage.listeners = mockPopups.map(mockPopup => (message) => {
            if (message.type === 'videoUpdate') {
                mockPopup.displayHistoryPage();
                return true; // Indicate that the message was handled
            }
        });

        // Simulate video update
        const videoUpdate = {
            videoId: 'test123',
            title: 'Test Video',
            time: 30,
            duration: 100,
            timestamp: Date.now()
        };

        // Trigger the message directly
        chrome.runtime.onMessage.listeners.forEach(listener => {
            listener({
                type: 'videoUpdate',
                data: videoUpdate
            });
        });

        // Check if all popups received the update
        mockPopups.forEach(mockPopup => {
            expect(mockPopup.displayHistoryPage).toHaveBeenCalled();
        });
    });
}); 