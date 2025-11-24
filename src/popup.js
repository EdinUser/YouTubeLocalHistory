// --- Debugging and Logging ---
let debugEnabled = false; // Will be set from user settings

function log(...args) {
    if (debugEnabled) {
        console.log('[ythdb-popup]', ...args);
    }
}

window.onerror = function (msg, url, lineNo, columnNo, error) {
    console.error('[ythdb-popup] Error: ' + msg + '\nURL: ' + url + '\nLine: ' + lineNo + '\nColumn: ' + columnNo + '\nError object: ' + JSON.stringify(error));
    return false;
};

console.log('[ythdb-popup] Script file loaded');

log('Script starting initialization');

// Pagination state
let allHistoryRecords = [];
let allShortsRecords = [];
let currentPage = 1;
let pageSize = 20;
let totalPages = 1;
let totalHistoryRecords = 0;

// Sync state tracking to prevent race conditions
let syncInProgress = false;

// Shorts Pagination state
let currentShortsPage = 1;
let shortsPageSize = 20;
let totalShortsPages = 1;
let totalShortsRecords = 0;

// --- Playlists Tab State ---
let allPlaylists = [];
let currentPlaylistPage = 1;
let playlistPageSize = 20;
let totalPlaylistPages = 1;
let totalPlaylistRecords = 0;

// Stored aggregated stats cache (from persistent storage)
let storedStats = null;

// Default settings
const DEFAULT_SETTINGS = {
    autoCleanPeriod: 90, // days
    paginationCount: 10,
    themePreference: 'system', // 'system', 'light', or 'dark'
    overlayTitle: 'viewed',
    overlayColor: 'blue',
    overlayLabelSize: 'medium',
    debug: false,
    pauseHistoryInPlaylists: false
};

// Get version from manifest
const EXTENSION_VERSION = chrome.runtime.getManifest().version;

const OVERLAY_LABEL_SIZE_MAP = {
    small: {fontSize: 12, bar: 2},
    medium: {fontSize: 16, bar: 3},
    large: {fontSize: 22, bar: 4},
    xlarge: {fontSize: 28, bar: 5}
};

// Color mapping for overlay colors
const OVERLAY_COLORS = {
    blue: '#4285f4',
    red: '#ea4335',
    green: '#34a853',
    purple: '#9c27b0',
    orange: '#ff9800'
};

// Format time duration
function formatDuration(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = Math.floor(seconds % 60);

    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

// Format date in a more readable way
function formatDate(timestamp) {
    if (!timestamp) return chrome.i18n.getMessage('date_unknown');

    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    const timeStr = date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    });

    if (isToday) {
        return chrome.i18n.getMessage('date_today') + ' ' + timeStr;
    }

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
        return chrome.i18n.getMessage('date_yesterday') + ' ' + timeStr;
    }

    return date.toLocaleDateString('en-US', {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric'
    }) + ' ' + timeStr;
}

// Calculate progress percentage with validation
function calculateProgress(time, duration) {
    if (!time || !duration || isNaN(time) || isNaN(duration) || duration <= 0) {
        return 0;
    }

    // Ensure values are within reasonable bounds
    time = Math.max(0, Math.min(time, duration));
    const percentage = Math.round((time / duration) * 100);
    return Math.min(100, Math.max(0, percentage)); // Ensure between 0-100
}

// Format progress text
function formatProgress(time, duration) {
    const timeStr = formatDuration(time);
    if (!duration || duration <= 0) {
        return timeStr;
    }

    const percentage = calculateProgress(time, duration);
    return `${timeStr} (${percentage}%)`;
}

// Show message
function showMessage(message, type = 'success') {
    log('Showing message:', {message, type});
    const messageDiv = document.getElementById('ytvhtMessage');
    if (!messageDiv) {
        console.error('[ythdb-popup] Message div not found!');
        return;
    }
    messageDiv.textContent = message;
    messageDiv.className = 'message ' + type;
    messageDiv.style.display = 'block';
    setTimeout(() => {
        messageDiv.style.display = 'none';
    }, 3000);
}

function sendToContentScript(message, callback) {
    chrome.tabs.query({active: true, currentWindow: true}, function (tabs) {
        if (!tabs[0]) {
            showMessage('No active tab found.', 'error');
            return;
        }
        log('Sending message to content script:', message);
        chrome.tabs.sendMessage(tabs[0].id, message, function (response) {
            log('Received response from content script:', response, chrome.runtime.lastError);
            callback(response);
        });
    });
}

// Send message to content script with retry
function sendToContentScriptWithRetry(message, callback, retries = 3, delay = 500) {
    log('Sending message to content script:', message);

    chrome.tabs.query({active: true, currentWindow: true}, function (tabs) {
        if (!tabs[0]?.id) {
            log('No active tab found');
            callback(null);
            return;
        }

        chrome.tabs.sendMessage(tabs[0].id, message, function (response) {
            if (chrome.runtime.lastError) {
                log('Error sending message:', chrome.runtime.lastError);
                if (retries > 0) {
                    log(`Retrying in ${delay}ms... (${retries} retries left)`);
                    setTimeout(() => {
                        sendToContentScriptWithRetry(message, callback, retries - 1, delay);
                    }, delay);
                } else {
                    callback(null);
                }
                return;
            }
            log('Received response from content script:', response);
            callback(response);
        });
    });
}

// Initialize storage and set up listeners
async function initStorage() {
    try {
        // Ensure migration is complete
        await ytStorage.ensureMigrated();

        // Load initial data
        await loadCurrentPages();

        // Set up message listener for updates
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (message.type === 'videoUpdateFromBackground') {
                log('Received video update from background:', message.data);
                updateVideoRecord(message.data);
            } else if (message.type === 'storageUpdate') {
                log('Received storage update:', message.changes);
                handleStorageUpdates(message.changes);
            }
        });

        // Get any updates that happened while popup was closed
        chrome.runtime.sendMessage({type: 'getLatestUpdate'}, (response) => {
            if (response?.lastUpdate) {
                log('Received latest update from background:', response.lastUpdate);
                updateVideoRecord(response.lastUpdate);
            }
        });

        // Set up storage change listener (but ignore changes during sync)
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && !syncInProgress) {
                const videoChanges = Object.entries(changes).filter(([key]) =>
                    key.startsWith('video_') || key.startsWith('playlist_')
                );

                if (videoChanges.length > 0) {
                    console.log('[Popup] Storage changes detected (not during sync):', videoChanges.length, 'items');
                    // Process each change individually
                    videoChanges.forEach(([key, change]) => {
                        if (key.startsWith('video_')) {
                            const videoId = key.replace('video_', '');
                            if (change.newValue) {
                                // Check for tombstone before adding/updating
                                checkTombstoneAndUpdateVideo(videoId, change.newValue);
                            } else {
                                // Record was deleted
                                allHistoryRecords = allHistoryRecords.filter(r => r.videoId !== videoId);
                                allShortsRecords = allShortsRecords.filter(r => r.videoId !== videoId);
                                displayHistoryPage();
                                displayShortsPage();
                            }
                        }
                    });
                }
            } else if (syncInProgress) {
                console.log('[Popup] Ignoring storage changes during sync (will refresh after sync completes)');
            }
        });

        return true;
    } catch (error) {
        console.error('Storage initialization failed:', error);
        return false;
    }
}

// Handle storage updates
function handleStorageUpdates(changes) {
    let needsRefresh = false;

    changes.forEach(([key, change]) => {
        if (key.startsWith('video_')) {
            const videoId = key.replace('video_', '');
            if (change.newValue) {
                // Update or add record
                updateVideoRecord(change.newValue);
            } else {
                // Record was deleted
                const index = allHistoryRecords.findIndex(r => r.videoId === videoId);
                if (index !== -1) {
                    allHistoryRecords.splice(index, 1);
                    needsRefresh = true;
                }
            }
        }
    });

    if (needsRefresh) {
        displayHistoryPage();
    }
}

// Check for tombstone before updating video record
async function checkTombstoneAndUpdateVideo(videoId, videoRecord) {
    try {
        // Get all storage data to check for tombstone
        const allData = await chrome.storage.local.get(null).catch(error => {
            if (error.message && error.message.includes('Extension context invalidated')) {
                console.log('[Popup] Extension context invalidated during tombstone check');
                return {};
            }
            throw error;
        });
        const tombstoneKey = `deleted_video_${videoId}`;

        if (allData[tombstoneKey]) {
            console.log('[Popup] Video has tombstone, not adding to UI:', videoId);
            return; // Don't add video if tombstone exists
        }

        // No tombstone, safe to update
        updateVideoRecord(videoRecord);
    } catch (error) {
        console.error('Error checking tombstone:', error);
        // If we can't check tombstone, err on the side of caution and don't add
    }
}

// Update a single video record in the table
function updateVideoRecord(record) {
    if (!record || !record.videoId) return;

    log('Updating video record:', record);

    // Update the record in our local array
    const recordIndex = allHistoryRecords.findIndex(r => r.videoId === record.videoId);
    if (recordIndex !== -1) {
        allHistoryRecords[recordIndex] = record;
    } else {
        // New record, add it to the beginning and sort
        allHistoryRecords.unshift(record);
        allHistoryRecords.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    }

    // Find if the record is currently displayed
    const historyTable = document.getElementById('ytvhtHistoryTable');
    const startIdx = (currentPage - 1) * pageSize;
    const endIdx = Math.min(startIdx + pageSize, allHistoryRecords.length);
    const recordPageIndex = recordIndex - startIdx;

    // Only update DOM if the record is on the current page
    if (recordIndex >= startIdx && recordIndex < endIdx) {
        const row = historyTable.rows[recordPageIndex];
        if (row) {
            const cell = row.cells[0];
            if (cell) {
                const link = cell.querySelector('.video-link');
                const progress = cell.querySelector('.video-progress');
                const date = cell.querySelector('.video-date');

                if (link) {
                    link.textContent = record.title || 'Unknown Title';
                    link.href = record.url;
                }

                if (progress) {
                    progress.textContent = formatProgress(record.time, record.duration);
                }

                if (date) {
                    date.textContent = formatDate(record.timestamp);
                }
            }
        }
    } else if (recordIndex === -1 && currentPage === 1) {
        // If it's a new record and we're on the first page, refresh the display
        displayHistoryPage();
    }
}

// Load history records
async function loadHistory(isInitialLoad = false) {
    try {
        log('Loading history from storage...');
        const allData = await chrome.storage.local.get(null).catch(error => {
            if (error.message && error.message.includes('Extension context invalidated')) {
                console.log('[Popup] Extension context invalidated during history load');
                return {};
            }
            throw error;
        });

        // Extract videos and tombstones
        const videos = {};
        const tombstones = {};

        Object.keys(allData).forEach(key => {
            if (key.startsWith('video_')) {
                const videoId = key.replace('video_', '');
                videos[videoId] = allData[key];
            } else if (key.startsWith('deleted_video_')) {
                const videoId = key.replace('deleted_video_', '');
                tombstones[videoId] = allData[key];
            }
        });

        // Filter out videos that have active tombstones
        const filteredVideos = {};
        Object.keys(videos).forEach(videoId => {
            if (!tombstones[videoId]) {
                filteredVideos[`video_${videoId}`] = videos[videoId];
            } else {
                console.log('[Popup] Filtering out video with tombstone:', videoId);
            }
        });

        console.log('[Popup] Raw history data from storage:', Object.keys(videos).length, 'items');
        console.log('[Popup] Filtered history data (after tombstones):', Object.keys(filteredVideos).length, 'items');

        if (Object.keys(filteredVideos).length > 0) {
            // Show newest videos first for sync debugging
            const videoKeys = Object.keys(filteredVideos);
            const sortedKeys = videoKeys.sort((a, b) => (filteredVideos[b].timestamp || 0) - (filteredVideos[a].timestamp || 0));
            const newestKeys = sortedKeys.slice(0, 3);

            console.log('[Popup] Sample newest videos from storage:', newestKeys.map(key => ({
                key: key,
                title: filteredVideos[key]?.title || 'No title',
                timestamp: new Date(filteredVideos[key]?.timestamp || 0).toLocaleTimeString()
            })));
        }

        if (!filteredVideos || Object.keys(filteredVideos).length === 0) {
            if (isInitialLoad) {
                showMessage(chrome.i18n.getMessage('history_no_history_found'), 'info');
            }
            allHistoryRecords = [];
            allShortsRecords = [];
        } else {
            const newRegularVideos = extractRegularVideoRecords(filteredVideos);
            const newShortsRecords = extractShortsRecords(filteredVideos);

            // Only sort and update if there are actual changes
            if (JSON.stringify(newRegularVideos) !== JSON.stringify(allHistoryRecords)) {
                allHistoryRecords = newRegularVideos;
                allHistoryRecords.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
                log('Updated regular videos history:', allHistoryRecords);
            }

            if (JSON.stringify(newShortsRecords) !== JSON.stringify(allShortsRecords)) {
                allShortsRecords = newShortsRecords;
                allShortsRecords.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
                log('Updated shorts history:', allShortsRecords);
            }
        }

        // Only reset to first page on initial load
        if (isInitialLoad) {
            currentPage = 1;
        }

        displayHistoryPage();
        displayShortsPage();
    } catch (error) {
        console.error('Error loading history:', error);
        if (isInitialLoad) {
            showMessage(chrome.i18n.getMessage('error_loading_history', [error.message || chrome.i18n.getMessage('unknown_error')]), 'error');
        }
    }
}

// Smart search functionality
let searchQuery = '';
let globalSearchInput = null; // Will be set in DOMContentLoaded

// Search history system
let searchHistory = {}; // {query: frequency}
let searchTimeout = null;
const SEARCH_DEBOUNCE_DELAY = 1000; // 1 second

function recordSearch(query) {
    if (!query || query.trim().length <= 3) return; // Don't save searches 3 characters or shorter

    const trimmed = query.trim().toLowerCase();
    searchHistory[trimmed] = (searchHistory[trimmed] || 0) + 1;

    // Keep only top 100 searches to prevent memory issues
    const entries = Object.entries(searchHistory);
    if (entries.length > 100) {
        // Sort by frequency and keep top 100
        entries.sort((a, b) => b[1] - a[1]);
        searchHistory = Object.fromEntries(entries.slice(0, 100));
    }

    // Save to storage
    try {
        chrome.storage.local.set({ 'ytvht_search_history': searchHistory }, () => {
            if (chrome.runtime.lastError) {
                if (chrome.runtime.lastError.message.includes('Extension context invalidated')) {
                    console.log('[Search] Extension context invalidated during search history save');
                } else {
                    console.warn('[Search] Failed to save search history:', chrome.runtime.lastError);
                }
            }
        });
    } catch (e) {
        if (e.message && e.message.includes('Extension context invalidated')) {
            console.log('[Search] Extension context invalidated during search history save');
        } else {
            console.warn('[Search] Failed to save search history:', e);
        }
    }
}

function getTopSearches(limit = 5) {
    return Object.entries(searchHistory)
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([query]) => query);
}

function getAllSearches() {
    return Object.keys(searchHistory);
}

// Load search history on initialization
async function loadSearchHistory() {
    try {
        const result = await chrome.storage.local.get(['ytvht_search_history']).catch(error => {
            if (error.message && error.message.includes('Extension context invalidated')) {
                console.log('[Search] Extension context invalidated during search history load');
                return {};
            }
            throw error;
        });
        searchHistory = result.ytvht_search_history || {};
    } catch (e) {
        if (e.message && e.message.includes('Extension context invalidated')) {
            console.log('[Search] Extension context invalidated during search history load');
            searchHistory = {};
        } else {
            console.warn('[Search] Failed to load search history:', e);
            searchHistory = {};
        }
    }
}

// Toggle clear button visibility
function toggleClearButton(show) {
    const searchClearBtn = document.getElementById('ytvhtSearchClear');
    if (searchClearBtn) {
        searchClearBtn.style.display = show ? 'flex' : 'none';
    }
}

