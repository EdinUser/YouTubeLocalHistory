// Smart search functionality
let searchQuery = '';
let globalSearchInput = null; // Will be set in DOMContentLoaded

// Search history system
let searchHistory = {}; // {query: frequency}
let searchTimeout = null;
const SEARCH_DEBOUNCE_DELAY = 1000; // 1 second

function recordSearch(query) {
    if (!query || query.trim().length <= 3) return; // Don't save searches 3 characters or shorter

    const trimmed = query.trim().toLowerCase();
    searchHistory[trimmed] = (searchHistory[trimmed] || 0) + 1;

    // Keep only top 100 searches to prevent memory issues
    const entries = Object.entries(searchHistory);
    if (entries.length > 100) {
        // Sort by frequency and keep top 100
        entries.sort((a, b) => b[1] - a[1]);
        searchHistory = Object.fromEntries(entries.slice(0, 100));
    }

    // Save to storage
    try {
        chrome.storage.local.set({ 'ytvht_search_history': searchHistory }, () => {
            if (chrome.runtime.lastError) {
                if (chrome.runtime.lastError.message.includes('Extension context invalidated')) {
                    console.log('[Search] Extension context invalidated during search history save');
                } else {
                    console.warn('[Search] Failed to save search history:', chrome.runtime.lastError);
                }
            }
        });
    } catch (e) {
        if (e.message && e.message.includes('Extension context invalidated')) {
            console.log('[Search] Extension context invalidated during search history save');
        } else {
            console.warn('[Search] Failed to save search history:', e);
        }
    }
}

function getTopSearches(limit = 5) {
    return Object.entries(searchHistory)
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([query]) => query);
}

function getAllSearches() {
    return Object.keys(searchHistory);
}

// Load search history on initialization
async function loadSearchHistory() {
    try {
        const result = await chrome.storage.local.get(['ytvht_search_history']).catch(error => {
            if (error.message && error.message.includes('Extension context invalidated')) {
                console.log('[Search] Extension context invalidated during search history load');
                return {};
            }
            throw error;
        });
        searchHistory = result.ytvht_search_history || {};
    } catch (e) {
        if (e.message && e.message.includes('Extension context invalidated')) {
            console.log('[Search] Extension context invalidated during search history load');
            searchHistory = {};
        } else {
            console.warn('[Search] Failed to load search history:', e);
            searchHistory = {};
        }
    }
}

// Toggle clear button visibility
function toggleClearButton(show) {
    const searchClearBtn = document.getElementById('ytvhtSearchClear');
    if (searchClearBtn) {
        searchClearBtn.style.display = show ? 'flex' : 'none';
    }
}

// Hide search suggestions
function hideSearchSuggestions() {
    const suggestions = document.getElementById('ytvhtSearchSuggestions');
    if (suggestions) {
        suggestions.style.display = 'none';
    }
}

// Smart search suggestions and filtering
async function smartSearch(query) {
    const trimmedQuery = query.trim();
    console.log('[Search] smartSearch called with:', query, 'trimmed:', trimmedQuery);

    // Clear existing timeout
    if (searchTimeout) {
        clearTimeout(searchTimeout);
    }

    if (trimmedQuery.length === 0) {
        console.log('[Search] Showing recent searches');
        return showRecentSearches();
    } else if (trimmedQuery.length < 3) {
        console.log('[Search] Showing autocomplete suggestions');
        return showAutocompleteSuggestions(trimmedQuery);
    } else {
        // For 3+ characters, show full search and schedule recording
        console.log('[Search] Showing full search results and scheduling recording');
        searchTimeout = setTimeout(() => recordSearch(trimmedQuery), SEARCH_DEBOUNCE_DELAY);
        return await showFullSearchResults(trimmedQuery);
    }
}

function showRecentSearches() {
    const recentContainer = document.getElementById('ytvhtSearchSuggestions') ||
                           createSearchSuggestionsContainer();

    const topSearches = getTopSearches(5);

    // Clear existing content
    recentContainer.innerHTML = '';

    // Create search section
    const searchSection = document.createElement('div');
    searchSection.className = 'search-section';

    // Create header
    const header = document.createElement('h4');
    header.textContent = 'Recent Searches';
    searchSection.appendChild(header);

    // Create suggestion items
    topSearches.forEach(search => {
        const item = document.createElement('div');
        item.className = 'suggestion-item recent-search-item';
        item.setAttribute('data-search', search);

        const textContainer = document.createElement('div');
        textContainer.className = 'suggestion-text';

        const title = document.createElement('div');
        title.className = 'suggestion-title';
        title.textContent = search;

        textContainer.appendChild(title);
        item.appendChild(textContainer);
        searchSection.appendChild(item);
    });

    recentContainer.appendChild(searchSection);

    // Add event listeners to avoid CSP issues
    recentContainer.querySelectorAll('.recent-search-item').forEach(item => {
        item.addEventListener('click', function() {
            const searchQuery = this.getAttribute('data-search');
            applyRecentSearch(searchQuery);
        });
    });

    recentContainer.style.display = 'block';
}

