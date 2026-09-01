// ----- data loading ------------------------------------------------------
async function loadData(options = {}) {
    try {
        const settings = (await ytStorage.getSettings()) || {};
        overlayTitle = tFeed('feed_viewed', 'Viewed');
        applyFeedTheme(settings.themePreference || 'system');
        applyAccentColor(settings.accentColor || 'blue');
    } catch (_) { /* defaults */ }

    try {
        const data = await ytvhtFeedViewData.loadCanonicalFeedViewData(ytIndexedDBStorage);
        const expectedVideoIds = ytvhtFeedContracts.createPendingFeedDiscovery({
            videoIds: options.expectedVideoIds,
            discoveredAt: 0
        }).videoIds;
        if (expectedVideoIds.length) {
            const loadedIds = new Set(data.videos.map((video) => video.videoId));
            const missingVideoIds = expectedVideoIds.filter((videoId) => !loadedIds.has(videoId));
            if (missingVideoIds.length) {
                const error = new Error(tFeed(
                    'feed_pending_inventory_incomplete',
                    'The local inventory does not contain every discovered video yet.',
                    [feedFormatNumber(missingVideoIds.length)]
                ));
                error.code = 'pending_inventory_incomplete';
                error.missingVideoIds = missingVideoIds;
                throw error;
            }
        }
        allVideos = data.videos;
        localSubscriptions = data.subscriptions;
        lastUpdated = allVideos.reduce((latest, video) => Math.max(latest, Number(video.lastSeenInFeedAt || 0)), 0);
        feedCachePolicy = 'v5-canonical';
        feedDiagnostics = [];
    } catch (e) {
        // This is an expected validation result for a stale “new videos”
        // notice, not a database-load failure. Its caller reconciles the
        // pending IDs with the current canonical inventory below.
        if (e && e.code !== 'pending_inventory_incomplete') {
            console.error('[feed] failed to load canonical feed inventory', e);
        }
        if (options.requireCanonicalInventory) throw e;
        allVideos = [];
        localSubscriptions = [];
        feedCachePolicy = '';
        feedDiagnostics = [];
    }

    try {
        releaseDateCache = await ytStorage.getReleaseDateCache();
    } catch (_) {
        releaseDateCache = {};
    }
    try {
        durationCache = await ytStorage.getDurationCache();
    } catch (_) {
        durationCache = {};
    }
    try {
        shortsCache = await ytStorage.getShortsCache();
    } catch (_) {
        shortsCache = {};
    }
    try {
        const feedbackResult = await chrome.storage.local.get(['feedFeedback']);
        const saved = feedbackResult.feedFeedback || {};
        feedFeedback = {
            notInterested: saved.notInterested || {},
            channelLess: saved.channelLess || {},
            channelMore: saved.channelMore || {}
        };
    } catch (_) {
        feedFeedback = { notInterested: {}, channelLess: {}, channelMore: {} };
    }

    // Watch records power the "viewed" overlay + "unwatched only" filter.
    try {
        const videos = await ytStorage.getAllVideos();
        watchedMap = videos || {};
    } catch (e) {
        console.warn('[feed] could not load watch history for overlays', e && e.message);
        watchedMap = {};
    }
}

// ----- refresh (self-contained; fetches youtube.com directly) ------------
function setStatus(message, busy) {
    const el = document.getElementById('status');
    el.textContent = '';
    if (busy) {
        const spinner = document.createElement('span');
        spinner.className = 'spinner';
        el.appendChild(spinner);
    }
    if (message) el.appendChild(document.createTextNode(message));
    el.style.display = message ? '' : 'none';
    syncFeedStatusRow();
}

function syncFeedStatusRow() {
    const row = document.getElementById('statusRow');
    const status = document.getElementById('status');
    const subscriptionSortControl = document.getElementById('subscriptionSort');
    if (!row || !status || !subscriptionSortControl) return;
    row.hidden = !status.textContent && subscriptionSortControl.hidden;
}

