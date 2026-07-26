// ----- wiring ------------------------------------------------------------
function onStorageChanged(changes, area) {
    if (area && area !== 'local') return;
    if (changes && changes.feedCache) {
        const v = changes.feedCache.newValue;
        allVideos = (v && Array.isArray(v.videos)) ? v.videos : [];
        lastUpdated = (v && v.updatedAt) || Date.now();
        feedCachePolicy = (v && v.policy) || '';
        setStatus('Feed updated.', false);
        // Don't pop the feed grid over the analytics view if it's open.
        if (channelActive && activeChannelInfo) renderChannelPage(activeChannelInfo);
        else if (!analyticsActive && !subscriptionsActive && !playlistsActive && !historyActive && !settingsActive) render();
    }
    if (changes && changes.durationCache) {
        durationCache = changes.durationCache.newValue || {};
        if (!analyticsActive && !subscriptionsActive && !playlistsActive && !historyActive && !settingsActive) render();
    }
    if (changes && changes.shortsCache) {
        shortsCache = changes.shortsCache.newValue || {};
        if (!analyticsActive && !subscriptionsActive && !playlistsActive && !historyActive && !settingsActive) render();
    }
    if (subscriptionsActive && changes && Object.keys(changes).some((key) => key.startsWith('sub_'))) {
        renderSubscriptions();
    }
    if (playlistsActive && !activePlaylistDetailId &&
        changes && Object.keys(changes).some((key) => key.startsWith('playlist_'))) {
        renderPlaylists();
    }
    if (historyActive && changes && Object.keys(changes).some((key) => key.startsWith('video_'))) {
        renderHistory();
    }
}

function openFeedView(view) {
    if (view === 'settings') showSettings();
    else if (view === 'history') showHistory();
    else if (view === 'playlists') showPlaylists();
    else if (view === 'channels') showSubscriptions();
    else if (view === 'analytics') showAnalytics();
    else if (view === 'shorts') {
        shortsOnly = true;
        subscriptionsChronological = false;
        showFeed();
    } else if (view === 'subscriptions') {
        shortsOnly = false;
        subscriptionsChronological = true;
        showFeed();
    } else {
        shortsOnly = false;
        subscriptionsChronological = false;
        showFeed();
    }
}

async function getStartupFeedView() {
    let defaultPage = 'last';
    try {
        const settings = (await ytStorage.getSettings()) || {};
        defaultPage = settings.defaultFeedPage || 'last';
    } catch (_) { /* use last/home fallback */ }
    if (defaultPage && defaultPage !== 'last') return defaultPage;
    try {
        const last = sessionStorage.getItem(LAST_VIEW_KEY) || 'home';
        return last === 'settings' ? 'home' : last;
    } catch (_) { return 'home'; }
}

