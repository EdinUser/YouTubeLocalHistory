// ----- data loading ------------------------------------------------------
async function loadData() {
    try {
        const settings = (await ytStorage.getSettings()) || {};
        overlayTitle = 'Viewed';
        applyFeedTheme(settings.themePreference || 'system');
        applyAccentColor(settings.accentColor || 'blue');
    } catch (_) { /* defaults */ }

    try {
        const data = await ytvhtFeedViewData.loadCanonicalFeedViewData(ytIndexedDBStorage);
        allVideos = data.videos;
        localSubscriptions = data.subscriptions;
        lastUpdated = allVideos.reduce((latest, video) => Math.max(latest, Number(video.lastSeenInFeedAt || 0)), 0);
        feedCachePolicy = 'v5-canonical';
        feedDiagnostics = [];
    } catch (e) {
        console.error('[feed] failed to load canonical feed inventory', e);
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
        btn.appendChild(document.createTextNode(tFeed('feed_refreshing', 'Refreshing...')));
    } else {
        btn.textContent = tFeed('feed_refresh', 'Refresh');
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

function renderFeedNotice() {
    const status = document.getElementById('status');
    const visible = pendingFeedVideoCount > 0 && !shortsOnly &&
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
    status.appendChild(document.createTextNode(`${pendingFeedVideoCount} new subscription videos available `));
    const show = document.createElement('button');
    show.className = 'btn';
    show.textContent = 'Show';
    show.addEventListener('click', async () => {
        await loadData();
        pendingFeedVideoCount = 0;
        const search = document.getElementById('search');
        if (search) search.value = '';
        shortsOnly = false;
        subscriptionsChronological = true;
        showFeed();
        setStatus('', false);
    });
    status.appendChild(show);
}

function showNewFeedVideos(count) {
    pendingFeedVideoCount = Number(count || pendingFeedVideoCount || 0);
    renderFeedNotice();
}

async function refresh() {
    setRefreshUi(true);
    setStatus('', false);
    try {
        const work = await requestPageActiveFeedWork();
        if (!work.result.insertedVideoCount && work.progress.pending === 0) {
            setFeedSyncStatus('Up to date', false);
        }
    } catch (e) {
        setStatus(tFeed('feed_refresh_failed_status', 'Refresh failed: $1.', [e.message || tFeed('message_unknown_error', 'error')]), false);
    } finally {
        setRefreshUi(false);
    }
}