// Hide search suggestions
function hideSearchSuggestions() {
    const suggestions = document.getElementById('ytvhtSearchSuggestions');
    if (suggestions) {
        suggestions.style.display = 'none';
    }
}

// Smart search suggestions and filtering
async function smartSearch(query) {
    const trimmedQuery = query.trim();
    console.log('[Search] smartSearch called with:', query, 'trimmed:', trimmedQuery);

    // Clear existing timeout
    if (searchTimeout) {
        clearTimeout(searchTimeout);
    }

    if (trimmedQuery.length === 0) {
        console.log('[Search] Showing recent searches');
        return showRecentSearches();
    } else if (trimmedQuery.length < 3) {
        console.log('[Search] Showing autocomplete suggestions');
        return showAutocompleteSuggestions(trimmedQuery);
    } else {
        // For 3+ characters, show full search and schedule recording
        console.log('[Search] Showing full search results and scheduling recording');
        searchTimeout = setTimeout(() => recordSearch(trimmedQuery), SEARCH_DEBOUNCE_DELAY);
        return await showFullSearchResults(trimmedQuery);
    }
}

function showRecentSearches() {
    const recentContainer = document.getElementById('ytvhtSearchSuggestions') ||
                           createSearchSuggestionsContainer();

    const topSearches = getTopSearches(5);

    recentContainer.innerHTML = `
        <div class="search-section">
            <h4>Recent Searches</h4>
            ${topSearches.map(search => `
                <div class="suggestion-item recent-search-item" data-search="${search.replace(/"/g, '&quot;')}">
                    <div class="suggestion-text">
                        <div class="suggestion-title">${search}</div>
                    </div>
                </div>
            `).join('')}
        </div>
    `;

    // Add event listeners to avoid CSP issues
    recentContainer.querySelectorAll('.recent-search-item').forEach(item => {
        item.addEventListener('click', function() {
            const searchQuery = this.getAttribute('data-search');
            applyRecentSearch(searchQuery);
        });
    });

    recentContainer.style.display = 'block';
}

function showAutocompleteSuggestions(query) {
    const suggestionsContainer = document.getElementById('ytvhtSearchSuggestions') ||
                                createSearchSuggestionsContainer();

    const allSearches = getAllSearches();
    const matchingSearches = allSearches
        .filter(search => search.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 8); // Limit to 8 suggestions

    suggestionsContainer.innerHTML = `
        <div class="search-section">
            <h4>Search Suggestions</h4>
            ${matchingSearches.map(search => `
                <div class="suggestion-item autocomplete-item" data-search="${search.replace(/"/g, '&quot;')}">
                    <div class="suggestion-text">
                        <div class="suggestion-title">${search}</div>
                    </div>
                </div>
            `).join('')}
        </div>
    `;

    // Add event listeners to avoid CSP issues
    suggestionsContainer.querySelectorAll('.autocomplete-item').forEach(item => {
        item.addEventListener('click', function() {
            const searchQuery = this.getAttribute('data-search');
            applyRecentSearch(searchQuery);
        });
    });

    suggestionsContainer.style.display = 'block';
}

function applyRecentSearch(searchQuery) {
    if (globalSearchInput) {
        globalSearchInput.value = searchQuery;
        showFullSearchResults(searchQuery);
    }
}


async function showFullSearchResults(query) {
    console.log('[Search] showFullSearchResults called with:', query);

    // Hide suggestions and proceed with normal search
    const suggestionsContainer = document.getElementById('ytvhtSearchSuggestions');
    if (suggestionsContainer) {
        suggestionsContainer.style.display = 'none';
    }

    // Proceed with normal search flow
    searchQuery = query.toLowerCase();
    currentPage = 1;
    currentShortsPage = 1;
    currentPlaylistPage = 1;

    console.log('[Search] Set searchQuery to:', searchQuery);

    // Load filtered data for all tabs
    await loadCurrentPages();
    console.log('[Search] loadCurrentPages completed');

    // Explicitly refresh the current tab's display
    const activeTab = document.querySelector('.tab-bar .tab.active');
    console.log('[Search] Active tab element:', activeTab);

    if (activeTab) {
        const tabName = activeTab.id.replace('ytvhtTab', '').toLowerCase();
        console.log('[Search] Active tab name:', tabName);

        switch (tabName) {
            case 'videos':
                console.log('[Search] Calling displayHistoryPage');
                displayHistoryPage();
                break;
            case 'shorts':
                console.log('[Search] Calling displayShortsPage');
                displayShortsPage();
                break;
            case 'playlists':
                console.log('[Search] Calling displayPlaylistsPage');
                displayPlaylistsPage();
                break;
        }
    } else {
        console.log('[Search] No active tab found!');
    }
}

function createSearchSuggestionsContainer() {
    const container = document.createElement('div');
    container.id = 'ytvhtSearchSuggestions';
    container.className = 'search-suggestions';

    // Insert after the global search input
    const globalSearchContainer = document.querySelector('.global-search-container');
    if (globalSearchContainer) {
        globalSearchContainer.appendChild(container);
    }

    return container;
}


// Quick actions for suggestions
function quickSelectVideo(videoId) {
    // Find and highlight the video in current view
    const videoElement = document.querySelector(`[data-video-id="${videoId}"]`);
    if (videoElement) {
        videoElement.scrollIntoView({ behavior: 'smooth' });
        videoElement.style.backgroundColor = 'var(--button-bg)';
        setTimeout(() => {
            videoElement.style.backgroundColor = '';
        }, 2000);
    }

    // Hide suggestions
    const suggestions = document.getElementById('ytvhtSearchSuggestions');
    if (suggestions) {
        suggestions.style.display = 'none';
    }
}


// Lazy loading functions for pagination
async function loadHistoryPage(options = {}) {
    const { page = currentPage, pageSize: pageSizeParam = pageSize, searchQuery: query = searchQuery } = options;

    try {
        log(`Loading history page ${page} with search: "${query}"`);
        const result = await ytStorage.getVideosPage({
            page,
            pageSize: pageSizeParam,
            searchQuery: query
        });

        // Update global arrays with just the current page data
        allHistoryRecords = result.records;

        // Update pagination metadata
        totalPages = result.pagination.totalPages;
        totalHistoryRecords = result.pagination.totalRecords;

        log(`Loaded page ${page}/${totalPages} with ${result.records.length} records (total: ${totalHistoryRecords})`);

        return result;
    } catch (error) {
        console.error('Error loading history page:', error);
        allHistoryRecords = [];
        totalPages = 1;
        totalHistoryRecords = 0;
        throw error;
    }
}

async function loadShortsPage(options = {}) {
    const { page = currentShortsPage, pageSize: pageSizeParam = shortsPageSize, searchQuery: query = searchQuery } = options;

    try {
        log(`Loading shorts page ${page} with search: "${query}"`);
        const result = await ytStorage.getShortsPage({
            page,
            pageSize: pageSizeParam,
            searchQuery: query
        });

        // Update global arrays with just the current page data
        allShortsRecords = result.records;

        // Update pagination metadata
        totalShortsPages = result.pagination.totalPages;
        totalShortsRecords = result.pagination.totalRecords;

        log(`Loaded shorts page ${page}/${totalShortsPages} with ${result.records.length} records (total: ${totalShortsRecords})`);

        return result;
    } catch (error) {
        console.error('Error loading shorts page:', error);
        allShortsRecords = [];
        totalShortsPages = 1;
        totalShortsRecords = 0;
        throw error;
    }
}

async function loadPlaylistsPage(options = {}) {
    const { page = currentPlaylistPage, pageSize: pageSizeParam = playlistPageSize, searchQuery: query = searchQuery } = options;

    try {
        log(`Loading playlists page ${page} with search: "${query}"`);
        const result = await ytStorage.getPlaylistsPage({
            page,
            pageSize: pageSizeParam,
            searchQuery: query
        });

        // Update global arrays with just the current page data
        allPlaylists = result.records;

        // Update pagination metadata
        totalPlaylistPages = result.pagination.totalPages;
        totalPlaylistRecords = result.pagination.totalRecords;

        log(`Loaded playlists page ${page}/${totalPlaylistPages} with ${result.records.length} records (total: ${totalPlaylistRecords})`);

        return result;
    } catch (error) {
        console.error('Error loading playlists page:', error);
        allPlaylists = [];
        totalPlaylistPages = 1;
        totalPlaylistRecords = 0;
        throw error;
    }
}

// Unified lazy loading function for all data types
async function loadCurrentPages() {
    try {
        console.log('[Search] loadCurrentPages called with searchQuery:', searchQuery);

        // Load all current pages in parallel
        const [videosResult, shortsResult, playlistsResult] = await Promise.all([
            loadHistoryPage({ page: currentPage }),
            loadShortsPage({ page: currentShortsPage }),
            loadPlaylistsPage({ page: currentPlaylistPage })
        ]);

        console.log('[Search] Data loaded:', {
            videos: videosResult.records?.length || 0,
            shorts: shortsResult.records?.length || 0,
            playlists: playlistsResult.records?.length || 0
        });

        // Update display for current active tab
        const activeTab = document.querySelector('.tab-bar .tab.active');
        console.log('[Search] loadCurrentPages active tab:', activeTab);

        if (activeTab) {
            const tabName = activeTab.id.replace('ytvhtTab', '').toLowerCase();
            console.log('[Search] loadCurrentPages tab name:', tabName);

            switch (tabName) {
                case 'videos':
                    console.log('[Search] loadCurrentPages calling displayHistoryPage');
                    displayHistoryPage();
                    break;
                case 'shorts':
                    console.log('[Search] loadCurrentPages calling displayShortsPage');
                    displayShortsPage();
                    break;
                case 'playlists':
                    console.log('[Search] loadCurrentPages calling displayPlaylistsPage');
                    displayPlaylistsPage();
                    break;
            }
        }

        return { videosResult, shortsResult, playlistsResult };
    } catch (error) {
        console.error('Error loading current pages:', error);
        throw error;
    }
}

// Content density adaptation based on record count
function adjustContentDensity(records) {
    const container = document.body || document.documentElement;

    // Remove existing density classes
    container.className = container.className.replace(/density-\w+/g, '').trim();

    // Add appropriate density class
    let densityClass = '';
    if (records.length > 100) {
        densityClass = 'density-high';
    } else if (records.length > 50) {
        densityClass = 'density-medium';
    } else if (records.length > 10) {
        densityClass = 'density-normal';
    } else {
        densityClass = 'density-low';
    }

    container.className += ' ' + densityClass;
    log(`Applied density class: ${densityClass} for ${records.length} records`);
}

// Progressive content loading
async function progressiveContentLoading() {
    const container = document.body || document.documentElement;
    log('Starting progressive content loading');

    // Phase 1: Show skeleton/structure immediately
    container.className += ' loading-skeleton';
    log('Applied loading-skeleton class');

    // Phase 2: Load critical data (first page) - already handled by loadCurrentPages()

    // Phase 3: Load secondary data (stats, etc.) in background
    setTimeout(async () => {
        try {
            // Load analytics data in background
            const stats = await ytStorage.getStats();
            updateAnalytics(stats);
            container.className = container.className.replace(' loading-skeleton', '');
        } catch (error) {
            console.log('Background data loading failed:', error);
            container.className = container.className.replace(' loading-skeleton', '');
        }
    }, 100);
}

// Filter records based on search query
function filterRecords(records) {
    if (!searchQuery) return records;
    return records.filter(record =>
        record.title?.toLowerCase().includes(searchQuery)
    );
}

