// --- Debugging and Logging ---
const DEBUG = true; // Set to false for production

function log(...args) {
    if (DEBUG) {
        console.log('[ythdb-popup]', ...args);
    }
}

window.onerror = function(msg, url, lineNo, columnNo, error) {
    console.error('[ythdb-popup] Error: ' + msg + '\nURL: ' + url + '\nLine: ' + lineNo + '\nColumn: ' + columnNo + '\nError object: ' + JSON.stringify(error));
    return false;
};

console.log('[ythdb-popup] Script file loaded');

log('Script starting initialization');

const DB_NAME = 'YouTubeHistoryDB';
const DB_VERSION = 1;
const STORE_NAME = 'videoHistory';
let db;

// Pagination state
let allHistoryRecords = [];
let currentPage = 1;
let pageSize = 20;

// --- Playlists Tab State ---
let allPlaylists = [];
let currentPlaylistPage = 1;
let playlistPageSize = 20;

// Default settings
const DEFAULT_SETTINGS = {
    autoCleanPeriod: 90, // days
    paginationCount: 10,
    overlayTitle: 'viewed',
    overlayColor: 'blue',
    overlayLabelSize: 'medium'
};

const OVERLAY_LABEL_SIZE_MAP = {
    small: { fontSize: 12, bar: 2 },
    medium: { fontSize: 16, bar: 3 },
    large: { fontSize: 22, bar: 4 },
    xlarge: { fontSize: 28, bar: 5 }
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
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

// Format date
function getYouTubeLocale() {
    // 1. Check for 'hl' param in URL
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('hl')) {
        return urlParams.get('hl');
    }
    // 2. Check <html lang="...">
    const htmlLang = document.documentElement.lang;
    if (htmlLang) {
        return htmlLang;
    }
    // 3. Fallback to browser
    return navigator.language || 'en-US';
}

function formatDate(timestamp) {
    const date = new Date(timestamp);
    const locale = getYouTubeLocale();
    return date.toLocaleDateString(locale) + ' ' + date.toLocaleTimeString(locale);
}

// Show message
function showMessage(message, type = 'success') {
    log('Showing message:', { message, type });
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
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        if (!tabs[0]) {
            showMessage('No active tab found.', 'error');
            return;
        }
        log('Sending message to content script:', message);
        chrome.tabs.sendMessage(tabs[0].id, message, function(response) {
            log('Received response from content script:', response, chrome.runtime.lastError);
            callback(response);
        });
    });
}

// Send message to content script with retry
function sendToContentScriptWithRetry(message, callback, retries = 3, delay = 500) {
    log('Sending message to content script:', message);
    
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        if (!tabs[0]?.id) {
            log('No active tab found');
            callback(null);
            return;
        }

        chrome.tabs.sendMessage(tabs[0].id, message, function(response) {
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

// Initialize database connection
function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('YouTubeHistoryDB', 3);
        request.onupgradeneeded = function(event) {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('videoHistory')) {
                db.createObjectStore('videoHistory', { keyPath: 'videoId' });
            }
            if (!db.objectStoreNames.contains('playlistHistory')) {
                db.createObjectStore('playlistHistory', { keyPath: 'playlistId' });
            }
            if (!db.objectStoreNames.contains('settings')) {
                db.createObjectStore('settings', { keyPath: 'id' });
            }
        };
        request.onsuccess = function(event) {
            db = event.target.result;
            resolve(db);
        };
        request.onerror = function(event) {
            reject(event.target.error);
        };
    });
}

// Load history records
function loadHistory() {
    log('Requesting history from content script...');
    sendToContentScriptWithRetry({type: 'getHistory'}, function(response) {
        if (!response) {
            showMessage('Error getting history. Please try closing and reopening the popup.', 'error');
            return;
        }
        allHistoryRecords = response.history || [];
        log('Received history:', allHistoryRecords);
        currentPage = 1;
        displayHistoryPage();
    });
}

