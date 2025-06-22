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
    themePreference: 'system', // 'system', 'light', or 'dark'
    overlayTitle: 'viewed',
    overlayColor: 'blue',
    overlayLabelSize: 'medium',
    darkMode: false // Add dark mode setting
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

// Initialize storage
async function initStorage() {
    try {
        // Ensure migration is complete
        await ytStorage.ensureMigrated();
        return true;
    } catch (error) {
        console.error('Storage initialization failed:', error);
        return false;
    }
}

// Load history records
async function loadHistory() {
    try {
        log('Loading history from storage...');
        const history = await ytStorage.getAllVideos();

        if (!history || Object.keys(history).length === 0) {
            showMessage('No history found.', 'info');
            allHistoryRecords = [];
        } else {
            // Convert the object of videos to an array and sort by timestamp descending (most recent first)
            allHistoryRecords = Object.values(history);
            allHistoryRecords.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            log('Loaded history:', allHistoryRecords);
        }

        currentPage = 1;
        displayHistoryPage();
    } catch (error) {
        console.error('Error loading history:', error);
        showMessage('Error loading history: ' + (error.message || 'Unknown error'), 'error');
    }
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
    // Update pagination info and controls
    updatePaginationUI(currentPage, totalPages);
}

async function deleteRecord(videoId) {
    try {
        await ytStorage.removeVideo(videoId);
        showMessage('Video removed from history');
        // Remove from local array and refresh page
        allHistoryRecords = allHistoryRecords.filter(r => r.videoId !== videoId);
        displayHistoryPage();
    } catch (error) {
        console.error('Error deleting record:', error);
        showMessage('Error removing video: ' + (error.message || 'Unknown error'), 'error');
    }
}

async function clearHistory() {
    if (!confirm('Are you sure you want to clear all history? This cannot be undone.')) {
        return;
    }

    try {
        await ytStorage.clear();
        showMessage('History cleared successfully');
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
        showMessage('Error clearing history: ' + (error.message || 'Unknown error'), 'error');
    }
}