// Format duration for analytics
function formatAnalyticsDuration(seconds) {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

// Calculate analytics data
function calculateAnalytics(records) {
    const totalSeconds = (storedStats && typeof storedStats.totalWatchSeconds === 'number')
        ? storedStats.totalWatchSeconds
        : records.reduce((sum, record) => sum + (record.time || 0), 0);
    const totalDuration = records.reduce((sum, record) => sum + (record.duration || 0), 0);
    const completedVideos = records.filter(record =>
        record.time && record.duration && (record.time / record.duration) >= 0.9
    ).length;

    return {
        totalWatchTime: formatAnalyticsDuration(totalSeconds),
        videosWatched: records.length,
        shortsWatched: allShortsRecords.length,
        avgDuration: formatAnalyticsDuration(totalDuration / records.length || 0),
        completionRate: Math.round((completedVideos / records.length) * 100) || 0,
        playlistsSaved: allPlaylists.length
    };
}

// Determine if stats are effectively empty (no totals/daily/hourly data)
function isStatsEmpty(stats) {
    if (!stats) return true;
    const totalEmpty = !stats.totalWatchSeconds || stats.totalWatchSeconds <= 0;
    const dailyEmpty = !stats.daily || Object.keys(stats.daily).length === 0;
    const hourlyEmpty = !Array.isArray(stats.hourly) || stats.hourly.length !== 24 || stats.hourly.every(v => !v || v <= 0);
    return totalEmpty && dailyEmpty && hourlyEmpty;
}

// Build initial stats snapshot from existing history records
function buildStatsFromHistory() {
    const all = [...allHistoryRecords, ...allShortsRecords];
    const daily = {};
    const hourly = new Array(24).fill(0);
    let total = 0;

    all.forEach(rec => {
        const time = Math.max(0, Math.floor(rec?.time || 0));
        if (!time) return;
        total += time;
        if (rec.timestamp) {
            const d = new Date(rec.timestamp);
            const dayKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
            daily[dayKey] = Math.max(0, Math.floor((daily[dayKey] || 0) + time));
            const h = d.getHours();
            hourly[h] = Math.max(0, Math.floor((hourly[h] || 0) + time));
        }
    });

    return {
        totalWatchSeconds: Math.max(0, Math.floor(total)),
        daily,
        hourly,
        lastUpdated: Date.now()
    };
}

// Update analytics display
async function updateAnalytics() {
    // Load stored stats for cards/charts (ignore errors, fallback below)
    try {
        storedStats = await ytStorage.getStats();
    } catch (e) {
        storedStats = null;
    }

    // Ensure latest history is loaded so on-the-fly charts are accurate
    try {
        await loadCurrentPages();
    } catch (_) {}

    // Ensure playlists are loaded so count isn't 0 when opening Analytics directly
    try {
        const playlistsObj = await ytStorage.getAllPlaylists();
        if (playlistsObj && typeof playlistsObj === 'object') {
            allPlaylists = Object.values(playlistsObj);
        } else {
            allPlaylists = [];
        }
    } catch (_) {
        allPlaylists = [];
    }

    // Migrate stats if daily/hourly appear empty due to previous key format
    try {
        const haveHistory = (allHistoryRecords && allHistoryRecords.length) || (allShortsRecords && allShortsRecords.length);
        if (haveHistory) {
            // Build last 7 local day keys
            const now = new Date();
            const last7 = Array.from({length: 7}, (_, i) => {
                const d = new Date(now);
                d.setDate(d.getDate() - i);
                return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
            });

            let needsDailySeed = false;
            if (!storedStats || !storedStats.daily || typeof storedStats.daily !== 'object') {
                needsDailySeed = true;
            } else {
                const anyInWindow = last7.some(k => Number(storedStats.daily[k] || 0) > 0);
                // If no daily entries in current 7-day window but we have history, seed
                if (!anyInWindow) needsDailySeed = true;
            }

            let needsHourlySeed = false;
            if (!storedStats || !Array.isArray(storedStats.hourly) || storedStats.hourly.length !== 24) {
                needsHourlySeed = true;
            } else {
                const sumHour = storedStats.hourly.reduce((a,b)=>a+Number(b||0),0);
                if (sumHour === 0) needsHourlySeed = true;
            }

            if (needsDailySeed || needsHourlySeed) {
                const seeded = buildStatsFromHistory();
                if (!storedStats) storedStats = {};
                // Prune seeded daily to last 7 keys only
                const daily = {};
                last7.reverse().forEach(k => { // oldest to newest
                    if (seeded.daily[k]) daily[k] = seeded.daily[k];
                });
                if (needsDailySeed) storedStats.daily = daily;
                if (needsHourlySeed) storedStats.hourly = seeded.hourly;
                storedStats.lastUpdated = Date.now();
                await ytStorage.setStats(storedStats);
            }
        }
    } catch (_) {}

    // One-time converter: if stats are empty but we have history, seed from calculated data
    try {
        const haveHistory = (allHistoryRecords && allHistoryRecords.length) || (allShortsRecords && allShortsRecords.length);
        if (haveHistory && isStatsEmpty(storedStats)) {
            const seeded = buildStatsFromHistory();
            if (seeded.totalWatchSeconds > 0) {
                await ytStorage.setStats(seeded);
                storedStats = seeded;
            }
        }
    } catch (_) {}
    const stats = calculateAnalytics(allHistoryRecords);

    document.getElementById('totalWatchTime').textContent = stats.totalWatchTime;
    document.getElementById('videosWatched').textContent = stats.videosWatched;
    document.getElementById('shortsWatched').textContent = stats.shortsWatched;
    document.getElementById('avgDuration').textContent = stats.avgDuration;
    document.getElementById('completionRate').textContent = `${stats.completionRate}%`;
    document.getElementById('playlistsSaved').textContent = stats.playlistsSaved;

    // Update all charts
    updateActivityChart();
    updateWatchTimeByHourChart();
    renderUnfinishedVideos();
    renderTopChannels();
    renderSkippedChannels();
    renderCompletionBarChart();
}

// Render the top 5 longest unfinished videos (duration >= 10 min, watched < 90%)
function renderUnfinishedVideos() {
    const container = document.getElementById('unfinishedVideosList');
    if (!container) return;

    // Filter for long, unfinished videos
    const unfinished = allHistoryRecords.filter(record => {
        return record.duration >= 600 && (record.time / record.duration) < 0.9;
    });

    // Sort by absolute time left, descending
    unfinished.sort((a, b) => ((b.duration - b.time) - (a.duration - a.time)));

    // Take top 5
    const topUnfinished = unfinished.slice(0, 5);

    if (topUnfinished.length === 0) {
        // Use textContent for plain text, or build DOM for styled text
        container.textContent = chrome.i18n.getMessage('analytics_no_unfinished_long_videos');
        return;
    }

    // Helper to create a safe unfinished video entry
    function createUnfinishedVideoEntry(record) {
        const div = document.createElement('div');
        div.style.marginBottom = '8px';
        const a = document.createElement('a');
        a.href = record.url;
        a.target = '_blank';
        a.style.fontWeight = '500';
        a.style.color = 'var(--button-bg)';
        a.style.textDecoration = 'none';
        a.textContent = sanitizeText(record.title || 'Untitled');
        div.appendChild(a);
        const timeLeft = Math.max(0, Math.round(record.duration - record.time));
        const watched = Math.round(record.time);
        const total = Math.round(record.duration);
        const minLeft = Math.floor(timeLeft / 60);
        const secLeft = timeLeft % 60;
        const minWatched = Math.floor(watched / 60);
        const minTotal = Math.floor(total / 60);
        const secWatched = watched % 60;
        const secTotal = total % 60;
        const timeLeftStr = `${minLeft}m${secLeft > 0 ? ' ' + secLeft + 's' : ''}`;
        const watchedStr = `${minWatched}:${secWatched.toString().padStart(2, '0')}`;
        const totalStr = `${minTotal}:${secTotal.toString().padStart(2, '0')}`;
        // Use a <div> for details, with a <span> for the main text, a <br>, and a <span> for the channel
        const details = document.createElement('div');
        details.style.color = 'var(--text-color)';
        details.style.opacity = '0.8';
        details.style.display = 'flex';
        details.style.alignItems = 'center';
        details.style.justifyContent = 'space-between';

        const leftDetails = document.createElement('div');
        leftDetails.style.display = 'flex';
        leftDetails.style.flexDirection = 'column';

        const mainText = document.createElement('span');
        mainText.textContent = ` - ${timeLeftStr} left (watched ${watchedStr}/${totalStr})`;
        leftDetails.appendChild(mainText);
        leftDetails.appendChild(document.createElement('br'));
        const channel = document.createElement('span');
        channel.style.fontSize = '12px';
        channel.style.color = 'var(--text-color)';
        channel.style.opacity = '0.7';
        channel.textContent = sanitizeText(record.channelName || 'Unknown Channel');
        leftDetails.appendChild(channel);

        details.appendChild(leftDetails);

        // Add delete button aligned right
        const deleteButton = document.createElement('button');
        deleteButton.className = 'delete-button';
        deleteButton.textContent = chrome.i18n.getMessage('delete_label');
        deleteButton.style.marginLeft = 'auto';
        deleteButton.onclick = () => deleteRecord(record.videoId);
        details.appendChild(deleteButton);
        div.appendChild(details);
        return div;
    }

    // Clear and append all entries
    container.innerHTML = '';
    topUnfinished.forEach(record => container.appendChild(createUnfinishedVideoEntry(record)));
}

// Create activity chart
function updateActivityChart() {
    const canvas = document.getElementById('ytvhtActivityChart');
    if (!canvas) return;

    // Set canvas size based on container
    const container = canvas.parentElement;
    canvas.width = container.clientWidth;
    canvas.height = parseInt(canvas.style.height) || 200;

    const ctx = canvas.getContext('2d');

    // Clear previous chart
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Get last 7 days of activity (prefer stored daily totals if present)
    const now = new Date();
    const days = Array.from({length: 7}, (_, i) => {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
    }).reverse();

    const allVideosForDaily = [...allHistoryRecords, ...allShortsRecords];
    const activity = days.map(day => {
        return allVideosForDaily.filter(record => {
            const d = new Date(record.timestamp);
            const recordDate = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
            return recordDate === day;
        }).length;
    });

    // Also compute total minutes per day
    const minutesPerDay = days.map(day => {
        const seconds = allVideosForDaily.reduce((sum, record) => {
            if (!record.timestamp) return sum;
            const d = new Date(record.timestamp);
            const recordDate = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
            if (recordDate === day) {
                return sum + (record.time || 0);
            }
            return sum;
        }, 0);
        return Math.round(seconds / 60);
    });

    // Draw chart
    const maxActivity = Math.max(...activity, 1);
    const availableWidth = canvas.width - 40; // Leave space for margins
    const barWidth = Math.max(12, Math.floor(availableWidth / 7)); // Minimum 12px width
    const barSpacing = Math.max(2, Math.min(6, Math.floor(barWidth * 0.15))); // 2-6px spacing
    const maxHeight = canvas.height - 40; // Leave space for labels

    // Draw background grid
    ctx.strokeStyle = getComputedStyle(document.documentElement)
        .getPropertyValue('--border-color')
        .trim();
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= 5; i++) {
        const y = 20 + (maxHeight * i / 5);
        ctx.moveTo(20, y);
        ctx.lineTo(canvas.width - 20, y);
    }
    ctx.stroke();

    // Draw bars
    activity.forEach((count, i) => {
        const height = Math.max(1, (count / maxActivity) * maxHeight);
        const x = 20 + (barWidth + barSpacing) * i;
        const y = canvas.height - height - 20;

        // Draw bar
        ctx.fillStyle = getComputedStyle(document.documentElement)
            .getPropertyValue('--button-bg')
            .trim();
        ctx.fillRect(x, y, barWidth - barSpacing, height);

        // Draw date label
        ctx.fillStyle = getComputedStyle(document.documentElement)
            .getPropertyValue('--text-color')
            .trim();
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        const dateLabel = days[i].slice(5).replace('-', '/');
        ctx.fillText(dateLabel, x + (barWidth - barSpacing) / 2, canvas.height - 5);

        // Draw label: number of videos / total minutes (e.g., 3/42m)
        const minutes = minutesPerDay[i];
        const label = `${count}/${minutes}m`;
        ctx.fillText(label, x + (barWidth - barSpacing) / 2, y - 5);
    });
}

// Restore the Watch Time by Hour chart function
function updateWatchTimeByHourChart() {
    const canvas = document.getElementById('ytvhtWatchTimeByHourChart');
    if (!canvas) return;

    // Set canvas size based on container
    const container = canvas.parentElement;
    canvas.width = container.clientWidth;
    canvas.height = parseInt(canvas.style.height) || 200;

    const ctx = canvas.getContext('2d');

    // Clear previous chart
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Calculate watch time by hour on the fly from current records
    const hourlyData = new Array(24).fill(0);
    const allVideos = [...allHistoryRecords, ...allShortsRecords];
    allVideos.forEach(record => {
        if (record.timestamp) {
            const hour = new Date(record.timestamp).getHours();
            hourlyData[hour] += record.time || 0;
        }
    });

    // Convert seconds to minutes for better readability
    const hourlyMinutes = hourlyData.map(seconds => Math.round(seconds / 60));

    // Draw chart
    const maxMinutes = Math.max(...hourlyMinutes, 1);
    const availableWidth = canvas.width - 60; // Leave space for labels
    const barWidth = Math.max(8, Math.floor(availableWidth / 24)); // Minimum 8px width
    const barSpacing = Math.max(1, Math.min(4, Math.floor(barWidth * 0.15))); // 1-4px spacing
    const maxHeight = canvas.height - 60; // Leave space for labels

    // Draw background grid
    ctx.strokeStyle = getComputedStyle(document.documentElement)
        .getPropertyValue('--border-color')
        .trim();
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= 5; i++) {
        const y = 20 + (maxHeight * i / 5);
        ctx.moveTo(30, y);
        ctx.lineTo(canvas.width - 30, y);
    }
    ctx.stroke();

    // Draw bars
    hourlyMinutes.forEach((minutes, hour) => {
        const height = Math.max(1, (minutes / maxMinutes) * maxHeight);
        const x = 30 + (barWidth + barSpacing) * hour;
        const y = canvas.height - height - 40;

        // Draw bar
        ctx.fillStyle = getComputedStyle(document.documentElement)
            .getPropertyValue('--button-bg')
            .trim();
        ctx.fillRect(x, y, barWidth - barSpacing, height);

        // Draw hour label
        ctx.fillStyle = getComputedStyle(document.documentElement)
            .getPropertyValue('--text-color')
            .trim();
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(
            hour.toString().padStart(2, '0'),
            x + (barWidth - barSpacing) / 2,
            canvas.height - 20
        );

        // Draw minutes label if non-zero
        if (minutes > 0) {
            ctx.fillText(
                `${minutes}m`,
                x + (barWidth - barSpacing) / 2,
                y - 5
            );
        }
    });

    // Draw axis labels
    ctx.fillStyle = getComputedStyle(document.documentElement)
        .getPropertyValue('--text-color')
        .trim();
    ctx.font = '12px Arial';
    ctx.textAlign = 'right';
    ctx.fillText(chrome.i18n.getMessage('chart_minutes'), 25, 35);
    ctx.textAlign = 'center';
    ctx.fillText(chrome.i18n.getMessage('chart_hour_of_day'), canvas.width / 2, canvas.height - 5);
}

// Update displayHistoryPage to use new layout
function displayHistoryPage() {
    console.log('[Display] displayHistoryPage called, allHistoryRecords length:', allHistoryRecords.length);

    const historyTable = document.getElementById('ytvhtHistoryTable');
    const noHistory = document.getElementById('ytvhtNoHistory');
    const paginationDiv = document.getElementById('ytvhtPagination');

    // allHistoryRecords already contains the current page data (filtered and paginated)
    const pageRecords = allHistoryRecords;

    // Apply content density adaptation
    adjustContentDensity(pageRecords);

    // Clear only if we have new content to show
    if (!pageRecords.length) {
        historyTable.innerHTML = '';
        noHistory.style.display = 'block';
        const emptyState = getContextualEmptyState('videos', searchQuery);
        renderEmptyState(noHistory, emptyState);
        paginationDiv.style.display = 'none';
        return;
    }

    noHistory.style.display = 'none';
    paginationDiv.style.display = 'flex';

    // Pagination bounds checking (totalPages is now set by loadHistoryPage)
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    // Reuse existing rows when possible
    while (historyTable.rows.length > pageRecords.length) {
        historyTable.deleteRow(-1);
    }

    pageRecords.forEach((record, index) => {
        let row = historyTable.rows[index];
        const isNewRow = !row;

        if (isNewRow) {
            row = document.createElement('tr');
            // We only need one cell now
            const cell = document.createElement('td');
            row.appendChild(cell);
            historyTable.appendChild(row);
        }

        // Get the cell (we only have one now)
        const cell = row.cells[0];
        cell.className = 'video-cell';

        // Create or update content
        if (!cell.querySelector('.video-thumbnail')) {
            // Build DOM nodes instead of using innerHTML
            cell.innerHTML = '';
            const img = document.createElement('img');
            img.className = 'video-thumbnail';
            img.alt = 'Video thumbnail';
            cell.appendChild(img);
            const contentDiv = document.createElement('div');
            contentDiv.className = 'video-content';
            const titleDiv = document.createElement('div');
            titleDiv.className = 'video-title';
            const a = document.createElement('a');
            a.className = 'video-link';
            a.target = '_blank';
            titleDiv.appendChild(a);
            contentDiv.appendChild(titleDiv);
            const channelDiv = document.createElement('div');
            channelDiv.className = 'video-channel';
            channelDiv.setAttribute('data-i18n', 'videos_channel_label');
            contentDiv.appendChild(channelDiv);
            const detailsDiv = document.createElement('div');
            detailsDiv.className = 'video-details';
            const progressSpan = document.createElement('span');
            progressSpan.className = 'video-progress';
            const dateSpan = document.createElement('span');
            dateSpan.className = 'video-date';
            const deleteButton = document.createElement('button');
            deleteButton.className = 'delete-button';
            deleteButton.textContent = chrome.i18n.getMessage('delete_label');
            detailsDiv.appendChild(progressSpan);
            detailsDiv.appendChild(dateSpan);
            detailsDiv.appendChild(deleteButton);
            contentDiv.appendChild(detailsDiv);
            cell.appendChild(contentDiv);
        }

        // Update content
        const thumbnail = cell.querySelector('.video-thumbnail');
        const link = cell.querySelector('.video-link');
        const progress = cell.querySelector('.video-progress');
        const date = cell.querySelector('.video-date');
        const deleteButton = cell.querySelector('.delete-button');
        const channelDiv = cell.querySelector('.video-channel');

        thumbnail.src = `https://i.ytimg.com/vi/${record.videoId}/mqdefault.jpg`;
        thumbnail.alt = record.title || 'Video thumbnail';

        link.href = record.url;
        link.textContent = record.title || 'Unknown Title';

        progress.textContent = formatProgress(record.time, record.duration);
        date.textContent = formatDate(record.timestamp);
        channelDiv.textContent = sanitizeText(record.channelName || '');

        deleteButton.onclick = () => deleteRecord(record.videoId);
    });

    // Update pagination info and controls
    updatePaginationUI(currentPage, totalPages);

    // Update analytics if we're showing them
    if (document.getElementById('ytvhtAnalyticsContainer').style.display !== 'none') {
        updateAnalytics();
    }
}

async function deleteRecord(videoId) {
    try {
        await ytStorage.removeVideo(videoId);
        showMessage(chrome.i18n.getMessage('message_video_removed'));
        // Remove from local array and refresh page
        allHistoryRecords = allHistoryRecords.filter(r => r.videoId !== videoId);
        displayHistoryPage();
    } catch (error) {
        console.error('Error deleting record:', error);
        showMessage(chrome.i18n.getMessage('message_error_removing_video', [error.message || chrome.i18n.getMessage('message_unknown_error')]), 'error');
    }
}

async function clearHistory() {
    if (!confirm(chrome.i18n.getMessage('message_confirm_clear_history'))) {
        return;
    }

    try {
        await ytStorage.clear();
        showMessage(chrome.i18n.getMessage('message_history_cleared'));
        allHistoryRecords = [];
        allPlaylists = [];
        currentPage = 1;
        currentPlaylistPage = 1;
        displayHistoryPage();
        if (document.getElementById('ytvhtTabPlaylists').classList.contains('active')) {
            displayPlaylistsPage();
        }
    } catch (error) {
        console.error('Error clearing history:', error);
        showMessage(chrome.i18n.getMessage('message_error_clearing_history', [error.message || chrome.i18n.getMessage('message_unknown_error')]), 'error');
    }
}

