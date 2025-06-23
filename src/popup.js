// --- Debugging and Logging ---
const DEBUG = false; // Set to false for production

function log(...args) {
    if (DEBUG) {
        console.log('[ythdb-popup]', ...args);
    }
}

window.onerror = function (msg, url, lineNo, columnNo, error) {
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
    overlayLabelSize: 'medium'
};

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
        if (record.duration && record.duration > 0) {
            const percentage = Math.round((record.time / record.duration) * 100);
            progressCell.textContent = `${formatDuration(record.time)} (${percentage}%)`;
        } else {
            progressCell.textContent = formatDuration(record.time);
        }
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

        const blob = new Blob([JSON.stringify(exportData, null, 2)], {type: 'application/json'});
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

    input.onchange = async function (e) {
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
        clonedInput.addEventListener('keypress', function (e) {
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
        clonedInput.addEventListener('keypress', function (e) {
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
        let settings = {...storedSettings};
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
        colorSelect.addEventListener('change', function () {
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

        settingsTab.addEventListener('click', function () {
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

// Helper function to determine if a color is dark
function isColorDark(color) {
    if (!color) {
        log('No color provided to isColorDark');
        return false;
    }

    try {
        // Handle rgb/rgba colors
        if (color.startsWith('rgb')) {
            const rgb = color.match(/\d+/g);
            if (rgb && rgb.length >= 3) {
                const r = parseInt(rgb[0]);
                const g = parseInt(rgb[1]);
                const b = parseInt(rgb[2]);
                // Calculate brightness using the WCAG formula
                const brightness = (r * 299 + g * 587 + b * 114) / 1000;
                return brightness < 128;
            }
        }
        // Handle hex colors
        else if (color.startsWith('#')) {
            // Convert #RGB to #RRGGBB
            const hex = color.length === 4 ?
                '#' + color[1] + color[1] + color[2] + color[2] + color[3] + color[3] :
                color;

            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            const brightness = (r * 299 + g * 587 + b * 114) / 1000;
            return brightness < 128;
        }

        // Handle color names (basic implementation)
        const colorMap = {
            'black': true,
            'navy': true,
            'darkblue': true,
            'mediumblue': true,
            'blue': false,
            'darkgreen': true,
            'green': false,
            'teal': true,
            'darkcyan': true,
            'deepskyblue': false,
            'darkturquoise': false,
            'mediumspringgreen': false,
            'lime': false,
            'springgreen': false,
            'cyan': false,
            'midnightblue': true,
            'dodgerblue': false,
            'lightseagreen': true,
            'forestgreen': true,
            'seagreen': true,
            'darkslategray': true,
            'darkslategrey': true,
            'limegreen': false,
            'mediumseagreen': false,
            'turquoise': false,
            'royalblue': false,
            'steelblue': false,
            'darkslateblue': true,
            'mediumturquoise': false,
            'indigo': true,
            'darkolivegreen': true,
            'cadetblue': false,
            'cornflowerblue': false,
            'rebeccapurple': true,
            'blueviolet': true,
            'darkkhaki': false,
            'mediumpurple': false,
            'crimson': true,
            'brown': true,
            'firebrick': true,
            'darkred': true,
            'red': false,
            'darkorange': false,
            'orange': false,
            'gold': false,
            'yellow': false,
            'khaki': false,
            'violet': false,
            'plum': false,
            'magenta': false,
            'orchid': false,
            'pink': false,
            'lightpink': false,
            'white': false,
            'snow': false,
            'whitesmoke': false,
            'gainsboro': false,
            'lightgray': false,
            'lightgrey': false,
            'silver': false,
            'darkgray': true,
            'darkgrey': true,
            'gray': true,
            'grey': true,
            'dimgray': true,
            'dimgrey': true,
            'black': true
        };

        const lowerColor = color.toLowerCase().trim();
        if (colorMap.hasOwnProperty(lowerColor)) {
            return colorMap[lowerColor];
        }

        // Default to light for unknown colors
        return false;

    } catch (e) {
        log('Error in isColorDark:', e);
        return false;
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
    if (themeText) {
        let text = 'Theme: ';
        switch (themePreference) {
            case 'light':
                text += 'Light';
                break;
            case 'dark':
                text += 'Dark';
                break;
            case 'system':
            default:
                text += 'System';
        }
        themeText.textContent = text;
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
        log('Initial settings:', settings);

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
                const data = {history, playlists};

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

        // Listen for system theme changes
        if (window.matchMedia) {
            const darkModeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
            darkModeMediaQuery.addEventListener('change', async (e) => {
                if (settings.themePreference === 'system' || settings.themePreference === undefined) {
                    const newDarkMode = e.matches;
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
