// ----- wiring ------------------------------------------------------------
const INITIALIZATION_CONTINUATION_DELAY_MS = 350;
const DORMANT_MAINTENANCE_WAKE_DELAY_MS = 1000;
let pageFeedWorkTimer = null;
let pageFeedWorkPromise = null;
let sharedFeedSchedulerStarted = false;
let activeInitializationProgress = null;
let latestPageSyncStatus = { message: '', busy: false };

function isFeedContentViewActive() {
    return !analyticsActive && !subscriptionsActive && !playlistsActive &&
        !historyActive && !settingsActive && !channelActive;
}

function clearPageFeedWorkTimer() {
    if (pageFeedWorkTimer !== null) clearTimeout(pageFeedWorkTimer);
    pageFeedWorkTimer = null;
}

function schedulePageFeedWork(delayMs) {
    clearPageFeedWorkTimer();
    pageFeedWorkTimer = setTimeout(() => {
        pageFeedWorkTimer = null;
        runPageActiveFeedWork().catch((error) => {
            console.warn('[feed] scheduled feed work failed', error && error.message);
        });
    }, Math.max(0, Number(delayMs || 0)));
}

async function feedRefreshIntervalMs() {
    const settings = (await ytStorage.getSettings()) || {};
    const minutes = Math.max(5, Math.min(1440, Number(settings.feedRefreshMinutes || 60)));
    return minutes * 60 * 1000;
}

function setPageActiveSyncStatus(message, busy) {
    latestPageSyncStatus = { message: message || '', busy: !!busy };
    if (typeof setFeedSyncStatus !== 'function') return;
    setFeedSyncStatus(isFeedContentViewActive() ? message : '', busy);
}

function restorePageActiveSyncStatus() {
    if (typeof setFeedSyncStatus !== 'function') return;
    setFeedSyncStatus(latestPageSyncStatus.message, latestPageSyncStatus.busy);
}

async function runPageActiveFeedWork() {
    if (pageFeedWorkPromise) return pageFeedWorkPromise;
    pageFeedWorkPromise = (async () => {
        const scheduler = ensureSharedFeedScheduler();
        if (!scheduler) throw new Error('Feed scheduler is unavailable');
        const intervalMs = await feedRefreshIntervalMs();
        scheduler.successfulCheckIntervalMs = intervalMs;
        if (!sharedFeedSchedulerStarted) {
            await scheduler.start();
            sharedFeedSchedulerStarted = true;
        }

        const before = await scheduler.getInitializationProgress();
        if (before.pending > 0) {
            activeInitializationProgress = { completed: before.completed, total: before.total };
            setPageActiveSyncStatus(`Preparing local feed · ${before.completed} / ${before.total} channels`, true);
            const result = await scheduler.runInitialization();
            const after = await scheduler.getInitializationProgress();
            activeInitializationProgress = null;
            // Keep the local projection current, but do not rerender an already
            // visible Home page: new inventory waits for Show/opening Home.
            await loadData();
            pendingFeedVideoCount += result.insertedVideoCount;
            if (result.insertedVideoCount) showNewFeedVideos(pendingFeedVideoCount);
            if (settingsActive && typeof setFeedSettingsMessage === 'function') {
                setFeedSettingsMessage(`Preparing local feed: ${after.completed} of ${after.total} channels scanned; ${after.pending} remaining.`);
            }
            if (after.pending > 0) {
                setPageActiveSyncStatus(`Preparing local feed · ${after.completed} / ${after.total} channels`, false);
                schedulePageFeedWork(INITIALIZATION_CONTINUATION_DELAY_MS);
            } else {
                setPageActiveSyncStatus('Local feed ready', false);
                schedulePageFeedWork(intervalMs);
            }
            return { result, progress: after };
        }

        setPageActiveSyncStatus('Checking for new uploads', true);
        const result = await scheduler.runForeground();
        await loadData();
        pendingFeedVideoCount += result.insertedVideoCount;
        if (result.insertedVideoCount) showNewFeedVideos(pendingFeedVideoCount);
        let dormant = null;
        if (result.total === 0) {
            setPageActiveSyncStatus('Checking a low-activity channel', true);
            dormant = await scheduler.runDormantMaintenance({ pageActive: true });
        }
        const dormantInserted = Number(dormant && dormant.terminal && dormant.terminal.insertedVideoCount || 0);
        if (dormantInserted) {
            await loadData();
            pendingFeedVideoCount += dormantInserted;
            showNewFeedVideos(pendingFeedVideoCount);
        }
        setPageActiveSyncStatus(result.insertedVideoCount || dormantInserted ? 'New uploads found' : 'Up to date', false);
        schedulePageFeedWork(dormant && dormant.ran ? DORMANT_MAINTENANCE_WAKE_DELAY_MS : intervalMs);
        return { result, progress: before };
    })().finally(() => {
        activeInitializationProgress = null;
        pageFeedWorkPromise = null;
    });
    return pageFeedWorkPromise;
}

function requestPageActiveFeedWork() {
    if (pageFeedWorkPromise) {
        return pageFeedWorkPromise.then(() => runPageActiveFeedWork());
    }
    return runPageActiveFeedWork();
}

