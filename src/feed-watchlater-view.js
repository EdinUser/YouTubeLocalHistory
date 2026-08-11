async function renderWatchLater() {
    const list = document.getElementById('watchLaterList');
    const empty = document.getElementById('watchLaterEmpty');
    const count = document.getElementById('watchLaterCount');
    if (!list || !empty || !count) return;

    let records = [];
    try {
        const items = await ytStorage.getAllWatchLater();
        records = Object.values(items || {})
            .filter((item) => item && item.videoId)
            .sort((a, b) => Number(b.addedAt || 0) - Number(a.addedAt || 0));
        records = await Promise.all(records.map(enrichWatchLaterRecord));
    } catch (error) {
        console.error('[watch-later] could not load saved videos', error);
    }

    list.textContent = '';
    records.forEach((record) => {
        const video = {
            ...record,
            url: record.url || `https://www.youtube.com/watch?v=${record.videoId}`
        };
        const row = buildResultRow(video, {
            metaText: watchLaterAddedText(record),
            overlayRecord: watchedMap[record.videoId]
        });
        row.classList.add('history-row');

        const remove = document.createElement('button');
        remove.className = 'btn history-remove';
        remove.type = 'button';
        remove.textContent = tFeed('feed_remove', 'Remove');
        remove.addEventListener('click', async () => {
            remove.disabled = true;
            try {
                await ytStorage.removeWatchLater(record.videoId);
                await renderWatchLater();
            } catch (error) {
                console.error('[watch-later] could not remove saved video', error);
                remove.disabled = false;
            }
        });
        const actions = row.querySelector('.yt-row-actions');
        if (actions) actions.insertBefore(remove, actions.firstChild);
        else row.appendChild(remove);
        list.appendChild(row);
    });

    count.textContent = feedPlural(
        'feed_watch_later_entries',
        records.length,
        '$1 saved video',
        '$1 saved videos'
    );
    empty.style.display = records.length ? 'none' : 'block';
}

// Older right-click saves can lack metadata if YouTube had not mounted the
// matching card. Repair those records on first display, rather than making a
// user remove and save each video again.
async function enrichWatchLaterRecord(record) {
    if (record.title && record.channelName) return record;
    const url = record.url || `https://www.youtube.com/watch?v=${record.videoId}`;
    try {
        const response = await fetch(
            'https://www.youtube.com/oembed?url=' + encodeURIComponent(url) + '&format=json'
        );
        if (!response.ok) return { ...record, url };
        const metadata = await response.json();
        const repaired = {
            ...record,
            url,
            title: record.title || (typeof metadata.title === 'string' ? metadata.title.trim() : ''),
            channelName: record.channelName || (typeof metadata.author_name === 'string' ? metadata.author_name.trim() : '')
        };
        if ((repaired.title && !record.title) || (repaired.channelName && !record.channelName)) {
            await ytStorage.setWatchLater(record.videoId, repaired);
        }
        return repaired;
    } catch (_) {
        return { ...record, url };
    }
}

function watchLaterAddedText(record) {
    const addedAt = Number(record.addedAt || 0);
    if (!addedAt) return tFeed('feed_unknown_date', 'Unknown date');
    return tFeed('feed_watch_later_added', 'Saved $1', [new Date(addedAt).toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    })]);
}

function showWatchLater() {
    rememberView('watchlater');
    document.body.classList.remove('shorts-mode');
    setRefreshVisible(false);
    setCreatePlaylistVisible(false);
    setSaveSettingsVisible(false);
    setClearSubscriptionsVisible(false);
    setClearHistoryVisible(false);
    setFeedOptionsVisible(false);
    showFeedStatus(false);
    leaveSearchPage();
    analyticsActive = false;
    subscriptionsActive = false;
    playlistsActive = false;
    historyActive = false;
    settingsActive = false;
    channelActive = false;
    watchLaterActive = true;

    ['localHeading', 'grid', 'localSearchResults', 'empty', 'ytSection',
        'analyticsSection', 'subscriptionsSection', 'playlistsSection',
        'historySection', 'settingsSection', 'channelSection'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    const chips = document.querySelector('.chips');
    if (chips) chips.style.display = 'none';
    const section = document.getElementById('watchLaterSection');
    if (section) section.style.display = 'block';
    setActiveNav('navWatchLater');
    renderWatchLater();
}
