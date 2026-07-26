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

function getPlaylistMetadataFromBackground(playlistId) {
    return new Promise((resolve) => {
        try {
            chrome.runtime.sendMessage(
                { type: 'getPlaylistMetadata', playlistId },
                (response) => {
                    if (chrome.runtime.lastError) {
                        resolve(null);
                        return;
                    }
                    resolve(response && !response.error ? response : null);
                }
            );
        } catch (_) {
            resolve(null);
        }
    });
}

async function enrichPlaylistCard(record) {
    if (isEmptyUntitledPlaylist(record)) return record;
    if (!record || record.thumbnail) return record;
    try {
        const url = record.url || `https://www.youtube.com/playlist?list=${record.playlistId}`;
        const seedVideoId = playlistSeedVideoId(record);
        if (seedVideoId) {
            record.videoId = seedVideoId;
            record.thumbnail = `https://i.ytimg.com/vi/${seedVideoId}/hqdefault.jpg`;
        }

        if (!record.thumbnail) {
            const data = await getPlaylistMetadataFromBackground(record.playlistId);
            if (data) {
                if (data.thumbnail) record.thumbnail = data.thumbnail;
                if ((!record.title || record.title === 'Untitled Playlist') && data.title) {
                    record.title = data.title;
                }
            }
        }

        // Keep a page-parser fallback in case oEmbed is unavailable.
        if (!record.thumbnail) {
            await ensureConsentCookie();
            const response = await fetch(url, { credentials: 'include' });
            if (response.ok) {
                const html = await response.text();
                const videoMatch =
                    html.match(/"videoId":"([A-Za-z0-9_-]{11})"/) ||
                    html.match(/\\"videoId\\":\\"([A-Za-z0-9_-]{11})\\"/);
                const countMatch =
                    html.match(/"videoCount":"(\d+)"/) ||
                    html.match(/"numVideosText":\{"runs":\[\{"text":"([\d,]+)"/);
                if (videoMatch) record.thumbnail = `https://i.ytimg.com/vi/${videoMatch[1]}/hqdefault.jpg`;
                if (countMatch) record.videoCount = Number(String(countMatch[1]).replace(/,/g, '')) || 0;
            }
        }

        if (record.thumbnail || record.videoCount || record.title) {
            const existing = await ytStorage.getPlaylist(record.playlistId);
            await ytStorage.setPlaylist(record.playlistId, {
                ...(existing || record),
                title: record.title,
                videoId: record.videoId || (existing && existing.videoId) || '',
                thumbnail: record.thumbnail,
                videoCount: record.videoCount || 0,
                lastUpdated: Number((existing || record).lastUpdated || Date.now())
            });
        }
    } catch (_) { /* keep the styled fallback cover */ }
    return record;
}

function extractJsonObjectAfter(html, marker) {
    const markerIndex = html.indexOf(marker);
    if (markerIndex < 0) return null;
    const start = html.indexOf('{', markerIndex + marker.length);
    if (start < 0) return null;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < html.length; index++) {
        const char = html[index];
        if (inString) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === '"') inString = false;
            continue;
        }
        if (char === '"') inString = true;
        else if (char === '{') depth++;
        else if (char === '}') {
            depth--;
            if (depth === 0) {
                try { return JSON.parse(html.slice(start, index + 1)); } catch (_) { return null; }
            }
        }
    }
    return null;
}

function playlistVideosFromInitialData(data) {
    const found = new Map();
    const visit = (node) => {
        if (!node || typeof node !== 'object') return;
        const renderer = node.playlistVideoRenderer || node.playlistPanelVideoRenderer;
        if (renderer && renderer.videoId && !found.has(renderer.videoId)) {
            const owner = renderer.shortBylineText || renderer.longBylineText;
            let channelUrl = '';
            try {
                const endpoint = owner.runs[0].navigationEndpoint.browseEndpoint;
                channelUrl = endpoint.canonicalBaseUrl
                    ? `https://www.youtube.com${endpoint.canonicalBaseUrl}`
                    : `https://www.youtube.com/channel/${endpoint.browseId}`;
            } catch (_) { /* optional */ }
            const thumbs = renderer.thumbnail && renderer.thumbnail.thumbnails;
            found.set(renderer.videoId, {
                videoId: renderer.videoId,
                title: runsText(renderer.title) || 'YouTube video',
                channelName: runsText(owner),
                channelUrl,
                thumbnail: Array.isArray(thumbs) && thumbs.length
                    ? thumbs[thumbs.length - 1].url
                    : `https://i.ytimg.com/vi/${renderer.videoId}/hqdefault.jpg`,
                url: `https://www.youtube.com/watch?v=${renderer.videoId}`,
        _durationText: cleanDurationText(runsText(renderer.lengthText)),
                savedAt: Date.now()
            });
        }
        Object.values(node).forEach(visit);
    };
    visit(data);
    return Object.fromEntries(found);
}