function onStorageChanged(changes, area) {
    if (area && area !== 'local') return;
    if (changes && changes.durationCache) {
        durationCache = changes.durationCache.newValue || {};
        if (!analyticsActive && !subscriptionsActive && !playlistsActive && !historyActive && !settingsActive) render();
    }
    if (changes && changes.shortsCache) {
        shortsCache = changes.shortsCache.newValue || {};
        if (!analyticsActive && !subscriptionsActive && !playlistsActive && !historyActive && !settingsActive) render();
    }
    if (changes && changes.settings && pageFeedWorkTimer !== null) {
        feedRefreshIntervalMs().then(schedulePageFeedWork).catch(() => {});
    }
    const videoChanges = changes && Object.entries(changes).filter(([key]) => key.startsWith('video_'));
    if (videoChanges && videoChanges.length) {
        videoChanges.forEach(([key, change]) => {
            const videoId = key.slice('video_'.length);
            if (change.newValue) watchedMap[videoId] = change.newValue;
            else delete watchedMap[videoId];
            if (typeof refreshWatchedOverlayForVideo === 'function') refreshWatchedOverlayForVideo(videoId);
        });
        if (historyActive) renderHistory();
        else if (channelActive && activeChannelInfo) renderChannelPage(activeChannelInfo);
        else if (isFeedContentViewActive() && document.getElementById('unwatched')?.checked) render();
    }
    if (subscriptionsActive && changes && Object.keys(changes).some((key) => key.startsWith('sub_'))) {
        renderSubscriptions();
    }
    if (playlistsActive && !activePlaylistDetailId &&
        changes && Object.keys(changes).some((key) => key.startsWith('playlist_'))) {
        renderPlaylists();
    }
}

function initializationHistoryPriority() {
    const recent = new Set();
    const seen = new Set();
    const recentCutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const subscriptionsByIdentity = new Map();
    const identityValues = (record) => [record && record.channelId, record && record.ucid,
        record && record.id, record && record.handle, record && record.channelName]
        .map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);

    (localSubscriptions || []).forEach((subscription) => {
        const channelId = subscription.ucid || subscription.id || subscription.channelId;
        identityValues(subscription).forEach((identity) => subscriptionsByIdentity.set(identity, channelId));
    });
    Object.values(watchedMap || {}).forEach((record) => {
        const channelId = identityValues(record).map((identity) => subscriptionsByIdentity.get(identity)).find(Boolean);
        if (!channelId) return;
        seen.add(channelId);
        if (Number(record.timestamp || 0) >= recentCutoff) recent.add(channelId);
    });
    return { recentHistoryChannelIds: [...recent], historyChannelIds: [...seen] };
}

function ensureSharedFeedScheduler() {
    if (sharedFeedScheduler) return sharedFeedScheduler;
    if (typeof ytvhtFeedScheduler === 'undefined' || !ytIndexedDBStorage) return null;
    sharedFeedScheduler = new ytvhtFeedScheduler.FeedScheduler({
        storage: ytIndexedDBStorage,
        ...initializationHistoryPriority()
    });
    sharedFeedScheduler.subscribe((progress) => {
        if (!progress.active) return;
        if (activeInitializationProgress) {
            const completed = activeInitializationProgress.completed + progress.completed;
            setPageActiveSyncStatus(`Scanning channels · ${completed} / ${activeInitializationProgress.total}`, true);
        } else {
            setPageActiveSyncStatus(`Scanning channels · ${progress.completed} / ${progress.total}`, true);
        }
    });
    return sharedFeedScheduler;
}

async function startCanonicalFeedWork() {
    return requestPageActiveFeedWork();
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
        const stored = await chrome.storage.local.get([LAST_VIEW_STORAGE_KEY]);
        const last = stored[LAST_VIEW_STORAGE_KEY] || sessionStorage.getItem(LAST_VIEW_KEY) || 'home';
        return ytvhtFeedViewPreference.selectStartupFeedView(defaultPage, last);
    } catch (_) { return 'home'; }
}

function init() {
    const searchInput = document.getElementById('search');
    searchInput.addEventListener('input', () => {
        searchVisibleLimit = SEARCH_PAGE_SIZE;
        // Typing in search means the user wants the feed, not another section.
        if (analyticsActive || subscriptionsActive || playlistsActive || historyActive || settingsActive || channelActive) showFeed();
        else render();
    });
    ['searchDate', 'searchDuration', 'searchWatched', 'searchSort'].forEach((id) => {
        const control = document.getElementById(id);
        if (!control) return;
        control.addEventListener('change', () => {
            searchVisibleLimit = SEARCH_PAGE_SIZE;
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
            shortsOnly = false;
            subscriptionsChronological = true;
            showFeed();
        });
    }
    const navPlaylists = document.getElementById('navPlaylists');
    if (navPlaylists) navPlaylists.addEventListener('click', () => {
        searchInput.value = '';
        showPlaylists();
    });
    const navHistory = document.getElementById('navHistory');
    if (navHistory) navHistory.addEventListener('click', () => {
        searchInput.value = '';
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
            if (analyticsActive) { showFeed(); } else { showAnalytics(); }
        });
    }
    const navSettings = document.getElementById('navSettings');
    if (navSettings) {
        navSettings.addEventListener('click', () => {
            searchInput.value = '';
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
            const subscriptions = await ytIndexedDBStorage.listSubscriptionRecords();
            if (!subscriptions.length) return;
            if (!confirm(`Are you sure you want to remove all ${subscriptions.length} local subscriptions?`)) return;

            clearSubscriptions.disabled = true;
            try {
                await Promise.all(subscriptions.map(async (subscription) => {
                    await ytIndexedDBStorage.deleteSubscriptionAndSyncState(subscription.channelId);
                }));
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

    window.addEventListener('unload', clearPageFeedWorkTimer, { once: true });

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
    startCanonicalFeedWork().catch((error) => {
        console.warn('[feed] canonical scheduler startup failed', error && error.message);
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