function init() {
    const searchInput = document.getElementById('search');
    searchInput.addEventListener('input', () => {
        searchVisibleLimit = SEARCH_PAGE_SIZE;
        youtubeVisibleLimit = SEARCH_PAGE_SIZE;
        // Typing in search means the user wants the feed, not another section.
        if (analyticsActive || subscriptionsActive || playlistsActive || historyActive || settingsActive || channelActive) showFeed();
        else render();
        const query = searchInput.value.trim();
        if (query.length >= 2) enrichSearchChannelAvatars(query);
        scheduleYouTubeSearch(query);
    });
    ['searchDate', 'searchDuration', 'searchWatched', 'searchSort'].forEach((id) => {
        const control = document.getElementById(id);
        if (!control) return;
        control.addEventListener('change', () => {
            searchVisibleLimit = SEARCH_PAGE_SIZE;
            youtubeVisibleLimit = SEARCH_PAGE_SIZE;
            updateSearchFilterButton();
            render();
        });
    });
    const filterToggle = document.getElementById('searchFilterToggle');
    if (filterToggle) {
        filterToggle.addEventListener('click', () => {
            searchFiltersOpen = !searchFiltersOpen;
            updateSearchFilterButton();
            render();
        });
    }
    const channelBack = document.getElementById('channelBack');
    if (channelBack) {
        channelBack.addEventListener('click', () => {
            hideChannelPage();
            showFeed();
        });
    }

    // Clicking the brand or "Home" acts like the YouTube logo: clear search,
    // leave Shorts/Analytics, and return to the plain feed.
    const goHome = () => {
        searchInput.value = '';
        searchVisibleLimit = SEARCH_PAGE_SIZE;
        youtubeVisibleLimit = SEARCH_PAGE_SIZE;
        cancelYouTubeSearch();
        shortsOnly = false;
        subscriptionsChronological = false;
        channelActive = false;
        reshuffleHome();
        showFeed();
        searchInput.blur();
    };
    const brandHome = document.getElementById('brandHome');
    if (brandHome) {
        brandHome.addEventListener('click', goHome);
        brandHome.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goHome(); }
        });
    }
    const navHome = document.getElementById('navHome');
    if (navHome) navHome.addEventListener('click', goHome);

    // "Shorts" sidebar item: show only Shorts.
    const navShorts = document.getElementById('navShorts');
    if (navShorts) {
        navShorts.addEventListener('click', () => {
            searchInput.value = '';
            searchVisibleLimit = SEARCH_PAGE_SIZE;
            youtubeVisibleLimit = SEARCH_PAGE_SIZE;
            cancelYouTubeSearch();
            shortsOnly = true;
            subscriptionsChronological = false;
            showFeed();
        });
    }
    const navSubscriptions = document.getElementById('navSubscriptions');
    if (navSubscriptions) {
        navSubscriptions.addEventListener('click', () => {
            searchInput.value = '';
            searchVisibleLimit = SEARCH_PAGE_SIZE;
            youtubeVisibleLimit = SEARCH_PAGE_SIZE;
            cancelYouTubeSearch();
            shortsOnly = false;
            subscriptionsChronological = true;
            showFeed();
        });
    }
    const navPlaylists = document.getElementById('navPlaylists');
    if (navPlaylists) navPlaylists.addEventListener('click', () => {
        searchInput.value = '';
        cancelYouTubeSearch();
        showPlaylists();
    });
    const navHistory = document.getElementById('navHistory');
    if (navHistory) navHistory.addEventListener('click', () => {
        searchInput.value = '';
        cancelYouTubeSearch();
        historyVisibleLimit = 30;
        showHistory();
    });

    // Hamburger collapses/expands the sidebar.
    const menuToggle = document.getElementById('menuToggle');
    if (menuToggle) {
        menuToggle.addEventListener('click', () => {
            document.body.classList.toggle('sidebar-collapsed');
        });
    }

    // ⋮ options menu (holds the Unwatched / Hide Shorts toggles).
    const hideMembers = document.getElementById('hideMembers');
    if (hideMembers) {
        hideMembers.checked = localStorage.getItem('ytvhtHideMembers') !== 'false';
    }

    const optionsToggle = document.getElementById('optionsToggle');
    const optionsMenu = document.getElementById('optionsMenu');
    if (optionsToggle && optionsMenu) {
        optionsToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            optionsMenu.hidden = !optionsMenu.hidden;
        });
        // Close when clicking outside (but not when toggling a checkbox inside).
        document.addEventListener('click', (e) => {
            if (!optionsMenu.hidden && !optionsMenu.contains(e.target) && e.target !== optionsToggle) {
                optionsMenu.hidden = true;
            }
            if (!e.target.closest('.video-menu-wrap')) {
                document.querySelectorAll('.video-menu').forEach((menu) => { menu.hidden = true; });
                document.querySelectorAll('.ytvht-feed-card.video-menu-open').forEach((card) => {
                    card.classList.remove('video-menu-open');
                });
            }
        });
    }

    const analyticsToggle = document.getElementById('analyticsToggle');
    if (analyticsToggle) {
        analyticsToggle.addEventListener('click', () => {
            searchInput.value = '';
            cancelYouTubeSearch();
            if (analyticsActive) { showFeed(); } else { showAnalytics(); }
        });
    }
    const navSettings = document.getElementById('navSettings');
    if (navSettings) {
        navSettings.addEventListener('click', () => {
            searchInput.value = '';
            cancelYouTubeSearch();
            showSettings();
        });
    }
    document.getElementById('historyLoadMore')?.addEventListener('click', () => {
        historyVisibleLimit += 30;
        renderHistory();
    });
    document.getElementById('clearHistoryPage')?.addEventListener('click', async () => {
        if (!confirm('Are you sure you want to clear all local watch history? This cannot be undone.')) return;
        const button = document.getElementById('clearHistoryPage');
        button.disabled = true;
        try {
            const videos = await ytStorage.getAllVideos();
            await Promise.all(Object.keys(videos || {}).map((videoId) => ytStorage.removeVideo(videoId)));
            watchedMap = {};
            historyVisibleLimit = 30;
            await renderHistory();
        } catch (error) {
            console.error('[history] clear failed', error);
        } finally {
            button.disabled = false;
        }
    });
    const saveCurrentFeedSettings = (context) => {
        saveFeedSettings().catch((error) => {
            console.error(`[settings] ${context} save failed`, error);
            document.getElementById('feedSettingsMessage').textContent = 'Could not save settings.';
        });
    };
    document.getElementById('feedSettingTheme')?.addEventListener('change', (event) => {
        applyFeedTheme(event.target.value);
        saveCurrentFeedSettings('theme');
    });
    document.getElementById('feedSettingAccent')?.addEventListener('change', (event) => {
        applyAccentColor(event.target.value);
        saveCurrentFeedSettings('color');
    });
    document.getElementById('feedSettingDefaultPage')?.addEventListener('change', () => {
        saveCurrentFeedSettings('default page');
    });
    document.getElementById('feedSettingRefresh')?.addEventListener('change', () => {
        saveCurrentFeedSettings('refresh interval');
    });
    document.getElementById('feedSettingAutoClean')?.addEventListener('change', () => {
        saveCurrentFeedSettings('history cleanup');
    });
    initFeedDataSettings();
    document.getElementById('unwatched').addEventListener('change', render);
    hideMembers?.addEventListener('change', () => {
        localStorage.setItem('ytvhtHideMembers', hideMembers.checked ? 'true' : 'false');
        render();
    });
    document.getElementById('refresh').addEventListener('click', refresh);
    document.getElementById('manage').addEventListener('click', showSubscriptions);

    const clearSubscriptions = document.getElementById('clearSubscriptions');
    if (clearSubscriptions) {
        clearSubscriptions.addEventListener('click', async () => {
            const subscriptions = await ytStorage.getSubscriptionList();
            if (!subscriptions.length) return;
            if (!confirm(`Are you sure you want to remove all ${subscriptions.length} local subscriptions?`)) return;

            clearSubscriptions.disabled = true;
            try {
                await ytStorage.clearSubscriptions();
                await ytStorage.setFeedCache({ updatedAt: Date.now(), videos: [], diagnostics: [] });
                await renderSubscriptions();
                setStatus('All local subscriptions removed.', false);
            } catch (error) {
                console.error('[subscriptions] clear failed', error);
            } finally {
                clearSubscriptions.disabled = false;
            }
        });
    }

    try {
        if (chrome.storage && chrome.storage.onChanged) {
            chrome.storage.onChanged.addListener(onStorageChanged);
        }
    } catch (_) { /* ignore */ }

    loadData().then(async () => {
        const hashView = (location.hash || '').replace(/^#/, '').trim();
        const startupView = hashView === 'settings' ? 'settings' : await getStartupFeedView();
        openFeedView(startupView);
        maybeAutoRefresh();
    }).catch((error) => {
        console.error('[feed] startup failed', error);
        showFeed();
    }).finally(() => {
        document.documentElement.classList.remove('app-loading');
    });
}

// Refresh on open when the cache is empty or stale, so the page works
// without anyone clicking Refresh (and without a YouTube tab).
async function maybeAutoRefresh() {
    if (typeof feedRefreshIsSuppressed === 'function' && feedRefreshIsSuppressed()) return;
    let subs = [];
    try { subs = await ytStorage.getSubscriptionList(); } catch (_) { /* ignore */ }
    if (!subs.length) return;
    const stale = !lastUpdated || (Date.now() - lastUpdated) > 30 * 60 * 1000;
    if (allVideos.length === 0 || stale) {
        refresh();
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
