function showFeedStatus(show) {
    const status = document.getElementById('status');
    if (!status) return;
    status.style.display = show && status.textContent ? '' : 'none';
    if (!show && typeof setFeedSyncStatus === 'function') setFeedSyncStatus('', false);
}

function setRefreshVisible(visible) {
    const refresh = document.getElementById('refresh');
    if (refresh) refresh.style.display = visible ? '' : 'none';
}

function setCreatePlaylistVisible(visible) {
    const create = document.getElementById('createPlaylist');
    if (create) create.style.display = visible ? '' : 'none';
}

function setSaveSettingsVisible(visible) {
    const save = document.getElementById('saveFeedSettings');
    if (save) save.style.display = visible ? '' : 'none';
}

function setClearSubscriptionsVisible(visible) {
    const clear = document.getElementById('clearSubscriptions');
    if (clear) clear.style.display = visible ? '' : 'none';
}

function setClearHistoryVisible(visible) {
    const clear = document.getElementById('clearHistoryPage');
    if (clear) clear.style.display = visible ? '' : 'none';
}

function setFeedOptionsVisible(visible) {
    const toggle = document.getElementById('optionsToggle');
    const menu = document.getElementById('optionsMenu');
    const wrap = toggle ? toggle.closest('.menu-wrap') : null;
    if (wrap) wrap.style.display = visible ? '' : 'none';
    if (!visible && menu) menu.hidden = true;
}

function hideSearchControls() {
    document.getElementById('searchFilters')?.classList.remove('visible', 'open');
    document.getElementById('searchSourceTabs')?.classList.remove('visible');
}

function leaveSearchPage() {
    const search = document.getElementById('search');
    if (search) search.value = '';
    searchVisibleLimit = SEARCH_PAGE_SIZE;
    hideSearchControls();
}