function displayHistoryPage() {
    const historyTable = document.getElementById('ytvhtHistoryTable');
    const noHistory = document.getElementById('ytvhtNoHistory');
    const paginationDiv = document.getElementById('ytvhtPagination');
    historyTable.innerHTML = '';
    if (!allHistoryRecords.length) {
        noHistory.style.display = 'block';
        paginationDiv.style.display = 'none';
        return;
    }
    noHistory.style.display = 'none';
    paginationDiv.style.display = 'flex';
    const totalPages = Math.ceil(allHistoryRecords.length / pageSize);
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;
    const startIdx = (currentPage - 1) * pageSize;
    const endIdx = Math.min(startIdx + pageSize, allHistoryRecords.length);
    const pageRecords = allHistoryRecords.slice(startIdx, endIdx);
    pageRecords.forEach(record => {
        const row = document.createElement('tr');
        // Video title and link
        const titleCell = document.createElement('td');
        const link = document.createElement('a');
        link.href = record.url;
        link.className = 'video-link';
        link.textContent = record.title;
        link.target = '_blank';
        titleCell.appendChild(link);
        // Progress
        const progressCell = document.createElement('td');
        progressCell.textContent = formatDuration(record.time);
        // Last watched
        const dateCell = document.createElement('td');
        dateCell.textContent = formatDate(record.timestamp);
        // Action buttons
        const actionCell = document.createElement('td');
        const deleteButton = document.createElement('button');
        deleteButton.textContent = 'Delete';
        deleteButton.onclick = () => deleteRecord(record.videoId);
        actionCell.appendChild(deleteButton);
        row.appendChild(titleCell);
        row.appendChild(progressCell);
        row.appendChild(dateCell);
        row.appendChild(actionCell);
        historyTable.appendChild(row);
    });
    // Update pagination info
    document.getElementById('ytvhtPageInfo').textContent = `Page ${currentPage} of ${totalPages}`;
    document.getElementById('ytvhtPrevPage').disabled = currentPage === 1;
    document.getElementById('ytvhtNextPage').disabled = currentPage === totalPages;
}

function deleteRecord(videoId) {
    sendToContentScript({type: 'deleteRecord', videoId}, function(response) {
        if (response && response.status === 'success') {
            showMessage('Record deleted successfully');
            // Remove from local array and refresh page
            allHistoryRecords = allHistoryRecords.filter(r => r.videoId !== videoId);
            displayHistoryPage();
        } else {
            showMessage('Error deleting record', 'error');
        }
    });
}

function clearHistory() {
    if (confirm('Are you sure you want to clear all history?')) {
        sendToContentScript({type: 'clearHistory'}, function(response) {
            if (response && response.status === 'success') {
                showMessage('History cleared successfully');
                allHistoryRecords = [];
                displayHistoryPage();
            } else {
                showMessage('Error clearing history', 'error');
            }
        });
    }
}

function exportHistory() {
    sendToContentScript({type: 'exportHistory'}, function(response) {
        const data = response && response.history ? response.history : [];
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'youtube-history-' + new Date().toISOString().split('T')[0] + '.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showMessage('History exported successfully');
    });
}

function importHistory() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async function(e) {
        const file = e.target.files[0];
        if (file) {
            try {
                const text = await file.text();
                const data = JSON.parse(text);
                if (!Array.isArray(data)) {
                    throw new Error('Invalid history file format');
                }
                sendToContentScript({type: 'importHistory', records: data}, function(response) {
                    if (response && response.status === 'success') {
                        showMessage('History imported successfully');
                        loadHistory();
                    } else {
                        showMessage('Error importing history', 'error');
                    }
                });
            } catch (error) {
                showMessage('Error importing history: ' + error.message, 'error');
            }
        }
    };
    input.click();
}

function goToPrevPage() {
    if (currentPage > 1) {
        currentPage--;
        displayHistoryPage();
    }
}

function goToNextPage() {
    const totalPages = Math.ceil(allHistoryRecords.length / pageSize);
    if (currentPage < totalPages) {
        currentPage++;
        displayHistoryPage();
    }
}

