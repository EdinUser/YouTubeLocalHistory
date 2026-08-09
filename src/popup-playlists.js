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
            const parser = new DOMParser();
            const svgDoc = parser.parseFromString(`<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z"/><circle cx="20" cy="7" r="2"/><circle cx="20" cy="12" r="2"/><circle cx="20" cy="17" r="2"/></svg>`, 'image/svg+xml');
            const svgElement = svgDoc.documentElement;
            iconDiv.appendChild(svgElement);
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