function showAutocompleteSuggestions(query) {
    const suggestionsContainer = document.getElementById('ytvhtSearchSuggestions') ||
                                createSearchSuggestionsContainer();

    const allSearches = getAllSearches();
    const matchingSearches = allSearches
        .filter(search => search.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 8); // Limit to 8 suggestions

    // Clear existing content
    suggestionsContainer.innerHTML = '';

    // Create search section
    const searchSection = document.createElement('div');
    searchSection.className = 'search-section';

    // Create header
    const header = document.createElement('h4');
    header.textContent = 'Search Suggestions';
    searchSection.appendChild(header);

    // Create suggestion items
    matchingSearches.forEach(search => {
        const item = document.createElement('div');
        item.className = 'suggestion-item autocomplete-item';
        item.setAttribute('data-search', search);

        // Add click event listener
        item.addEventListener('click', function() {
            const searchQuery = this.getAttribute('data-search');
            applyRecentSearch(searchQuery);
        });

        const textContainer = document.createElement('div');
        textContainer.className = 'suggestion-text';

        const title = document.createElement('div');
        title.className = 'suggestion-title';
        title.textContent = search;

        textContainer.appendChild(title);
        item.appendChild(textContainer);
        searchSection.appendChild(item);
    });

    suggestionsContainer.appendChild(searchSection);
    suggestionsContainer.style.display = 'block';
}

function applyRecentSearch(searchQuery) {
    if (globalSearchInput) {
        globalSearchInput.value = searchQuery;
        showFullSearchResults(searchQuery);
    }
}


async function showFullSearchResults(query) {
    console.log('[Search] showFullSearchResults called with:', query);

    // Hide suggestions and proceed with normal search
    const suggestionsContainer = document.getElementById('ytvhtSearchSuggestions');
    if (suggestionsContainer) {
        suggestionsContainer.style.display = 'none';
    }

    // Proceed with normal search flow
    searchQuery = query.toLowerCase();
    currentPage = 1;
    currentShortsPage = 1;
    currentPlaylistPage = 1;

    console.log('[Search] Set searchQuery to:', searchQuery);

    // Load filtered data for all tabs
    await loadCurrentPages();
    console.log('[Search] loadCurrentPages completed');

    // Explicitly refresh the current tab's display
    const activeTab = document.querySelector('.tab-bar .tab.active');
    console.log('[Search] Active tab element:', activeTab);

    if (activeTab) {
        const tabName = activeTab.id.replace('ytvhtTab', '').toLowerCase();
        console.log('[Search] Active tab name:', tabName);

        switch (tabName) {
            case 'videos':
                console.log('[Search] Calling displayHistoryPage');
                displayHistoryPage();
                break;
            case 'shorts':
                console.log('[Search] Calling displayShortsPage');
                displayShortsPage();
                break;
            case 'playlists':
                console.log('[Search] Calling displayPlaylistsPage');
                displayPlaylistsPage();
                break;
        }
    } else {
        console.log('[Search] No active tab found!');
    }
}

function createSearchSuggestionsContainer() {
    const container = document.createElement('div');
    container.id = 'ytvhtSearchSuggestions';
    container.className = 'search-suggestions';

    // Insert after the global search input
    const globalSearchContainer = document.querySelector('.global-search-container');
    if (globalSearchContainer) {
        globalSearchContainer.appendChild(container);
    }

    return container;
}


// Quick actions for suggestions
function quickSelectVideo(videoId) {
    // Find and highlight the video in current view
    const videoElement = document.querySelector(`[data-video-id="${videoId}"]`);
    if (videoElement) {
        videoElement.scrollIntoView({ behavior: 'smooth' });
        videoElement.style.backgroundColor = 'var(--button-bg)';
        setTimeout(() => {
            videoElement.style.backgroundColor = '';
        }, 2000);
    }

    // Hide suggestions
    const suggestions = document.getElementById('ytvhtSearchSuggestions');
    if (suggestions) {
        suggestions.style.display = 'none';
    }
}