function loadPlaylists() {
    log('Requesting playlists from content script...');
    sendToContentScriptWithRetry({type: 'getPlaylists'}, function(response) {
        if (!response) {
            showMessage('Error getting playlists. Please try closing and reopening the popup.', 'error');
            return;
        }
        allPlaylists = response.playlists || [];
        currentPlaylistPage = 1;
        displayPlaylistsPage();
    });
}

function displayPlaylistsPage() {
    const playlistsTable = document.getElementById('ytvhtPlaylistsTable');
    const noPlaylists = document.getElementById('ytvhtNoPlaylists');
    const paginationDiv = document.getElementById('ytvhtPlaylistsPagination');
    const body = document.getElementById('ytvhtPlaylistsBody');
    body.innerHTML = '';
    if (!allPlaylists.length) {
        noPlaylists.style.display = 'block';
        playlistsTable.style.display = 'none';
        paginationDiv.style.display = 'none';
        return;
    }
    noPlaylists.style.display = 'none';
    playlistsTable.style.display = '';
    paginationDiv.style.display = 'flex';
    const totalPages = Math.ceil(allPlaylists.length / playlistPageSize);
    if (currentPlaylistPage > totalPages) currentPlaylistPage = totalPages;
    if (currentPlaylistPage < 1) currentPlaylistPage = 1;
    const startIdx = (currentPlaylistPage - 1) * playlistPageSize;
    const endIdx = Math.min(startIdx + playlistPageSize, allPlaylists.length);
    const pageRecords = allPlaylists.slice(startIdx, endIdx);
    pageRecords.forEach(record => {
        const row = document.createElement('tr');
        // Playlist title
        const titleCell = document.createElement('td');
        titleCell.textContent = record.title;
        // Playlist link
        const linkCell = document.createElement('td');
        const link = document.createElement('a');
        link.href = record.url;
        link.className = 'video-link';
        link.textContent = 'Open';
        link.target = '_blank';
        linkCell.appendChild(link);
        // Saved date
        const dateCell = document.createElement('td');
        dateCell.textContent = formatDate(record.timestamp);
        // Action
        const actionCell = document.createElement('td');
        const deleteButton = document.createElement('button');
        deleteButton.textContent = 'Delete';
        deleteButton.onclick = () => deletePlaylist(record.playlistId);
        actionCell.appendChild(deleteButton);
        row.appendChild(titleCell);
        row.appendChild(linkCell);
        row.appendChild(dateCell);
        row.appendChild(actionCell);
        body.appendChild(row);
    });
    // Update pagination info
    document.getElementById('ytvhtPlaylistsPageInfo').textContent = `Page ${currentPlaylistPage} of ${totalPages}`;
    document.getElementById('ytvhtPrevPlaylistPage').disabled = currentPlaylistPage === 1;
    document.getElementById('ytvhtNextPlaylistPage').disabled = currentPlaylistPage === totalPages;
}

function goToPrevPlaylistPage() {
    if (currentPlaylistPage > 1) {
        currentPlaylistPage--;
        displayPlaylistsPage();
    }
}

function goToNextPlaylistPage() {
    const totalPages = Math.ceil(allPlaylists.length / playlistPageSize);
    if (currentPlaylistPage < totalPages) {
        currentPlaylistPage++;
        displayPlaylistsPage();
    }
}

function deletePlaylist(playlistId) {
    sendToContentScript({type: 'deletePlaylist', playlistId}, function(response) {
        if (response && response.status === 'success') {
            showMessage('Playlist deleted successfully');
            allPlaylists = allPlaylists.filter(r => r.playlistId !== playlistId);
            displayPlaylistsPage();
        } else {
            showMessage('Error deleting playlist', 'error');
        }
    });
}

// Load settings from browser.storage.local
async function loadSettings() {
    try {
        const storedSettings = await popupStorage.getSettings();
        let settings = storedSettings?.settings || {};
        let updated = false;
        
        for (const key in DEFAULT_SETTINGS) {
            if (!(key in settings)) {
                settings[key] = DEFAULT_SETTINGS[key];
                updated = true;
            }
        }
        
        if (updated) {
            await popupStorage.setSettings({ id: 'userSettings', settings });
        }
        
        return settings;
    } catch (error) {
        console.error('Error loading settings:', error);
        return DEFAULT_SETTINGS;
    }
}

