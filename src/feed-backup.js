function mergeCanonicalBackupSubscription(existing, incoming) {
    const channelId = String(incoming && incoming.channelId || '').trim();
    const allowedSources = ['takeout_csv', 'oauth', 'manual'];
    const existingSource = String(existing && existing.source || '').trim();
    const incomingSource = String(incoming && incoming.source || '').trim();
    const source = allowedSources.includes(existingSource)
        ? existingSource
        : (allowedSources.includes(incomingSource) ? incomingSource : '');
    if (!/^UC[\w-]+$/.test(channelId) || !source) return null;

    const merged = { ...(incoming || {}) };
    Object.entries(existing || {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') merged[key] = value;
    });
    const followedAtValues = [existing && existing.followedAt, incoming && incoming.followedAt]
        .map(Number)
        .filter((value) => Number.isFinite(value) && value > 0);
    return {
        ...merged,
        channelId,
        source,
        followedAt: followedAtValues.length ? Math.min(...followedAtValues) : Date.now()
    };
}

async function restoreCanonicalBackupSubscriptions(subscriptions) {
    const result = { restored: 0, skipped: 0 };
    for (const incoming of (Array.isArray(subscriptions) ? subscriptions : [])) {
        const channelId = String(incoming && incoming.channelId || '').trim();
        const existing = /^UC[\w-]+$/.test(channelId)
            ? await ytIndexedDBStorage.getSubscriptionRecord(channelId)
            : null;
        const merged = mergeCanonicalBackupSubscription(existing, incoming);
        if (!merged) {
            result.skipped += 1;
            continue;
        }
        await ytIndexedDBStorage.putSubscriptionRecord(merged);
        result.restored += 1;
    }
    return result;
}

async function createFeedBackupData() {
    const [
        videos,
        playlists,
        stats,
        legacySubscriptions,
        canonicalSubscriptions,
        watchLater,
        settings,
        localData
    ] = await Promise.all([
        ytStorage.getAllVideos(),
        ytStorage.getAllPlaylists(),
        ytStorage.getStats(),
        ytStorage.getSubscriptionList(),
        ytIndexedDBStorage.listSubscriptionRecords(),
        ytStorage.getAllWatchLater(),
        ytStorage.getSettings(),
        chrome.storage.local.get([
            'localVideoPlaylists',
            'feedFeedback',
            'durationCache',
            'shortsCache',
            'releaseDateCache',
            'popupAccentColor'
        ])
    ]);
    const data = {
        _metadata: {
            exportDate: new Date().toISOString(),
            extensionVersion: chrome.runtime.getManifest().version,
            exportFormat: 'json',
            dataVersion: '2.1',
            type: 'yt-rewatch-full-backup'
        },
        history: Object.values(videos || {}),
        playlists: Object.values(playlists || {}),
        localPlaylists: localData.localVideoPlaylists || {},
        subscriptions: legacySubscriptions || [],
        canonicalSubscriptions: canonicalSubscriptions || [],
        watchLater: Object.values(watchLater || {}),
        settings: settings || {},
        stats,
        recommendationPreferences: localData.feedFeedback || {},
        caches: {
            durations: localData.durationCache || {},
            shorts: localData.shortsCache || {},
            releaseDates: localData.releaseDateCache || {}
        },
        interface: {
            popupAccentColor: localData.popupAccentColor || ''
        }
    };
    return data;
}