async function importSavedPlaylistVideos(record) {
    if (!record || record._local || !record.playlistId) return record && record.items || {};
    if (Object.keys(record.items || {}).length) return record.items;
    try {
        await ensureConsentCookie();
        const url = record.url || `https://www.youtube.com/playlist?list=${record.playlistId}`;
        const response = await fetch(url, { credentials: 'include' });
        if (!response.ok) return {};
        const html = await response.text();
        const initialData =
            extractJsonObjectAfter(html, 'var ytInitialData =') ||
            extractJsonObjectAfter(html, 'window["ytInitialData"] =') ||
            extractJsonObjectAfter(html, 'ytInitialData =');
        const items = playlistVideosFromInitialData(initialData);
        if (!Object.keys(items).length) return {};
        const existing = await ytStorage.getPlaylist(record.playlistId);
        await ytStorage.setPlaylist(record.playlistId, {
            ...(existing || record),
            playlistId: record.playlistId,
            localItems: items,
            videoCount: Object.keys(items).length,
            timestamp: Date.now(),
            lastUpdated: Date.now()
        });
        record.items = items;
        record._hasLocalItems = true;
        record.videoCount = Object.keys(items).length;
        return items;
    } catch (error) {
        console.warn('[playlists] could not import playlist videos', error);
        return {};
    }
}

async function enrichLocalPlaylistMetadata(record, videos) {
    const missing = [];
    videos.forEach((video) => {
        if (!video.published && releaseDateCache[video.videoId]) {
            video.published = releaseDateCache[video.videoId];
        }
        if (!video.duration && durationCache[video.videoId]) {
            video.duration = durationCache[video.videoId];
        }
        video._durationText = cleanDurationText(video._durationText);
        if ((!video.published || !video.duration) && video.videoId) missing.push(video);
    });
    if (!missing.length) return;

    await ensureConsentCookie();
    await runPool(missing.slice(0, 80), 8, async (video) => {
        const metadata = await fetchSearchMetadata(video.videoId);
        if (!metadata) return;
        if (metadata.published) {
            video.published = metadata.published;
            releaseDateCache[video.videoId] = metadata.published;
        }
        if (metadata.duration) {
            video.duration = metadata.duration;
            video._durationText = formatDuration(metadata.duration);
            durationCache[video.videoId] = metadata.duration;
        }
        if (metadata.isLive) video.isLive = true;
    });
    await ytStorage.setReleaseDateCache(releaseDateCache);
    await ytStorage.setDurationCache(durationCache);

    const items = Object.fromEntries(videos.map((video) => [video.videoId, video]));
    record.items = items;
    if (record._local) {
        const stored = await chrome.storage.local.get(['localVideoPlaylists']);
        const playlists = stored.localVideoPlaylists || {};
        if (playlists[record.playlistId]) {
            playlists[record.playlistId].items = items;
            playlists[record.playlistId].order = videos.map((video) => video.videoId);
            playlists[record.playlistId].updatedAt = Date.now();
            await chrome.storage.local.set({ localVideoPlaylists: playlists });
        }
    } else {
        const existing = await ytStorage.getPlaylist(record.playlistId);
        await ytStorage.setPlaylist(record.playlistId, {
            ...(existing || record),
            localItems: items,
            localOrder: videos.map((video) => video.videoId),
            videoCount: videos.length,
            timestamp: Date.now(),
            lastUpdated: Date.now()
        });
    }
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
    await renderLocalPlaylistDetail(record, false);
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
    handle.title = 'Drag to reorder';
    handle.setAttribute('aria-label', 'Drag to reorder');
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

