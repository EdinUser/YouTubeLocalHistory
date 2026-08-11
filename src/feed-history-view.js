async function renderHistory() {
    const list = document.getElementById('historyList');
    const empty = document.getElementById('historyEmpty');
    const count = document.getElementById('historyCount');
    const loadMore = document.getElementById('historyLoadMore');
    const clearAll = document.getElementById('clearHistoryPage');
    if (!list || !empty || !count || !loadMore) return;

    let videoMap = {};
    try { videoMap = await ytStorage.getAllVideos(); } catch (_) { /* show empty */ }
    let records = Object.entries(videoMap || {})
        .map(([videoId, value]) => ({ ...(value || {}), videoId: (value && value.videoId) || videoId }))
        .filter(isVisibleHistoryRecord)
        .filter((video) => !isShortsHistoryRecord(video))
        .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));

    const visible = records.slice(0, historyVisibleLimit);
    list.textContent = '';
    visible.forEach((video) => {
        const row = buildResultRow(video, {
            metaText: historyWatchedText(video),
            overlayRecord: video
        });
        row.classList.add('history-row');
        const remove = document.createElement('button');
        remove.className = 'btn history-remove';
        remove.type = 'button';
        remove.textContent = tFeed('feed_remove', 'Remove');
        remove.addEventListener('click', async () => {
            remove.disabled = true;
            try {
                await ytStorage.removeVideo(video.videoId);
                delete watchedMap[video.videoId];
                await renderHistory();
            } catch (error) {
                console.error('[history] remove failed', error);
                remove.disabled = false;
            }
        });
        const actions = row.querySelector('.yt-row-actions');
        if (actions) actions.insertBefore(remove, actions.firstChild);
        else row.appendChild(remove);
        list.appendChild(row);
    });

    count.textContent = feedPlural('feed_history_entries', records.length, '$1 history entry', '$1 history entries');
    if (clearAll) clearAll.style.display = records.length ? '' : 'none';
    empty.style.display = records.length ? 'none' : 'block';
    loadMore.style.display = visible.length < records.length ? '' : 'none';
    loadMore.textContent = visible.length < records.length
        ? tFeed('feed_load_more_remaining', 'Load more ($1 remaining)', [feedFormatNumber(records.length - visible.length)])
        : tFeed('feed_load_more', 'Load more');
}

function refreshHistoryRow(videoId, record) {
    const row = Array.from(document.querySelectorAll('#historyList .history-row'))
        .find((candidate) => candidate.dataset.ytvhtVideoId === videoId);
    if (!row || !isVisibleHistoryRecord(record) || isShortsHistoryRecord(record)) return false;

    const meta = row.querySelector('.yt-row-meta');
    if (meta) meta.textContent = historyWatchedText(record);

    const thumbWrap = row.querySelector('.ytvht-thumb-wrap');
    if (thumbWrap) {
        const existingDuration = thumbWrap.querySelector('.ytvht-card-duration');
        const durationText = Number(record.duration || 0) > 0 ? formatDuration(record.duration) : '';
        if (durationText) {
            const badge = existingDuration || document.createElement('span');
            badge.className = 'ytvht-card-duration';
            badge.textContent = durationText;
            if (!existingDuration) thumbWrap.appendChild(badge);
        } else if (existingDuration) {
            existingDuration.remove();
        }
    }
    return true;
}

function showHistory() {
    rememberView('history');
    document.body.classList.remove('shorts-mode');
    setRefreshVisible(false);
    setCreatePlaylistVisible(false);
    setSaveSettingsVisible(false);
    setClearSubscriptionsVisible(false);
    setClearHistoryVisible(true);
    setFeedOptionsVisible(false);
    showFeedStatus(false);
    leaveSearchPage();
    analyticsActive = false;
    subscriptionsActive = false;
    playlistsActive = false;
    historyActive = true;
    settingsActive = false;
    channelActive = false;
    watchLaterActive = false;
    ['localHeading', 'grid', 'localSearchResults', 'empty', 'ytSection',
        'analyticsSection', 'subscriptionsSection', 'playlistsSection', 'settingsSection', 'channelSection', 'watchLaterSection'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    const chips = document.querySelector('.chips');
    if (chips) chips.style.display = 'none';
    const section = document.getElementById('historySection');
    if (section) section.style.display = 'block';
    setActiveNav('navHistory');
    renderHistory();
}

function isVisibleHistoryRecord(video) {
    if (!video || !video.videoId) return false;
    if (Number(video.time || 0) > 0) return true;
    if (video.importedHistory) return true;
    return Number(video.timestamp || 0) > 0 && !!(video.title || video.url);
}

function isShortsHistoryRecord(video) {
    return video?.isShorts === true || String(video?.url || '').includes('/shorts/');
}