function pendingFeedVisibility(videoIds) {
    const pendingIds = new Set(videoIds || []);
    const counts = new Map();
    let hiddenCount = 0;
    const add = (label) => {
        hiddenCount += 1;
        counts.set(label, (counts.get(label) || 0) + 1);
    };
    const isUnwatchedOnly = document.getElementById('unwatched')?.checked;
    const hidesMembers = document.getElementById('hideMembers')?.checked;
    const videos = (allVideos || []).filter((video) => pendingIds.has(video?.videoId));

    videos.forEach((video) => {
        if (typeof isShort === 'function' && isShort(video)) {
            add(tFeed('tab_shorts', 'Shorts'));
        } else if (feedFeedback?.notInterested?.[video.videoId]) {
            add(tFeed('feed_hidden_manually', 'Hidden manually'));
        } else if (isUnwatchedOnly && watchedMap?.[video.videoId]) {
            add(tFeed('feed_unwatched_only', 'Unwatched only'));
        } else if (hidesMembers && typeof videoIsMembersOnly === 'function' && videoIsMembersOnly(video)) {
            add(tFeed('feed_hide_members', 'Hide member videos'));
        }
    });

    return {
        visibleCount: Math.max(0, videos.length - hiddenCount),
        hiddenCount,
        reasons: Array.from(counts, ([label, count]) => `${label} (${feedFormatNumber(count)})`).join(', ')
    };
}

function setRefreshUi(busy) {
    const btn = document.getElementById('refresh');
    if (!btn) return;
    btn.disabled = busy;
    btn.setAttribute('aria-busy', busy ? 'true' : 'false');
    btn.textContent = '';
    if (busy) {
        const spinner = document.createElement('span');
        spinner.className = 'button-spinner';
        spinner.setAttribute('aria-hidden', 'true');
        btn.appendChild(spinner);
        btn.appendChild(document.createTextNode(tFeed('feed_refreshing', 'Checking…')));
    } else {
        btn.textContent = tFeed('feed_refresh', 'Reload videos');
    }
}

function setReloadUi(busy) {
    const btn = document.getElementById('reloadView');
    if (!btn) return;
    btn.disabled = busy;
    btn.setAttribute('aria-busy', busy ? 'true' : 'false');
    btn.textContent = '';
    if (busy) {
        const spinner = document.createElement('span');
        spinner.className = 'button-spinner';
        spinner.setAttribute('aria-hidden', 'true');
        btn.appendChild(spinner);
        btn.appendChild(document.createTextNode(tFeed('feed_reloading_view', 'Reloading…')));
    } else {
        btn.textContent = tFeed('feed_refresh_view', 'Refresh');
    }
}

function setRefreshResultStatus() {
    setStatus(allVideos.length ? tFeed('feed_updated', 'Feed updated.') : '', false);
}

function setFeedSyncStatus(message, busy) {
    const status = document.getElementById('feedSyncStatus');
    if (!status) return;
    status.textContent = message || '';
    status.toggleAttribute('hidden', !message);
    status.setAttribute('aria-busy', busy ? 'true' : 'false');
}

const PENDING_FEED_DISCOVERY_STORAGE_KEY = 'ytvht.pendingFeedDiscovery.v1';

async function replacePendingFeedDiscovery(nextDiscovery) {
    const normalized = ytvhtFeedContracts.createPendingFeedDiscovery(nextDiscovery);
    await chrome.storage.local.set({ [PENDING_FEED_DISCOVERY_STORAGE_KEY]: normalized });
    pendingFeedDiscovery = normalized;
    return normalized;
}

async function restorePendingFeedDiscovery() {
    try {
        const stored = await chrome.storage.local.get([PENDING_FEED_DISCOVERY_STORAGE_KEY]);
        pendingFeedDiscovery = ytvhtFeedContracts.createPendingFeedDiscovery(
            stored[PENDING_FEED_DISCOVERY_STORAGE_KEY] || { videoIds: [], discoveredAt: 0 }
        );
    } catch (error) {
        console.warn('[feed] could not restore pending discoveries', error && error.message);
    }
    return pendingFeedDiscovery;
}

function pendingFeedVideoCount() {
    return pendingFeedDiscovery.videoIds.length;
}