async function exportHistory() {
    try {
        const [videosObj, playlistsObj, stats] = await Promise.all([
            ytStorage.getAllVideos(),
            ytStorage.getAllPlaylists(),
            (async ()=>{ try { return await ytStorage.getStats(); } catch(e){ return null; } })()
        ]);

        // Convert objects to arrays (getAllVideos/getAllPlaylists return objects keyed by ID)
        const videos = Object.values(videosObj || {});
        const playlists = Object.values(playlistsObj || {});

        // Validate exported records (required fields)
        const validVideos = videos.filter(v => 
            v && typeof v.videoId === 'string' && typeof v.timestamp === 'number' && typeof v.time === 'number'
        );
        const validPlaylists = playlists.filter(p => 
            p && typeof p.playlistId === 'string'
        );

        // Create export data with metadata
        const exportData = {
            _metadata: {
                exportDate: new Date().toISOString(),
                extensionVersion: EXTENSION_VERSION,
                totalVideos: validVideos.length,
                totalPlaylists: validPlaylists.length,
                exportFormat: "json",
                dataVersion: "1.1"
            },
            history: validVideos,  // Array of video records
            playlists: validPlaylists,  // Array of playlist records
            stats: stats || undefined
        };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], {type: 'application/json'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `youtube-history-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showMessage(chrome.i18n.getMessage('message_export_success', [validVideos.length, validPlaylists.length]));
    } catch (error) {
        console.error('Error exporting history:', error);
        showMessage(chrome.i18n.getMessage('message_error_exporting_history', [error.message || chrome.i18n.getMessage('message_unknown_error')]), 'error');
    }
}

function openImportPage() {
    if (!chrome || !chrome.tabs || !chrome.tabs.query) {
        return;
    }

    const targetHash = '#ytlh_import';

    // First, pause any playing video in the active tab (if it's YouTube)
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeTab = tabs && tabs[0];
        if (activeTab && activeTab.id && activeTab.url && activeTab.url.includes('://www.youtube.com/')) {
            try {
                chrome.tabs.sendMessage(activeTab.id, { type: 'pauseVideoForImport' }, () => {
                    // Ignore errors here; pausing is best-effort only
                });
            } catch (e) {
                // Ignore messaging errors
            }
        }

        // Always open a dedicated import tab instead of reloading the current one
        chrome.tabs.create({ url: `https://www.youtube.com/${targetHash}` });
    });
}

// Extract all Shorts records from a history object (object of videoId -> record)
// Fallback: treat as Shorts if isShorts === true, or if isShorts is missing and url contains '/shorts/'
function extractShortsRecords(historyObj) {
    if (!historyObj || typeof historyObj !== 'object') return [];
    return Object.values(historyObj).filter(r =>
        r.isShorts === true ||
        (typeof r.isShorts === 'undefined' && r.url && r.url.includes('/shorts/'))
    );
}

// Extract all non-Shorts (regular video) records from a history object
// Fallback: treat as regular if isShorts === false, or if isShorts is missing and url does not contain '/shorts/'
function extractRegularVideoRecords(historyObj) {
    if (!historyObj || typeof historyObj !== 'object') return [];
    return Object.values(historyObj).filter(r =>
        r.isShorts === false ||
        (typeof r.isShorts === 'undefined' && (!r.url || !r.url.includes('/shorts/')))
    );
}

async function goToPrevPage() {
    if (currentPage > 1) {
        currentPage--;
        await loadHistoryPage({ page: currentPage });
        displayHistoryPage();
    }
}

async function goToNextPage() {
    if (currentPage < totalPages) {
        currentPage++;
        await loadHistoryPage({ page: currentPage });
        displayHistoryPage();
    }
}

async function goToFirstPage() {
    if (currentPage !== 1) {
        currentPage = 1;
        await loadHistoryPage({ page: currentPage });
        displayHistoryPage();
    }
}

async function goToLastPage() {
    if (currentPage !== totalPages) {
        currentPage = totalPages;
        await loadHistoryPage({ page: currentPage });
        displayHistoryPage();
    }
}

async function goToPage(page) {
    if (page >= 1 && page <= totalPages && page !== currentPage) {
        currentPage = page;
        await loadHistoryPage({ page: currentPage });
        displayHistoryPage();
    }
}

function updateVideosPaginationUI(current, total) {
    // Defensive: Only update if all required elements exist
    const pageInfo = document.getElementById('ytvhtPageInfo');
    const firstBtn = document.getElementById('ytvhtFirstPage');
    const prevBtn = document.getElementById('ytvhtPrevPage');
    const nextBtn = document.getElementById('ytvhtNextPage');
    const lastBtn = document.getElementById('ytvhtLastPage');
    const pageInput = document.getElementById('ytvhtPageInput');
    const pageNumbers = document.getElementById('ytvhtPageNumbers');

    if (!pageInfo || !firstBtn || !prevBtn || !nextBtn || !lastBtn || !pageInput || !pageNumbers) {
        // One or more elements are missing, do not proceed
        return;
    }

    pageInfo.textContent = chrome.i18n.getMessage('pagination_page_info', [current, total]);

    // Update button states
    firstBtn.disabled = current === 1;
    prevBtn.disabled = current === 1;
    nextBtn.disabled = current === total;
    lastBtn.disabled = current === total;

    // Update page input
    pageInput.max = total;

    // Generate page numbers (smart pagination)
    pageNumbers.innerHTML = '';

    if (total <= 7) {
        // Show all pages if 7 or fewer
        for (let i = 1; i <= total; i++) {
            addVideosPageButton(i, current);
        }
    } else {
        // Smart pagination for many pages
        addVideosPageButton(1, current); // Always show first page

        if (current > 3) {
            addVideosEllipsis(); // Add ... if current is far from start
        }

        // Show current page and neighbors (1 before and 1 after)
        const start = Math.max(2, current - 1);
        const end = Math.min(total - 1, current + 1);

        for (let i = start; i <= end; i++) {
            if (i !== 1 && i !== total) { // Don't duplicate first/last page
                addVideosPageButton(i, current);
            }
        }

        if (current < total - 2) {
            addVideosEllipsis(); // Add ... if current is far from end
        }

        if (total > 1) {
            addVideosPageButton(total, current); // Always show last page
        }
    }
}


function addVideosPageButton(pageNum, currentPage) {
    const button = document.createElement('button');
    button.textContent = pageNum;
    button.className = pageNum === currentPage ? 'active' : '';
    button.style.cssText = `
        min-width: 30px;
        padding: 5px 8px;
        border: 1px solid #ccc;
        background: ${pageNum === currentPage ? '#007cba' : '#f9f9f9'};
        color: ${pageNum === currentPage ? 'white' : '#333'};
        cursor: pointer;
        border-radius: 3px;
    `;
    button.addEventListener('click', () => goToPage(pageNum));
    document.getElementById('ytvhtPageNumbers').appendChild(button);
}

function addVideosEllipsis() {
    const span = document.createElement('span');
    span.innerHTML = '&hellip;';  // HTML entity for ellipsis
    span.style.cssText = `
        padding: 5px 10px;
        color: var(--text-color);
        opacity: 0.7;
        font-weight: bold;
        user-select: none;
        display: flex;
        align-items: center;
        font-size: 16px;
        letter-spacing: 2px;
    `;
    document.getElementById('ytvhtPageNumbers').appendChild(span);
}

function updatePaginationUI(current, total) {
    // Use simple pagination for videos tab
    updateVideosPaginationUI(current, total);
}

// Contextual empty states based on tab and search context
function getContextualEmptyState(tab, searchQuery) {
    if (searchQuery && searchQuery.trim()) {
        // Search-specific empty states
        return {
            icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>',
            title: chrome.i18n.getMessage('search_no_results_title', 'No results found'),
            subtitle: chrome.i18n.getMessage('search_no_results_subtitle', 'Try different keywords or clear the search'),
            action: chrome.i18n.getMessage('search_clear_button', 'Clear search'),
            actionCallback: () => {
                if (globalSearchInput) {
                    globalSearchInput.value = '';
                    searchQuery = '';
                    loadCurrentPages();
                }
            }
        };
    }

    // Tab-specific empty states
    switch (tab) {
        case 'videos':
            return {
                icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
                title: chrome.i18n.getMessage('videos_empty_title', 'No videos yet'),
                subtitle: chrome.i18n.getMessage('videos_empty_subtitle', 'Watch some YouTube videos to see your history here'),
                action: chrome.i18n.getMessage('videos_empty_action', 'Browse YouTube'),
                actionCallback: () => {
                    chrome.tabs.create({ url: 'https://www.youtube.com' });
                }
            };

        case 'shorts':
            return {
                icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M11.71 15.29l2.59-2.59a1.5 1.5 0 0 0-2.12-2.12l-2.59 2.59a1.5 1.5 0 0 0 2.12 2.12z"/><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/></svg>',
                title: chrome.i18n.getMessage('shorts_empty_title', 'No shorts watched'),
                subtitle: chrome.i18n.getMessage('shorts_empty_subtitle', 'Short videos you watch will appear here'),
                action: chrome.i18n.getMessage('shorts_empty_action', 'Explore shorts'),
                actionCallback: () => {
                    chrome.tabs.create({ url: 'https://www.youtube.com/shorts' });
                }
            };

        case 'playlists':
            return {
                icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg>',
                title: chrome.i18n.getMessage('playlists_empty_title', 'No playlists found'),
                subtitle: chrome.i18n.getMessage('playlists_empty_subtitle', 'Saved playlists will appear here'),
                action: chrome.i18n.getMessage('playlists_empty_action', 'Browse playlists'),
                actionCallback: () => {
                    chrome.tabs.create({ url: 'https://www.youtube.com/playlists' });
                }
            };

        default:
            return {
                icon: '📭',
                title: chrome.i18n.getMessage('generic_empty_title', 'Nothing here'),
                subtitle: chrome.i18n.getMessage('generic_empty_subtitle', 'Check back later'),
                action: null
            };
    }
}

function renderEmptyState(container, emptyState) {
    container.innerHTML = `
        <div class="empty-state">
            <div class="empty-state-icon">${emptyState.icon}</div>
            <h3 class="empty-title">${emptyState.title}</h3>
            <p class="empty-subtitle">${emptyState.subtitle}</p>
            ${emptyState.action ? `
                <button class="empty-action-btn" data-empty-action="true">
                    ${emptyState.action}
                </button>
            ` : ''}
        </div>
    `;

    // Add event listener for empty action button (CSP compliant)
    if (emptyState.action && emptyState.actionCallback) {
        const actionBtn = container.querySelector('.empty-action-btn');
        if (actionBtn) {
            actionBtn.addEventListener('click', emptyState.actionCallback);
        }
    }
}

// Responsive table column management
function makeTableResponsive(table) {
    if (!table) return;

    const tableWidth = table.offsetWidth;
    const headers = table.querySelectorAll('thead th');
    const rows = table.querySelectorAll('tbody tr');

    // Define responsive breakpoints
    const isNarrow = tableWidth < 600;
    const isVeryNarrow = tableWidth < 400;

    // Hide/show columns based on width
    headers.forEach((header, index) => {
        const columnClass = header.className || `col-${index}`;

        // Duration column (usually index 1)
        if (columnClass.includes('duration') || header.textContent.toLowerCase().includes('duration')) {
            header.style.display = isNarrow ? 'none' : '';
            rows.forEach(row => {
                const cell = row.cells[index];
                if (cell) cell.style.display = isNarrow ? 'none' : '';
            });
        }

        // Date column on very narrow screens
        if (isVeryNarrow && (columnClass.includes('date') || header.textContent.toLowerCase().includes('date'))) {
            header.style.display = 'none';
            rows.forEach(row => {
                const cell = row.cells[index];
                if (cell) cell.style.display = 'none';
            });
        }
    });
}

// Watch for table size changes
function setupResponsiveTables() {
    const tables = ['ytvhtShortsTable', 'ytvhtPlaylistsTable'];

    tables.forEach(tableId => {
        const table = document.getElementById(tableId);
        if (table) {
            // Initial responsive check
            makeTableResponsive(table);

            // Watch for resize events
            const resizeObserver = new ResizeObserver(() => {
                makeTableResponsive(table);
            });
            resizeObserver.observe(table);
        }
    });
}

function addPageButton(pageNum, currentPage) {
    const button = document.createElement('button');
    button.textContent = pageNum;
    button.className = pageNum === currentPage ? 'active' : '';
    button.style.cssText = `
        min-width: 30px;
        padding: 5px 8px;
        border: 1px solid #ccc;
        background: ${pageNum === currentPage ? '#007cba' : '#f9f9f9'};
        color: ${pageNum === currentPage ? 'white' : '#333'};
        cursor: pointer;
        border-radius: 3px;
    `;
    button.addEventListener('click', () => goToPage(pageNum));
    document.getElementById('ytvhtPageNumbers').appendChild(button);
}

async function loadPlaylists(showMessages = true) {
    try {
        log('Loading playlists from storage...');
        const playlists = await ytStorage.getAllPlaylists();

        if (!playlists || Object.keys(playlists).length === 0) {
            if (showMessages) {
                showMessage(chrome.i18n.getMessage('playlists_no_playlists_found'), 'info');
            }
            allPlaylists = [];
        } else {
            // Convert the object of playlists to an array and sort by lastUpdated descending (most recent first)
            allPlaylists = Object.values(playlists);
            allPlaylists.sort((a, b) => (b.lastUpdated || 0) - (a.lastUpdated || 0));
            log('Loaded playlists:', allPlaylists);
        }

        currentPlaylistPage = 1;
        if (showMessages) {
            displayPlaylistsPage();
        }
    } catch (error) {
        console.error('Error loading playlists:', error);
        if (showMessages) {
            showMessage(chrome.i18n.getMessage('error_loading_playlists', [error.message || chrome.i18n.getMessage('unknown_error')]), 'error');
        }
    }
}