async function exportFeedData() {
    const data = await createFeedBackupData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `yt-rewatch-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
}

async function restoreFeedBackup(file) {
    const text = await file.text();
    let data;
    try { data = JSON.parse(text); }
    catch (_) {
        throw new Error(tFeed('feed_invalid_backup', 'This is not a valid JSON backup file.'));
    }
    return restoreFeedBackupData(data);
}

async function restoreFeedBackupData(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error(tFeed('feed_backup_empty', 'Backup file is empty.'));
    }

    const history = Array.isArray(data.history) ? data.history : [];
    const playlists = Array.isArray(data.playlists) ? data.playlists : [];
    if (history.length || playlists.length) {
        await ytStorage.importRecords(history, playlists, true);
    }

    for (const subscription of (Array.isArray(data.subscriptions) ? data.subscriptions : [])) {
        if (subscription) await ytStorage.addSubscription(subscription);
    }
    await restoreCanonicalBackupSubscriptions(data.canonicalSubscriptions);
    for (const item of (Array.isArray(data.watchLater) ? data.watchLater : [])) {
        if (item && item.videoId) await ytStorage.setWatchLater(item.videoId, item);
    }
    if (data.settings && typeof data.settings === 'object') {
        const currentSettings = (await ytStorage.getSettings()) || {};
        await ytStorage.setSettings({ ...currentSettings, ...data.settings });
    }
    if (data.stats && typeof data.stats === 'object') {
        await ytStorage.setStats(data.stats);
    }

    const currentLocal = await chrome.storage.local.get([
        'localVideoPlaylists',
        'feedFeedback',
        'durationCache',
        'shortsCache',
        'releaseDateCache'
    ]);
    const localRestore = {};
    if (data.localPlaylists && typeof data.localPlaylists === 'object') {
        localRestore.localVideoPlaylists = {
            ...(currentLocal.localVideoPlaylists || {}),
            ...data.localPlaylists
        };
    }
    if (data.recommendationPreferences && typeof data.recommendationPreferences === 'object') {
        const currentFeedback = currentLocal.feedFeedback || {};
        localRestore.feedFeedback = {
            notInterested: {
                ...(currentFeedback.notInterested || {}),
                ...(data.recommendationPreferences.notInterested || {})
            },
            channelLess: {
                ...(currentFeedback.channelLess || {}),
                ...(data.recommendationPreferences.channelLess || {})
            },
            channelMore: {
                ...(currentFeedback.channelMore || {}),
                ...(data.recommendationPreferences.channelMore || {})
            }
        };
    }
    if (data.caches && typeof data.caches === 'object') {
        if (data.caches.durations) {
            localRestore.durationCache = {
                ...(currentLocal.durationCache || {}),
                ...data.caches.durations
            };
        }
        if (data.caches.shorts) {
            localRestore.shortsCache = {
                ...(currentLocal.shortsCache || {}),
                ...data.caches.shorts
            };
        }
        if (data.caches.releaseDates) {
            localRestore.releaseDateCache = {
                ...(currentLocal.releaseDateCache || {}),
                ...data.caches.releaseDates
            };
        }
    }
    if (data.interface && data.interface.popupAccentColor) {
        localRestore.popupAccentColor = data.interface.popupAccentColor;
    }
    if (Object.keys(localRestore).length) await chrome.storage.local.set(localRestore);

    await loadData();
    await loadFeedSettingsForm();
    notifySettingsChanged((await ytStorage.getSettings()) || {});
}

function notifySubsChanged() {
    try {
        chrome.tabs.query({ url: ['*://*.youtube.com/*'] }, (tabs) => {
            (tabs || []).forEach((tab) => {
                chrome.tabs.sendMessage(tab.id, { type: 'ytvhtSubsChanged' }).catch(() => {});
            });
        });
    } catch (_) { /* ignore */ }
}

function setFeedSettingsMessage(text) {
    const message = document.getElementById('feedSettingsMessage');
    if (message) {
        delete message.dataset.initializing;
        message.textContent = text || '';
    }
}

function refreshActiveFeedDataView() {
    if (settingsActive) return;
    if (historyActive) {
        renderHistory();
    } else if (subscriptionsActive) {
        renderSubscriptions();
    } else if (playlistsActive) {
        renderPlaylists();
    } else if (analyticsActive) {
        renderAnalytics();
    } else {
        render();
    }
}

function parseWatchHistoryHtml(htmlText) {
    const doc = new DOMParser().parseFromString(htmlText, 'text/html');
    const records = [];
    const seen = new Set();

    let cells = Array.from(doc.querySelectorAll('div.content-cell'));
    if (cells.length === 0) cells = [doc.body];

    let index = 0;
    cells.forEach((cell) => {
        const videoLink = cell.querySelector('a[href*="watch?v="], a[href*="youtu.be/"]');
        if (!videoLink) return;
        const href = videoLink.getAttribute('href') || '';
        const idMatch = href.match(/[?&]v=([\w-]{11})/) || href.match(/youtu\.be\/([\w-]{11})/);
        if (!idMatch) return;
        const videoId = idMatch[1];
        if (seen.has(videoId)) return;
        seen.add(videoId);

        const title = (videoLink.textContent || '').trim() || 'Unknown Title';

        let channelName = '';
        let channelId = '';
        const chLink = cell.querySelector('a[href*="/channel/"], a[href*="youtube.com/@"]');
        if (chLink) {
            channelName = (chLink.textContent || '').trim();
            const chHref = chLink.getAttribute('href') || '';
            const cm = chHref.match(/\/channel\/(UC[\w-]+)/) || chHref.match(/\/(@[\w.\-]+)/);
            if (cm) channelId = cm[1];
        }

        let timestamp = 0;
        const dateMatch = (cell.textContent || '').match(
            /([A-Z][a-z]{2,8} \d{1,2}, \d{4}, [\d:]+(?:\s?[AP]M)?[^\n]*)/
        );
        if (dateMatch) {
            const parsed = Date.parse(dateMatch[1]);
            if (!isNaN(parsed)) timestamp = parsed;
        }
        if (!timestamp) timestamp = Date.now() - index * 60000;
        index++;

        records.push({
            videoId,
            title,
            url: `https://www.youtube.com/watch?v=${videoId}`,
            channelName: channelName || 'Unknown Channel',
            channelId,
            time: 0,
            duration: 0,
            importedHistory: true,
            timestamp
        });
    });

    return records;
}