function renderFeedNotice() {
    const status = document.getElementById('status');
    const count = pendingFeedVideoCount();
    const visible = count > 0 && !shortsOnly &&
        !analyticsActive && !subscriptionsActive && !playlistsActive &&
        !historyActive && !settingsActive && !channelActive;
    if (!status) return;
    if (!visible) {
        status.textContent = '';
        status.style.display = 'none';
        return;
    }
    status.textContent = '';
    status.style.display = '';
    if (pendingFeedNoticeState.error) {
        status.appendChild(document.createTextNode(`${tFeed(
            'feed_show_new_videos_failed',
            'Could not show new videos: $1',
            [pendingFeedNoticeState.error]
        )} `));
    } else {
        status.appendChild(document.createTextNode(`${feedPlural(
            'feed_new_videos_available',
            count,
            '$1 new subscription video available',
            '$1 new subscription videos available'
        )} `));
    }
    const show = document.createElement('button');
    show.className = 'btn';
    show.disabled = pendingFeedNoticeState.busy;
    show.setAttribute('aria-busy', pendingFeedNoticeState.busy ? 'true' : 'false');
    if (pendingFeedNoticeState.busy) {
        const spinner = document.createElement('span');
        spinner.className = 'button-spinner';
        spinner.setAttribute('aria-hidden', 'true');
        show.appendChild(spinner);
        show.appendChild(document.createTextNode(tFeed('feed_showing_new_videos', 'Showing…')));
    } else {
        show.textContent = pendingFeedNoticeState.error
            ? tFeed('feed_retry', 'Retry')
            : tFeed('feed_show', 'Show');
    }
    show.addEventListener('click', () => showPendingFeedVideos(() => {
        subscriptionsChronological = true;
        showFeed();
    }));
    status.appendChild(show);
}

async function showNewFeedVideos(videoIds) {
    const merged = ytvhtFeedContracts.createPendingFeedDiscovery({
        videoIds: pendingFeedDiscovery.videoIds.concat(videoIds || []),
        discoveredAt: pendingFeedDiscovery.discoveredAt || Date.now()
    });
    if (merged.videoIds.length === pendingFeedDiscovery.videoIds.length) return pendingFeedDiscovery;
    await replacePendingFeedDiscovery(merged);
    pendingFeedNoticeState = { busy: false, error: '' };
    renderFeedNotice();
    return pendingFeedDiscovery;
}

