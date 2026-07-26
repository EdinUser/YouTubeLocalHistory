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

// Render the popup's Shorts history page.
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
        const baseUrl = record.url || `https://www.youtube.com/shorts/${record.videoId}`;
        link.href = (record.time && record.time > 0) 
            ? addTimestampToUrl(baseUrl, record.time)
            : baseUrl;
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
