// Render the popup's compact "continue watching" list.
function displayHistoryPage() {
    console.log('[Display] displayHistoryPage called, allHistoryRecords length:', allHistoryRecords.length);

    const historyTable = document.getElementById('ytvhtHistoryTable');
    const noHistory = document.getElementById('ytvhtNoHistory');
    const paginationDiv = document.getElementById('ytvhtPagination');

    // The compact popup is for quickly resuming unfinished regular videos.
    const pageRecords = allHistoryRecords.filter((record) => {
        const time = Number(record.time || 0);
        const duration = Number(record.duration || 0);
        return time > 0 && duration > 0 && time / duration < 0.9;
    });

    adjustContentDensity(pageRecords);

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
            const cell = document.createElement('td');
            row.appendChild(cell);
            historyTable.appendChild(row);
        }

        const cell = row.cells[0];
        cell.className = 'video-cell';

        if (!cell.querySelector('.video-thumbnail')) {
            cell.innerHTML = '';
            const thumbWrap = document.createElement('div');
            thumbWrap.className = 'video-thumbnail-wrap';
            const img = document.createElement('img');
            img.className = 'video-thumbnail';
            img.alt = 'Video thumbnail';
            thumbWrap.appendChild(img);
            const progressTrack = document.createElement('div');
            progressTrack.className = 'video-progress-track';
            const progressFill = document.createElement('span');
            progressFill.className = 'video-progress-fill';
            progressTrack.appendChild(progressFill);
            thumbWrap.appendChild(progressTrack);
            cell.appendChild(thumbWrap);
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
            deleteButton.textContent = '🗑';
            deleteButton.title = chrome.i18n.getMessage('delete_label') || 'Delete';
            deleteButton.setAttribute('aria-label', deleteButton.title);
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
        const progressFill = cell.querySelector('.video-progress-fill');

        thumbnail.src = `https://i.ytimg.com/vi/${record.videoId}/mqdefault.jpg`;
        thumbnail.alt = record.title || 'Video thumbnail';

        // Add timestamp to URL if video has saved progress
        link.href = (record.time && record.time > 0) 
            ? addTimestampToUrl(record.url, record.time)
            : record.url;
        link.textContent = record.title || 'Unknown Title';

        progress.textContent = formatProgress(record.time, record.duration);
        progressFill.style.width = `${Math.max(0, Math.min(100,
            (Number(record.time || 0) / Number(record.duration || 1)) * 100))}%`;
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

// Expose key helpers on window for testing and potential reuse
window.addTimestampToUrl = addTimestampToUrl;
window.exportHistory = exportHistory;
window.openImportPage = openImportPage;
