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

// Sync state tracking to prevent race conditions
let syncInProgress = false;

// Shorts Pagination state
let currentShortsPage = 1;
let shortsPageSize = 20;

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
    debug: false
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
        await loadHistory(true);

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
        chrome.runtime.sendMessage({ type: 'getLatestUpdate' }, (response) => {
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
                                updateVideoRecord(change.newValue);
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
        const history = await ytStorage.getAllVideos();

        console.log('[Popup] Raw history data from storage:', Object.keys(history).length, 'items');
        if (Object.keys(history).length > 0) {
            // Show newest videos first for sync debugging
            const videoKeys = Object.keys(history).filter(k => k.startsWith('video_'));
            const sortedKeys = videoKeys.sort((a, b) => (history[b].timestamp || 0) - (history[a].timestamp || 0));
            const newestKeys = sortedKeys.slice(0, 3);

            console.log('[Popup] Sample newest videos from storage:', newestKeys.map(key => ({
                key: key,
                title: history[key]?.title || 'No title',
                timestamp: new Date(history[key]?.timestamp || 0).toLocaleTimeString()
            })));
        }

        if (!history || Object.keys(history).length === 0) {
            if (isInitialLoad) {
                showMessage(chrome.i18n.getMessage('history_no_history_found'), 'info');
            }
            allHistoryRecords = [];
            allShortsRecords = [];
        } else {
            const newRegularVideos = extractRegularVideoRecords(history);
            const newShortsRecords = extractShortsRecords(history);

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

// Search functionality
let searchQuery = '';
const searchInput = document.getElementById('ytvhtSearchInput');

searchInput?.addEventListener('input', (e) => {
    searchQuery = e.target.value.toLowerCase();
    currentPage = 1; // Reset to first page when searching
    displayHistoryPage();
});

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
    const totalSeconds = records.reduce((sum, record) => sum + (record.time || 0), 0);
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

// Update analytics display
function updateAnalytics() {
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
        container.innerHTML = `<span style="color:var(--text-color);opacity:0.7;">${chrome.i18n.getMessage('analytics_no_unfinished_long_videos')}</span>`;
        return;
    }

    // Helper to sanitize text (replace mis-encoded dashes and clean up)
    function sanitizeText(text) {
        if (!text) return '';
        return text
            .replace(/â€" |â€" |â€" |â€\x9c|â€\x9d/g, '–') // common mis-encoded dashes
            .replace(/â€™/g, "'") // apostrophe
            .replace(/â€œ|â€/g, '"') // quotes
            .replace(/â€¦/g, '...') // ellipsis
            .replace(/â€¢/g, '-') // bullet
            .replace(/\s+/g, ' ') // collapse whitespace
            .trim();
    }

    // Render list
    container.innerHTML = topUnfinished.map(record => {
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
        const title = sanitizeText(record.title || 'Untitled');
        const channel = sanitizeText(record.channelName || 'Unknown Channel');
        return `<div style="margin-bottom:8px;">
            <a href="${record.url}" target="_blank" style="font-weight:500; color:var(--button-bg); text-decoration:none;">${title}</a>
            <span style="color:var(--text-color); opacity:0.8;"> - ${timeLeftStr} left (watched ${watchedStr}/${totalStr})<br>
            <span style="font-size:12px; color:var(--text-color); opacity:0.7;">${channel}</span></span>
        </div>`;
    }).join('');
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

    // Get last 7 days of activity
    const now = new Date();
    const days = Array.from({length: 7}, (_, i) => {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        return date.toISOString().split('T')[0];
    }).reverse();

    const activity = days.map(day => {
        return allHistoryRecords.filter(record => {
            const recordDate = new Date(record.timestamp).toISOString().split('T')[0];
            return recordDate === day;
        }).length;
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
        ctx.fillText(dateLabel, x + (barWidth - barSpacing)/2, canvas.height - 5);

        // Draw count label
        ctx.fillText(count.toString(), x + (barWidth - barSpacing)/2, y - 5);
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

    // Calculate watch time by hour
    const hourlyData = new Array(24).fill(0);

    // Combine regular videos and shorts
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
            x + (barWidth - barSpacing)/2,
            canvas.height - 20
        );

        // Draw minutes label if non-zero
        if (minutes > 0) {
            ctx.fillText(
                `${minutes}m`,
                x + (barWidth - barSpacing)/2,
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
    const historyTable = document.getElementById('ytvhtHistoryTable');
    const noHistory = document.getElementById('ytvhtNoHistory');
    const paginationDiv = document.getElementById('ytvhtPagination');

    // Filter records based on search
    const filteredRecords = filterRecords(allHistoryRecords);

    // Clear only if we have new content to show
    if (!filteredRecords.length) {
        historyTable.innerHTML = '';
        noHistory.style.display = 'block';
        noHistory.textContent = searchQuery
            ? chrome.i18n.getMessage('search_no_videos_found')
            : chrome.i18n.getMessage('history_no_history_found');
        paginationDiv.style.display = 'none';
        return;
    }

    noHistory.style.display = 'none';
    paginationDiv.style.display = 'flex';

    const totalPages = Math.ceil(filteredRecords.length / pageSize);
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const startIdx = (currentPage - 1) * pageSize;
    const endIdx = Math.min(startIdx + pageSize, filteredRecords.length);
    const pageRecords = filteredRecords.slice(startIdx, endIdx);

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
            cell.innerHTML = `
                <img class="video-thumbnail" alt="Video thumbnail">
                <div class="video-content">
                    <div class="video-title">
                        <a class="video-link" target="_blank"></a>
                    </div>
                    <div class="video-details">
                        <span class="video-progress"></span>
                        <span class="video-date"></span>
                        <button class="delete-button">${chrome.i18n.getMessage('delete_label')}</button>
                    </div>
                </div>
            `;
        }

        // Update content
        const thumbnail = cell.querySelector('.video-thumbnail');
        const link = cell.querySelector('.video-link');
        const progress = cell.querySelector('.video-progress');
        const date = cell.querySelector('.video-date');
        const deleteButton = cell.querySelector('.delete-button');

        thumbnail.src = `https://i.ytimg.com/vi/${record.videoId}/mqdefault.jpg`;
        thumbnail.alt = record.title || 'Video thumbnail';

        link.href = record.url;
        link.textContent = record.title || 'Unknown Title';

        progress.textContent = formatProgress(record.time, record.duration);
        date.textContent = formatDate(record.timestamp);

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
        const [videos, playlists] = await Promise.all([
            ytStorage.getAllVideos(),
            ytStorage.getAllPlaylists()
        ]);

        // Create export data with metadata
        const exportData = {
            _metadata: {
                exportDate: new Date().toISOString(),
                extensionVersion: EXTENSION_VERSION,
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
        showMessage(chrome.i18n.getMessage('message_export_success', [videos.length, playlists.length]));
    } catch (error) {
        console.error('Error exporting history:', error);
        showMessage(chrome.i18n.getMessage('message_error_exporting_history', [error.message || chrome.i18n.getMessage('message_unknown_error')]), 'error');
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
                showMessage(chrome.i18n.getMessage('message_no_data_in_import'), 'error');
                return;
            }

            // For legacy format, always use replace mode
            if (isLegacyFormat) {
                await ytStorage.clear();
                for (const video of videos) {
                    await ytStorage.setVideo(video.videoId, video);
                }
                showMessage(chrome.i18n.getMessage('message_import_success', ['replaced', videos.length, playlists.length]));
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
            showMessage(chrome.i18n.getMessage('message_import_success', [mode, importedVideos, importedPlaylists]));
            loadHistory();

        } catch (error) {
            console.error('Import error:', error);
            showMessage(chrome.i18n.getMessage('message_error_importing_history', [error.message || chrome.i18n.getMessage('message_unknown_error')]), 'error');
        }
    };

    input.click();
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
    document.getElementById('ytvhtPageInfo').textContent = chrome.i18n.getMessage('pagination_page_info', [current, total]);

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

    if (total <= 7) {
        // Show all pages if 7 or fewer
        for (let i = 1; i <= total; i++) {
            addPageButton(i, current);
        }
    } else {
        // Smart pagination for many pages
        addPageButton(1, current); // Always show first page

        if (current > 3) {
            addEllipsis(); // Add ... if current is far from start
        }

        // Show current page and neighbors (1 before and 1 after)
        const start = Math.max(2, current - 1);
        const end = Math.min(total - 1, current + 1);

        for (let i = start; i <= end; i++) {
            if (i !== 1 && i !== total) { // Don't duplicate first/last page
                addPageButton(i, current);
            }
        }

        if (current < total - 2) {
            addEllipsis(); // Add ... if current is far from end
        }

        if (total > 1) {
            addPageButton(total, current); // Always show last page
        }
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
            cell.innerHTML = `
                <div class="playlist-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z"/>
                        <circle cx="20" cy="7" r="2"/>
                        <circle cx="20" cy="12" r="2"/>
                        <circle cx="20" cy="17" r="2"/>
                    </svg>
                </div>
                <div class="playlist-content">
                    <div class="playlist-title">
                        <a class="video-link" target="_blank"></a>
                    </div>
                    <div class="playlist-details">
                        <span class="playlist-date"></span>
                        <button class="delete-button">${chrome.i18n.getMessage('delete_label')}</button>
                    </div>
                </div>
            `;
        }

        // Update content
        const link = cell.querySelector('.video-link');
        const date = cell.querySelector('.playlist-date');
        const deleteButton = cell.querySelector('.delete-button');

        link.href = record.url;
        link.textContent = record.title || 'Unknown Playlist';
        date.textContent = formatDate(record.timestamp);
        deleteButton.onclick = () => deletePlaylist(record.playlistId);
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
    document.getElementById('ytvhtAutoCleanPeriod').value = settings.autoCleanPeriod;
    document.getElementById('ytvhtPaginationCount').value = settings.paginationCount;
    document.getElementById('ytvhtOverlayTitle').value = settings.overlayTitle;
    document.getElementById('ytvhtOverlayColor').value = settings.overlayColor;
    document.getElementById('ytvhtOverlayLabelSize').value = settings.overlayLabelSize;
    document.getElementById('ytvhtDebugMode').checked = settings.debug;
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
        autoCleanPeriod.addEventListener('change', async function() {
            const settings = await loadSettings();
            settings.autoCleanPeriod = parseInt(this.value);
            await saveSettings(settings);
            showMessage(chrome.i18n.getMessage('message_overlay_color_updated'));
        });
    } else {
        log('Error: Auto-clean period element not found');
    }

    // Pagination count
    const paginationCount = document.getElementById('ytvhtPaginationCount');
    if (paginationCount) {
        paginationCount.addEventListener('change', async function() {
            const settings = await loadSettings();
            settings.paginationCount = parseInt(this.value);
            await saveSettings(settings);
            showMessage(chrome.i18n.getMessage('message_pagination_count_updated'));
        });
    } else {
        log('Error: Pagination count element not found');
    }

    // Overlay title
    const overlayTitle = document.getElementById('ytvhtOverlayTitle');
    if (overlayTitle) {
        overlayTitle.addEventListener('change', async function() {
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
        overlayColor.addEventListener('change', async function() {
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
        overlayLabelSize.addEventListener('change', async function() {
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
        themePreference.addEventListener('change', async function() {
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
        debugMode.addEventListener('change', async function() {
            const settings = await loadSettings();
            settings.debug = this.checked;
            await saveSettings(settings);
            showMessage(chrome.i18n.getMessage('message_debug_mode_enabled'));
        });
    } else {
        log('Error: Debug mode element not found');
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
        } else if (tab === 'playlists') {
            // Load playlists when switching to playlists tab
            loadPlaylists(true);
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
                showMessage(chrome.i18n.getMessage('message_export_success', [history.length, playlists.length]));
            } catch (error) {
                console.error('Error exporting history:', error);
                showMessage(chrome.i18n.getMessage('message_error_exporting_history', [error.message || chrome.i18n.getMessage('message_unknown_error')]), 'error');
            }
        });

        importButton.addEventListener('click', () => importHistory());
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
        videosTab.addEventListener('click', () => switchTab('videos'));
        shortsTab.addEventListener('click', () => {
            switchTab('shorts');
            displayShortsPage();
        });
        playlistsTab.addEventListener('click', () => {
            switchTab('playlists');
            loadPlaylists(true);
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
        await loadHistory(true);

        // Load playlists for analytics (don't show messages)
        await loadPlaylists(false);

        // Initialize sync functionality
        initSyncIntegration();

        log('Initialization complete');
    } catch (error) {
        console.error('Error during initialization:', error);
        showMessage(chrome.i18n.getMessage('message_failed_to_initialize', [error.message || chrome.i18n.getMessage('message_unknown_error')]), 'error');
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

// Shorts pagination controls
function goToPrevShortsPage() {
    if (currentShortsPage > 1) {
        currentShortsPage--;
        displayShortsPage();
    }
}

function goToNextShortsPage() {
    const totalPages = Math.ceil(allShortsRecords.length / shortsPageSize);
    if (currentShortsPage < totalPages) {
        currentShortsPage++;
        displayShortsPage();
    }
}

function goToFirstShortsPage() {
    if (currentShortsPage !== 1) {
        currentShortsPage = 1;
        displayShortsPage();
    }
}

function goToLastShortsPage() {
    const totalPages = Math.ceil(allShortsRecords.length / shortsPageSize);
    if (currentShortsPage !== totalPages) {
        currentShortsPage = totalPages;
        displayShortsPage();
    }
}

function goToShortsPage(page) {
    const totalPages = Math.ceil(allShortsRecords.length / shortsPageSize);
    if (page >= 1 && page <= totalPages && page !== currentShortsPage) {
        currentShortsPage = page;
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
    const shortsTable = document.getElementById('ytvhtShortsTable');
    const noShorts = document.getElementById('ytvhtNoShorts');
    const paginationDiv = document.getElementById('ytvhtShortsPagination');
    const tbody = document.getElementById('ytvhtShortsBody');
    tbody.innerHTML = '';

    if (!allShortsRecords.length) {
        noShorts.style.display = 'block';
        shortsTable.style.display = 'none';
        if (paginationDiv) paginationDiv.style.display = 'none';
        return;
    }
    noShorts.style.display = 'none';
    shortsTable.style.display = '';
    if (paginationDiv) paginationDiv.style.display = 'flex';

    const totalPages = Math.ceil(allShortsRecords.length / shortsPageSize);
    if (currentShortsPage > totalPages) currentShortsPage = totalPages;
    if (currentShortsPage < 1) currentShortsPage = 1;
    const startIdx = (currentShortsPage - 1) * shortsPageSize;
    const endIdx = Math.min(startIdx + shortsPageSize, allShortsRecords.length);
    const pageRecords = allShortsRecords.slice(startIdx, endIdx);

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


    updateShortsPaginationUI(currentShortsPage, totalPages);
}

// ========== SYNC INTEGRATION ==========

// Keep only essential debug functions for troubleshooting
window.debugSyncViaMessage = function() {
    chrome.runtime.sendMessage({type: 'debugSyncStorage'}, (response) => {
        console.log('[Popup] 🔍 debugSyncStorage response:', response);
        if (chrome.runtime.lastError) {
            console.error('[Popup] ❌ Message error:', chrome.runtime.lastError);
        }
        return response;
    });
};

window.testSyncImprovements = function() {
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
    chrome.runtime.sendMessage({ type: 'getSyncStatus' }, (response) => {
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
                await loadHistory(false);
            }, 200);
        } else if (message.type === 'regularSyncComplete') {
            syncInProgress = false; // Ensure flag is cleared

            // Force complete refresh after regular sync
            setTimeout(async () => {
                await loadHistory(false);
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
    chrome.runtime.sendMessage({ type: 'getSyncStatus' }, (response) => {
        if (!response) return;

        if (response.status === 'not_available') {
            showMessage(chrome.i18n.getMessage('message_firefox_sync_not_available'), 'error');
            return;
        }

        if (response.status === 'disabled') {
            // Enable sync
            chrome.runtime.sendMessage({ type: 'enableSync' }, (result) => {
                if (!result || !result.success) {
                    showMessage(chrome.i18n.getMessage('message_failed_to_enable_sync'), 'error');
                }
                // Sync indicator will show success status
            });
        } else if (response.status === 'error') {
            // Retry sync
            chrome.runtime.sendMessage({ type: 'triggerSync' }, (result) => {
                if (!result || !result.success) {
                    showMessage(chrome.i18n.getMessage('message_sync_currently_disabled'), 'error');
                }
            });
        } else if (response.enabled) {
            // Manual sync trigger
            chrome.runtime.sendMessage({ type: 'triggerSync' }, (result) => {
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
        chrome.runtime.sendMessage({ type: 'enableSync' }, (result) => {
            if (!result || !result.success) {
                event.target.checked = false;
                showMessage(chrome.i18n.getMessage('message_failed_to_enable_sync'), 'error');
            }
            // Removed success message - sync indicator shows status
        });
    } else {
        chrome.runtime.sendMessage({ type: 'disableSync' }, (result) => {
            if (!result || !result.success) {
                event.target.checked = true;
                showMessage(chrome.i18n.getMessage('message_failed_to_disable_sync'), 'error');
            }
            // Removed success message - sync indicator shows status
        });
    }
}

async function handleManualSync() {
    chrome.runtime.sendMessage({ type: 'triggerSync' }, (result) => {
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
    chrome.runtime.sendMessage({ type: 'triggerFullSync' }, (result) => {
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
        chrome.runtime.sendMessage({ type: 'getSyncStatus' }, (response) => {
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
        container.innerHTML = `<span style="color:var(--text-color);opacity:0.7;">${chrome.i18n.getMessage('analytics_no_channel_data')}</span>`;
        return;
    }

    function formatWatchTime(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        return h > 0 ? `${h}h ${m}m` : `${m}m`;
    }

    function sanitizeText(text) {
        if (!text) return '';
        return text
            .replace(/â€" |â€" |â€" |â€\x9c|â€\x9d/g, '-') // always use plain hyphen
            .replace(/â€™/g, "'")
            .replace(/â€œ|â€/g, '"')
            .replace(/â€¦/g, '...')
            .replace(/â€¢/g, '-')
            .replace(/\s+/g, ' ')
            .trim();
    }

    container.innerHTML = topChannels.map(ch => {
        let channelUrl = '';
        if (ch.channelId) {
            if (ch.channelId.startsWith('UC')) {
                channelUrl = `https://www.youtube.com/channel/${ch.channelId}`;
            } else if (ch.channelId.startsWith('@')) {
                channelUrl = `https://www.youtube.com/${ch.channelId}`;
            }
        }
        const channelName = sanitizeText(ch.channel);
        const link = channelUrl ? `<a href="${channelUrl}" target="_blank" style="font-weight:500; color:var(--button-bg); text-decoration:none;">${channelName}</a>` : `<span style="font-weight:500; color:var(--button-bg);">${channelName}</span>`;
        return `<div style="margin-bottom:8px;">${link} <span style="color:var(--text-color); opacity:0.8;">- ${chrome.i18n.getMessage('analytics_channel_videos', [ch.count, formatWatchTime(ch.watchTime)])}</span></div>`;
    }).join('');
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
            channelMap[channel] = { channel, channelId, count: 0 };
        }
        channelMap[channel].count++;
    });
    let channels = Object.values(channelMap);
    channels.sort((a, b) => b.count - a.count);
    const topSkipped = channels.slice(0, 5);

    function sanitizeText(text) {
        if (!text) return '';
        return text
            .replace(/â€" |â€" |â€" |â€\x9c|â€\x9d/g, '-')
            .replace(/â€™/g, "'")
            .replace(/â€œ|â€/g, '"')
            .replace(/â€¦/g, '...')
            .replace(/â€¢/g, '-')
            .replace(/\s+/g, ' ')
            .trim();
    }

    if (topSkipped.length === 0) {
        container.innerHTML = `<span style="color:var(--text-color);opacity:0.7;">${chrome.i18n.getMessage('analytics_no_skipped_channel_data')}</span>`;
    } else {
        container.innerHTML = topSkipped.map(ch => {
            let channelUrl = '';
            if (ch.channelId) {
                if (ch.channelId.startsWith('UC')) {
                    channelUrl = `https://www.youtube.com/channel/${ch.channelId}`;
                } else if (ch.channelId.startsWith('@')) {
                    channelUrl = `https://www.youtube.com/${ch.channelId}`;
                }
            }
            const channelName = sanitizeText(ch.channel);
            const link = channelUrl ? `<a href="${channelUrl}" target="_blank" style="font-weight:500; color:var(--button-bg); text-decoration:none;">${channelName}</a>` : `<span style="font-weight:500; color:var(--button-bg);">${channelName}</span>`;
            return `<div style="margin-bottom:8px;">${link} <span style="color:var(--text-color); opacity:0.8;">- ${chrome.i18n.getMessage('analytics_skipped_count', [ch.count])}</span></div>`;
        }).join('');
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
    legendDiv.innerHTML = legendHtml;
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