function parseSubscriptionsExport(text, fileName) {
    const subs = [];
    const trimmed = text.trim();
    const looksJson = (fileName && fileName.toLowerCase().endsWith('.json')) ||
        trimmed.startsWith('[') || trimmed.startsWith('{');

    if (looksJson) {
        try {
            const data = JSON.parse(trimmed);
            const arr = Array.isArray(data) ? data : (data.subscriptions || []);
            arr.forEach((item) => {
                const snip = item.snippet || item;
                const resource = snip.resourceId || {};
                const ucid = resource.channelId || snip.channelId || item.channelId;
                const title = snip.title || item.title || 'Unknown Channel';
                if (ucid && /^UC[\w-]+$/.test(ucid)) {
                    subs.push({ ucid, title, url: `https://www.youtube.com/channel/${ucid}` });
                }
            });
            return subs;
        } catch (_) { /* fall through to CSV */ }
    }

    const lines = trimmed.split(/\r?\n/);
    lines.forEach((line, i) => {
        if (!line.trim()) return;
        if (i === 0 && /channel id/i.test(line)) return;
        const c1 = line.indexOf(',');
        const c2 = c1 >= 0 ? line.indexOf(',', c1 + 1) : -1;
        if (c1 < 0 || c2 < 0) return;
        const id = line.slice(0, c1).trim();
        const url = line.slice(c1 + 1, c2).trim();
        const title = line.slice(c2 + 1).trim().replace(/^"|"$/g, '');
        if (/^UC[\w-]+$/.test(id)) {
            subs.push({
                ucid: id,
                title: title || 'Unknown Channel',
                url: url || `https://www.youtube.com/channel/${id}`
            });
        }
    });
    return subs;
}

async function importYouTubeHistoryFile(file) {
    const text = await file.text();
    const records = parseWatchHistoryHtml(text);
    if (!records.length) {
        throw new Error(tFeed(
            'feed_no_history_videos_found',
            'No videos found. Use watch-history.html from Google Takeout.'
        ));
    }
    const result = await ytStorage.importRecords(records, [], true);
    await loadData();
    return result.importedVideos || records.length;
}