// Save settings to browser.storage.local
async function saveSettings(settings) {
    try {
        await popupStorage.setSettings({ id: 'userSettings', settings });
    } catch (error) {
        console.error('Error saving settings:', error);
        throw error;
    }
}

// Update settings UI with current values
function updateSettingsUI(settings) {
    document.getElementById('ytvhtAutoCleanPeriod').value = settings.autoCleanPeriod;
    document.getElementById('ytvhtPaginationCount').value = settings.paginationCount;
    document.getElementById('ytvhtOverlayTitle').value = settings.overlayTitle;
    document.getElementById('ytvhtOverlayColor').value = settings.overlayColor;
    document.getElementById('ytvhtOverlayLabelSize').value = settings.overlayLabelSize || 'medium';
    updateColorPreview(settings.overlayColor);
}

// Update color preview
function updateColorPreview(color) {
    const preview = document.getElementById('ytvhtColorPreview');
    preview.style.backgroundColor = OVERLAY_COLORS[color];
}

// Handle settings tab
function initSettingsTab() {
    const settingsTab = document.getElementById('ytvhtTabSettings');
    const settingsContainer = document.getElementById('ytvhtSettingsContainer');
    const saveButton = document.getElementById('ytvhtSaveSettings');
    const colorSelect = document.getElementById('ytvhtOverlayColor');
    loadSettings().then(settings => {
        updateSettingsUI(settings);
    }).catch(error => {
        console.error('Error loading settings:', error);
        showMessage('Error loading settings', 'error');
    });
    colorSelect.addEventListener('change', function() {
        updateColorPreview(this.value);
    });
    saveButton.addEventListener('click', function() {
        const settings = {
            autoCleanPeriod: parseInt(document.getElementById('ytvhtAutoCleanPeriod').value) || DEFAULT_SETTINGS.autoCleanPeriod,
            paginationCount: parseInt(document.getElementById('ytvhtPaginationCount').value) || DEFAULT_SETTINGS.paginationCount,
            overlayTitle: document.getElementById('ytvhtOverlayTitle').value || DEFAULT_SETTINGS.overlayTitle,
            overlayColor: document.getElementById('ytvhtOverlayColor').value || DEFAULT_SETTINGS.overlayColor,
            overlayLabelSize: document.getElementById('ytvhtOverlayLabelSize').value || DEFAULT_SETTINGS.overlayLabelSize
        };
        if (settings.autoCleanPeriod < 1 || settings.autoCleanPeriod > 180) {
            showMessage('Auto-clean period must be between 1 and 180 days', 'error');
            return;
        }
        if (settings.paginationCount < 5 || settings.paginationCount > 20) {
            showMessage('Items per page must be between 5 and 20', 'error');
            return;
        }
        if (settings.overlayTitle.length > 12) {
            showMessage('Overlay title must be 12 characters or less', 'error');
            return;
        }
        saveSettings(settings).then(() => {
            showMessage('Settings saved successfully');
            pageSize = settings.paginationCount;
            displayHistoryPage();
        }).catch(error => {
            console.error('Error saving settings:', error);
            showMessage('Error saving settings', 'error');
        });
    });
    settingsTab.addEventListener('click', function() {
        switchTab('settings');
    });
}

