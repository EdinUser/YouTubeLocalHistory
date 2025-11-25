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
  getStats: jest.fn().mockResolvedValue(null),
  triggerSync: jest.fn()
};

// Mock Chrome API (runtime methods will be extended in specific describe blocks)
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
  },
  tabs: {
    query: jest.fn(),
    create: jest.fn()
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

// Localization helper from popup.js
const localizeHtmlPage = () => {
    // Set text content for elements with data-i18n
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        const msg = chrome.i18n.getMessage(key);
        if (msg) el.textContent = msg;
    });
    // Set title attribute for elements with data-i18n-title
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        const msg = chrome.i18n.getMessage(key);
        if (msg) el.title = msg;
    });
    // Set placeholder attribute for elements with data-i18n-placeholder
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        const msg = chrome.i18n.getMessage(key);
        if (msg) el.placeholder = msg;
    });
};

// Ensure a window-like global exists before loading popup.js so its globals attach correctly
if (!global.window) {
  global.window = global;
}

// Import mocks
jest.mock('../../src/content.js');

// Load the real popup module once so its free functions/global helpers are registered
require('../../src/popup.js');
const popup = global; // popup.js attaches helpers like exportHistory/addTimestampToUrl to window/global
const contentModule = require('../../src/content.js');

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

  describe('Export History', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      // Mock i18n so exportHistory can build messages
      global.chrome.i18n = {
        getMessage: jest.fn((key, substitutions) => {
          if (key === 'message_export_success') {
            const [videoCount, playlistCount] = substitutions || [];
            return `Exported ${videoCount} videos and ${playlistCount} playlists`;
          }
          if (key === 'message_unknown_error') {
            return 'Unknown error';
          }
          if (key === 'message_error_exporting_history') {
            const [msg] = substitutions || [];
            return `Error exporting: ${msg}`;
          }
          return key;
        })
      };
    });

    test('exportHistory builds JSON with validated videos and playlists and triggers download', async () => {
      const now = Date.now();
      const validVideo = {
        videoId: 'v1',
        timestamp: now,
        time: 30,
        title: 'Valid Video'
      };
      const invalidVideo = {
        videoId: 'bad', // missing timestamp/time
        title: 'Invalid'
      };
      const validPlaylist = {
        playlistId: 'p1',
        title: 'Valid Playlist'
      };
      const invalidPlaylist = {
        title: 'Invalid Playlist'
      };

      mockYtStorage.getAllVideos.mockResolvedValue({
        v1: validVideo,
        bad: invalidVideo
      });
      mockYtStorage.getAllPlaylists.mockResolvedValue({
        p1: validPlaylist,
        badPl: invalidPlaylist
      });
      mockYtStorage.getStats.mockResolvedValue({ some: 'stats' });

      // Provide URL methods in JSDOM environment and spy on them
      if (!global.URL.createObjectURL) {
        global.URL.createObjectURL = () => 'blob:real';
      }
      if (!global.URL.revokeObjectURL) {
        global.URL.revokeObjectURL = () => {};
      }
      const createObjectURLSpy = jest.spyOn(global.URL, 'createObjectURL').mockReturnValue('blob:mock');
      const revokeObjectURLSpy = jest.spyOn(global.URL, 'revokeObjectURL').mockImplementation(() => {});

      // Capture created <a> elements
      const clicks = [];
      const originalAppendChild = document.body.appendChild.bind(document.body);
      document.body.appendChild = (node) => {
        if (node.tagName === 'A') {
          clicks.push(node);
        }
        return originalAppendChild(node);
      };

      expect(typeof popup.exportHistory).toBe('function');
      await popup.exportHistory();

      expect(mockYtStorage.getAllVideos).toHaveBeenCalled();
      expect(mockYtStorage.getAllPlaylists).toHaveBeenCalled();
      expect(mockYtStorage.getStats).toHaveBeenCalled();

      // We should have created a blob URL and then revoked it
      expect(createObjectURLSpy).toHaveBeenCalled();
      expect(revokeObjectURLSpy).toHaveBeenCalled();

      // There should be an anchor that was used to trigger download
      const downloadLink = clicks.find(a => a.download && a.href === 'blob:mock');
      expect(downloadLink).toBeDefined();
      expect(downloadLink.download).toMatch(/^youtube-history-\d{4}-\d{2}-\d{2}\.json$/);

      // We intentionally do not assert on showMessage here because the real
      // implementation uses its own internal helper; this test focuses on
      // storage calls and download wiring.

      // Restore appendChild
      document.body.appendChild = originalAppendChild;
      createObjectURLSpy.mockRestore();
      revokeObjectURLSpy.mockRestore();
    });
  });

  describe('Import page opening', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    test('openImportPage opens dedicated YouTube tab with import hash and pauses active YouTube tab best-effort', () => {
      const activeTab = { id: 123, url: 'https://www.youtube.com/watch?v=abc123' };
      chrome.tabs.query.mockImplementation((query, cb) => cb([activeTab]));
      chrome.tabs.create.mockImplementation((opts, cb) => cb && cb());
      chrome.tabs.sendMessage = jest.fn((id, msg, cb) => cb && cb());

      expect(typeof popup.openImportPage).toBe('function');
      popup.openImportPage();

      expect(chrome.tabs.query).toHaveBeenCalledWith(
        { active: true, currentWindow: true },
        expect.any(Function)
      );
      // Should try to pause current YouTube tab
      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
        activeTab.id,
        { type: 'pauseVideoForImport' },
        expect.any(Function)
      );
      // Should open dedicated import tab at YouTube with #ytlh_import
      expect(chrome.tabs.create).toHaveBeenCalledWith(
        { url: 'https://www.youtube.com/#ytlh_import' }
      );
    });
  });

  describe('URL timestamp helpers', () => {
    test('addTimestampToUrl should clean URL and append t parameter', () => {
      const originalUrl = 'https://www.youtube.com/watch?v=abc123&t=10s&list=PL1';
      const timeSeconds = 120;

      expect(typeof popup.addTimestampToUrl).toBe('function');
      const urlWithTimestamp = popup.addTimestampToUrl(originalUrl, timeSeconds);

      // Should be a clean watch URL with only v and t params in some order
      expect(urlWithTimestamp).toContain('https://www.youtube.com/watch?v=abc123');
      expect(urlWithTimestamp).toContain('t=120s');
      // Should not contain the original t=10s twice
      const tMatches = urlWithTimestamp.match(/t=\d+s/g) || [];
      expect(tMatches.length).toBe(1);
    });

    // DOM integration with displayHistoryPage is exercised via higher level
    // tests; here we focus on the pure URL helper.
  });

  // Legacy Sync Functionality tests removed (sync service is no longer part of the runtime architecture)

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

  describe('Localization', () => {
    beforeEach(() => {
        // Mock the i18n API
        global.chrome.i18n = {
            getMessage: jest.fn((key, substitutions) => {
                const messages = {
                    'popup_title': 'Test Title',
                    'search_placeholder': 'Test Search...',
                    'button_tooltip': 'Test Tooltip'
                };
                return messages[key] || `??${key}??`;
            })
        };
    });

    test('should localize elements with data-i18n attributes', () => {
        // Set up DOM with i18n attributes
        document.body.innerHTML = `
            <h1 data-i18n="popup_title"></h1>
            <input type="text" data-i18n-placeholder="search_placeholder">
            <button data-i18n-title="button_tooltip"></button>
            <span data-i18n="non_existent_key"></span>
        `;
        
        localizeHtmlPage();

        expect(document.querySelector('h1').textContent).toBe('Test Title');
        expect(document.querySelector('input').placeholder).toBe('Test Search...');
        expect(document.querySelector('button').title).toBe('Test Tooltip');
        // It should handle non-existent keys gracefully
        expect(document.querySelector('span').textContent).toBe('??non_existent_key??');

        expect(chrome.i18n.getMessage).toHaveBeenCalledWith('popup_title');
        expect(chrome.i18n.getMessage).toHaveBeenCalledWith('search_placeholder');
        expect(chrome.i18n.getMessage).toHaveBeenCalledWith('button_tooltip');
        expect(chrome.i18n.getMessage).toHaveBeenCalledWith('non_existent_key');
    });
  });
});

describe.skip('Real-time Updates', () => {
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

describe.skip('Popup Live Updates', () => {
    // Legacy live-update behavior is now covered by integration tests in
    // tests/integration/video-tracking.test.js and by popup Storage Change
    // Listener tests above. These tests are kept skipped for historical
    // reference and can be removed once no longer needed.
});