async function importYouTubeChannelsFile(file) {
    const text = await file.text();
    const subs = parseSubscriptionsExport(text, file.name);
    if (!subs.length) {
        throw new Error(tFeed(
            'feed_no_channels_found',
            'No channels found. Use subscriptions.csv from YouTube or Takeout.'
        ));
    }
    const { outcome, queuedChannelIds } = await ytvhtFeedSubscriptionImport.importCanonicalSubscriptions(ytIndexedDBStorage, subs);
    localSubscriptions = (await ytvhtFeedViewData.loadCanonicalFeedViewData(ytIndexedDBStorage)).subscriptions;
    const scheduler = ensureSharedFeedScheduler();
    if (scheduler && queuedChannelIds.length) {
        await scheduler.initializeSubscriptions(queuedChannelIds);
        setFeedSettingsMessage(tFeed(
            'feed_imported_channels_preparing',
            'Imported $1 channels; preparing your local feed.',
            [feedFormatNumber(outcome.added)]
        ));
        requestPageActiveFeedWork().catch((error) => {
            console.warn('[feed] initialization after import failed', error);
        });
    }
    notifySubsChanged();
    return outcome;
}

async function resetAllFeedData() {
    setRefreshUi(false);
    setStatus('', false);
    await ytStorage.resetAllData();
    watchedMap = {};
    localSubscriptions = [];
    allVideos = [];
    lastUpdated = 0;
    feedCachePolicy = '';
    feedFeedback = { notInterested: {}, channelLess: {}, channelMore: {} };
    releaseDateCache = {};
    durationCache = {};
    shortsCache = {};
    feedDiagnostics = [];
    await loadFeedSettingsForm();
    applyFeedTheme(FEED_SETTINGS_DEFAULTS.themePreference || 'system');
    applyAccentColor(FEED_SETTINGS_DEFAULTS.accentColor || 'blue');
    const searchInput = document.getElementById('search');
    if (searchInput) searchInput.value = '';
    searchVisibleLimit = SEARCH_PAGE_SIZE;
    shortsOnly = false;
    subscriptionsChronological = false;
    channelActive = false;
    reshuffleHome();
    setRefreshUi(false);
    setStatus('', false);
    showFeed();
    render();
    setTimeout(() => {
        setRefreshUi(false);
        setStatus('', false);
    }, 0);
    setTimeout(() => {
        setRefreshUi(false);
        setStatus('', false);
    }, 750);
    notifySubsChanged();
}

function getFeedSettingsUrl() {
    const runtime = (typeof browser !== 'undefined' && browser.runtime)
        ? browser.runtime
        : chrome.runtime;
    return runtime.getURL('feed.html') + '#settings';
}

function openFeedSettingsPage() {
    const url = getFeedSettingsUrl();
    if (chrome.tabs && typeof chrome.tabs.create === 'function') {
        try {
            chrome.tabs.create({ url });
            return;
        } catch (_) { /* fall through */ }
    }
    window.open(url, '_blank', 'noopener');
}