// Modify switchTab function to handle settings tab
function switchTab(tab) {
    const videosTab = document.getElementById('ytvhtTabVideos');
    const playlistsTab = document.getElementById('ytvhtTabPlaylists');
    const settingsTab = document.getElementById('ytvhtTabSettings');
    const historyContainer = document.getElementById('ytvhtHistoryContainer');
    const settingsContainer = document.getElementById('ytvhtSettingsContainer');
    videosTab.classList.remove('active');
    playlistsTab.classList.remove('active');
    settingsTab.classList.remove('active');
    if (tab === 'videos') {
        videosTab.classList.add('active');
        historyContainer.style.display = 'block';
        settingsContainer.style.display = 'none';
        document.getElementById('ytvhtVideosTable').style.display = 'table';
        document.getElementById('ytvhtPlaylistsTable').style.display = 'none';
    } else if (tab === 'playlists') {
        playlistsTab.classList.add('active');
        historyContainer.style.display = 'block';
        settingsContainer.style.display = 'none';
        document.getElementById('ytvhtVideosTable').style.display = 'none';
        document.getElementById('ytvhtPlaylistsTable').style.display = 'table';
    } else if (tab === 'settings') {
        settingsTab.classList.add('active');
        historyContainer.style.display = 'none';
        settingsContainer.style.display = 'block';
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    try {
        log('Starting initialization...');
        
        // Set up event listeners
        const clearButton = document.getElementById('ytvhtClearHistory');
        const exportButton = document.getElementById('ytvhtExportHistory');
        const importButton = document.getElementById('ytvhtImportHistory');
        const closeButton = document.getElementById('ytvhtClosePopup');
        const prevPageBtn = document.getElementById('ytvhtPrevPage');
        const nextPageBtn = document.getElementById('ytvhtNextPage');
        const videosTab = document.getElementById('ytvhtTabVideos');
        const playlistsTab = document.getElementById('ytvhtTabPlaylists');
        const prevPlaylistBtn = document.getElementById('ytvhtPrevPlaylistPage');
        const nextPlaylistBtn = document.getElementById('ytvhtNextPlaylistPage');

        if (!clearButton || !exportButton || !importButton || !closeButton || 
            !prevPageBtn || !nextPageBtn || !videosTab || !playlistsTab || 
            !prevPlaylistBtn || !nextPlaylistBtn) {
            throw new Error('Required buttons not found');
        }

        // Update other functions to use sendToContentScriptWithRetry
        clearButton.addEventListener('click', () => {
            sendToContentScriptWithRetry({type: 'clearHistory'}, function(response) {
                if (!response || response.status !== 'success') {
                    showMessage('Error clearing history', 'error');
                    return;
                }
                loadHistory();
                showMessage('History cleared successfully');
            });
        });

        exportButton.addEventListener('click', () => {
            sendToContentScriptWithRetry({type: 'getHistory'}, function(response) {
                if (!response) {
                    showMessage('Error exporting history', 'error');
                    return;
                }
                const blob = new Blob([JSON.stringify(response.history || [], null, 2)], {type: 'application/json'});
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'youtube_history.json';
                a.click();
                URL.revokeObjectURL(url);
            });
        });

        importButton.addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';
            input.onchange = function() {
                const file = input.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = function() {
                    try {
                        const records = JSON.parse(reader.result);
                        sendToContentScriptWithRetry({type: 'importHistory', records}, function(response) {
                            if (!response || response.status !== 'success') {
                                showMessage('Error importing history', 'error');
                                return;
                            }
                            loadHistory();
                            showMessage('History imported successfully');
                        });
                    } catch (e) {
                        showMessage('Invalid file format', 'error');
                    }
                };
                reader.readAsText(file);
            };
            input.click();
        });

        closeButton.addEventListener('click', () => window.close());
        prevPageBtn.addEventListener('click', goToPrevPage);
        nextPageBtn.addEventListener('click', goToNextPage);
        videosTab.addEventListener('click', () => switchTab('videos'));
        playlistsTab.addEventListener('click', () => {
            switchTab('playlists');
            loadPlaylists();
        });
        prevPlaylistBtn.addEventListener('click', goToPrevPlaylistPage);
        nextPlaylistBtn.addEventListener('click', goToNextPlaylistPage);

        // Load initial data with a slight delay to ensure content script is ready
        setTimeout(() => {
            switchTab('videos');
            loadHistory();
        }, 100);
        
        initSettingsTab();
        
        log('Initialization complete');
    } catch (error) {
        log('Error during initialization:', error);
        showMessage('Failed to initialize extension', 'error');
    }
});

