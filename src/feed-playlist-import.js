function playlistSeedVideoId(record) {
    if (record && /^[A-Za-z0-9_-]{11}$/.test(record.videoId || '')) return record.videoId;
    const playlistId = String((record && record.playlistId) || '');
    // YouTube Mix IDs end with the 11-character seed video ID.
    if (/^RD(?:MM)?[A-Za-z0-9_-]{11}$/.test(playlistId)) return playlistId.slice(-11);
    return '';
}

function isEmptyUntitledPlaylist(record) {
    if (!record || record._local || record.ignoreVideos) return false;
    const title = String(record.title || '').trim().toLowerCase();
    const hasDefaultTitle = !title || title === 'untitled playlist' || title === 'unknown playlist';
    const hasItems = Object.keys(record.items || record.localItems || {}).length > 0;
    return hasDefaultTitle &&
        !hasItems &&
        !record.thumbnail &&
        !record.videoId &&
        !Number(record.videoCount || 0);
}

async function removeVideoFromLocalPlaylist(record, videoId) {
    delete record.items[videoId];
    record.order = (record.order || []).filter((id) => id !== videoId);
    if (record.coverVideoId === videoId) delete record.coverVideoId;
    if (record._local) {
        const stored = await chrome.storage.local.get(['localVideoPlaylists']);
        const playlists = stored.localVideoPlaylists || {};
        if (playlists[record.playlistId]) {
            playlists[record.playlistId].items = record.items;
            playlists[record.playlistId].order = record.order;
            if (record.coverVideoId) playlists[record.playlistId].coverVideoId = record.coverVideoId;
            else delete playlists[record.playlistId].coverVideoId;
            playlists[record.playlistId].updatedAt = Date.now();
            await chrome.storage.local.set({ localVideoPlaylists: playlists });
        }
    } else {
        const existing = await ytStorage.getPlaylist(record.playlistId);
        const update = {
            ...(existing || record),
            localItems: record.items,
            localOrder: record.order,
            videoCount: Object.keys(record.items).length,
            timestamp: Date.now(),
            lastUpdated: Date.now()
        };
        if (record.coverVideoId) update.coverVideoId = record.coverVideoId;
        else delete update.coverVideoId;
        await ytStorage.setPlaylist(record.playlistId, update);
    }
    await renderLocalPlaylistDetail(record);
}

function orderedPlaylistVideos(record, items) {
    const byId = items || {};
    const savedOrder = Array.isArray(record.order) ? record.order : [];
    const ordered = savedOrder.map((videoId) => byId[videoId]).filter(Boolean);
    const included = new Set(ordered.map((video) => video.videoId));
    const remaining = Object.values(byId)
        .filter((video) => video && !included.has(video.videoId))
        .sort((a, b) => Number(b.savedAt || 0) - Number(a.savedAt || 0));
    return ordered.concat(remaining);
}

async function savePlaylistOrder(record, videoIds) {
    record.order = videoIds.slice();
    if (record._local) {
        const stored = await chrome.storage.local.get(['localVideoPlaylists']);
        const playlists = stored.localVideoPlaylists || {};
        if (playlists[record.playlistId]) {
            playlists[record.playlistId].order = record.order;
            playlists[record.playlistId].updatedAt = Date.now();
            await chrome.storage.local.set({ localVideoPlaylists: playlists });
        }
    } else {
        const existing = await ytStorage.getPlaylist(record.playlistId);
        await ytStorage.setPlaylist(record.playlistId, {
            ...(existing || record),
            localOrder: record.order,
            timestamp: Date.now(),
            lastUpdated: Date.now()
        });
    }
}

async function setPlaylistCover(record, videoId) {
    if (!record || !videoId) return;
    const video = (record.items || {})[videoId];
    record.coverVideoId = videoId;
    if (video && video.thumbnail) record.thumbnail = video.thumbnail;
    if (record._local) {
        const stored = await chrome.storage.local.get(['localVideoPlaylists']);
        const playlists = stored.localVideoPlaylists || {};
        if (playlists[record.playlistId]) {
            playlists[record.playlistId].coverVideoId = videoId;
            playlists[record.playlistId].updatedAt = Date.now();
            await chrome.storage.local.set({ localVideoPlaylists: playlists });
        }
    } else {
        const existing = await ytStorage.getPlaylist(record.playlistId);
        await ytStorage.setPlaylist(record.playlistId, {
            ...(existing || record),
            coverVideoId: videoId,
            thumbnail: (video && video.thumbnail) || (existing && existing.thumbnail) || record.thumbnail,
            lastUpdated: Date.now()
        });
    }
}

function makePlaylistRowDraggable(row, video, record, detail, enabled) {
    if (enabled === false) {
        row.classList.add('playlist-detail-row');
        return;
    }
    row.classList.add('playlist-sort-row');
    row.dataset.videoId = video.videoId;

    const handle = document.createElement('button');
    handle.className = 'playlist-drag-handle';
    handle.type = 'button';
    handle.title = tFeed('feed_drag_reorder', 'Drag to reorder');
    handle.setAttribute('aria-label', tFeed('feed_drag_reorder', 'Drag to reorder'));
    handle.textContent = '☰';
    handle.draggable = true;
    row.prepend(handle);

    handle.addEventListener('dragstart', (event) => {
        row.classList.add('dragging');
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', video.videoId);
    });
    handle.addEventListener('dragend', async () => {
        row.classList.remove('dragging');
        detail.querySelectorAll('.playlist-sort-row').forEach((item) => {
            item.classList.remove('drag-over');
        });
        const order = Array.from(detail.querySelectorAll('.playlist-sort-row'))
            .map((item) => item.dataset.videoId)
            .filter(Boolean);
        try { await savePlaylistOrder(record, order); }
        catch (error) { console.error('[playlists] could not save order', error); }
    });
    row.addEventListener('dragover', (event) => {
        event.preventDefault();
        const dragging = detail.querySelector('.playlist-sort-row.dragging');
        if (!dragging || dragging === row) return;
        const box = row.getBoundingClientRect();
        const after = event.clientY > box.top + box.height / 2;
        detail.insertBefore(dragging, after ? row.nextSibling : row);
        row.classList.add('drag-over');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
}
