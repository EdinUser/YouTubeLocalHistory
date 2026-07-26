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
    // Clear existing content
    container.innerHTML = '';

    // Create empty state container
    const emptyStateDiv = document.createElement('div');
    emptyStateDiv.className = 'empty-state';

    // Create icon (SVG content is trusted and hardcoded)
    const iconDiv = document.createElement('div');
    iconDiv.className = 'empty-state-icon';
    if (emptyState.icon) {
        const parser = new DOMParser();
        const svgDoc = parser.parseFromString(emptyState.icon, 'image/svg+xml');
        const svgElement = svgDoc.documentElement;
        iconDiv.appendChild(svgElement);
    }
    emptyStateDiv.appendChild(iconDiv);

    // Create title
    const title = document.createElement('h3');
    title.className = 'empty-title';
    title.textContent = emptyState.title;
    emptyStateDiv.appendChild(title);

    // Create subtitle
    const subtitle = document.createElement('p');
    subtitle.className = 'empty-subtitle';
    subtitle.textContent = emptyState.subtitle;
    emptyStateDiv.appendChild(subtitle);

    // Create action button if needed
    if (emptyState.action) {
        const actionBtn = document.createElement('button');
        actionBtn.className = 'empty-action-btn';
        actionBtn.setAttribute('data-empty-action', 'true');
        actionBtn.textContent = emptyState.action;

        if (emptyState.actionCallback) {
            actionBtn.addEventListener('click', emptyState.actionCallback);
        }

        emptyStateDiv.appendChild(actionBtn);
    }

    container.appendChild(emptyStateDiv);
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