function displayPlaylistsPage() {
    console.log('[Display] displayPlaylistsPage called, allPlaylists length:', allPlaylists.length);

    const playlistsTable = document.getElementById('ytvhtPlaylistsTable');
    const noPlaylists = document.getElementById('ytvhtNoPlaylists');
    const paginationDiv = document.getElementById('ytvhtPlaylistsPagination');
    const body = document.getElementById('ytvhtPlaylistsBody');
    body.innerHTML = '';

    // allPlaylists already contains the current page data
    const pageRecords = allPlaylists;

    // Apply content density adaptation
    adjustContentDensity(pageRecords);

    if (!pageRecords.length) {
        playlistsTable.style.display = 'none';
        noPlaylists.style.display = 'block';
        const emptyState = getContextualEmptyState('playlists', searchQuery);
        renderEmptyState(noPlaylists, emptyState);
        paginationDiv.style.display = 'none';
        return;
    }

    noPlaylists.style.display = 'none';
    playlistsTable.style.display = '';
    paginationDiv.style.display = 'flex';

    // Pagination bounds checking (totalPlaylistPages is now set by loadPlaylistsPage)
    if (currentPlaylistPage > totalPlaylistPages) currentPlaylistPage = totalPlaylistPages;
    if (currentPlaylistPage < 1) currentPlaylistPage = 1;

    // Reuse existing rows when possible
    while (body.rows.length > pageRecords.length) {
        body.deleteRow(-1);
    }

    pageRecords.forEach((record, index) => {
        let row = body.rows[index];
        const isNewRow = !row;

        if (isNewRow) {
            row = document.createElement('tr');
            const cell = document.createElement('td');
            row.appendChild(cell);
            body.appendChild(row);
        }

        // Get the cell
        const cell = row.cells[0];
        cell.className = 'playlist-cell';

        // Create or update content
        if (!cell.querySelector('.playlist-icon')) {
            // Build DOM nodes instead of using innerHTML
            cell.innerHTML = '';
            const iconDiv = document.createElement('div');
            iconDiv.className = 'playlist-icon';
            iconDiv.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z"/><circle cx="20" cy="7" r="2"/><circle cx="20" cy="12" r="2"/><circle cx="20" cy="17" r="2"/></svg>`;
            cell.appendChild(iconDiv);
            const contentDiv = document.createElement('div');
            contentDiv.className = 'playlist-content';
            const titleDiv = document.createElement('div');
            titleDiv.className = 'playlist-title';
            const a = document.createElement('a');
            a.className = 'video-link';
            a.target = '_blank';
            titleDiv.appendChild(a);
            contentDiv.appendChild(titleDiv);
            const detailsDiv = document.createElement('div');
            detailsDiv.className = 'playlist-details';
            const dateSpan = document.createElement('span');
            dateSpan.className = 'playlist-date';
            const ignoreLabel = document.createElement('span');
            ignoreLabel.className = 'playlist-ignore-label';
            ignoreLabel.style.cssText = 'padding:2px 6px;border:1px solid var(--border-color);border-radius:4px;';
            const ignoreToggle = document.createElement('input');
            ignoreToggle.type = 'checkbox';
            ignoreToggle.title = chrome.i18n.getMessage('playlists_ignore_toggle_tooltip') || 'Ignore videos in this playlist';
            const deleteButton = document.createElement('button');
            deleteButton.className = 'delete-button';
            deleteButton.textContent = chrome.i18n.getMessage('delete_label');
            detailsDiv.appendChild(dateSpan);
            detailsDiv.appendChild(ignoreLabel);
            detailsDiv.appendChild(ignoreToggle);
            detailsDiv.appendChild(deleteButton);
            contentDiv.appendChild(detailsDiv);
            cell.appendChild(contentDiv);
        }

        // Update content
        const link = cell.querySelector('.video-link');
        const date = cell.querySelector('.playlist-date');
        const deleteButton = cell.querySelector('.delete-button');
        const ignoreToggle = cell.querySelector('input[type="checkbox"]');
        const ignoreLabel = cell.querySelector('.playlist-ignore-label');

        link.href = record.url;
        link.textContent = record.title || 'Unknown Playlist';
        date.textContent = formatDate(record.timestamp);
        ignoreLabel.textContent = chrome.i18n.getMessage('playlists_ignore_toggle_label') || 'Ignore';
        ignoreToggle.checked = !!record.ignoreVideos;
        ignoreToggle.onchange = async () => {
            try {
                const existing = await ytStorage.getPlaylist(record.playlistId);
                const updated = { ...(existing || {}), ignoreVideos: ignoreToggle.checked, lastUpdated: Date.now() };
                await ytStorage.setPlaylist(record.playlistId, updated);
                showMessage(ignoreToggle.checked ? (chrome.i18n.getMessage('playlists_ignore_enabled') || 'Playlist will be ignored') : (chrome.i18n.getMessage('playlists_ignore_disabled') || 'Playlist will be tracked'));
            } catch (e) {
                showMessage(chrome.i18n.getMessage('message_unknown_error') || 'Error', 'error');
                ignoreToggle.checked = !!record.ignoreVideos; // revert
            }
        };
        deleteButton.onclick = () => deletePlaylist(record.playlistId);
    });

    // Update pagination info and controls
    updatePlaylistPaginationUI(currentPlaylistPage, totalPlaylistPages);
}

async function goToFirstPlaylistPage() {
    if (currentPlaylistPage !== 1) {
        currentPlaylistPage = 1;
        await loadPlaylistsPage({ page: currentPlaylistPage });
        displayPlaylistsPage();
    }
}

async function goToLastPlaylistPage() {
    if (currentPlaylistPage !== totalPlaylistPages) {
        currentPlaylistPage = totalPlaylistPages;
        await loadPlaylistsPage({ page: currentPlaylistPage });
        displayPlaylistsPage();
    }
}

async function goToPlaylistPage(page) {
    if (page >= 1 && page <= totalPlaylistPages && page !== currentPlaylistPage) {
        currentPlaylistPage = page;
        await loadPlaylistsPage({ page: currentPlaylistPage });
        displayPlaylistsPage();
    }
}

function updatePlaylistPaginationUI(current, total) {
    document.getElementById('ytvhtPlaylistsPageInfo').textContent = chrome.i18n.getMessage('pagination_page_info', [current, total]);

    // Update button states
    document.getElementById('ytvhtFirstPlaylistPage').disabled = current === 1;
    document.getElementById('ytvhtPrevPlaylistPage').disabled = current === 1;
    document.getElementById('ytvhtNextPlaylistPage').disabled = current === total;
    document.getElementById('ytvhtLastPlaylistPage').disabled = current === total;

    // Update page input
    const pageInput = document.getElementById('ytvhtPlaylistPageInput');
    pageInput.max = total;

    // Generate page numbers
    const pageNumbers = document.getElementById('ytvhtPlaylistPageNumbers');
    pageNumbers.innerHTML = '';

    if (total <= 7) {
        // Show all pages if 7 or fewer
        for (let i = 1; i <= total; i++) {
            addPlaylistPageButton(i, current);
        }
    } else {
        // Smart pagination for many pages
        addPlaylistPageButton(1, current); // Always show first page

        if (current > 3) {
            addPlaylistEllipsis(); // Add ... if current is far from start
        }

        // Show current page and neighbors (1 before and 1 after)
        const start = Math.max(2, current - 1);
        const end = Math.min(total - 1, current + 1);

        for (let i = start; i <= end; i++) {
            if (i !== 1 && i !== total) { // Don't duplicate first/last page
                addPlaylistPageButton(i, current);
            }
        }

        if (current < total - 2) {
            addPlaylistEllipsis(); // Add ... if current is far from end
        }

        if (total > 1) {
            addPlaylistPageButton(total, current); // Always show last page
        }
    }


}

function addPlaylistPageButton(pageNum, currentPage) {
    const button = document.createElement('button');
    button.textContent = pageNum;
    button.className = pageNum === currentPage ? 'active' : '';
    button.style.cssText = `
        min-width: 30px;
        padding: 5px 8px;
        border: 1px solid #ccc;
        background: ${pageNum === currentPage ? '#007cba' : '#f9f9f9'};
        color: ${pageNum === currentPage ? 'white' : '#333'};
        cursor: pointer;
        border-radius: 3px;
    `;
    button.addEventListener('click', () => goToPlaylistPage(pageNum));
    document.getElementById('ytvhtPlaylistPageNumbers').appendChild(button);
}

function addPlaylistEllipsis() {
    const span = document.createElement('span');
    span.innerHTML = '&hellip;';  // HTML entity for ellipsis
    span.style.cssText = `
        padding: 5px 10px;
        color: var(--text-color);
        opacity: 0.7;
        font-weight: bold;
        user-select: none;
        display: flex;
        align-items: center;
        font-size: 16px;
        letter-spacing: 2px;
    `;
    document.getElementById('ytvhtPlaylistPageNumbers').appendChild(span);
}

async function deletePlaylist(playlistId) {
    try {
        await ytStorage.removePlaylist(playlistId);
        showMessage(chrome.i18n.getMessage('message_playlist_removed'));
        allPlaylists = allPlaylists.filter(r => r.playlistId !== playlistId);
        displayPlaylistsPage();
    } catch (error) {
        console.error('Error deleting playlist:', error);
        showMessage(chrome.i18n.getMessage('message_error_removing_playlist', [error.message || chrome.i18n.getMessage('message_unknown_error')]), 'error');
    }
}

// Load settings from storage
async function loadSettings() {
    try {
        const settings = await ytStorage.getSettings() || {};
        let updated = false;

        // Ensure all default settings exist
        for (const key in DEFAULT_SETTINGS) {
            if (!(key in settings)) {
                settings[key] = DEFAULT_SETTINGS[key];
                updated = true;
            }
        }

        // Save back if we added any defaults
        if (updated) {
            await ytStorage.setSettings(settings);
        }

        return settings;
    } catch (error) {
        console.error('Error loading settings:', error);
        return {...DEFAULT_SETTINGS}; // Return a copy of defaults
    }
}

// Save settings to storage
async function saveSettings(settings) {
    try {
        // Remove parasite sub-object if present
        if ('settings' in settings) {
            delete settings.settings;
        }
        await ytStorage.setSettings(settings);
        return true;
    } catch (error) {
        console.error('Error saving settings:', error);
        return false;
    }
}

// Update settings UI with current values
function updateSettingsUI(settings) {
    const autoCleanSelect = document.getElementById('ytvhtAutoCleanPeriod');
    if (settings.autoCleanPeriod === 'forever') {
        autoCleanSelect.value = 'forever';
    } else {
        // For numeric values, select the closest available option or the value itself
        const numericValue = parseInt(settings.autoCleanPeriod) || 90;
        if (['30', '90', '180'].includes(numericValue.toString())) {
            autoCleanSelect.value = numericValue.toString();
        } else {
            // If it's a custom value, default to 90
            autoCleanSelect.value = '90';
        }
    }
    document.getElementById('ytvhtPaginationCount').value = settings.paginationCount;
    document.getElementById('ytvhtOverlayTitle').value = settings.overlayTitle;
    document.getElementById('ytvhtOverlayColor').value = settings.overlayColor;
    document.getElementById('ytvhtOverlayLabelSize').value = settings.overlayLabelSize;
    document.getElementById('ytvhtDebugMode').checked = settings.debug;
    const pauseChk = document.getElementById('ytvhtPauseHistoryInPlaylists');
    if (pauseChk) pauseChk.checked = !!settings.pauseHistoryInPlaylists;
    document.getElementById('ytvhtVersion').textContent = EXTENSION_VERSION;
    updateColorPreview(settings.overlayColor);
}

// Update color preview
function updateColorPreview(color) {
    const preview = document.getElementById('ytvhtColorPreview');
    preview.style.backgroundColor = OVERLAY_COLORS[color];
}

// Handle settings tab
async function initSettingsTab() {
    log('Initializing settings tab...');
    const settings = await loadSettings();
    log('Loaded settings:', settings);

    // Update UI with current values
    updateSettingsUI(settings);

    // Auto-clean period
    const autoCleanPeriod = document.getElementById('ytvhtAutoCleanPeriod');
    if (autoCleanPeriod) {
        autoCleanPeriod.addEventListener('change', async function () {
            const settings = await loadSettings();
            const value = this.value;
            settings.autoCleanPeriod = value === 'forever' ? 'forever' : parseInt(value);
            await saveSettings(settings);
            showMessage(chrome.i18n.getMessage('message_auto_clean_updated'));
        });
    } else {
        log('Error: Auto-clean period element not found');
    }

    // Pagination count
    const paginationCount = document.getElementById('ytvhtPaginationCount');
    if (paginationCount) {
        paginationCount.addEventListener('change', async function () {
            const settings = await loadSettings();
            settings.paginationCount = parseInt(this.value);
            await saveSettings(settings);

            // Update page size variables
            pageSize = settings.paginationCount;
            shortsPageSize = settings.paginationCount;
            playlistPageSize = settings.paginationCount;

            // Reload current pages with new page size
            await loadCurrentPages();

            showMessage(chrome.i18n.getMessage('message_pagination_count_updated'));
        });
    } else {
        log('Error: Pagination count element not found');
    }

    // Overlay title
    const overlayTitle = document.getElementById('ytvhtOverlayTitle');
    if (overlayTitle) {
        overlayTitle.addEventListener('change', async function () {
            const settings = await loadSettings();
            settings.overlayTitle = this.value;
            await saveSettings(settings);
            showMessage(chrome.i18n.getMessage('message_overlay_title_updated'));
        });
    } else {
        log('Error: Overlay title element not found');
    }

    // Overlay color
    const overlayColor = document.getElementById('ytvhtOverlayColor');
    if (overlayColor) {
        overlayColor.addEventListener('change', async function () {
            const settings = await loadSettings();
            settings.overlayColor = this.value;
            updateColorPreview(this.value);
            await saveSettings(settings);
            showMessage(chrome.i18n.getMessage('message_overlay_color_updated'));
        });
    } else {
        log('Error: Overlay color element not found');
    }

    // Overlay label size
    const overlayLabelSize = document.getElementById('ytvhtOverlayLabelSize');
    if (overlayLabelSize) {
        overlayLabelSize.addEventListener('change', async function () {
            const settings = await loadSettings();
            settings.overlayLabelSize = this.value;
            await saveSettings(settings);
            showMessage(chrome.i18n.getMessage('message_overlay_size_updated'));
        });
    } else {
        log('Error: Overlay label size element not found');
    }

    // Theme preference
    const themePreference = document.getElementById('ytvhtThemePreference');
    if (themePreference) {
        themePreference.value = settings.themePreference || 'system';
        themePreference.addEventListener('change', async function () {
            const settings = await loadSettings();
            settings.themePreference = this.value;
            await saveSettings(settings);
            await applyTheme(this.value);
            showMessage(chrome.i18n.getMessage('message_theme_preference_updated'));
        });
    } else {
        log('Error: Theme preference element not found');
    }

    // Debug mode
    const debugMode = document.getElementById('ytvhtDebugMode');
    if (debugMode) {
        debugMode.checked = settings.debug || false;
        debugMode.addEventListener('change', async function () {
            const settings = await loadSettings();
            settings.debug = this.checked;
            await saveSettings(settings);
            showMessage(chrome.i18n.getMessage('message_debug_mode_enabled'));
        });
    } else {
        log('Error: Debug mode element not found');
    }

    // Pause history in playlists
    const pauseInPlaylists = document.getElementById('ytvhtPauseHistoryInPlaylists');
    if (pauseInPlaylists) {
        pauseInPlaylists.checked = settings.pauseHistoryInPlaylists || false;
        pauseInPlaylists.addEventListener('change', async function () {
            const s = await loadSettings();
            s.pauseHistoryInPlaylists = this.checked;
            await saveSettings(s);
            const enabledMsg = chrome.i18n.getMessage('message_pause_in_playlists_enabled') || 'Paused history in playlists enabled';
            const disabledMsg = chrome.i18n.getMessage('message_pause_in_playlists_disabled') || 'Paused history in playlists disabled';
            showMessage(this.checked ? enabledMsg : disabledMsg);
        });
    } else {
        log('Error: Pause history in playlists element not found');
    }

    // Version display
    const versionElement = document.getElementById('ytvhtVersion');
    if (versionElement) {
        versionElement.textContent = EXTENSION_VERSION;
    } else {
        log('Error: Version element not found');
    }

    log('Settings tab initialization complete');
}

// Switch between different tabs in the popup
function switchTab(tab) {
    // Save the current tab
    saveCurrentExtensionTab(tab);

    // Remove active class from all tabs
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));

    // Add active class to selected tab
    document.getElementById(`ytvhtTab${tab.charAt(0).toUpperCase() + tab.slice(1)}`).classList.add('active');

    // Hide all containers
    document.getElementById('ytvhtVideosContainer').style.display = 'none';
    document.getElementById('ytvhtShortsContainer').style.display = 'none';
    document.getElementById('ytvhtPlaylistsContainer').style.display = 'none';
    document.getElementById('ytvhtSettingsContainer').style.display = 'none';
    document.getElementById('ytvhtAnalyticsContainer').style.display = 'none';

    // Show selected container
    const container = document.getElementById(`ytvht${tab.charAt(0).toUpperCase() + tab.slice(1)}Container`);
    if (container) {
        container.style.display = 'block';

        // Handle special tab initializations
        if (tab === 'analytics') {
            // Small delay to ensure container is visible and sized
            setTimeout(() => {
                updateAnalytics();
            }, 0);
        } else if (tab === 'settings') {
            // Initialize settings tab
            initSettingsTab();
        } else if (tab === 'videos') {
            // Display videos when switching to videos tab
            displayHistoryPage();
        } else if (tab === 'playlists') {
            // Load playlists when switching to playlists tab
            if (allPlaylists.length === 0) {
                loadPlaylistsPage({ page: currentPlaylistPage });
            }
            displayPlaylistsPage();
        } else if (tab === 'shorts') {
            // Display shorts when switching to shorts tab
            displayShortsPage();
        }
    }
}