async function exportHistory() {
    try {
        const [videos, playlists] = await Promise.all([
            ytStorage.getAllVideos(),
            ytStorage.getAllPlaylists()
        ]);

        // Create export data with metadata
        const exportData = {
            _metadata: {
                exportDate: new Date().toISOString(),
                extensionVersion: "2.2.0",
                totalVideos: videos.length,
                totalPlaylists: playlists.length,
                exportFormat: "json",
                dataVersion: "1.0"
            },
            history: videos,  // Changed from 'videos' to 'history' to match import format
            playlists: playlists
        };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `youtube-history-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showMessage(`History exported successfully: ${videos.length} videos, ${playlists.length} playlists`);
    } catch (error) {
        console.error('Error exporting history:', error);
        showMessage('Error exporting history: ' + (error.message || 'Unknown error'), 'error');
    }
}

async function importHistory() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';

    input.onchange = async function(e) {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const text = await file.text();
            const data = JSON.parse(text);

            let videos = [];
            let playlists = [];
            let isLegacyFormat = false;

            // Handle both new format (with metadata) and legacy format (array of videos)
            if (data.history && Array.isArray(data.history)) {
                // New format with history and playlists
                videos = data.history;
                playlists = data.playlists || [];
            } else if (Array.isArray(data)) {
                // Legacy format - array of videos
                videos = data;
                isLegacyFormat = true;

                // Validate that it looks like video data
                if (videos.length > 0 && !videos[0].videoId) {
                    throw new Error('Invalid file format: missing videoId in first record');
                }
            } else {
                throw new Error('Invalid file format: expected an array of videos or an object with history/playlists');
            }

            if (videos.length === 0 && playlists.length === 0) {
                showMessage('No data found in import file', 'error');
                return;
            }

            // For legacy format, always use replace mode
            if (isLegacyFormat) {
                await ytStorage.clear();
                for (const video of videos) {
                    await ytStorage.setVideo(video.videoId, video);
                }
                showMessage(`Imported ${videos.length} videos`);
                loadHistory();
                return;
            }

            // For new format, ask for merge mode
            const mergeMode = confirm(
                `Import ${videos.length} videos and ${playlists.length} playlists.\n\n` +
                'Choose import mode:\n' +
                '• OK = Merge with existing data (keep both)\n' +
                '• Cancel = Replace existing data (overwrite)'
            );

            if (!mergeMode) {
                await ytStorage.clear();
            }

            // Import videos
            let importedVideos = 0;
            for (const video of videos) {
                if (video.videoId) {
                    await ytStorage.setVideo(video.videoId, video);
                    importedVideos++;
                }
            }

            // Import playlists
            let importedPlaylists = 0;
            for (const playlist of playlists) {
                if (playlist.playlistId) {
                    await ytStorage.setPlaylist(playlist.playlistId, playlist);
                    importedPlaylists++;
                }
            }

            const mode = mergeMode ? 'merged' : 'replaced';
            showMessage(`History ${mode} successfully: ${importedVideos} videos, ${importedPlaylists} playlists`);
            loadHistory();

        } catch (error) {
            console.error('Import error:', error);
            showMessage('Error importing history: ' + (error.message || 'Unknown error'), 'error');
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

function goToFirstPage() {
    if (currentPage !== 1) {
        currentPage = 1;
        displayHistoryPage();
    }
}

function goToLastPage() {
    const totalPages = Math.ceil(allHistoryRecords.length / pageSize);
    if (currentPage !== totalPages) {
        currentPage = totalPages;
        displayHistoryPage();
    }
}

function goToPage(page) {
    const totalPages = Math.ceil(allHistoryRecords.length / pageSize);
    if (page >= 1 && page <= totalPages && page !== currentPage) {
        currentPage = page;
        displayHistoryPage();
    }
}

function updatePaginationUI(current, total) {
    document.getElementById('ytvhtPageInfo').textContent = `Page ${current} of ${total}`;

    // Update button states
    document.getElementById('ytvhtFirstPage').disabled = current === 1;
    document.getElementById('ytvhtPrevPage').disabled = current === 1;
    document.getElementById('ytvhtNextPage').disabled = current === total;
    document.getElementById('ytvhtLastPage').disabled = current === total;

    // Update page input
    const pageInput = document.getElementById('ytvhtPageInput');
    pageInput.max = total;

    // Generate page numbers (smart pagination)
    const pageNumbers = document.getElementById('ytvhtPageNumbers');
    pageNumbers.innerHTML = '';

    if (total <= 10) {
        // Show all pages if 10 or fewer
        for (let i = 1; i <= total; i++) {
            addPageButton(i, current);
        }
    } else {
        // Smart pagination for many pages
        addPageButton(1, current); // Always show first page

        if (current > 4) {
            addEllipsis(); // Add ... if current is far from start
        }

        // Show current page and neighbors
        const start = Math.max(2, current - 2);
        const end = Math.min(total - 1, current + 2);

        for (let i = start; i <= end; i++) {
            addPageButton(i, current);
        }

        if (current < total - 3) {
            addEllipsis(); // Add ... if current is far from end
        }

        if (total > 1) {
            addPageButton(total, current); // Always show last page
        }
    }

    // Add "Go to page" input for very large sets
    if (total > 10) {
        const goToSpan = document.createElement('span');
        goToSpan.textContent = ' Go to: ';
        goToSpan.style.marginLeft = '10px';
        pageNumbers.appendChild(goToSpan);

        const clonedInput = pageInput.cloneNode(true);
        clonedInput.style.display = 'inline';
        clonedInput.value = '';
        clonedInput.placeholder = current;
        clonedInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                const page = parseInt(this.value);
                if (page) {
                    goToPage(page);
                    this.value = '';
                    this.placeholder = currentPage;
                }
            }
        });
        pageNumbers.appendChild(clonedInput);
    }
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

function addEllipsis() {
    const span = document.createElement('span');
    span.textContent = '...';
    span.style.padding = '5px';
    document.getElementById('ytvhtPageNumbers').appendChild(span);
}

async function loadPlaylists() {
    try {
        log('Loading playlists from storage...');
        const playlists = await ytStorage.getAllPlaylists();

        if (!playlists || Object.keys(playlists).length === 0) {
            showMessage('No playlists found.', 'info');
            allPlaylists = [];
        } else {
            // Convert the object of playlists to an array and sort by lastUpdated descending (most recent first)
            allPlaylists = Object.values(playlists);
            allPlaylists.sort((a, b) => (b.lastUpdated || 0) - (a.lastUpdated || 0));
            log('Loaded playlists:', allPlaylists);
        }

        currentPlaylistPage = 1;
        displayPlaylistsPage();
    } catch (error) {
        console.error('Error loading playlists:', error);
        showMessage('Error loading playlists: ' + (error.message || 'Unknown error'), 'error');
    }
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
    // Update pagination info and controls
    updatePlaylistPaginationUI(currentPlaylistPage, totalPages);
}

function goToFirstPlaylistPage() {
    if (currentPlaylistPage !== 1) {
        currentPlaylistPage = 1;
        displayPlaylistsPage();
    }
}

function goToLastPlaylistPage() {
    const totalPages = Math.ceil(allPlaylists.length / playlistPageSize);
    if (currentPlaylistPage !== totalPages) {
        currentPlaylistPage = totalPages;
        displayPlaylistsPage();
    }
}

function goToPlaylistPage(page) {
    const totalPages = Math.ceil(allPlaylists.length / playlistPageSize);
    if (page >= 1 && page <= totalPages && page !== currentPlaylistPage) {
        currentPlaylistPage = page;
        displayPlaylistsPage();
    }
}

function updatePlaylistPaginationUI(current, total) {
    document.getElementById('ytvhtPlaylistsPageInfo').textContent = `Page ${current} of ${total}`;

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

    if (total <= 10) {
        // Show all pages if 10 or fewer
        for (let i = 1; i <= total; i++) {
            addPlaylistPageButton(i, current);
        }
    } else {
        // Smart pagination for many pages
        addPlaylistPageButton(1, current); // Always show first page

        if (current > 4) {
            addPlaylistEllipsis(); // Add ... if current is far from start
        }

        // Show current page and neighbors
        const start = Math.max(2, current - 2);
        const end = Math.min(total - 1, current + 2);

        for (let i = start; i <= end; i++) {
            addPlaylistPageButton(i, current);
        }

        if (current < total - 3) {
            addPlaylistEllipsis(); // Add ... if current is far from end
        }

        if (total > 1) {
            addPlaylistPageButton(total, current); // Always show last page
        }
    }

    // Add "Go to page" input for very large sets
    if (total > 10) {
        const goToSpan = document.createElement('span');
        goToSpan.textContent = ' Go to: ';
        goToSpan.style.marginLeft = '10px';
        pageNumbers.appendChild(goToSpan);

        const clonedInput = pageInput.cloneNode(true);
        clonedInput.style.display = 'inline';
        clonedInput.value = '';
        clonedInput.placeholder = current;
        clonedInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                const page = parseInt(this.value);
                if (page) {
                    goToPlaylistPage(page);
                    this.value = '';
                    this.placeholder = currentPlaylistPage;
                }
            }
        });
        pageNumbers.appendChild(clonedInput);
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
    span.textContent = '...';
    span.style.margin = '0 5px';
    document.getElementById('ytvhtPlaylistPageNumbers').appendChild(span);
}

async function deletePlaylist(playlistId) {
    try {
        await ytStorage.removePlaylist(playlistId);
        showMessage('Playlist removed');
        allPlaylists = allPlaylists.filter(r => r.playlistId !== playlistId);
        displayPlaylistsPage();
    } catch (error) {
        console.error('Error deleting playlist:', error);
        showMessage('Error removing playlist: ' + (error.message || 'Unknown error'), 'error');
    }
}

// Load settings from storage
async function loadSettings() {
    try {
        const storedSettings = await ytStorage.getSettings() || {};
        let settings = { ...storedSettings };
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
        return { ...DEFAULT_SETTINGS }; // Return a copy of defaults
    }
}

// Save settings to storage
async function saveSettings(settings) {
    try {
        await ytStorage.setSettings(settings);
        return true;
    } catch (error) {
        console.error('Error saving settings:', error);
        return false;
    }
}

// Update settings UI with current values
function updateSettingsUI(settings) {
    document.getElementById('ytvhtAutoCleanPeriod').value = settings.autoCleanPeriod;
    document.getElementById('ytvhtPaginationCount').value = settings.paginationCount;
    document.getElementById('ytvhtOverlayTitle').value = settings.overlayTitle;
    document.getElementById('ytvhtOverlayColor').value = settings.overlayColor;
    document.getElementById('ytvhtOverlayLabelSize').value = settings.overlayLabelSize || 'medium';
    document.getElementById('ytvhtThemePreference').value = settings.themePreference || 'system';
    updateColorPreview(settings.overlayColor);
}

// Update color preview
function updateColorPreview(color) {
    const preview = document.getElementById('ytvhtColorPreview');
    preview.style.backgroundColor = OVERLAY_COLORS[color];
}

// Handle settings tab
async function initSettingsTab() {
    const settingsTab = document.getElementById('ytvhtTabSettings');
    const settingsContainer = document.getElementById('ytvhtSettingsContainer');
    const saveButton = document.getElementById('ytvhtSaveSettings');
    const colorSelect = document.getElementById('ytvhtOverlayColor');

    try {
        const settings = await loadSettings();
        updateSettingsUI(settings);

        // Set up color preview
        colorSelect.addEventListener('change', function() {
            updateColorPreview(this.value);
        });

        // Set up save button
        saveButton.addEventListener('click', async () => {
            try {
                const themePreference = document.getElementById('ytvhtThemePreference').value || 'system';
                const newSettings = {
                    ...settings, // Keep existing settings
                    autoCleanPeriod: parseInt(document.getElementById('ytvhtAutoCleanPeriod').value, 10) || 90,
                    paginationCount: parseInt(document.getElementById('ytvhtPaginationCount').value, 10) || 10,
                    overlayTitle: document.getElementById('ytvhtOverlayTitle').value || 'viewed',
                    overlayColor: document.getElementById('ytvhtOverlayColor').value || 'blue',
                    overlayLabelSize: document.getElementById('ytvhtOverlayLabelSize').value || 'medium',
                    themePreference: themePreference,
                    darkMode: themePreference === 'system'
                        ? getSystemColorScheme() === 'dark'
                        : themePreference === 'dark'
                };

                // Validate settings
                if (newSettings.autoCleanPeriod < 1 || newSettings.autoCleanPeriod > 365) {
                    throw new Error('Auto-clean period must be between 1 and 365 days');
                }

                if (newSettings.paginationCount < 1 || newSettings.paginationCount > 100) {
                    throw new Error('Items per page must be between 1 and 100');
                }

                if (newSettings.overlayTitle.length > 20) {
                    throw new Error('Overlay title must be 20 characters or less');
                }

                const success = await saveSettings(newSettings);
                if (!success) {
                    throw new Error('Failed to save settings');
                }

                showMessage('Settings saved successfully');

                // Update current settings and UI
                Object.assign(settings, newSettings);
                pageSize = settings.paginationCount;
                playlistPageSize = settings.paginationCount;

                // Update display
                displayHistoryPage();
                if (document.getElementById('ytvhtTabPlaylists').classList.contains('active')) {
                    displayPlaylistsPage();
                }

                // Notify content script of settings changes
                chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
                    if (tabs[0]?.id) {
                        chrome.tabs.sendMessage(tabs[0].id, {
                            type: 'updateSettings',
                            settings: newSettings
                        }).catch(err => console.warn('Could not send settings to tab:', err));
                    }
                });

            } catch (error) {
                console.error('Error saving settings:', error);
                showMessage(error.message || 'Error saving settings', 'error');
            }
        });

        settingsTab.addEventListener('click', function() {
            switchTab('settings');
        });

    } catch (error) {
        console.error('Error initializing settings tab:', error);
        showMessage('Error initializing settings tab', 'error');
    }
}

// Switch between different tabs in the popup
function switchTab(tab) {
    const videosTab = document.getElementById('ytvhtTabVideos');
    const playlistsTab = document.getElementById('ytvhtTabPlaylists');
    const settingsTab = document.getElementById('ytvhtTabSettings');
    const historyContainer = document.getElementById('ytvhtHistoryContainer');
    const settingsContainer = document.getElementById('ytvhtSettingsContainer');
    const videoPagination = document.getElementById('ytvhtPagination');
    const playlistPagination = document.getElementById('ytvhtPlaylistsPagination');

    // Update tab active states
    videosTab.classList.remove('active');
    playlistsTab.classList.remove('active');
    settingsTab.classList.remove('active');

    if (tab === 'videos') {
        videosTab.classList.add('active');
        historyContainer.style.display = 'block';
        settingsContainer.style.display = 'none';
        document.getElementById('ytvhtVideosTable').style.display = 'table';
        document.getElementById('ytvhtPlaylistsTable').style.display = 'none';
        videoPagination.style.display = 'flex';
        playlistPagination.style.display = 'none';
    } else if (tab === 'playlists') {
        playlistsTab.classList.add('active');
        historyContainer.style.display = 'block';
        settingsContainer.style.display = 'none';
        document.getElementById('ytvhtVideosTable').style.display = 'none';
        document.getElementById('ytvhtPlaylistsTable').style.display = 'table';
        videoPagination.style.display = 'none';
        playlistPagination.style.display = 'flex';
    } else if (tab === 'settings') {
        settingsTab.classList.add('active');
        historyContainer.style.display = 'none';
        settingsContainer.style.display = 'block';
        videoPagination.style.display = 'none';
        playlistPagination.style.display = 'none';
    }
}

function toggleDarkMode(enable) {
    document.documentElement.setAttribute('data-theme', enable ? 'dark' : 'light');
}

// Update theme toggle text based on current preference
function updateThemeToggleText(themePreference) {
    const themeToggle = document.getElementById('ytvhtToggleTheme');
    const themeText = document.getElementById('themeText');
    if (!themeToggle || !themeText) return;

    // Update text based on current mode
    if (themePreference === 'system') {
        themeText.textContent = 'System';
        themeToggle.title = 'System theme (click to change)';
    } else if (themePreference === 'light') {
        themeText.textContent = 'Light';
        themeToggle.title = 'Light theme (click to change)';
    } else {
        themeText.textContent = 'Dark';
        themeToggle.title = 'Dark theme (click to change)';
    }
}

// Check system color scheme preference
function getSystemColorScheme() {
    const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    log('System color scheme detection:', {
        prefersDark: isDark,
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        matchMediaSupported: !!window.matchMedia,
        prefersDarkSupported: window.matchMedia ? !!window.matchMedia('(prefers-color-scheme: dark)') : false
    });
    return isDark ? 'dark' : 'light';
}



// Force dark mode for testing (temporary)
function forceDarkMode() {
    log('Forcing dark mode for testing');
    document.documentElement.setAttribute('data-theme', 'dark');
    document.body.classList.add('dark-mode');
    document.body.classList.remove('light-mode');

    // Update toggle button if it exists
    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) {
        themeToggle.innerHTML = '☀️';
        themeToggle.title = 'Switch to light mode';
    }
}

// Toggle theme between system, light, and dark
async function toggleTheme() {
    try {
        const settings = await loadSettings();
        const systemPrefersDark = getSystemColorScheme() === 'dark';

        // Cycle through theme preferences: system -> light -> dark -> system
        if (!settings.themePreference || settings.themePreference === 'system') {
            settings.themePreference = 'light';
        } else if (settings.themePreference === 'light') {
            settings.themePreference = 'dark';
        } else {
            settings.themePreference = 'system';
        }

        // Determine which theme to use based on preference
        settings.darkMode = settings.themePreference === 'system'
            ? systemPrefersDark
            : settings.themePreference === 'dark';

        await saveSettings(settings);

        // Apply the theme
        toggleDarkMode(settings.darkMode);

        // Update theme toggle text
        updateThemeToggleText(settings.themePreference);

        // Update settings UI if open
        updateSettingsUI(settings);
    } catch (error) {
        console.error('Error toggling theme:', error);
        showMessage('Error changing theme: ' + (error.message || 'Unknown error'), 'error');
    }
}



// Initialize
document.addEventListener('DOMContentLoaded', async function() {
    try {
        log('Starting initialization...');

        // Initialize storage first
        const storageReady = await initStorage();
        if (!storageReady) {
            throw new Error('Failed to initialize storage');
        }

        // Load settings
        const settings = await loadSettings();
        currentSettings = settings;
        updateSettingsUI(settings);

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
        const playlistsTab = document.getElementById('ytvhtTabPlaylists');
        const prevPlaylistBtn = document.getElementById('ytvhtPrevPlaylistPage');
        const nextPlaylistBtn = document.getElementById('ytvhtNextPlaylistPage');
        const firstPlaylistBtn = document.getElementById('ytvhtFirstPlaylistPage');
        const lastPlaylistBtn = document.getElementById('ytvhtLastPlaylistPage');

        if (!clearButton || !exportButton || !importButton || !closeButton ||
            !firstPageBtn || !prevPageBtn || !nextPageBtn || !lastPageBtn ||
            !videosTab || !playlistsTab || !prevPlaylistBtn || !nextPlaylistBtn ||
            !firstPlaylistBtn || !lastPlaylistBtn) {
            throw new Error('Required buttons not found');
        }

        // Set up event listeners
        clearButton.addEventListener('click', async () => {
            try {
                await ytStorage.clear();
                allHistoryRecords = [];
                allPlaylists = [];
                currentPage = 1;
                currentPlaylistPage = 1;
                displayHistoryPage();
                showMessage('History cleared successfully');
            } catch (error) {
                console.error('Error clearing history:', error);
                showMessage('Error clearing history: ' + (error.message || 'Unknown error'), 'error');
            }
        });

        exportButton.addEventListener('click', async () => {
            try {
                const history = await ytStorage.getAllVideos();
                const playlists = await ytStorage.getAllPlaylists();
                const data = { history, playlists };

                const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'youtube_history_backup.json';
                a.click();
                URL.revokeObjectURL(url);
                showMessage('Export completed successfully');
            } catch (error) {
                console.error('Error exporting history:', error);
                showMessage('Error exporting history: ' + (error.message || 'Unknown error'), 'error');
            }
        });

        importButton.addEventListener('click', () => importHistory());
        closeButton.addEventListener('click', () => window.close());

        // Pagination controls
        firstPageBtn.addEventListener('click', goToFirstPage);
        prevPageBtn.addEventListener('click', goToPrevPage);
        nextPageBtn.addEventListener('click', goToNextPage);
        lastPageBtn.addEventListener('click', goToLastPage);

        // Tabs
        videosTab.addEventListener('click', () => switchTab('videos'));
        playlistsTab.addEventListener('click', () => {
            switchTab('playlists');
            loadPlaylists();
        });

        // Playlist pagination
        prevPlaylistBtn.addEventListener('click', goToPrevPlaylistPage);
        nextPlaylistBtn.addEventListener('click', goToNextPlaylistPage);
        firstPlaylistBtn.addEventListener('click', goToFirstPlaylistPage);
        lastPlaylistBtn.addEventListener('click', goToLastPlaylistPage);

        // Initialize UI
        initSettingsTab();

        log('Initial settings:', settings);

        // Check system preference
        const systemPrefersDark = getSystemColorScheme() === 'dark';
        log('System prefers dark mode:', systemPrefersDark);

        // If themePreference is not set, default to 'system'
        if (settings.themePreference === undefined) {
            log('No theme preference set, defaulting to system');
            settings.themePreference = 'system';
            settings.darkMode = systemPrefersDark;
            log('Saving initial settings:', settings);
            await saveSettings(settings);
        }

        // Determine which theme to use based on preference
        const useDarkMode = settings.themePreference === 'system'
            ? systemPrefersDark
            : settings.themePreference === 'dark';

        log('Theme preference:', settings.themePreference);
        log('Will use dark mode:', useDarkMode);

        // Ensure darkMode setting matches the actual theme being used
        if (settings.darkMode !== useDarkMode) {
            log('Updating darkMode setting to match theme preference');
            settings.darkMode = useDarkMode;
            await saveSettings(settings);
        }

        // Apply the theme
        log('Applying theme, dark mode:', useDarkMode);
        toggleDarkMode(useDarkMode);

        // Set up theme toggle button
        const themeToggle = document.getElementById('ytvhtToggleTheme');
        if (themeToggle) {
            themeToggle.addEventListener('click', toggleTheme);
            // Update the button text based on current theme preference
            updateThemeToggleText(settings.themePreference);
        }

        // Listen for system theme changes
        if (window.matchMedia) {
            const darkModeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
            darkModeMediaQuery.addEventListener('change', async (e) => {
                if (settings.themePreference === 'system' || settings.themePreference === undefined) {
                    const newDarkMode = e.matches;
                    settings.darkMode = newDarkMode;
                    await saveSettings(settings);
                    toggleDarkMode(newDarkMode);

                    // Update the button icon
                    const themeToggle = document.getElementById('ytvhtToggleTheme');
                    if (themeToggle) {
                        const icon = themeToggle.querySelector('.theme-icon');
                        if (icon) {
                            icon.textContent = newDarkMode ? '☀️' : '🌙';
                        }
                    }
                }
            });
        }

        // Load initial data
        await loadHistory();

        // Show default tab
        switchTab('videos');

        log('Initialization complete');
    } catch (error) {
        console.error('Error during initialization:', error);
        showMessage('Failed to initialize extension: ' + (error.message || 'Unknown error'), 'error');
    }
});

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

