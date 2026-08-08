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
            updateAnalytics();
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