/**
 * Saves the currently opened extension tab (e.g., "videos", "shorts", "playlists", "settings") in localStorage.
 * @param {string} tabName - The name of the tab to save.
 */
function saveCurrentExtensionTab(tabName) {
    if (typeof tabName === 'string') {
        localStorage.setItem('ythdb_currentTab', tabName);
    }
}

/**
 * Reads the currently saved extension tab from localStorage.
 * @returns {string|null} The name of the saved tab, or null if not set.
 */
function getCurrentExtensionTab() {
    return localStorage.getItem('ythdb_currentTab');
}

// Function to check system dark mode preference
async function getSystemColorScheme() {
    try {
        log('=== Starting theme detection ===');

        // 1. First check prefers-color-scheme media query
        const darkMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        const lightMediaQuery = window.matchMedia('(prefers-color-scheme: light)');

        log(`[Theme Detection] Media query - prefers-color-scheme: ${darkMediaQuery.matches ? 'dark' : lightMediaQuery.matches ? 'light' : 'not set'}`);

        if (darkMediaQuery.matches) {
            log('[Theme Detection] Using dark theme from media query');
            return 'dark';
        }
        if (lightMediaQuery.matches) {
            log('[Theme Detection] Using light theme from media query');
            return 'light';
        }

        // 2. Try to get the browser's theme info
        if (typeof browser !== 'undefined' && browser.theme && typeof browser.theme.getCurrent === 'function') {
            try {
                log('[Theme Detection] Attempting to get browser theme info...');
                const themeInfo = await browser.theme.getCurrent();
                log('[Theme Detection] Browser theme info:', JSON.stringify(themeInfo, null, 2));

                if (themeInfo && themeInfo.colors) {
                    // Log all color values for debugging
                    log('[Theme Detection] Theme colors:', Object.entries(themeInfo.colors)
                        .map(([key, value]) => `${key}: ${value}`)
                        .join('\n  '));

                    // Check for explicit dark theme indicators
                    if (themeInfo.colors.color_scheme === 'dark' ||
                        (themeInfo.colors.theme_collection &&
                            themeInfo.colors.theme_collection.private_browsing === 'dark')) {
                        log('[Theme Detection] Detected dark theme from explicit indicators');
                        return 'dark';
                    }

                    // Check for common dark theme properties
                    const themeColors = JSON.stringify(themeInfo.colors).toLowerCase();
                    const hasDarkIndicator = ['dark', 'night', 'black'].some(key =>
                        themeColors.includes(key));

                    if (hasDarkIndicator) {
                        log('[Theme Detection] Detected dark theme from color analysis');
                        return 'dark';
                    }
                }
            } catch (e) {
                log('[Theme Detection] Error getting browser theme:', e);
            }
        } else {
            log('[Theme Detection] Browser theme API not available');
        }

        // 3. Check for high contrast mode
        if (window.matchMedia('(forced-colors: active)').matches) {
            log('[Theme Detection] High contrast mode detected');
            if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
                return 'dark';
            }
        }

        // 4. Check the document's background color as a last resort
        const bgColor = window.getComputedStyle(document.documentElement).backgroundColor;
        log(`[Theme Detection] Document background color: ${bgColor}`);

        // Simple check for dark background
        if (bgColor) {
            const rgb = bgColor.match(/\d+/g);
            if (rgb && rgb.length >= 3) {
                const brightness = (parseInt(rgb[0]) * 299 +
                    parseInt(rgb[1]) * 587 +
                    parseInt(rgb[2]) * 114) / 1000;
                const isDark = brightness < 128;
                log(`[Theme Detection] Background brightness: ${brightness}, isDark: ${isDark}`);
                return isDark ? 'dark' : 'light';
            }
        }

        log('[Theme Detection] No dark theme detected, defaulting to light');
        return 'light';

    } catch (error) {
        log('[Theme Detection] Error in getSystemColorScheme:', error);
        return 'light'; // Default to light on error
    }
}

function toggleDarkMode(enable) {
    log('=== toggleDarkMode called with:', enable);

    try {
        const theme = enable ? 'dark' : 'light';
        log(`Setting theme to: ${theme}`);

        // Set data-theme attribute on html and body
        document.documentElement.setAttribute('data-theme', theme);
        document.body.setAttribute('data-theme', theme);

        // Toggle dark-mode class on body
        if (enable) {
            document.body.classList.add('dark-mode');
        } else {
            document.body.classList.remove('dark-mode');
        }

        // Force a reflow to ensure styles are applied
        document.body.offsetHeight;

        // Log the current state after applying theme
        const htmlTheme = document.documentElement.getAttribute('data-theme');
        const bodyTheme = document.body.getAttribute('data-theme');
        const bodyClasses = document.body.className;
        const computedBg = window.getComputedStyle(document.body).backgroundColor;
        const computedColor = window.getComputedStyle(document.body).color;

        log('Theme applied:', {
            'html data-theme': htmlTheme,
            'body data-theme': bodyTheme,
            'body classes': bodyClasses,
            'computed bg': computedBg,
            'computed color': computedColor
        });

    } catch (error) {
        console.error('Error in toggleDarkMode:', error);
    }
}

// Update theme toggle text based on current preference
function updateThemeToggleText(themePreference) {
    const themeText = document.getElementById('themeText');
    const toggleButton = document.getElementById('ytvhtToggleTheme');

    if (themeText) {
        let text = 'Theme';
        let tooltip = 'Toggle theme';

        switch (themePreference) {
            case 'light':
                text = 'Light';
                tooltip = 'Switch to dark theme';
                break;
            case 'dark':
                text = 'Dark';
                tooltip = 'Switch to light theme';
                break;
            case 'system':
            default:
                text = 'Auto';
                tooltip = 'Currently following system theme - Click to override';
                break;
        }

        themeText.textContent = text;
        if (toggleButton) {
            toggleButton.title = tooltip;
        }
    }
}

// Apply theme based on settings or override
async function applyTheme(themePreference) {
    let effectiveTheme = themePreference;
    if (!effectiveTheme || effectiveTheme === 'system') {
        effectiveTheme = await getSystemColorScheme();
    }
    toggleDarkMode(effectiveTheme === 'dark');
    updateThemeToggleText(themePreference || 'system');
}

// Toggle theme between light and dark (never "system" from the button)
async function toggleTheme() {
    try {
        const settings = await loadSettings();
        let newTheme;
        // Only toggle between light and dark
        if (settings.themePreference === 'dark') {
            newTheme = 'light';
        } else {
            newTheme = 'dark';
        }
        // Override the saved preference (even if it was "system")
        settings.themePreference = newTheme;
        await saveSettings(settings);
        updateThemeToggleText(newTheme);
        await applyTheme(newTheme);
    } catch (error) {
        console.error('Error in toggleTheme:', error);
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', async function () {
    try {
        log('Starting initialization...');

        // Load settings first
        const settings = await loadSettings();
        debugEnabled = settings.debug || false;

        // Update page size variables from settings
        pageSize = settings.paginationCount || 20;
        shortsPageSize = settings.paginationCount || 20;
        playlistPageSize = settings.paginationCount || 20;

        log('Initial settings:', settings);
        log('Page sizes set to:', { pageSize, shortsPageSize, playlistPageSize });

        // Function to handle theme changes
        async function handleThemeChange() {
            log('Theme change detected, re-applying theme...');
            const currentSettings = await loadSettings();
            await applyTheme(currentSettings.themePreference);
        }

        // Set up theme change listeners
        if (typeof browser !== 'undefined' && browser.theme && browser.theme.onUpdated) {
            log('Setting up browser theme change listener');
            browser.theme.onUpdated.addListener(handleThemeChange);

            // Clean up event listener when popup is closed
            window.addEventListener('unload', () => {
                if (typeof browser !== 'undefined' && browser.theme && browser.theme.onUpdated) {
                    browser.theme.onUpdated.removeListener(handleThemeChange);
                }
            });
        }

        // Set up system theme change listener
        const darkModeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        darkModeMediaQuery.addEventListener('change', handleThemeChange);

        // Clean up event listener when popup is closed
        window.addEventListener('unload', () => {
            darkModeMediaQuery.removeEventListener('change', handleThemeChange);
        });

        // Initialize storage
        const storageReady = await initStorage();
        if (!storageReady) {
            throw new Error('Failed to initialize storage');
        }

        // Update UI with current settings
        currentSettings = settings;
        updateSettingsUI(settings);

        // Apply theme immediately on popup open
        await applyTheme(settings.themePreference);

        // Set up theme toggle button
        const themeToggle = document.getElementById('ytvhtToggleTheme');
        if (themeToggle) {
            themeToggle.addEventListener('click', toggleTheme);
            updateThemeToggleText(settings.themePreference);
        }

        // Initialize settings tab
        initSettingsTab();

        // Load search history
        await loadSearchHistory();

        log('Theme and UI initialization complete');

        const colorSchemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
        colorSchemeQuery.addEventListener('change', handleThemeChange);
        log('System theme change listener set up');

        // Clean up event listeners when popup is closed
        window.addEventListener('unload', () => {
            if (typeof browser !== 'undefined' && browser.theme && browser.theme.onUpdated) {
                browser.theme.onUpdated.removeListener(handleThemeChange);
            }
            colorSchemeQuery.removeEventListener('change', handleThemeChange);
        });

        // Set up event listeners
        const clearButton = document.getElementById('ytvhtClearHistory');
        const exportButton = document.getElementById('ytvhtExportHistory');
        const importButton = document.getElementById('ytvhtImportHistory');
        const closeButton = document.getElementById('ytvhtClosePopup');
        const firstPageBtn = document.getElementById('ytvhtFirstPage');
        const prevPageBtn = document.getElementById('ytvhtPrevPage');
        const nextPageBtn = document.getElementById('ytvhtNextPage');
        const lastPageBtn = document.getElementById('ytvhtLastPage');
        const videosTab = document.getElementById('ytvhtTabVideos');
        const shortsTab = document.getElementById('ytvhtTabShorts');
        const playlistsTab = document.getElementById('ytvhtTabPlaylists');
        const analyticsTab = document.getElementById('ytvhtTabAnalytics');
        const settingsTab = document.getElementById('ytvhtTabSettings');
        const prevPlaylistBtn = document.getElementById('ytvhtPrevPlaylistPage');
        const nextPlaylistBtn = document.getElementById('ytvhtNextPlaylistPage');
        const firstPlaylistBtn = document.getElementById('ytvhtFirstPlaylistPage');
        const lastPlaylistBtn = document.getElementById('ytvhtLastPlaylistPage');
        // Shorts tab and pagination
        const firstShortsBtn = document.getElementById('ytvhtFirstShortsPage');
        const prevShortsBtn = document.getElementById('ytvhtPrevShortsPage');
        const nextShortsBtn = document.getElementById('ytvhtNextShortsPage');
        const lastShortsBtn = document.getElementById('ytvhtLastShortsPage');

        // Debug: Log missing buttons if any
        const requiredButtons = [
            ['ytvhtClearHistory', clearButton],
            ['ytvhtExportHistory', exportButton],
            ['ytvhtImportHistory', importButton],
            ['ytvhtClosePopup', closeButton],
            ['ytvhtFirstPage', firstPageBtn],
            ['ytvhtPrevPage', prevPageBtn],
            ['ytvhtNextPage', nextPageBtn],
            ['ytvhtLastPage', lastPageBtn],
            ['ytvhtTabVideos', videosTab],
            ['ytvhtTabPlaylists', playlistsTab],
            ['ytvhtTabAnalytics', analyticsTab],
            ['ytvhtTabSettings', settingsTab],
            ['ytvhtPrevPlaylistBtn', prevPlaylistBtn],
            ['ytvhtNextPlaylistBtn', nextPlaylistBtn],
            ['ytvhtFirstPlaylistBtn', firstPlaylistBtn],
            ['ytvhtLastPlaylistBtn', lastPlaylistBtn],
            ['ytvhtTabShorts', shortsTab],
            ['ytvhtFirstShortsPage', firstShortsBtn],
            ['ytvhtPrevShortsPage', prevShortsBtn],
            ['ytvhtNextShortsPage', nextShortsBtn],
            ['ytvhtLastShortsPage', lastShortsBtn]
        ];
        const missing = requiredButtons.filter(([id, el]) => !el).map(([id]) => id);
        if (missing.length) {
            console.error('Missing required buttons:', missing);
            throw new Error('Required buttons not found: ' + missing.join(', '));
        }

        // Set up event listeners
        clearButton.addEventListener('click', async () => {
            // Show confirmation dialog
            const confirmed = confirm(chrome.i18n.getMessage('message_warning_clear_all'));

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

                // Update all displays
                displayHistoryPage();
                displayShortsPage();
                displayPlaylistsPage();

                showMessage(chrome.i18n.getMessage('message_all_history_cleared'));
            } catch (error) {
                console.error('Error clearing history:', error);
                showMessage(chrome.i18n.getMessage('message_error_clearing_history', [error.message || chrome.i18n.getMessage('message_unknown_error')]), 'error');
            }
        });

        exportButton.addEventListener('click', async () => {
            try {
                const [history, playlists, stats] = await Promise.all([
                    ytStorage.getAllVideos(),
                    ytStorage.getAllPlaylists(),
                    (async ()=>{ try { return await ytStorage.getStats(); } catch(e){ return null; } })()
                ]);
                const data = {history, playlists, stats};

                const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'youtube_history_backup.json';
                a.click();
                URL.revokeObjectURL(url);
                showMessage(chrome.i18n.getMessage('message_export_success', [history.length, playlists.length]));
            } catch (error) {
                console.error('Error exporting history:', error);
                showMessage(chrome.i18n.getMessage('message_error_exporting_history', [error.message || chrome.i18n.getMessage('message_unknown_error')]), 'error');
            }
        });

        importButton.addEventListener('click', () => openImportPage());
        closeButton.addEventListener('click', () => window.close());

        // Pagination controls
        firstPageBtn.addEventListener('click', goToFirstPage);
        prevPageBtn.addEventListener('click', goToPrevPage);
        nextPageBtn.addEventListener('click', goToNextPage);
        lastPageBtn.addEventListener('click', goToLastPage);

        let currentTab = getCurrentExtensionTab() || 'videos';
        if (!['videos', 'shorts', 'playlists', 'analytics', 'settings'].includes(currentTab)) {
            currentTab = 'videos'; // Default to videos if invalid
        }
        log('Current extension tab:', currentTab);
        switchTab(currentTab);
        // Tabs
        videosTab.addEventListener('click', () => {
            switchTab('videos');
            displayHistoryPage();
        });
        shortsTab.addEventListener('click', () => {
            switchTab('shorts');
            displayShortsPage();
        });
        playlistsTab.addEventListener('click', () => {
            switchTab('playlists');
            // Load playlists if not already loaded
            if (allPlaylists.length === 0) {
                loadPlaylistsPage({ page: currentPlaylistPage });
            }
            displayPlaylistsPage();
        });
        analyticsTab.addEventListener('click', () => {
            switchTab('analytics');
            updateAnalytics();
        });
        if (settingsTab) {
            settingsTab.addEventListener('click', () => {
                switchTab('settings');
                initSettingsTab();
            });
        } else {
            console.error('Settings tab button not found');
        }

        // Initialize global search
        globalSearchInput = document.getElementById('ytvhtGlobalSearchInput');
        const searchClearBtn = document.getElementById('ytvhtSearchClear');

        if (globalSearchInput) {
            globalSearchInput.addEventListener('input', async (e) => {
                const query = e.target.value;
                console.log('[Search] Input event:', query);
                await smartSearch(query);

                // Toggle clear button visibility
                toggleClearButton(query.length > 0);
            });

            globalSearchInput.addEventListener('keydown', async (e) => {
                if (e.key === 'Enter') {
                    console.log('[Search] Enter pressed with:', e.target.value);
                    await showFullSearchResults(e.target.value);
                } else if (e.key === 'Escape') {
                    // Clear search and suggestions
                    e.target.value = '';
                    searchQuery = '';
                    toggleClearButton(false);
                    hideSearchSuggestions();
                    await loadCurrentPages();
                }
            });

            // Add click outside to close suggestions
            document.addEventListener('click', (e) => {
                const searchContainer = document.querySelector('.global-search-container');
                const suggestions = document.getElementById('ytvhtSearchSuggestions');

                if (searchContainer && suggestions &&
                    !searchContainer.contains(e.target) &&
                    suggestions.style.display !== 'none') {
                    hideSearchSuggestions();
                }
            });
        } else {
            console.error('Global search input not found');
        }

        // Clear button functionality
        if (searchClearBtn) {
            searchClearBtn.addEventListener('click', async () => {
                if (globalSearchInput) {
                    globalSearchInput.value = '';
                    globalSearchInput.focus();
                    searchQuery = '';
                    toggleClearButton(false);
                    hideSearchSuggestions();
                    await loadCurrentPages();
                }
            });
        }

        // Playlist pagination
        prevPlaylistBtn.addEventListener('click', goToPrevPlaylistPage);
        nextPlaylistBtn.addEventListener('click', goToNextPlaylistPage);
        firstPlaylistBtn.addEventListener('click', goToFirstPlaylistPage);
        lastPlaylistBtn.addEventListener('click', goToLastPlaylistPage);

        // Shorts pagination
        firstShortsBtn.addEventListener('click', goToFirstShortsPage);
        prevShortsBtn.addEventListener('click', goToPrevShortsPage);
        nextShortsBtn.addEventListener('click', goToNextShortsPage);
        lastShortsBtn.addEventListener('click', goToLastShortsPage);

        // Listen for system theme changes
        if (window.matchMedia) {
            const darkModeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
            darkModeMediaQuery.addEventListener('change', async (e) => {
                if (settings.themePreference === 'system' || settings.themePreference === undefined) {
                    const newDarkMode = e.matches;
                    toggleDarkMode(newDarkMode);
                    // Theme text will be updated by the theme change handler
                }
            });
        }

        // Load initial data
        await loadCurrentPages();

        // Pre-render all first pages immediately for instant tab switching
        displayHistoryPage();
        displayShortsPage();
        displayPlaylistsPage();

        // Playlists are already loaded by loadCurrentPages() above
        // Analytics can access allPlaylists (current page) or load more if needed

        // Initialize sync functionality
        initSyncIntegration();

        // Enable progressive content loading
        progressiveContentLoading();

        // Set up responsive table handling
        setupResponsiveTables();

        log('Initialization complete');
    } catch (error) {
        console.error('Error during initialization:', error);
        showMessage(chrome.i18n.getMessage('message_failed_to_initialize', [error.message || chrome.i18n.getMessage('message_unknown_error')]), 'error');
    }
});