// Toggle between the feed grid and the analytics view.
function showAnalytics() {
    rememberView('analytics');
    document.body.classList.remove('shorts-mode');
    setRefreshVisible(false);
    setCreatePlaylistVisible(false);
    setSaveSettingsVisible(false);
    setClearSubscriptionsVisible(false);
    setClearHistoryVisible(false);
    setFeedOptionsVisible(false);
    showFeedStatus(false);
    leaveSearchPage();
    analyticsActive = true;
    subscriptionsActive = false;
    playlistsActive = false;
    historyActive = false;
    settingsActive = false;
    channelActive = false;
    ['localHeading', 'grid', 'localSearchResults', 'empty', 'channelSection'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    const subscriptions = document.getElementById('subscriptionsSection');
    if (subscriptions) subscriptions.style.display = 'none';
    const playlists = document.getElementById('playlistsSection');
    if (playlists) playlists.style.display = 'none';
    const history = document.getElementById('historySection');
    if (history) history.style.display = 'none';
    const settings = document.getElementById('settingsSection');
    if (settings) settings.style.display = 'none';
    const chips = document.querySelector('.chips');
    if (chips) chips.style.display = 'none';
    const sec = document.getElementById('analyticsSection');
    if (sec) sec.style.display = 'block';
    setActiveNav('analyticsToggle');
    renderAnalytics();
}

function showFeed() {
    rememberView(shortsOnly ? 'shorts' : (subscriptionsChronological ? 'subscriptions' : 'home'));
    setRefreshVisible(true);
    setCreatePlaylistVisible(false);
    setSaveSettingsVisible(false);
    setClearSubscriptionsVisible(false);
    setClearHistoryVisible(false);
    setFeedOptionsVisible(true);
    showFeedStatus(true);
    analyticsActive = false;
    subscriptionsActive = false;
    playlistsActive = false;
    historyActive = false;
    settingsActive = false;
    channelActive = false;
    const sec = document.getElementById('analyticsSection');
    if (sec) sec.style.display = 'none';
    const subscriptions = document.getElementById('subscriptionsSection');
    if (subscriptions) subscriptions.style.display = 'none';
    const playlists = document.getElementById('playlistsSection');
    if (playlists) playlists.style.display = 'none';
    const history = document.getElementById('historySection');
    if (history) history.style.display = 'none';
    const settings = document.getElementById('settingsSection');
    if (settings) settings.style.display = 'none';
    const channel = document.getElementById('channelSection');
    if (channel) channel.style.display = 'none';
    const chips = document.querySelector('.chips');
    if (chips) chips.style.display = '';
    const heading = document.getElementById('localHeading');
    if (heading) heading.style.display = '';
    setActiveNav(shortsOnly ? 'navShorts' : (subscriptionsChronological ? 'navSubscriptions' : 'navHome'));
    render();
    if (typeof restorePageActiveSyncStatus === 'function') restorePageActiveSyncStatus();
    if (typeof renderFeedNotice === 'function') renderFeedNotice();
}

function subscriptionUrl(sub) {
    if (sub.url) return sub.url;
    if (sub.handle) return `https://www.youtube.com/${sub.handle}`;
    return `https://www.youtube.com/channel/${sub.ucid || sub.id}`;
}

function setSubscriptionAddStatus(message, isError) {
    const status = document.getElementById('subscriptionAddStatus');
    if (!status) return;
    status.textContent = message || '';
    status.style.color = isError ? 'var(--danger-text)' : '';
}

function setupSubscriptionAddForm() {
    const form = document.getElementById('subscriptionAddForm');
    const input = document.getElementById('subscriptionAddInput');
    if (!form || !input || form.dataset.bound) return;
    form.dataset.bound = 'true';
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        setSubscriptionAddStatus(tFeed('feed_resolving_channel', 'Resolving channel…'), false);
        try {
            const resolved = await ytvhtLocalSubscriptionActions.resolveInput(input.value, fetch);
            const outcome = await ytvhtLocalSubscriptionActions.follow(ytIndexedDBStorage, resolved);
            if (outcome.status === 'already-following') {
                setSubscriptionAddStatus(tFeed('feed_already_following', 'Already following this channel with re:Watch.'), false);
            } else {
                input.value = '';
                setSubscriptionAddStatus(tFeed('feed_subscribed_preparing', 'Subscribed with re:Watch — preparing local feed.'), false);
                const scheduler = ensureSharedFeedScheduler();
                if (scheduler) await scheduler.initializeSubscriptions([resolved.channelId]);
            }
            await renderSubscriptions();
            if (outcome.status === 'followed') {
                // A previously empty Channels view completed an empty initial
                // batch, so hydrate this explicit addition immediately.
                await hydrateVisibleChannelMetadata([outcome.subscription]);
            }
        } catch (error) {
            console.warn('[subscriptions] add failed', error && error.message);
            setSubscriptionAddStatus(tFeed('feed_subscribe_failed', 'Could not subscribe to that channel.'), true);
        } finally {
            button.disabled = false;
        }
    });
}

