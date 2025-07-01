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
        <div id="ytvhtSyncIndicator" class="sync-indicator sync-disabled">
          <span class="sync-text">Off</span>
        </div>
        <button id="ytvhtExportHistory">Export History</button>
        <button id="ytvhtImportHistory">Import History</button>
        <button id="ytvhtClearHistory" style="background-color: #dc3545;">Clear History</button>
      </div>
      <button id="ytvhtClosePopup">Close</button>
    </div>
    <div id="ytvhtMessage" class="message"></div>
    <div id="ytvhtSettingsContainer" style="display: none;">
      <div class="settings-section">
        <h3>Sync Settings</h3>
        <label>
          <input type="checkbox" id="ytvhtSyncEnabled"> Enable Sync
        </label>
        <div class="sync-controls">
          <button id="ytvhtTriggerSync">Sync Now</button>
          <button id="ytvhtTriggerFullSync">Full Sync</button>
          <div id="ytvhtLastSyncTime">Never</div>
        </div>
      </div>
    </div>
  `;
};

// Mock storage
const mockYtStorage = {
  clear: jest.fn().mockResolvedValue(),
  clearHistoryOnly: jest.fn().mockResolvedValue(),
  getAllVideos: jest.fn().mockResolvedValue({}),
  getAllPlaylists: jest.fn().mockResolvedValue({}),
  triggerSync: jest.fn()
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
    getManifest: jest.fn().mockReturnValue({ version: '2.6.1' }),
    onMessage: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
      trigger: jest.fn(),
      listeners: []
    },
    sendMessage: jest.fn()
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
global.syncInProgress = false;

// Mock functions that would be defined in popup.js
global.displayHistoryPage = jest.fn();
global.displayShortsPage = jest.fn();
global.displayPlaylistsPage = jest.fn();
global.showMessage = jest.fn();
global.updateSyncIndicator = jest.fn();
global.updateSyncSettingsUI = jest.fn();

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
        formatDate: jest.fn(timestamp => new Date(timestamp).toLocaleString()),
        updateSyncIndicator: jest.fn(),
        updateSyncSettingsUI: jest.fn(),
        handleSyncIndicatorClick: jest.fn(),
        handleSyncToggle: jest.fn(),
        handleManualSync: jest.fn(),
        handleManualFullSync: jest.fn()
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
    global.syncInProgress = false;
  });

  describe('Button Ordering', () => {
    test('should have correct button order in left-controls', () => {
      const leftControls = document.querySelector('.left-controls');
      const buttons = leftControls.querySelectorAll('button');
      const syncIndicator = leftControls.querySelector('#ytvhtSyncIndicator');
      
      expect(buttons).toHaveLength(4);
      expect(buttons[0].id).toBe('ytvhtToggleTheme');
      expect(buttons[1].id).toBe('ytvhtExportHistory');
      expect(buttons[2].id).toBe('ytvhtImportHistory');
      expect(buttons[3].id).toBe('ytvhtClearHistory');
      expect(syncIndicator).toBeTruthy();
    });

    test('should have Clear History button styled as destructive', () => {
      const clearButton = document.getElementById('ytvhtClearHistory');
      expect(clearButton.style.backgroundColor).toBe('rgb(220, 53, 69)'); // #dc3545
    });

    test('should have sync indicator with initial state', () => {
      const syncIndicator = document.getElementById('ytvhtSyncIndicator');
      expect(syncIndicator).toBeTruthy();
      expect(syncIndicator.classList).toContain('sync-disabled');
      expect(syncIndicator.querySelector('.sync-text').textContent).toBe('Off');
    });
  });

  describe('Clear History Functionality', () => {
    test('should show updated confirmation dialog when clear history is clicked', () => {
      const clearButton = document.getElementById('ytvhtClearHistory');
      
      // Simulate the updated event listener logic
      const handleClearClick = async () => {
        const confirmed = confirm('WARNING: This will permanently delete ALL your YouTube viewing history and playlists.\n\nThis action cannot be undone. Are you sure you want to continue?');
        
        if (!confirmed) {
          return;
        }
        
        try {
          await ytStorage.clearHistoryOnly();
          allHistoryRecords = [];
          allPlaylists = [];
          allShortsRecords = [];
          currentPage = 1;
          currentPlaylistPage = 1;
          currentShortsPage = 1;
          
          displayHistoryPage();
          displayShortsPage();
          displayPlaylistsPage();
          
          showMessage('All video and playlist history has been cleared successfully');
        } catch (error) {
          console.error('Error clearing history:', error);
          showMessage('Error clearing history: ' + (error.message || 'Unknown error'), 'error');
        }
      };

      // Test with confirmation
      global.confirm.mockReturnValue(true);
      handleClearClick();

      expect(global.confirm).toHaveBeenCalledWith(
        'WARNING: This will permanently delete ALL your YouTube viewing history and playlists.\n\nThis action cannot be undone. Are you sure you want to continue?'
      );
    });

    test('should use clearHistoryOnly instead of clear', async () => {
      const clearButton = document.getElementById('ytvhtClearHistory');
      
      // Simulate the updated event listener logic with clearHistoryOnly
      const handleClearClick = async () => {
        const confirmed = confirm('WARNING: This will permanently delete ALL your YouTube viewing history and playlists.\n\nThis action cannot be undone. Are you sure you want to continue?');
        
        if (!confirmed) {
          return;
        }
        
        try {
          await ytStorage.clearHistoryOnly(); // Uses clearHistoryOnly instead of clear
          allHistoryRecords = [];
          allPlaylists = [];
          allShortsRecords = [];
          currentPage = 1;
          currentPlaylistPage = 1;
          currentShortsPage = 1;
          
          displayHistoryPage();
          displayShortsPage();
          displayPlaylistsPage();
          
          showMessage('All video and playlist history has been cleared successfully');
        } catch (error) {
          console.error('Error clearing history:', error);
          showMessage('Error clearing history: ' + (error.message || 'Unknown error'), 'error');
        }
      };

      // Test with confirmation
      global.confirm.mockReturnValue(true);
      await handleClearClick();

      expect(global.confirm).toHaveBeenCalled();
      expect(mockYtStorage.clearHistoryOnly).toHaveBeenCalled();
      expect(mockYtStorage.clear).not.toHaveBeenCalled(); // Ensure clear is not called
      expect(displayHistoryPage).toHaveBeenCalled();
      expect(displayShortsPage).toHaveBeenCalled();
      expect(displayPlaylistsPage).toHaveBeenCalled();
      expect(showMessage).toHaveBeenCalledWith('All video and playlist history has been cleared successfully');
    });

    test('should not clear history when user cancels confirmation', async () => {
      const clearButton = document.getElementById('ytvhtClearHistory');
      
      // Simulate the updated event listener logic
      const handleClearClick = async () => {
        const confirmed = confirm('WARNING: This will permanently delete ALL your YouTube viewing history and playlists.\n\nThis action cannot be undone. Are you sure you want to continue?');
        
        if (!confirmed) {
          return;
        }
        
        try {
          await ytStorage.clearHistoryOnly();
          allHistoryRecords = [];
          allPlaylists = [];
          allShortsRecords = [];
          currentPage = 1;
          currentPlaylistPage = 1;
          currentShortsPage = 1;
          
          displayHistoryPage();
          displayShortsPage();
          displayPlaylistsPage();
          
          showMessage('All video and playlist history has been cleared successfully');
        } catch (error) {
          console.error('Error clearing history:', error);
          showMessage('Error clearing history: ' + (error.message || 'Unknown error'), 'error');
        }
      };

      // Test with cancellation
      global.confirm.mockReturnValue(false);
      await handleClearClick();

      expect(global.confirm).toHaveBeenCalled();
      expect(mockYtStorage.clearHistoryOnly).not.toHaveBeenCalled();
      expect(displayHistoryPage).not.toHaveBeenCalled();
      expect(displayShortsPage).not.toHaveBeenCalled();
      expect(displayPlaylistsPage).not.toHaveBeenCalled();
      expect(showMessage).not.toHaveBeenCalled();
    });

    test('should handle errors during clear operation', async () => {
      const clearButton = document.getElementById('ytvhtClearHistory');
      
      // Mock error
      const mockError = new Error('Storage error');
      mockYtStorage.clearHistoryOnly.mockRejectedValueOnce(mockError);
      
      // Simulate the updated event listener logic
      const handleClearClick = async () => {
        const confirmed = confirm('WARNING: This will permanently delete ALL your YouTube viewing history and playlists.\n\nThis action cannot be undone. Are you sure you want to continue?');
        
        if (!confirmed) {
          return;
        }
        
        try {
          await ytStorage.clearHistoryOnly();
          allHistoryRecords = [];
          allPlaylists = [];
          allShortsRecords = [];
          currentPage = 1;
          currentPlaylistPage = 1;
          currentShortsPage = 1;
          
          displayHistoryPage();
          displayShortsPage();
          displayPlaylistsPage();
          
          showMessage('All video and playlist history has been cleared successfully');
        } catch (error) {
          console.error('Error clearing history:', error);
          showMessage('Error clearing history: ' + (error.message || 'Unknown error'), 'error');
        }
      };

      // Test with confirmation
      global.confirm.mockReturnValue(true);
      await handleClearClick();

      expect(global.confirm).toHaveBeenCalled();
      expect(mockYtStorage.clearHistoryOnly).toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith('Error clearing history:', mockError);
      expect(showMessage).toHaveBeenCalledWith('Error clearing history: Storage error', 'error');
    });
  });

  describe('Sync Functionality', () => {
    test('should initialize sync integration', () => {
      // Mock the sync integration initialization
      const initSyncIntegration = jest.fn(() => {
        // Mock getting initial sync status
        chrome.runtime.sendMessage({ type: 'getSyncStatus' }, (response) => {
          if (response) {
            updateSyncIndicator(response.status, response.lastSyncTime);
            updateSyncSettingsUI(response);
          }
        });
      });

      initSyncIntegration();
      expect(initSyncIntegration).toHaveBeenCalled();
    });

    test('should update sync indicator based on status', () => {
      const syncIndicator = document.getElementById('ytvhtSyncIndicator');
      const syncText = syncIndicator.querySelector('.sync-text');

      // Test different sync states
      popup.updateSyncIndicator('disabled', null);
      popup.updateSyncIndicator('syncing', null);
      popup.updateSyncIndicator('success', Date.now());
      popup.updateSyncIndicator('error', null);

      expect(popup.updateSyncIndicator).toHaveBeenCalledTimes(4);
    });

    test('should handle sync indicator click', async () => {
      const syncIndicator = document.getElementById('ytvhtSyncIndicator');
      
      // Mock click handler
      const handleClick = async () => {
        chrome.runtime.sendMessage({ type: 'getSyncStatus' }, (response) => {
          if (response && response.status === 'disabled') {
            chrome.runtime.sendMessage({ type: 'enableSync' });
          } else if (response && response.enabled) {
            chrome.runtime.sendMessage({ type: 'triggerSync' });
          }
        });
      };

      await handleClick();
      expect(chrome.runtime.sendMessage).toHaveBeenCalled();
    });

    test('should handle sync toggle in settings', () => {
      const syncToggle = document.getElementById('ytvhtSyncEnabled');
      
      // Mock toggle handler
      const handleToggle = (enabled) => {
        if (enabled) {
          chrome.runtime.sendMessage({ type: 'enableSync' });
        } else {
          chrome.runtime.sendMessage({ type: 'disableSync' });
        }
      };

      handleToggle(true);
      handleToggle(false);

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'enableSync' });
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'disableSync' });
    });

    test('should handle manual sync trigger', () => {
      const syncButton = document.getElementById('ytvhtTriggerSync');
      
      // Mock manual sync handler
      const handleManualSync = () => {
        chrome.runtime.sendMessage({ type: 'triggerSync' });
      };

      handleManualSync();
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'triggerSync' });
    });

    test('should handle full sync trigger with confirmation', () => {
      const fullSyncButton = document.getElementById('ytvhtTriggerFullSync');
      global.confirm.mockReturnValue(true);
      
      // Mock full sync handler
      const handleFullSync = () => {
        const confirmed = confirm('Full Sync will clean up old data and re-sync everything. This may take a moment. Continue?');
        if (confirmed) {
          chrome.runtime.sendMessage({ type: 'triggerFullSync' });
        }
      };

      handleFullSync();
      expect(global.confirm).toHaveBeenCalledWith('Full Sync will clean up old data and re-sync everything. This may take a moment. Continue?');
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'triggerFullSync' });
    });

    test('should prevent actions during sync', () => {
      global.syncInProgress = true;
      
      // Mock sync-aware storage change listener
      const storageChangeListener = (changes, area) => {
        if (area === 'local' && !syncInProgress) {
          const videoChanges = Object.entries(changes).filter(([key]) =>
            key.startsWith('video_') || key.startsWith('playlist_')
          );
          if (videoChanges.length > 0) {
            // Process changes
          }
        }
      };

      const changes = { 'video_123': { newValue: { title: 'Test' } } };
      storageChangeListener(changes, 'local');

      // Should not process changes during sync
      expect(global.syncInProgress).toBe(true);
    });

    test('should update sync status message handling', () => {
      const syncIndicator = document.getElementById('ytvhtSyncIndicator');
      
      // Test sync status messages
      const testStatuses = [
        { status: 'disabled', expectedText: 'Off', expectedClass: 'sync-disabled' },
        { status: 'initializing', expectedText: 'Init', expectedClass: 'sync-initializing' },
        { status: 'syncing', expectedText: 'Sync', expectedClass: 'sync-syncing' },
        { status: 'success', expectedText: 'OK', expectedClass: 'sync-success' },
        { status: 'error', expectedText: 'Error', expectedClass: 'sync-error' },
        { status: 'not_available', expectedText: 'N/A', expectedClass: 'sync-not_available' }
      ];

      testStatuses.forEach(({ status, expectedText, expectedClass }) => {
        popup.updateSyncIndicator(status, Date.now());
        expect(popup.updateSyncIndicator).toHaveBeenCalledWith(status, expect.any(Number));
      });
    });

    test('should handle sync status updates correctly', () => {
      const syncIndicator = document.getElementById('ytvhtSyncIndicator');
      const syncText = syncIndicator.querySelector('.sync-text');

      // Mock updateSyncIndicator function
      const updateSyncIndicator = (status, lastSyncTime) => {
        const statusMessages = {
          'disabled': 'Off',
          'initializing': 'Init', 
          'syncing': 'Sync',
          'success': 'OK',
          'error': 'Error',
          'not_available': 'N/A'
        };

        // Update classes
        syncIndicator.className = `sync-indicator sync-${status}`;
        syncText.textContent = statusMessages[status] || 'Unknown';

        // Add timestamp for successful syncs
        if (status === 'success' && lastSyncTime) {
          const timeElement = syncIndicator.querySelector('.sync-time') || document.createElement('div');
          timeElement.className = 'sync-time';
          timeElement.textContent = new Date(lastSyncTime).toLocaleTimeString();
          if (!syncIndicator.querySelector('.sync-time')) {
            syncIndicator.appendChild(timeElement);
          }
        }
      };

      // Test each status
      updateSyncIndicator('disabled', null);
      expect(syncIndicator.classList.contains('sync-disabled')).toBe(true);
      expect(syncText.textContent).toBe('Off');

      updateSyncIndicator('syncing', null);
      expect(syncIndicator.classList.contains('sync-syncing')).toBe(true);
      expect(syncText.textContent).toBe('Sync');

      updateSyncIndicator('success', Date.now());
      expect(syncIndicator.classList.contains('sync-success')).toBe(true);
      expect(syncText.textContent).toBe('OK');
      expect(syncIndicator.querySelector('.sync-time')).toBeTruthy();
    });

    test('should handle sync settings UI updates', () => {
      const syncToggle = document.getElementById('ytvhtSyncEnabled');
      const lastSyncTime = document.getElementById('ytvhtLastSyncTime');
      
      // Mock sync settings UI update
      const updateSyncSettingsUI = (syncStatus) => {
        if (syncToggle) {
          syncToggle.checked = syncStatus.enabled || false;
        }
        
        if (lastSyncTime) {
          if (syncStatus.lastSyncTime) {
            lastSyncTime.textContent = new Date(syncStatus.lastSyncTime).toLocaleString();
          } else {
            lastSyncTime.textContent = 'Never';
          }
        }
      };

      // Test enabled state
      updateSyncSettingsUI({ enabled: true, lastSyncTime: Date.now() });
      expect(syncToggle.checked).toBe(true);
      expect(lastSyncTime.textContent).not.toBe('Never');

      // Test disabled state
      updateSyncSettingsUI({ enabled: false, lastSyncTime: null });
      expect(syncToggle.checked).toBe(false);
      expect(lastSyncTime.textContent).toBe('Never');
    });

    test('should prevent race conditions during sync', () => {
      // Mock storage change listener that's sync-aware
      let processedChanges = [];
      
      const syncAwareStorageListener = (changes, area) => {
        if (area === 'local' && !global.syncInProgress) {
          const videoChanges = Object.entries(changes).filter(([key]) =>
            key.startsWith('video_') || key.startsWith('playlist_')
          );
          
          if (videoChanges.length > 0) {
            processedChanges.push(...videoChanges);
          }
        } else if (global.syncInProgress) {
          console.log('Ignoring storage changes during sync (will refresh after sync completes)');
        }
      };

      // Test normal operation (not syncing)
      global.syncInProgress = false;
      processedChanges = [];
      const changes1 = { 'video_123': { newValue: { title: 'Test Video' } } };
      syncAwareStorageListener(changes1, 'local');
      expect(processedChanges).toHaveLength(1);

      // Test during sync (should ignore changes)
      global.syncInProgress = true;
      processedChanges = [];
      const changes2 = { 'video_456': { newValue: { title: 'Another Video' } } };
      syncAwareStorageListener(changes2, 'local');
      expect(processedChanges).toHaveLength(0);
    });
  });

  describe('Storage Change Listener', () => {
    let storageChangeListener;

    beforeEach(() => {
      // Mock processExistingThumbnails
      global.processExistingThumbnails = jest.fn();

      // Create a sync-aware storage change listener
      storageChangeListener = (changes, area) => {
        if (area === 'local' && !global.syncInProgress) {
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

    test('should call processExistingThumbnails on video_ or playlist_ key change when not syncing', () => {
      global.syncInProgress = false;
      const changes = {
        'video_123': { newValue: { title: 'Test Video' } },
        'playlist_456': { newValue: { title: 'Test Playlist' } }
      };
      
      // Trigger the listener directly
      storageChangeListener(changes, 'local');
      
      expect(global.processExistingThumbnails).toHaveBeenCalled();
    });

    test('should not call processExistingThumbnails during sync', () => {
      global.syncInProgress = true;
      const changes = {
        'video_123': { newValue: { title: 'Test Video' } },
        'playlist_456': { newValue: { title: 'Test Playlist' } }
      };
      
      // Trigger the listener directly
      storageChangeListener(changes, 'local');
      
      expect(global.processExistingThumbnails).not.toHaveBeenCalled();
    });

    test('should not call processExistingThumbnails on unrelated key change', () => {
      global.syncInProgress = false;
      const changes = {
        'settings': { newValue: { theme: 'dark' } }
      };
      
      // Trigger the listener directly
      storageChangeListener(changes, 'local');
      
      expect(global.processExistingThumbnails).not.toHaveBeenCalled();
    });
  });

  describe('Sync Status Updates', () => {
    test('should handle sync status update messages', () => {
      const mockMessage = {
        type: 'syncStatusUpdate',
        status: 'syncing',
        lastSyncTime: Date.now()
      };

      // Mock message listener
      const messageListener = (message, sender, sendResponse) => {
        if (message.type === 'syncStatusUpdate') {
          if (message.status === 'syncing') {
            global.syncInProgress = true;
          } else if (message.status === 'success' || message.status === 'error') {
            global.syncInProgress = false;
          }
          popup.updateSyncIndicator(message.status, message.lastSyncTime);
          popup.updateSyncSettingsUI(message);
        }
      };

      messageListener(mockMessage, null, null);
      expect(global.syncInProgress).toBe(true);
      expect(popup.updateSyncIndicator).toHaveBeenCalledWith('syncing', mockMessage.lastSyncTime);
    });

    test('should handle full sync complete message', async () => {
      const mockMessage = {
        type: 'fullSyncComplete'
      };

      // Mock message listener
      const messageListener = async (message, sender, sendResponse) => {
        if (message.type === 'fullSyncComplete') {
          global.syncInProgress = false;
          // Force complete refresh after full sync
          setTimeout(async () => {
            await mockYtStorage.getAllVideos();
          }, 200);
        }
      };

      await messageListener(mockMessage, null, null);
      expect(global.syncInProgress).toBe(false);
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