function scrollToShownFeedVideos(videoIds) {
    const pending = new Set(videoIds);
    const findCard = () => Array.from(document.querySelectorAll('[data-ytvht-video-id]'))
        .find((card) => pending.has(card.dataset.ytvhtVideoId));
    const scrollToCard = () => {
        const firstCard = findCard();
        if (!firstCard || typeof firstCard.scrollIntoView !== 'function') return false;
        firstCard.scrollIntoView({ block: 'start', behavior: 'smooth' });
        return true;
    };
    if (scrollToCard()) return Promise.resolve(true);

    const grid = document.getElementById('grid');
    if (!grid || typeof MutationObserver === 'undefined') {
        if (typeof window.scrollTo === 'function') window.scrollTo({ top: 0, behavior: 'smooth' });
        return Promise.resolve(false);
    }

    return new Promise((resolve) => {
        let settled = false;
        const finish = (found) => {
            if (settled) return;
            settled = true;
            observer.disconnect();
            clearTimeout(timeout);
            if (!found && typeof window.scrollTo === 'function') {
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
            resolve(found);
        };
        const observer = new MutationObserver(() => {
            if (scrollToCard()) finish(true);
        });
        const timeout = setTimeout(() => finish(false), 1500);
        observer.observe(grid, { childList: true, subtree: true });
        if (scrollToCard()) finish(true);
    });
}

async function showPendingFeedVideos(onReady) {
    if (pendingFeedNoticeState.busy || !pendingFeedVideoCount()) return;
    const videoIds = pendingFeedDiscovery.videoIds.slice();
    pendingFeedNoticeState = { busy: true, error: '' };
    renderFeedNotice();
    try {
        await loadData({
            requireCanonicalInventory: true,
            expectedVideoIds: videoIds
        });
        newlyShownFeedVideoIds = videoIds;
        await replacePendingFeedDiscovery({ videoIds: [], discoveredAt: 0 });
        pendingFeedNoticeState = { busy: false, error: '' };
        const search = document.getElementById('search');
        if (search) search.value = '';
        shortsOnly = false;
        subscriptionsChronological = true;
        // Keep the order the user selected before opening the new-videos view.
        // A newly detected older upload can therefore appear farther down when
        // Subscriptions is ordered by upload date, instead of changing the
        // entire inventory to detection time.
        if (typeof onReady === 'function') onReady();
        else showFeed();
        const { visibleCount, hiddenCount, reasons } = pendingFeedVisibility(videoIds);
        let message = feedPlural(
            'feed_new_videos_shown',
            visibleCount,
            '$1 new video shown.',
            '$1 new videos shown.'
        );
        if (hiddenCount) {
            message += ` ${feedPlural(
                'feed_new_videos_hidden_by_filters',
                hiddenCount,
                '$1 new video is hidden: $2.',
                '$1 new videos are hidden: $2.',
                [reasons || tFeed('feed_hidden_reason_unavailable', 'a saved visibility preference')]
            )}`;
        }
        setStatus(message, false);
        await scrollToShownFeedVideos(videoIds);
    } catch (error) {
        // Pending discoveries created before a retention pass can include IDs
        // that were legitimately removed before the user clicks Show. Recover
        // any remaining canonical IDs in-place rather than presenting a
        // guaranteed failure. A fully unavailable inventory still stays
        // retryable below.
        if (error && error.code === 'pending_inventory_incomplete') {
            try {
                await loadData({ requireCanonicalInventory: true });
                const available = new Set((allVideos || []).map((video) => video.videoId));
                const retainedVideoIds = videoIds.filter((videoId) => available.has(videoId));
                if (retainedVideoIds.length) {
                    await replacePendingFeedDiscovery({
                        videoIds: retainedVideoIds,
                        discoveredAt: pendingFeedDiscovery.discoveredAt || Date.now()
                    });
                    pendingFeedNoticeState = { busy: false, error: '' };
                    return showPendingFeedVideos(onReady);
                }
                // These IDs were discovered earlier but were later removed
                // by retention. A retry cannot restore them, so clear only
                // this stale notice instead of trapping the user behind Retry.
                await replacePendingFeedDiscovery({ videoIds: [], discoveredAt: 0 });
                pendingFeedNoticeState = { busy: false, error: '' };
                renderFeedNotice();
                setStatus(feedPlural(
                    'feed_stale_discoveries_removed',
                    videoIds.length,
                    '$1 stale discovery was removed from the new-videos notice.',
                    '$1 stale discoveries were removed from the new-videos notice.'
                ), false);
                return;
            } catch (recoveryError) {
                console.warn('[feed] could not recover retained discoveries', recoveryError && recoveryError.message);
            }
        }
        pendingFeedNoticeState = {
            busy: false,
            error: String(error && error.message || tFeed('message_unknown_error', 'error'))
        };
        renderFeedNotice();
    }
}

async function checkForNewVideos() {
    setRefreshUi(true);
    setStatus('', false);
    try {
        await requestPageActiveFeedWork();
    } catch (e) {
        console.warn('[feed] upload check failed', e && e.message);
        setStatus(tFeed(
            'feed_refresh_failed_status',
            'Could not check for new videos. Please try again.'
        ), false);
    } finally {
        setRefreshUi(false);
    }
}

async function reloadView() {
    setReloadUi(true);
    setStatus('', false);
    try {
        await loadData({ requireCanonicalInventory: true });
        newlyShownFeedVideoIds = [];
        refreshActiveFeedDataView();
        if (pendingFeedVideoCount()) renderFeedNotice();
        else setStatus(tFeed('feed_view_reloaded', 'View reloaded.'), false);
    } catch (error) {
        setStatus(tFeed('feed_reload_view_failed', 'Could not reload the view: $1.', [
            error && error.message || tFeed('message_unknown_error', 'error')
        ]), false);
    } finally {
        setReloadUi(false);
    }
}
