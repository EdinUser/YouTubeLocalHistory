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
        totalPages = Math.max(1, result.pagination.totalPages || 0);
        totalHistoryRecords = result.pagination.totalRecords;

        log(`Loaded page ${currentPage}/${totalPages} with ${result.records.length} records (total: ${totalHistoryRecords})`);

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
async function loadCurrentPages(options = {}) {
    try {
        const { renderActive = true } = options;
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

        if (!renderActive) return { videosResult, shortsResult, playlistsResult };

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

// Filter records based on search query
function filterRecords(records) {
    if (!searchQuery) return records;
    return records.filter(record =>
        record.title?.toLowerCase().includes(searchQuery)
    );
}