async function goToPrevPlaylistPage() {
    if (currentPlaylistPage > 1) {
        currentPlaylistPage--;
        await loadPlaylistsPage({ page: currentPlaylistPage });
        displayPlaylistsPage();
    }
}

async function goToNextPlaylistPage() {
    if (currentPlaylistPage < totalPlaylistPages) {
        currentPlaylistPage++;
        await loadPlaylistsPage({ page: currentPlaylistPage });
        displayPlaylistsPage();
    }
}

// Shorts pagination controls
async function goToPrevShortsPage() {
    if (currentShortsPage > 1) {
        currentShortsPage--;
        await loadShortsPage({ page: currentShortsPage });
        displayShortsPage();
    }
}

async function goToNextShortsPage() {
    if (currentShortsPage < totalShortsPages) {
        currentShortsPage++;
        await loadShortsPage({ page: currentShortsPage });
        displayShortsPage();
    }
}

async function goToFirstShortsPage() {
    if (currentShortsPage !== 1) {
        currentShortsPage = 1;
        await loadShortsPage({ page: currentShortsPage });
        displayShortsPage();
    }
}

async function goToLastShortsPage() {
    if (currentShortsPage !== totalShortsPages) {
        currentShortsPage = totalShortsPages;
        await loadShortsPage({ page: currentShortsPage });
        displayShortsPage();
    }
}

async function goToShortsPage(page) {
    if (page >= 1 && page <= totalShortsPages && page !== currentShortsPage) {
        currentShortsPage = page;
        await loadShortsPage({ page: currentShortsPage });
        displayShortsPage();
    }
}

function updateShortsPaginationUI(current, total) {
    // Defensive: Only update if all required elements exist
    const pageInfo = document.getElementById('ytvhtShortsPageInfo');
    const firstBtn = document.getElementById('ytvhtFirstShortsPage');
    const prevBtn = document.getElementById('ytvhtPrevShortsPage');
    const nextBtn = document.getElementById('ytvhtNextShortsPage');
    const lastBtn = document.getElementById('ytvhtLastShortsPage');
    const pageInput = document.getElementById('ytvhtShortsPageInput');
    const pageNumbers = document.getElementById('ytvhtShortsPageNumbers');

    if (!pageInfo || !firstBtn || !prevBtn || !nextBtn || !lastBtn || !pageInput || !pageNumbers) {
        // One or more elements are missing, do not proceed
        return;
    }

    pageInfo.textContent = chrome.i18n.getMessage('pagination_page_info', [current, total]);

    // Update button states
    firstBtn.disabled = current === 1;
    prevBtn.disabled = current === 1;
    nextBtn.disabled = current === total;
    lastBtn.disabled = current === total;

    // Update page input
    pageInput.max = total;

    // Generate page numbers (smart pagination)
    pageNumbers.innerHTML = '';

    if (total <= 7) {
        // Show all pages if 7 or fewer
        for (let i = 1; i <= total; i++) {
            addShortsPageButton(i, current);
        }
    } else {
        // Smart pagination for many pages
        addShortsPageButton(1, current); // Always show first page

        if (current > 3) {
            addShortsEllipsis(); // Add ... if current is far from start
        }

        // Show current page and neighbors (1 before and 1 after)
        const start = Math.max(2, current - 1);
        const end = Math.min(total - 1, current + 1);

        for (let i = start; i <= end; i++) {
            if (i !== 1 && i !== total) { // Don't duplicate first/last page
                addShortsPageButton(i, current);
            }
        }

        if (current < total - 2) {
            addShortsEllipsis(); // Add ... if current is far from end
        }

        if (total > 1) {
            addShortsPageButton(total, current); // Always show last page
        }
    }


}

function addShortsPageButton(pageNum, currentPage) {
    const button = document.createElement('button');
    button.textContent = pageNum;
    button.className = pageNum === currentPage ? 'active' : '';
    button.style.cssText = `
        min-width: 30px;
        padding: 5px 8px;
        border: 1px solid #ccc;
        background: ${pageNum === currentPage ? '#007cba' : '#f9f9f9'};
        color: ${pageNum === currentPage ? 'white' : '#333'};
        cursor: pointer;
        border-radius: 3px;
    `;
    button.addEventListener('click', () => goToShortsPage(pageNum));
    document.getElementById('ytvhtShortsPageNumbers').appendChild(button);
}

function addShortsEllipsis() {
    const span = document.createElement('span');
    span.innerHTML = '&hellip;';  // HTML entity for ellipsis
    span.style.cssText = `
        padding: 5px 10px;
        color: var(--text-color);
        opacity: 0.7;
        font-weight: bold;
        user-select: none;
        display: flex;
        align-items: center;
        font-size: 16px;
        letter-spacing: 2px;
    `;
    document.getElementById('ytvhtShortsPageNumbers').appendChild(span);
}

// Update displayShortsPage to use pagination
function displayShortsPage() {
    console.log('[Display] displayShortsPage called, allShortsRecords length:', allShortsRecords.length);

    const shortsTable = document.getElementById('ytvhtShortsTable');
    const noShorts = document.getElementById('ytvhtNoShorts');
    const paginationDiv = document.getElementById('ytvhtShortsPagination');
    const tbody = document.getElementById('ytvhtShortsBody');
    tbody.innerHTML = '';

    // allShortsRecords already contains the current page data
    const pageRecords = allShortsRecords;

    // Apply content density adaptation
    adjustContentDensity(pageRecords);

    // Apply responsive table columns
    makeTableResponsive(shortsTable);

    if (!pageRecords.length) {
        shortsTable.style.display = 'none';
        noShorts.style.display = 'block';
        const emptyState = getContextualEmptyState('shorts', searchQuery);
        renderEmptyState(noShorts, emptyState);
        if (paginationDiv) paginationDiv.style.display = 'none';
        return;
    }
    noShorts.style.display = 'none';
    shortsTable.style.display = '';
    if (paginationDiv) paginationDiv.style.display = 'flex';

    // Pagination bounds checking (totalShortsPages is now set by loadShortsPage)
    if (currentShortsPage > totalShortsPages) currentShortsPage = totalShortsPages;
    if (currentShortsPage < 1) currentShortsPage = 1;

    pageRecords.forEach(record => {
        const row = document.createElement('tr');
        // Shorts title and link
        const titleCell = document.createElement('td');
        const link = document.createElement('a');
        link.href = record.url || `https://www.youtube.com/shorts/${record.videoId}`;
        link.className = 'video-link';
        link.textContent = record.title || record.videoId;
        link.target = '_blank';
        titleCell.appendChild(link);

        // Duration
        const durationCell = document.createElement('td');
        durationCell.textContent = formatDuration(record.duration);

        // Last watched
        const dateCell = document.createElement('td');
        dateCell.textContent = formatDate(record.timestamp);

        // Action buttons
        const actionCell = document.createElement('td');
        const deleteButton = document.createElement('button');
        deleteButton.textContent = chrome.i18n.getMessage('delete_label');
        deleteButton.onclick = () => deleteRecord(record.videoId);
        actionCell.appendChild(deleteButton);

        row.appendChild(titleCell);
        row.appendChild(durationCell);
        row.appendChild(dateCell);
        row.appendChild(actionCell);

        tbody.appendChild(row);
    });


    updateShortsPaginationUI(currentShortsPage, totalShortsPages);
}

// ========== SYNC INTEGRATION ==========

// Keep only essential debug functions for troubleshooting
window.debugSyncViaMessage = function () {
    chrome.runtime.sendMessage({type: 'debugSyncStorage'}, (response) => {
        console.log('[Popup] 🔍 debugSyncStorage response:', response);
        if (chrome.runtime.lastError) {
            console.error('[Popup] ❌ Message error:', chrome.runtime.lastError);
        }
        return response;
    });
};

window.testSyncImprovements = function () {
    chrome.runtime.sendMessage({type: 'testSyncImprovements'}, (response) => {
        console.log('[Popup] 🚀 Sync test results:', response.success ? response.data : response.error);
        return response;
    });
};

function initSyncIntegration() {
    // Ensure sync indicator is visible by default
    const indicatorElement = document.getElementById('ytvhtSyncIndicator');
    if (indicatorElement) {
        indicatorElement.style.display = 'flex';
        indicatorElement.style.visibility = 'visible';
    }

    // Get initial sync status from background
    chrome.runtime.sendMessage({type: 'getSyncStatus'}, (response) => {
        if (response) {
            updateSyncIndicator(response.status, response.lastSyncTime);
            updateSyncSettingsUI(response);
        } else {
            // Fallback if sync status fails
            updateSyncIndicator('not_available', null);
        }
    });

    // Set up sync status updates from background
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'syncStatusUpdate') {
            // Track sync status to prevent race conditions
            if (message.status === 'syncing') {
                syncInProgress = true;
            } else if (message.status === 'success' || message.status === 'error') {
                syncInProgress = false;
            }
            updateSyncIndicator(message.status, message.lastSyncTime);
            updateSyncSettingsUI(message);
        } else if (message.type === 'fullSyncComplete') {
            syncInProgress = false; // Ensure flag is cleared

            // Force complete refresh after full sync
            setTimeout(async () => {
                await loadCurrentPages();
            }, 200);
        } else if (message.type === 'regularSyncComplete') {
            syncInProgress = false; // Ensure flag is cleared

            // Force complete refresh after regular sync
            setTimeout(async () => {
                await loadCurrentPages();
            }, 200);
        }
    });

    // Set up sync indicator click handler
    const syncIndicator = document.getElementById('ytvhtSyncIndicator');
    if (syncIndicator) {
        syncIndicator.addEventListener('click', handleSyncIndicatorClick);
    }

    // Set up settings sync controls
    const syncEnabledCheckbox = document.getElementById('ytvhtSyncEnabled');
    const triggerSyncButton = document.getElementById('ytvhtTriggerSync');
    const triggerFullSyncButton = document.getElementById('ytvhtTriggerFullSync');

    if (syncEnabledCheckbox) {
        syncEnabledCheckbox.addEventListener('change', handleSyncToggle);
    }

    if (triggerSyncButton) {
        triggerSyncButton.addEventListener('click', handleManualSync);
    }

    if (triggerFullSyncButton) {
        triggerFullSyncButton.addEventListener('click', handleManualFullSync);
    }
}

// Store timeout reference for proper cleanup
let syncStatusTimeout = null;

function updateSyncIndicator(status, lastSyncTime) {
    const indicator = document.getElementById('ytvhtSyncIndicator');
    if (!indicator) return;

    // Remove all status classes
    indicator.className = 'sync-indicator';

    // Add current status class
    indicator.classList.add('sync-' + status);

    // Update text and tooltip
    const textElement = indicator.querySelector('.sync-text');

    // Get or create a single status element (remove any duplicates first)
    const existingElements = indicator.parentNode.querySelectorAll('.sync-status');
    existingElements.forEach((el, index) => {
        if (index > 0) el.remove(); // Remove duplicates, keep only first
    });

    let statusElement = existingElements[0];
    if (!statusElement) {
        statusElement = createSyncStatusElement(indicator);
    }

    const tooltips = {
        'disabled': 'Sync disabled - Click to enable',
        'not_available': 'Sync not available - Firefox Sync required',
        'initializing': 'Initializing sync...',
        'syncing': 'Syncing data...',
        'success': lastSyncTime ? `Last sync: ${formatSyncTime(lastSyncTime)}` : 'Sync ready',
        'error': 'Sync error - Click to retry'
    };

    const statusText = {
        'disabled': 'Off',
        'not_available': 'N/A',
        'initializing': 'Init',
        'syncing': 'Sync',
        'success': 'On',
        'error': 'Error'
    };

    if (textElement) {
        textElement.textContent = statusText[status] || 'Sync';
    }

    // Clear any existing timeout to prevent conflicts
    if (syncStatusTimeout) {
        clearTimeout(syncStatusTimeout);
        syncStatusTimeout = null;
    }

    // Update status text next to sync button (simplified - no Unicode symbols)
    if (statusElement) {
        if (status === 'syncing') {
            statusElement.textContent = 'Syncing...';
            statusElement.style.color = '#007cba';
        } else if (status === 'success' && lastSyncTime && (Date.now() - lastSyncTime) < 5000) {
            // Show "synced" for 3 seconds after successful sync
            statusElement.textContent = 'Synced';
            statusElement.style.color = '#34a853';
            syncStatusTimeout = setTimeout(() => {
                // Clear the specific element we set the text on
                if (statusElement && statusElement.parentNode && syncStatusTimeout) {
                    statusElement.textContent = '';
                }
                syncStatusTimeout = null;
            }, 3000);
        } else {
            statusElement.textContent = '';
        }
    }

    indicator.title = tooltips[status] || 'Sync status';
}

function createSyncStatusElement(indicator) {
    const statusElement = document.createElement('span');
    statusElement.className = 'sync-status';
    statusElement.style.cssText = `
        margin-left: 8px;
        font-size: 12px;
        font-weight: 500;
    `;

    indicator.parentNode.insertBefore(statusElement, indicator.nextSibling);
    return statusElement;
}