async function renderSubscriptions() {
    const list = document.getElementById('subscriptionsList');
    const empty = document.getElementById('subscriptionsEmpty');
    const count = document.getElementById('subscriptionsCount');
    const clear = document.getElementById('clearSubscriptions');
    if (!list || !empty || !count) return;

    setupSubscriptionAddForm();
    let subscriptions = [];
    try {
        subscriptions = (await ytvhtFeedViewData.loadCanonicalFeedViewData(ytIndexedDBStorage)).subscriptions;
        subscriptions = await Promise.all(subscriptions.map(async (subscription) => ({
            ...subscription,
            ...((await ytIndexedDBStorage.getChannelSyncState(subscription.channelId)) || {})
        })));
    } catch (_) { /* show empty */ }
    list.textContent = '';
    count.textContent = feedPlural('feed_channels_count', subscriptions.length, '$1 channel', '$1 channels');
    empty.style.display = subscriptions.length ? 'none' : 'block';
    if (clear) clear.style.display = subscriptions.length ? '' : 'none';

    subscriptions.forEach((sub) => {
        const row = document.createElement('div');
        row.className = 'subs-row subs-card';
        row.dataset.channelId = sub.channelId;
        const banner = document.createElement('div');
        banner.className = 'subs-banner';
        if (sub.bannerUrl) banner.style.backgroundImage = `linear-gradient(to bottom, color-mix(in srgb, var(--bg) 50%, transparent), var(--bg)), url("${sub.bannerUrl}")`;
        row.appendChild(banner);

        const channel = document.createElement('a');
        channel.className = 'subs-channel';
        channel.href = subscriptionUrl(sub);
        channel.target = '_blank';
        channel.rel = 'noopener';

        let avatar;
        if (sub.thumbnail) {
            avatar = document.createElement('img');
            avatar.src = sub.thumbnail;
            avatar.alt = '';
            avatar.loading = 'lazy';
            avatar.className = 'subs-avatar';
        } else {
            avatar = document.createElement('div');
            avatar.className = 'subs-avatar subs-avatar-fallback';
            avatar.textContent = decodeHtmlEntities(sub.channelName || sub.id || '?').charAt(0).toUpperCase();
        }
        channel.appendChild(avatar);

        const copy = document.createElement('span');
        copy.className = 'subs-copy';
        const name = document.createElement('span');
        name.className = 'subs-name';
        name.textContent = decodeHtmlEntities(sub.channelName || sub.id || tFeed('analytics_unknown_channel', 'Unknown channel'));
        copy.appendChild(name);
        const identity = document.createElement('div');
        identity.className = 'subs-count';
        identity.textContent = `${sub.handle || ''}${sub.handle ? ' · ' : ''}${sub.channelId}`;
        copy.appendChild(identity);
        channel.appendChild(copy);
        row.appendChild(channel);

        const latest = sub.latestUploadAt
            ? tFeed('feed_last_upload', 'Last upload $1', [relativeTime(sub.latestUploadAt)])
            : '';
        const nextCheck = formatNextChannelCheck(sub.nextEligibleCheckAt);
        const parsedVideoCount = sub.videoCount && /^\d[\d, ]*$/.test(sub.videoCount)
            ? Number(String(sub.videoCount).replace(/[, ]/g, ''))
            : NaN;
        const videoCount = Number.isFinite(parsedVideoCount)
            ? feedPlural('feed_videos', parsedVideoCount, '$1 video', '$1 videos')
            : sub.videoCount;
        const metaText = [sub.subscriberCount, videoCount, latest, sub.activityClass, nextCheck].filter(Boolean).join(' · ');
        if (metaText) {
            const meta = document.createElement('div');
            meta.className = 'subs-meta';
            meta.textContent = metaText;
            row.appendChild(meta);
        }

        const unsubscribe = document.createElement('button');
        unsubscribe.className = 'btn';
        unsubscribe.textContent = tFeed('subscriptions_unsubscribe', 'Unsubscribe');
        unsubscribe.addEventListener('click', async () => {
            unsubscribe.disabled = true;
            try {
                await ytIndexedDBStorage.deleteSubscriptionAndSyncState(sub.channelId);
                await renderSubscriptions();
                setStatus(tFeed('feed_unsubscribed_from_status', 'Unsubscribed from $1.', [name.textContent]), false);
            } catch (error) {
                console.error('[subscriptions] remove failed', error);
                unsubscribe.disabled = false;
            }
        });
        row.appendChild(unsubscribe);
        list.appendChild(row);
    });
    if (!channelMetadataStarted) hydrateVisibleChannelMetadata(subscriptions).catch(() => {});
    else if (channelMetadataAwaitingVisibility) observeNextChannelMetadataBatch(subscriptions, list);
}

function formatNextChannelCheck(timestamp) {
    const deltaMs = Number(timestamp || 0) - Date.now();
    if (!Number.isFinite(deltaMs) || !timestamp) return '';
    if (deltaMs <= 0) return tFeed('feed_next_check_due', 'Next check due');
    const minutes = Math.ceil(deltaMs / 60000);
    if (minutes < 60) return tFeed('feed_next_check_minutes', 'Next check in $1m', [feedFormatNumber(minutes)]);
    const hours = Math.ceil(minutes / 60);
    if (hours < 48) return tFeed('feed_next_check_hours', 'Next check in $1h', [feedFormatNumber(hours)]);
    return tFeed('feed_next_check_days', 'Next check in $1d', [feedFormatNumber(Math.ceil(hours / 24))]);
}