function initFeedDataSettings() {
    const restoreInput = document.getElementById('restoreBackupFile');
    const historyInput = document.getElementById('importHistoryFile');
    const channelsInput = document.getElementById('importChannelsFile');

    document.getElementById('exportFeedData')?.addEventListener('click', async () => {
        const button = document.getElementById('exportFeedData');
        setFeedSettingsMessage(tFeed('feed_creating_backup', 'Creating backup…'));
        if (button) button.disabled = true;
        try {
            await exportFeedData();
            setFeedSettingsMessage(tFeed('feed_backup_downloaded', 'Backup downloaded.'));
        } catch (error) {
            console.error('[settings] export failed', error);
            setFeedSettingsMessage(tFeed('feed_backup_create_failed', 'Could not create backup.'));
        } finally {
            if (button) button.disabled = false;
        }
    });

    document.getElementById('importFeedData')?.addEventListener('click', () => {
        if (restoreInput) {
            restoreInput.value = '';
            restoreInput.click();
        }
    });
    restoreInput?.addEventListener('change', async () => {
        const file = restoreInput.files && restoreInput.files[0];
        if (!file) return;
        if (!confirm(tFeed(
            'feed_confirm_restore_backup',
            'Restore this backup and merge it with your current local data?'
        ))) {
            restoreInput.value = '';
            return;
        }
        const button = document.getElementById('importFeedData');
        setFeedSettingsMessage(tFeed('feed_restoring_backup', 'Restoring backup…'));
        if (button) button.disabled = true;
        try {
            await restoreFeedBackup(file);
            refreshActiveFeedDataView();
            setFeedSettingsMessage(tFeed('feed_backup_restored', 'Backup restored. Your local data is ready.'));
        } catch (error) {
            console.error('[settings] restore failed', error);
            setFeedSettingsMessage(error.message || tFeed('feed_backup_restore_failed', 'Could not restore backup.'));
        } finally {
            if (button) button.disabled = false;
            restoreInput.value = '';
        }
    });

    document.getElementById('importYouTubeHistory')?.addEventListener('click', () => {
        if (historyInput) {
            historyInput.value = '';
            historyInput.click();
        }
    });
    historyInput?.addEventListener('change', async () => {
        const file = historyInput.files && historyInput.files[0];
        if (!file) return;
        const button = document.getElementById('importYouTubeHistory');
        setFeedSettingsMessage(tFeed('feed_importing_history', 'Importing YouTube history…'));
        if (button) button.disabled = true;
        try {
            const count = await importYouTubeHistoryFile(file);
            refreshActiveFeedDataView();
            setFeedSettingsMessage(tFeed(
                'feed_imported_history_videos',
                'Imported $1 videos into your history.',
                [feedFormatNumber(count)]
            ));
        } catch (error) {
            console.error('[settings] history import failed', error);
            setFeedSettingsMessage(error.message || tFeed('feed_history_import_failed', 'Could not import history.'));
        } finally {
            if (button) button.disabled = false;
            historyInput.value = '';
        }
    });

    document.getElementById('importYouTubeChannels')?.addEventListener('click', () => {
        if (channelsInput) {
            channelsInput.value = '';
            channelsInput.click();
        }
    });
    channelsInput?.addEventListener('change', async () => {
        const file = channelsInput.files && channelsInput.files[0];
        if (!file) return;
        const button = document.getElementById('importYouTubeChannels');
        setFeedSettingsMessage(tFeed('feed_importing_channels', 'Importing channels…'));
        if (button) button.disabled = true;
        try {
            const outcome = await importYouTubeChannelsFile(file);
            setFeedSettingsMessage(tFeed(
                'feed_imported_channels_queued',
                'Imported $1 channels; $2 queued to prepare your local feed.',
                [feedFormatNumber(outcome.added), feedFormatNumber(outcome.initializationQueued)]
            ));
        } catch (error) {
            console.error('[settings] channels import failed', error);
            setFeedSettingsMessage(error.message || tFeed('feed_channels_import_failed', 'Could not import channels.'));
        } finally {
            if (button) button.disabled = false;
            channelsInput.value = '';
        }
    });

    document.getElementById('resetAllData')?.addEventListener('click', async () => {
        const button = document.getElementById('resetAllData');
        const confirmed = confirm(tFeed(
            'feed_confirm_reset_all',
            'Reset all YT re:Watch data in this browser?\n\nThis permanently deletes history, subscriptions, playlists, watch later, settings, stats, and caches.\n\nThis cannot be undone.'
        ));
        if (!confirmed) return;
        if (!confirm(tFeed('feed_confirm_reset_last_chance', 'Last chance: reset everything now?'))) return;

        if (button) button.disabled = true;
        setFeedSettingsMessage(tFeed('feed_resetting_all_data', 'Resetting all data…'));
        try {
            await resetAllFeedData();
            setFeedSettingsMessage(tFeed('feed_all_data_reset', 'All local data has been reset.'));
        } catch (error) {
            console.error('[settings] reset failed', error);
            setFeedSettingsMessage(tFeed('feed_reset_all_failed', 'Could not reset all data.'));
        } finally {
            if (button) button.disabled = false;
        }
    });
}