function formatSyncTime(timestamp) {
    if (!timestamp) return 'Never';

    const now = Date.now();
    const diff = now - timestamp;

    if (diff < 60000) { // Less than 1 minute
        return 'Just now';
    } else if (diff < 3600000) { // Less than 1 hour
        const minutes = Math.floor(diff / 60000);
        return `${minutes}m ago`;
    } else if (diff < 86400000) { // Less than 1 day
        const hours = Math.floor(diff / 3600000);
        return `${hours}h ago`;
    } else {
        const days = Math.floor(diff / 86400000);
        return `${days}d ago`;
    }
}

async function handleSyncIndicatorClick() {
    chrome.runtime.sendMessage({type: 'getSyncStatus'}, (response) => {
        if (!response) return;

        if (response.status === 'not_available') {
            showMessage(chrome.i18n.getMessage('message_firefox_sync_not_available'), 'error');
            return;
        }

        if (response.status === 'disabled') {
            // Enable sync
            chrome.runtime.sendMessage({type: 'enableSync'}, (result) => {
                if (!result || !result.success) {
                    showMessage(chrome.i18n.getMessage('message_failed_to_enable_sync'), 'error');
                }
                // Sync indicator will show success status
            });
        } else if (response.status === 'error') {
            // Retry sync
            chrome.runtime.sendMessage({type: 'triggerSync'}, (result) => {
                if (!result || !result.success) {
                    showMessage(chrome.i18n.getMessage('message_sync_currently_disabled'), 'error');
                }
            });
        } else if (response.enabled) {
            // Manual sync trigger
            chrome.runtime.sendMessage({type: 'triggerSync'}, (result) => {
                if (!result || !result.success) {
                    showMessage(chrome.i18n.getMessage('message_sync_currently_disabled'), 'error');
                }
            });
        }
    });
}

async function handleSyncToggle(event) {
    const enabled = event.target.checked;

    if (enabled) {
        chrome.runtime.sendMessage({type: 'enableSync'}, (result) => {
            if (!result || !result.success) {
                event.target.checked = false;
                showMessage(chrome.i18n.getMessage('message_failed_to_enable_sync'), 'error');
            }
            // Removed success message - sync indicator shows status
        });
    } else {
        chrome.runtime.sendMessage({type: 'disableSync'}, (result) => {
            if (!result || !result.success) {
                event.target.checked = true;
                showMessage(chrome.i18n.getMessage('message_failed_to_disable_sync'), 'error');
            }
            // Removed success message - sync indicator shows status
        });
    }
}

async function handleManualSync() {
    chrome.runtime.sendMessage({type: 'triggerSync'}, (result) => {
        if (!result || !result.success) {
            showMessage(chrome.i18n.getMessage('message_sync_currently_disabled'), 'error');
        }
        // Removed sync initiated message - sync indicator shows status
    });
}

async function handleManualFullSync() {
    if (!confirm(chrome.i18n.getMessage('message_confirm_full_sync'))) {
        return;
    }

    console.log('[Popup] 🚀 Full sync button clicked');
    chrome.runtime.sendMessage({type: 'triggerFullSync'}, (result) => {
        console.log('[Popup] 🚀 triggerFullSync response:', result);
        if (result && result.success) {
            showMessage(chrome.i18n.getMessage('message_full_sync_initiated'));
        } else {
            showMessage(chrome.i18n.getMessage('message_sync_currently_disabled'), 'error');
        }
    });
}

function updateSyncSettingsUI(syncStatus) {
    if (!syncStatus) {
        // Get status from background if not provided
        chrome.runtime.sendMessage({type: 'getSyncStatus'}, (response) => {
            if (response) {
                updateSyncSettingsUI(response);
            }
        });
        return;
    }

    // Update checkbox
    const syncEnabledCheckbox = document.getElementById('ytvhtSyncEnabled');
    if (syncEnabledCheckbox) {
        syncEnabledCheckbox.checked = syncStatus.enabled;
        syncEnabledCheckbox.disabled = !syncStatus.available;
    }

    // Update last sync time
    const lastSyncElement = document.getElementById('ytvhtLastSyncTime');
    if (lastSyncElement) {
        lastSyncElement.textContent = syncStatus.lastSyncTime ?
            formatSyncTime(syncStatus.lastSyncTime) : 'Never';
    }

    // Update sync now button
    const triggerSyncButton = document.getElementById('ytvhtTriggerSync');
    if (triggerSyncButton) {
        triggerSyncButton.disabled = !syncStatus.enabled || syncStatus.status === 'syncing';
        triggerSyncButton.textContent = syncStatus.status === 'syncing' ? 'Syncing...' : 'Sync Now';
    }

    // Update full sync button
    const triggerFullSyncButton = document.getElementById('ytvhtTriggerFullSync');
    if (triggerFullSyncButton) {
        triggerFullSyncButton.disabled = !syncStatus.enabled || syncStatus.status === 'syncing';
        triggerFullSyncButton.textContent = syncStatus.status === 'syncing' ? 'Syncing...' : 'Full Sync';
    }
}

// Render the top 5 watched channels
function renderTopChannels() {
    const container = document.getElementById('topChannelsList');
    if (!container) return;

    // Aggregate by channel
    const channelMap = {};
    allHistoryRecords.forEach(record => {
        const channel = record.channelName || 'Unknown Channel';
        const channelId = record.channelId || '';
        if (channel === 'Unknown Channel') return; // skip unknown
        if (!channelMap[channel]) {
            channelMap[channel] = {
                channel,
                channelId,
                count: 0,
                watchTime: 0
            };
        }
        channelMap[channel].count++;
        channelMap[channel].watchTime += record.time || 0;
    });

    let channels = Object.values(channelMap);
    channels.sort((a, b) => b.count - a.count || b.watchTime - a.watchTime);
    const topChannels = channels.slice(0, 5);

    if (topChannels.length === 0) {
        container.textContent = chrome.i18n.getMessage('analytics_no_channel_data');
        return;
    }

    // Helper to create a safe channel entry
    function createChannelEntry(ch) {
        const div = document.createElement('div');
        div.style.marginBottom = '8px';
        let channelUrl = '';
        if (ch.channelId) {
            if (ch.channelId.startsWith('UC')) {
                channelUrl = `https://www.youtube.com/channel/${ch.channelId}`;
            } else if (ch.channelId.startsWith('@')) {
                channelUrl = `https://www.youtube.com/${ch.channelId}`;
            }
        }
        const channelName = sanitizeText(ch.channel);
        let link;
        if (channelUrl) {
            link = document.createElement('a');
            link.href = channelUrl;
            link.target = '_blank';
            link.style.fontWeight = '500';
            link.style.color = 'var(--button-bg)';
            link.style.textDecoration = 'none';
            link.textContent = channelName;
        } else {
            link = document.createElement('span');
            link.style.fontWeight = '500';
            link.style.color = 'var(--button-bg)';
            link.textContent = channelName;
        }
        div.appendChild(link);
        const details = document.createElement('span');
        details.style.color = 'var(--text-color)';
        details.style.opacity = '0.8';
        details.textContent = ` - ${chrome.i18n.getMessage('analytics_channel_videos', [ch.count, formatWatchTime(ch.watchTime)])}`;
        div.appendChild(details);
        return div;
    }

    container.innerHTML = '';
    topChannels.forEach(ch => container.appendChild(createChannelEntry(ch)));
}

// Render the top 5 skipped channels (long videos only, watched <10%)
function renderSkippedChannels() {
    const container = document.getElementById('skippedChannelsList');
    if (!container) return;

    // Only consider long videos
    const longVideos = allHistoryRecords.filter(r => r.duration >= 600);
    const skipped = longVideos.filter(r => (r.time / r.duration) < 0.1);

    // Aggregate by channel
    const channelMap = {};
    skipped.forEach(record => {
        const channel = record.channelName || 'Unknown Channel';
        const channelId = record.channelId || '';
        if (channel === 'Unknown Channel') return; // skip unknown
        if (!channelMap[channel]) {
            channelMap[channel] = {channel, channelId, count: 0};
        }
        channelMap[channel].count++;
    });
    let channels = Object.values(channelMap);
    channels.sort((a, b) => b.count - a.count);
    const topSkipped = channels.slice(0, 5);

    function sanitizeText(text) {
        if (!text) return '';
        return text
            .replace(/\u00e2\u20ac\" |\u00e2\u20ac\" |\u00e2\u20ac\" |\u00e2\u20ac\\x9c|\u00e2\u20ac\\x9d/g, '–') // common mis-encoded dashes
            .replace(/\u00e2\u20ac\u2122/g, "'") // apostrophe
            .replace(/\u00e2\u20ac\u0153|\u00e2\u20ac\u009d/g, '"') // quotes
            .replace(/\u00e2\u20ac\u00a6/g, '...') // ellipsis
            .replace(/\u00e2\u20ac\u00a2/g, '-') // bullet
            .replace(/\s+/g, ' ') // collapse whitespace
            .trim();
    }

    if (topSkipped.length === 0) {
        container.textContent = chrome.i18n.getMessage('analytics_no_skipped_channel_data');
    } else {
        // Helper to create a safe skipped channel entry
        function createSkippedChannelEntry(ch) {
            const div = document.createElement('div');
            div.style.marginBottom = '8px';
            let channelUrl = '';
            if (ch.channelId) {
                if (ch.channelId.startsWith('UC')) {
                    channelUrl = `https://www.youtube.com/channel/${ch.channelId}`;
                } else if (ch.channelId.startsWith('@')) {
                    channelUrl = `https://www.youtube.com/${ch.channelId}`;
                }
            }
            const channelName = sanitizeText(ch.channel);
            let link;
            if (channelUrl) {
                link = document.createElement('a');
                link.href = channelUrl;
                link.target = '_blank';
                link.style.fontWeight = '500';
                link.style.color = 'var(--button-bg)';
                link.style.textDecoration = 'none';
                link.textContent = channelName;
            } else {
                link = document.createElement('span');
                link.style.fontWeight = '500';
                link.style.color = 'var(--button-bg)';
                link.textContent = channelName;
            }
            div.appendChild(link);
            const details = document.createElement('span');
            details.style.color = 'var(--text-color)';
            details.style.opacity = '0.8';
            details.textContent = ` - ${chrome.i18n.getMessage('analytics_skipped_count', [ch.count])}`;
            div.appendChild(details);
            return div;
        }

        container.innerHTML = '';
        topSkipped.forEach(ch => container.appendChild(createSkippedChannelEntry(ch)));
    }
}

// Render the completion bar chart (Skipped, Partial, Completed)
function renderCompletionBarChart() {
    const canvas = document.getElementById('completionBarChart');
    const legendDiv = document.getElementById('completionBarLegend');
    if (!canvas || !legendDiv) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Only consider long videos
    const longVideos = allHistoryRecords.filter(r => r.duration >= 600);
    const skipped = longVideos.filter(r => (r.time / r.duration) < 0.1);
    const partial = longVideos.filter(r => (r.time / r.duration) >= 0.1 && (r.time / r.duration) < 0.9);
    const completed = longVideos.filter(r => (r.time / r.duration) >= 0.9);
    const counts = [skipped.length, partial.length, completed.length];
    // Use short labels for x-axis
    const labels = [
        chrome.i18n.getMessage('chart_skipped'),
        chrome.i18n.getMessage('chart_partial'),
        chrome.i18n.getMessage('chart_completed')
    ];
    // Use detailed labels for legend
    const legendLabels = [
        chrome.i18n.getMessage('chart_skipped_legend'),
        chrome.i18n.getMessage('chart_partial_legend'),
        chrome.i18n.getMessage('chart_completed_legend')
    ];
    const colors = ['#e74c3c', '#f1c40f', '#2ecc40'];
    const total = counts.reduce((a, b) => a + b, 0);

    // Bar chart dimensions
    const barWidth = 40;
    const barGap = 40;
    const chartHeight = canvas.height - 40;
    const maxCount = Math.max(...counts, 1);
    const baseY = canvas.height - 20;
    const startX = 40;

    // Draw bars
    for (let i = 0; i < counts.length; i++) {
        const barHeight = Math.round((counts[i] / maxCount) * chartHeight);
        ctx.fillStyle = colors[i];
        ctx.fillRect(startX + i * (barWidth + barGap), baseY - barHeight, barWidth, barHeight);
        // Draw count above bar
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(counts[i], startX + i * (barWidth + barGap) + barWidth / 2, baseY - barHeight - 8);
    }

    // Draw x-axis labels (short)
    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#ccc';
    ctx.textAlign = 'center';
    for (let i = 0; i < labels.length; i++) {
        ctx.fillText(labels[i], startX + i * (barWidth + barGap) + barWidth / 2, baseY + 16);
    }

    // Draw legend (to the right of the chart, detailed)
    let legendHtml = '';
    for (let i = 0; i < legendLabels.length; i++) {
        const percent = total ? Math.round((counts[i] / total) * 100) : 0;
        legendHtml += `<div style="margin-bottom:8px;display:flex;align-items:center;">
            <span style="display:inline-block;width:16px;height:16px;background:${colors[i]};margin-right:8px;border-radius:3px;"></span>
            <span style="color:var(--text-color);font-weight:500;flex:1;">${legendLabels[i]}</span>
            <span style="color:var(--text-color);margin-left:8px;text-align:right;min-width:60px;">${counts[i]} (${percent}%)</span>
        </div>`;
    }
    // Replace with safe DOM construction
    legendDiv.innerHTML = '';
    for (let i = 0; i < legendLabels.length; i++) {
        const row = document.createElement('div');
        row.style.marginBottom = '8px';
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        const colorBox = document.createElement('span');
        colorBox.style.display = 'inline-block';
        colorBox.style.width = '16px';
        colorBox.style.height = '16px';
        colorBox.style.background = colors[i];
        colorBox.style.marginRight = '8px';
        colorBox.style.borderRadius = '3px';
        row.appendChild(colorBox);
        const label = document.createElement('span');
        label.style.color = 'var(--text-color)';
        label.style.fontWeight = '500';
        label.style.flex = '1';
        label.textContent = legendLabels[i];
        row.appendChild(label);
        const count = document.createElement('span');
        count.style.color = 'var(--text-color)';
        count.style.marginLeft = '8px';
        count.style.textAlign = 'right';
        count.style.minWidth = '60px';
        count.textContent = `${counts[i]} (${total ? Math.round((counts[i] / total) * 100) : 0}%)`;
        row.appendChild(count);
        legendDiv.appendChild(row);
    }
}

// Localization helper: localize all elements with data-i18n* attributes
function localizeHtmlPage() {
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
}

document.addEventListener('DOMContentLoaded', () => {
    localizeHtmlPage();
    // ... existing code ...

// ... existing code ...
// Replace all user-facing text in JS with chrome.i18n.getMessage
// Example:
// document.getElementById('ytvhtMessage').textContent = chrome.i18n.getMessage('message_some_key');
// ...
});

// ... existing code ...
// For all dynamic text assignments, replace hardcoded strings with chrome.i18n.getMessage('key')
// For example:
// alert(chrome.i18n.getMessage('alert_some_error'));
// ...

// Add global helpers at the top of the file
function sanitizeText(text) {
    if (!text) return '';
    return text
        .replace(/\u00e2\u20ac\" |\u00e2\u20ac\" |\u00e2\u20ac\" |\u00e2\u20ac\\x9c|\u00e2\u20ac\\x9d/g, '–') // common mis-encoded dashes
        .replace(/\u00e2\u20ac\u2122/g, "'") // apostrophe
        .replace(/\u00e2\u20ac\u0153|\u00e2\u20ac\u009d/g, '"') // quotes
        .replace(/\u00e2\u20ac\u00a6/g, '...') // ellipsis
        .replace(/\u00e2\u20ac\u00a2/g, '-') // bullet
        .replace(/\s+/g, ' ') // collapse whitespace
        .trim();
}

function formatWatchTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
