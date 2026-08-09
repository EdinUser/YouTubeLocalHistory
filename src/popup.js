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
    const subsContainer = document.getElementById('ytvhtSubscriptionsContainer');
    if (subsContainer) subsContainer.style.display = 'none';
    const watchlaterContainer = document.getElementById('ytvhtWatchlaterContainer');
    if (watchlaterContainer) watchlaterContainer.style.display = 'none';

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
        } else if (tab === 'videos') {
            // Display videos when switching to videos tab
            displayHistoryPage();
        } else if (tab === 'playlists') {
            // Load playlists when switching to playlists tab
            if (allPlaylists.length === 0) {
                loadPlaylistsPage({ page: currentPlaylistPage });
            }
            displayPlaylistsPage();
        } else if (tab === 'shorts') {
            // Display shorts when switching to shorts tab
            displayShortsPage();
        } else if (tab === 'subscriptions') {
            // Display local subscriptions
            displaySubscriptionsPage();
        } else if (tab === 'watchlater') {
            // Display local Watch Later list
            displayWatchLaterPage();
        }
    }
}

/**
 * Saves the currently opened extension tab (e.g., "videos", "shorts", "playlists", "settings") in localStorage.
 * @param {string} tabName - The name of the tab to save.
 */
// Initialize
document.addEventListener('DOMContentLoaded', async function () {
    try {
        log('Starting initialization...');

        // Load settings first
        const settings = await loadSettings();
        debugEnabled = settings.debug || false;
        applyPopupAccent(settings.accentColor || settings.overlayColor || 'blue');
        await applyTheme(settings.themePreference);

        // Update page size variables from settings
        pageSize = settings.paginationCount || 20;
        shortsPageSize = settings.paginationCount || 20;
        playlistPageSize = settings.paginationCount || 20;

        log('Initial settings:', settings);
        log('Page sizes set to:', { pageSize, shortsPageSize, playlistPageSize });

        // Function to handle theme changes
        async function handleThemeChange() {
            log('Theme change detected, re-applying theme...');
            const currentSettings = await loadSettings();
            await applyTheme(currentSettings.themePreference);
            applyPopupAccent(currentSettings.accentColor || currentSettings.overlayColor || 'blue');
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

        // Keep the theme in sync after settings UI/storage initialization.
        await applyTheme(settings.themePreference);
        applyPopupAccent(settings.accentColor || settings.overlayColor || 'blue');

        if (chrome.storage && chrome.storage.onChanged) {
            chrome.storage.onChanged.addListener((changes, area) => {
                if (area !== 'local' || !changes.settings || !changes.settings.newValue) return;
                const updated = changes.settings.newValue;
                applyPopupAccent(updated.accentColor || updated.overlayColor || 'blue');
            });
        }

        // Set up theme toggle button
        const themeToggle = document.getElementById('ytvhtToggleTheme');
        if (themeToggle) {
            themeToggle.addEventListener('click', toggleTheme);
            updateThemeToggleText(settings.themePreference);
        }

        // Initialize settings tab
        initSettingsTab();

        // Load search history
        await loadSearchHistory();

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
        const importSubscriptionsButton = document.getElementById('ytvhtImportSubscriptions');
        const closeButton = document.getElementById('ytvhtClosePopup');
        const firstPageBtn = document.getElementById('ytvhtFirstPage');
        const prevPageBtn = document.getElementById('ytvhtPrevPage');
        const nextPageBtn = document.getElementById('ytvhtNextPage');
        const lastPageBtn = document.getElementById('ytvhtLastPage');
        const videosTab = document.getElementById('ytvhtTabVideos');
        const shortsTab = document.getElementById('ytvhtTabShorts');
        const playlistsTab = document.getElementById('ytvhtTabPlaylists');
        const analyticsTab = document.getElementById('ytvhtTabAnalytics');
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
            ['ytvhtImportSubscriptions', importSubscriptionsButton],
            ['ytvhtClosePopup', closeButton],
            ['ytvhtFirstPage', firstPageBtn],
            ['ytvhtPrevPage', prevPageBtn],
            ['ytvhtNextPage', nextPageBtn],
            ['ytvhtLastPage', lastPageBtn],
            ['ytvhtTabVideos', videosTab],
            ['ytvhtTabPlaylists', playlistsTab],
            ['ytvhtTabAnalytics', analyticsTab],
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

        exportButton.addEventListener('click', exportHistory);

        // Import History (.html) and Import Subscriptions (.csv) open a dedicated
        // import tab. File pickers can't be used directly from the toolbar popup
        // because Firefox closes the popup when a file dialog opens.
        const openImportTab = () => {
            try {
                const runtime = (typeof browser !== 'undefined' && browser.runtime)
                    ? browser.runtime
                    : chrome.runtime;
                chrome.tabs.create({ url: runtime.getURL('feed.html') + '#settings' });
            } catch (e) {
                console.error('Could not open settings page:', e);
            }
        };
        if (importButton) importButton.addEventListener('click', openImportTab);
        if (importSubscriptionsButton) importSubscriptionsButton.addEventListener('click', openImportTab);
        closeButton.addEventListener('click', () => window.close());

        // Pagination controls
        firstPageBtn.addEventListener('click', goToFirstPage);
        prevPageBtn.addEventListener('click', goToPrevPage);
        nextPageBtn.addEventListener('click', goToNextPage);
        lastPageBtn.addEventListener('click', goToLastPage);

        let currentTab = getCurrentExtensionTab() || 'videos';
        if (!['videos', 'watchlater'].includes(currentTab)) {
            currentTab = 'videos'; // Default to videos if invalid
        }
        log('Current extension tab:', currentTab);
        switchTab(currentTab);
        // Tabs
        videosTab.addEventListener('click', () => {
            switchTab('videos');
            displayHistoryPage();
        });
        shortsTab.addEventListener('click', () => {
            switchTab('shorts');
            displayShortsPage();
        });
        playlistsTab.addEventListener('click', () => {
            switchTab('playlists');
            // Load playlists if not already loaded
            if (allPlaylists.length === 0) {
                loadPlaylistsPage({ page: currentPlaylistPage });
            }
            displayPlaylistsPage();
        });
        const subscriptionsTab = document.getElementById('ytvhtTabSubscriptions');
        if (subscriptionsTab) {
            subscriptionsTab.addEventListener('click', () => {
                switchTab('subscriptions');
                displaySubscriptionsPage();
            });
        }
        const watchlaterTab = document.getElementById('ytvhtTabWatchlater');
        if (watchlaterTab) {
            watchlaterTab.addEventListener('click', () => {
                switchTab('watchlater');
                displayWatchLaterPage();
            });
        }
        const clearWatchlaterBtn = document.getElementById('ytvhtClearWatchlater');
        if (clearWatchlaterBtn) {
            clearWatchlaterBtn.addEventListener('click', async () => {
                if (!confirm(chrome.i18n.getMessage('watchlater_confirm_clear') || 'Clear all Watch Later items?')) return;
                try {
                    const items = await ytStorage.getAllWatchLater();
                    await Promise.all(Object.keys(items).map((id) => ytStorage.removeWatchLater(id)));
                    await displayWatchLaterPage();
                } catch (e) {
                    console.error('Error clearing watch later:', e);
                }
            });
        }
        const openFeedBtn = document.getElementById('ytvhtOpenFeed');
        if (openFeedBtn) {
            openFeedBtn.addEventListener('click', () => {
                try {
                    chrome.tabs.create({ url: chrome.runtime.getURL('feed.html') });
                } catch (e) {
                    console.error('Could not open feed page:', e);
                }
            });
        }
        const clearSubsBtn = document.getElementById('ytvhtClearSubs');
        if (clearSubsBtn) {
            clearSubsBtn.addEventListener('click', async () => {
                if (!confirm('Remove ALL local subscriptions? This cannot be undone.')) return;
                try {
                    const subs = await ytStorage.getSubscriptionList();
                    for (const s of subs) {
                        await ytStorage.removeSubscription(s.id);
                    }
                    await ytStorage.setFeedCache({ updatedAt: Date.now(), videos: [], diagnostics: [] });
                    notifyYouTubeTabs({ type: 'ytvhtSubsChanged' });
                    await displaySubscriptionsPage();
                    showMessage('All local subscriptions cleared.');
                } catch (e) {
                    console.error('Error clearing subscriptions:', e);
                    showMessage('Error clearing subscriptions.', 'error');
                }
            });
        }
        analyticsTab.addEventListener('click', () => {
            switchTab('analytics');
            updateAnalytics();
        });
        // Initialize global search
        globalSearchInput = document.getElementById('ytvhtGlobalSearchInput');
        const searchClearBtn = document.getElementById('ytvhtSearchClear');

        if (globalSearchInput) {
            globalSearchInput.addEventListener('input', async (e) => {
                const query = e.target.value;
                console.log('[Search] Input event:', query);
                await smartSearch(query);

                // Toggle clear button visibility
                toggleClearButton(query.length > 0);
            });

            globalSearchInput.addEventListener('keydown', async (e) => {
                if (e.key === 'Enter') {
                    console.log('[Search] Enter pressed with:', e.target.value);
                    await showFullSearchResults(e.target.value);
                } else if (e.key === 'Escape') {
                    // Clear search and suggestions
                    e.target.value = '';
                    searchQuery = '';
                    toggleClearButton(false);
                    hideSearchSuggestions();
                    await loadCurrentPages();
                }
            });

            // Add click outside to close suggestions
            document.addEventListener('click', (e) => {
                const searchContainer = document.querySelector('.global-search-container');
                const suggestions = document.getElementById('ytvhtSearchSuggestions');

                if (searchContainer && suggestions &&
                    !searchContainer.contains(e.target) &&
                    suggestions.style.display !== 'none') {
                    hideSearchSuggestions();
                }
            });
        } else {
            console.error('Global search input not found');
        }

        // Clear button functionality
        if (searchClearBtn) {
            searchClearBtn.addEventListener('click', async () => {
                if (globalSearchInput) {
                    globalSearchInput.value = '';
                    globalSearchInput.focus();
                    searchQuery = '';
                    toggleClearButton(false);
                    hideSearchSuggestions();
                    await loadCurrentPages();
                }
            });
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
        await loadCurrentPages();

        // Pre-render all first pages immediately for instant tab switching
        displayHistoryPage();
        displayShortsPage();
        displayPlaylistsPage();

        // Playlists are already loaded by loadCurrentPages() above
        // Analytics can access allPlaylists (current page) or load more if needed

        // Enable progressive content loading
        progressiveContentLoading();

        // Set up responsive table handling
        setupResponsiveTables();

        log('Initialization complete');
    } catch (error) {
        console.error('Error during initialization:', error);
        showMessage(chrome.i18n.getMessage('message_failed_to_initialize', [error.message || chrome.i18n.getMessage('message_unknown_error')]), 'error');
    }
});