async function hydrateVisibleChannelMetadata(subscriptions) {
    if (!subscriptionsActive || !ytvhtFeedChannelMetadata || channelMetadataInFlight) return;
    const candidates = ytvhtFeedChannelMetadata.selectHydrationBatch(subscriptions, channelMetadataProcessedIds);
    channelMetadataStarted = true;
    if (!candidates.length) return;
    channelMetadataInFlight = true;
    const controller = new AbortController();
    channelMetadataAbortController = controller;
    try {
        await ytvhtFeedChannelMetadata.hydrateSubscriptionBatch(candidates, {
            storage: ytIndexedDBStorage,
            processedIds: channelMetadataProcessedIds,
            concurrency: 3,
            signal: controller.signal
        });
        if (controller.signal.aborted) return;
        channelMetadataLastHydratedId = candidates[candidates.length - 1].channelId;
        channelMetadataAwaitingVisibility = subscriptions.some((sub) => ytvhtFeedChannelMetadata.needsHydration(sub) && !channelMetadataProcessedIds.has(sub.channelId));
        if (subscriptionsActive) renderSubscriptions();
    } finally {
        if (channelMetadataAbortController === controller) {
            channelMetadataAbortController = null;
            channelMetadataInFlight = false;
        }
    }
}

function observeNextChannelMetadataBatch(subscriptions, list) {
    if (!subscriptionsActive || channelMetadataObserver || !channelMetadataLastHydratedId || typeof IntersectionObserver === 'undefined') return;
    const target = list.querySelector(`[data-channel-id="${channelMetadataLastHydratedId}"]`);
    if (!target) return;
    channelMetadataObserver = new IntersectionObserver((entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        channelMetadataObserver.disconnect();
        channelMetadataObserver = null;
        channelMetadataAwaitingVisibility = false;
        hydrateVisibleChannelMetadata(subscriptions).catch(() => {});
    }, { rootMargin: '160px 0px' });
    channelMetadataObserver.observe(target);
}

let channelMetadataObserver = null;
let channelMetadataAbortController = null;
let channelMetadataInFlight = false;
let channelMetadataStarted = false;
let channelMetadataAwaitingVisibility = false;
let channelMetadataLastHydratedId = '';
const channelMetadataProcessedIds = new Set();

function resetChannelMetadataHydration() {
    channelMetadataObserver?.disconnect();
    channelMetadataAbortController?.abort();
    channelMetadataObserver = null;
    channelMetadataAbortController = null;
    channelMetadataInFlight = false;
    channelMetadataStarted = false;
    channelMetadataAwaitingVisibility = false;
    channelMetadataLastHydratedId = '';
    channelMetadataProcessedIds.clear();
}

function showSubscriptions() {
    resetChannelMetadataHydration();
    rememberView('channels');
    document.body.classList.remove('shorts-mode');
    setRefreshVisible(false);
    setCreatePlaylistVisible(false);
    setSaveSettingsVisible(false);
    setClearSubscriptionsVisible(true);
    setClearHistoryVisible(false);
    setFeedOptionsVisible(false);
    showFeedStatus(false);
    leaveSearchPage();
    analyticsActive = false;
    subscriptionsActive = true;
    playlistsActive = false;
    historyActive = false;
    settingsActive = false;
    channelActive = false;
    ['localHeading', 'grid', 'localSearchResults', 'empty', 'ytSection', 'channelSection'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    const analytics = document.getElementById('analyticsSection');
    if (analytics) analytics.style.display = 'none';
    const playlists = document.getElementById('playlistsSection');
    if (playlists) playlists.style.display = 'none';
    const history = document.getElementById('historySection');
    if (history) history.style.display = 'none';
    const settings = document.getElementById('settingsSection');
    if (settings) settings.style.display = 'none';
    const chips = document.querySelector('.chips');
    if (chips) chips.style.display = 'none';
    const subscriptions = document.getElementById('subscriptionsSection');
    if (subscriptions) subscriptions.style.display = 'block';
    setActiveNav('manage');
    renderSubscriptions();
}

function formatSavedDate(timestamp) {
    if (!timestamp) return '';
    try {
        return new Date(timestamp).toLocaleDateString(undefined, {
            year: 'numeric', month: 'short', day: 'numeric'
        });
    } catch (_) {
        return '';
    }
}

function formatUploadDate(timestamp) {
    if (!timestamp) return '';
    try {
        return tFeed('feed_uploaded_on', 'Uploaded $1', [new Date(timestamp).toLocaleDateString(undefined, {
            year: 'numeric', month: 'short', day: 'numeric'
        })]);
    } catch (_) {
        return '';
    }
}
