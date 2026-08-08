const playlistAsync = globalThis.ytvhtFeedAsync;

function playlistMetaText(record) {
    const count = Number(record.videoCount || 0);
    const videoPart = count
        ? feedPlural('feed_videos', count, '$1 video', '$1 videos')
        : tFeed('feed_empty', 'Empty');
    const savedPart = tFeed('feed_saved_on', 'Saved $1', [formatSavedDate(record.timestamp || record.lastUpdated)]);
    if (record._local) return `${videoPart} · ${savedPart}`;
    if (record._hasLocalItems) {
        const localItemCount = Object.keys(record.items || {}).length;
        return `${videoPart} · ${tFeed('feed_local_count', '$1 local', [feedFormatNumber(localItemCount)])} · ${savedPart}`;
    }
    return `${videoPart} · ${savedPart}`;
}

function playlistCoverThumbnail(record) {
    const items = record.items || {};
    const coverId = record.coverVideoId;
    if (coverId && items[coverId] && items[coverId].thumbnail) {
        return items[coverId].thumbnail;
    }
    if (record.thumbnail) return record.thumbnail;
    const seedVideoId = playlistSeedVideoId(record);
    if (seedVideoId) return `https://i.ytimg.com/vi/${seedVideoId}/hqdefault.jpg`;
    const ordered = orderedPlaylistVideos(record, items);
    if (ordered[0] && ordered[0].thumbnail) return ordered[0].thumbnail;
    const first = Object.values(items).find((video) => video && video.thumbnail);
    return first ? first.thumbnail : '';
}

function appendPlaylistSvgMarkup(svg, markup) {
    const doc = new DOMParser().parseFromString(
        `<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`,
        'image/svg+xml'
    );
    Array.from(doc.documentElement.childNodes).forEach((node) => {
        svg.appendChild(document.importNode(node, true));
    });
}

function closePlaylistActionDialog(backdrop, onKeydown, finish, result) {
    backdrop.hidden = true;
    document.removeEventListener('keydown', onKeydown);
    finish(result);
}

function showPlaylistNameDialog(options) {
    options = options || {};
    return new Promise((resolve) => {
        const backdrop = document.getElementById('playlistActionDialog');
        const titleEl = document.getElementById('playlistActionDialogTitle');
        const body = document.getElementById('playlistActionDialogBody');
        const footer = document.getElementById('playlistActionDialogFooter');
        const closeButton = document.getElementById('playlistActionDialogClose');
        if (!backdrop || !titleEl || !body || !footer || !closeButton) {
            resolve(null);
            return;
        }

        titleEl.textContent = options.title || tFeed('feed_playlist', 'Playlist');
        body.className = '';
        body.textContent = '';
        footer.textContent = '';

        if (options.description) {
            const description = document.createElement('p');
            description.className = 'playlist-action-body';
            description.textContent = options.description;
            body.appendChild(description);
        }

        const form = document.createElement('form');
        form.className = 'playlist-action-form';
        if (options.description) form.classList.add('playlist-action-form-tight');

        const label = document.createElement('label');
        label.className = 'playlist-action-label';
        label.textContent = options.inputLabel || tFeed('feed_playlist_name', 'Playlist name');
        label.htmlFor = 'playlistActionNameInput';

        const input = document.createElement('input');
        input.id = 'playlistActionNameInput';
        input.type = 'text';
        input.maxLength = 80;
        input.value = options.initialValue || '';
        input.placeholder = options.placeholder || tFeed('feed_playlist_name', 'Playlist name');
        input.autocomplete = 'off';

        form.appendChild(label);
        form.appendChild(input);
        body.appendChild(form);

        const cancel = document.createElement('button');
        cancel.className = 'btn';
        cancel.type = 'button';
        cancel.textContent = tFeed('feed_cancel', 'Cancel');

        const save = document.createElement('button');
        save.className = 'btn primary';
        save.type = 'submit';
        save.textContent = options.submitLabel || tFeed('feed_save', 'Save');

        footer.append(cancel, save);

        const onKeydown = (event) => {
            if (event.key === 'Escape') closePlaylistActionDialog(backdrop, onKeydown, resolve, null);
        };

        const submit = (event) => {
            event.preventDefault();
            closePlaylistActionDialog(backdrop, onKeydown, resolve, input.value);
        };

        form.addEventListener('submit', submit);
        save.addEventListener('click', () => {
            if (typeof form.requestSubmit === 'function') {
                form.requestSubmit();
            } else {
                closePlaylistActionDialog(backdrop, onKeydown, resolve, input.value);
            }
        });
        cancel.addEventListener('click', () => closePlaylistActionDialog(backdrop, onKeydown, resolve, null));
        closeButton.onclick = () => closePlaylistActionDialog(backdrop, onKeydown, resolve, null);
        backdrop.onclick = (event) => {
            if (event.target === backdrop) closePlaylistActionDialog(backdrop, onKeydown, resolve, null);
        };

        backdrop.hidden = false;
        document.addEventListener('keydown', onKeydown);
        setTimeout(() => {
            input.focus();
            if (input.value) input.select();
        }, 0);
    });
}

function showPlaylistRenameDialog(record) {
    return showPlaylistNameDialog({
        title: tFeed('feed_rename_playlist', 'Rename playlist'),
        submitLabel: tFeed('feed_save', 'Save'),
        initialValue: record.title || '',
        inputLabel: tFeed('feed_playlist_name', 'Playlist name'),
        placeholder: tFeed('feed_enter_new_name', 'Enter a new name')
    });
}

function showPlaylistCreateDialog() {
    return showPlaylistNameDialog({
        title: tFeed('feed_create_playlist', 'Create playlist'),
        submitLabel: tFeed('feed_create', 'Create'),
        inputLabel: tFeed('feed_playlist_name', 'Playlist name'),
        placeholder: tFeed('feed_my_playlist', 'My playlist'),
        description: tFeed(
            'feed_create_playlist_help',
            'Create an empty playlist, then add videos from the feed using ⋮ → Add to local playlist.'
        )
    });
}

function showPlaylistDeleteDialog(titleText) {
    return new Promise((resolve) => {
        const backdrop = document.getElementById('playlistActionDialog');
        const titleEl = document.getElementById('playlistActionDialogTitle');
        const body = document.getElementById('playlistActionDialogBody');
        const footer = document.getElementById('playlistActionDialogFooter');
        const closeButton = document.getElementById('playlistActionDialogClose');
        if (!backdrop || !titleEl || !body || !footer || !closeButton) {
            resolve(false);
            return;
        }

        titleEl.textContent = tFeed('feed_delete_playlist_question', 'Delete playlist?');
        body.className = 'playlist-action-body';
        body.textContent = tFeed(
            'feed_delete_playlist_body',
            '“$1” will be removed from your local playlists. This cannot be undone.',
            [titleText]
        );
        footer.textContent = '';

        const cancel = document.createElement('button');
        cancel.className = 'btn';
        cancel.type = 'button';
        cancel.textContent = tFeed('feed_cancel', 'Cancel');

        const remove = document.createElement('button');
        remove.className = 'btn danger';
        remove.type = 'button';
        remove.textContent = tFeed('delete_label', 'Delete');

        footer.append(cancel, remove);

        const onKeydown = (event) => {
            if (event.key === 'Escape') closePlaylistActionDialog(backdrop, onKeydown, resolve, false);
        };

        cancel.addEventListener('click', () => closePlaylistActionDialog(backdrop, onKeydown, resolve, false));
        remove.addEventListener('click', () => closePlaylistActionDialog(backdrop, onKeydown, resolve, true));
        closeButton.onclick = () => closePlaylistActionDialog(backdrop, onKeydown, resolve, false);
        backdrop.onclick = (event) => {
            if (event.target === backdrop) closePlaylistActionDialog(backdrop, onKeydown, resolve, false);
        };

        backdrop.hidden = false;
        document.addEventListener('keydown', onKeydown);
        setTimeout(() => remove.focus(), 0);
    });
}

function buildPlaylistCardMenu(titleText, options) {
    options = options || {};
    const wrap = document.createElement('div');
    wrap.className = 'video-menu-wrap playlist-card-menu';
    const toggle = document.createElement('button');
    toggle.className = 'video-menu-button';
    toggle.type = 'button';
    toggle.textContent = '⋮';
    toggle.title = tFeed('feed_playlist_options', 'Playlist options');
    toggle.setAttribute('aria-label', tFeed('feed_playlist_options', 'Playlist options'));
    const menu = document.createElement('div');
    menu.className = 'video-menu';
    menu.hidden = true;

    const addItem = (label, iconPaths, handler) => {
        const item = document.createElement('button');
        item.className = 'video-menu-item';
        item.type = 'button';
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        icon.setAttribute('class', 'video-menu-icon');
        icon.setAttribute('viewBox', '0 0 24 24');
        icon.setAttribute('aria-hidden', 'true');
        appendPlaylistSvgMarkup(icon, iconPaths);
        const text = document.createElement('span');
        text.textContent = label;
        item.appendChild(icon);
        item.appendChild(text);
        item.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            menu.hidden = true;
            item.disabled = true;
            try {
                await handler();
            } catch (error) {
                console.error('[playlists] menu action failed', error);
            } finally {
                item.disabled = false;
            }
        });
        menu.appendChild(item);
    };

    if (typeof options.onRename === 'function') {
        addItem(
            tFeed('feed_rename', 'Rename'),
            '<path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path>',
            options.onRename
        );
    }
    if (typeof options.onDelete === 'function') {
        addItem(tFeed('delete_label', 'Delete'), '<path d="M4 7h16"></path><path d="m9 7 .7-2h4.6l.7 2"></path><path d="M7 7l1 13h8l1-13"></path>', async () => {
            const confirmed = await showPlaylistDeleteDialog(titleText);
            if (!confirmed) return;
            await options.onDelete();
        });
    }

    toggle.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        document.querySelectorAll('.video-menu').forEach((other) => {
            if (other !== menu) other.hidden = true;
        });
        menu.hidden = !menu.hidden;
    });
    wrap.addEventListener('click', (event) => event.stopPropagation());
    wrap.appendChild(toggle);
    wrap.appendChild(menu);
    return wrap;
}

async function deletePlaylistRecord(record) {
    if (record._local) {
        const stored = await chrome.storage.local.get(['localVideoPlaylists']);
        const playlists = stored.localVideoPlaylists || {};
        delete playlists[record.playlistId];
        await chrome.storage.local.set({ localVideoPlaylists: playlists });
    } else {
        await ytStorage.removePlaylist(record.playlistId);
    }
}

async function renamePlaylistRecord(record, newTitle) {
    const trimmed = newTitle.trim();
    if (!trimmed) return 'empty';
    if (record._local) {
        const stored = await chrome.storage.local.get(['localVideoPlaylists']);
        const playlists = stored.localVideoPlaylists || {};
        const duplicate = Object.values(playlists).find((playlist) =>
            playlist.id !== record.playlistId &&
            normalizeText(playlist.title) === normalizeText(trimmed)
        );
        if (duplicate) return 'duplicate';
        const playlist = playlists[record.playlistId];
        if (!playlist) return 'missing';
        playlist.title = trimmed;
        playlist.updatedAt = Date.now();
        await chrome.storage.local.set({ localVideoPlaylists: playlists });
    } else {
        const existing = await ytStorage.getPlaylist(record.playlistId);
        await ytStorage.setPlaylist(record.playlistId, {
            ...(existing || record),
            title: trimmed,
            lastUpdated: Date.now()
        });
    }
    record.title = trimmed;
    return 'ok';
}

async function openRenamePlaylistDialog(record, onRenamed) {
    const newTitle = await showPlaylistRenameDialog(record);
    if (newTitle == null) return;
    const result = await renamePlaylistRecord(record, newTitle);
    if (result === 'empty') {
        setStatus(tFeed('feed_enter_playlist_name', 'Enter a playlist name.'), true);
        return;
    }
    if (result === 'duplicate') {
        setStatus(tFeed('feed_playlist_name_exists', 'A playlist with that name already exists.'), true);
        return;
    }
    if (result === 'missing') {
        setStatus(tFeed('feed_playlist_not_found', 'Could not find that playlist.'), true);
        return;
    }
    setStatus(tFeed('feed_playlist_renamed', 'Renamed to “$1”.', [record.title]), false);
    if (typeof onRenamed === 'function') await onRenamed();
}

function appendPlaylistDetailActions(record, container, onDeleted, onRenamed) {
    container.textContent = '';

    const rename = document.createElement('button');
    rename.className = 'btn';
    rename.type = 'button';
    rename.textContent = tFeed('feed_rename', 'Rename');
    rename.addEventListener('click', () => {
        openRenamePlaylistDialog(record, () => {
            if (typeof onRenamed === 'function') onRenamed(record.title);
        }).catch((error) => {
            console.error('[playlists] rename failed', error);
            setStatus(tFeed('feed_playlist_rename_failed', 'Could not rename playlist.'), true);
        });
    });

    const remove = document.createElement('button');
    remove.className = 'btn danger';
    remove.type = 'button';
    remove.textContent = tFeed('delete_label', 'Delete');
    remove.addEventListener('click', async () => {
        const confirmed = await showPlaylistDeleteDialog(
            record.title || tFeed('feed_this_playlist', 'this playlist')
        );
        if (!confirmed) return;
        remove.disabled = true;
        try {
            await deletePlaylistRecord(record);
            activePlaylistDetailId = null;
            if (typeof onDeleted === 'function') await onDeleted();
            setStatus(tFeed('feed_playlist_removed', 'Removed $1.', [record.title]), false);
        } catch (error) {
            console.error('[playlists] delete failed', error);
            remove.disabled = false;
            setStatus(tFeed('feed_playlist_delete_failed', 'Could not delete playlist.'), true);
        }
    });

    container.append(rename, remove);
}

function playlistVideoMetaText(video) {
    const watched = watchedMap[video.videoId];
    if (watched) {
        return historyWatchedText({
            ...video,
            timestamp: watched.timestamp,
            time: watched.time,
            duration: watched.duration || video.duration
        });
    }
    return formatUploadDate(video.published) || tFeed('feed_upload_date_unavailable', 'Upload date unavailable');
}

async function createEmptyPlaylist() {
    const title = await showPlaylistCreateDialog();
    if (title == null) return;
    const trimmed = title.trim();
    if (!trimmed) {
        setStatus(tFeed('feed_enter_playlist_name', 'Enter a playlist name.'), true);
        return;
    }
    const stored = await chrome.storage.local.get(['localVideoPlaylists']);
    const playlists = stored.localVideoPlaylists || {};
    const sameTitle = Object.values(playlists).find((playlist) =>
        normalizeText(playlist.title) === normalizeText(trimmed)
    );
    if (sameTitle) {
        setStatus(tFeed('feed_playlist_name_exists', 'A playlist with that name already exists.'), true);
        return;
    }
    let id = normalizeText(trimmed).replace(/\s+/g, '-') || `playlist-${Date.now()}`;
    if (playlists[id]) id = `${id}-${Date.now()}`;
    playlists[id] = {
        id,
        title: trimmed,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        items: {},
        order: []
    };
    await chrome.storage.local.set({ localVideoPlaylists: playlists });
    setStatus(tFeed('feed_playlist_created', 'Playlist created.'), false);
    await renderPlaylists();
}

function initPlaylistsToolbar() {
    const createButton = document.getElementById('createPlaylist');
    if (!createButton || createButton.dataset.bound) return;
    createButton.dataset.bound = '1';
    createButton.addEventListener('click', () => {
        createEmptyPlaylist().catch((error) => {
            console.error('[playlists] create failed', error);
            setStatus(tFeed('feed_playlist_create_failed', 'Could not create playlist.'), true);
        });
    });
}

async function renderPlaylists() {
    activePlaylistDetailId = null;
    playlistDetailRenderToken++;
    setPlaylistsNavBackMode(false);
    const list = document.getElementById('playlistsList');
    const empty = document.getElementById('playlistsEmpty');
    const count = document.getElementById('playlistsCount');
    const heading = document.querySelector('.playlists-title');
    const section = document.getElementById('playlistsSection');
    if (!list || !empty || !count) return;
    if (heading) heading.textContent = tFeed('tab_playlists', 'Playlists');
    setCreatePlaylistVisible(true);
    if (section) section.classList.remove('playlists-view-detail');

    let records = [];
    let localPlaylists = {};
    try {
        const stored = await ytStorage.getAllPlaylists();
        records = Object.entries(stored || {}).map(([id, value]) => ({
            ...(value || {}),
            playlistId: (value && value.playlistId) || id,
            _hasLocalItems: Object.keys((value && value.localItems) || {}).length > 0,
            items: (value && value.localItems) || {},
            order: (value && value.localOrder) || [],
            videoCount: Object.keys((value && value.localItems) || {}).length
        }));
    } catch (_) { /* show empty */ }
    try {
        const localStored = await chrome.storage.local.get(['localVideoPlaylists']);
        localPlaylists = localStored.localVideoPlaylists || {};
        Object.values(localPlaylists).forEach((playlist) => {
            const items = playlist.items || {};
            const itemList = Object.values(items);
            const record = {
                _local: true,
                playlistId: playlist.id,
                title: playlist.title,
                timestamp: playlist.createdAt,
                lastUpdated: playlist.updatedAt,
                coverVideoId: playlist.coverVideoId || '',
                videoCount: itemList.length,
                items,
                order: playlist.order || []
            };
            record.thumbnail = playlistCoverThumbnail(record);
            records.push(record);
        });
    } catch (_) { /* show saved YouTube playlists */ }

    const placeholderRecords = records.filter(isEmptyUntitledPlaylist);
    if (placeholderRecords.length) {
        await Promise.all(placeholderRecords.map((record) => ytStorage.removePlaylist(record.playlistId)));
        records = records.filter((record) => !isEmptyUntitledPlaylist(record));
    }

    records.sort((a, b) => Number(b.timestamp || b.lastUpdated || 0) - Number(a.timestamp || a.lastUpdated || 0));
    const missingArtwork = records.filter((record) => !record._local && !record.thumbnail).slice(0, 30);
    if (missingArtwork.length) {
        await playlistAsync.runPool(missingArtwork, 4, enrichPlaylistCard);
    }
    list.textContent = '';
    list.classList.remove('playlists-list-detail');
    count.textContent = feedPlural('feed_playlists_count', records.length, '$1 playlist', '$1 playlists');
    empty.style.display = records.length ? 'none' : 'block';

    records.forEach((record) => {
        const row = document.createElement('div');
        row.className = 'playlist-row';

        const openDetail = (event) => {
            event.preventDefault();
            renderLocalPlaylistDetail(record);
        };

        const thumbLink = document.createElement('a');
        thumbLink.className = 'playlist-link playlist-thumb-link';
        thumbLink.href = '#';
        thumbLink.addEventListener('click', openDetail);

        const titleText = decodeHtmlEntities(record.title || tFeed('feed_unknown_playlist', 'Unknown playlist'));

        const thumb = document.createElement('div');
        thumb.className = 'playlist-thumb';
        const thumbnailUrl = playlistCoverThumbnail(record);
        if (thumbnailUrl) {
            const image = document.createElement('img');
            image.src = thumbnailUrl;
            image.alt = '';
            image.loading = 'lazy';
            image.addEventListener('error', () => {
                image.remove();
                if (!thumb.querySelector('.playlist-thumb-fallback')) {
                    const fallback = document.createElement('div');
                    fallback.className = 'playlist-thumb-fallback';
                    fallback.textContent = '▶';
                    thumb.prepend(fallback);
                }
            }, { once: true });
            thumb.appendChild(image);
        } else {
            const fallback = document.createElement('div');
            fallback.className = 'playlist-thumb-fallback';
            fallback.textContent = '▶';
            thumb.appendChild(fallback);
        }
        const overlay = document.createElement('span');
        overlay.className = 'playlist-overlay';
        overlay.textContent = record.videoCount
            ? `☷ ${feedPlural('feed_videos', record.videoCount, '$1 video', '$1 videos')}`
            : `☷ ${tFeed('feed_playlist', 'Playlist')}`;
        thumb.appendChild(overlay);
        thumbLink.appendChild(thumb);

        const text = document.createElement('div');
        text.className = 'playlist-text';

        const titleRow = document.createElement('div');
        titleRow.className = 'playlist-title-row';

        const name = document.createElement('a');
        name.className = 'playlist-name';
        name.href = '#';
        name.textContent = titleText;
        name.addEventListener('click', openDetail);

        titleRow.appendChild(name);
        titleRow.appendChild(buildPlaylistCardMenu(titleText, {
            onRename: () => openRenamePlaylistDialog(record, renderPlaylists),
            onDelete: async () => {
                await deletePlaylistRecord(record);
                await renderPlaylists();
                setStatus(tFeed('feed_playlist_removed', 'Removed $1.', [titleText]), false);
            }
        }));

        const meta = document.createElement('span');
        meta.className = 'playlist-meta';
        meta.textContent = playlistMetaText(record);
        text.appendChild(titleRow);
        text.appendChild(meta);
        row.appendChild(thumbLink);
        row.appendChild(text);
        list.appendChild(row);
    });
}

function setPlaylistDetailLoadingMessage(root, message) {
    const text = root && root.querySelector('.playlist-detail-loading-text');
    if (text) text.textContent = message;
}

function setPlaylistsNavBackMode(enabled) {
    const nav = document.getElementById('navPlaylists');
    const label = nav && nav.querySelector('span[data-i18n="tab_playlists"]');
    if (!label) return;
    label.textContent = enabled
        ? tFeed('feed_back', 'Back')
        : tFeed('tab_playlists', 'Playlists');
}

function buildPlaylistDetailLoading(record) {
    const detail = document.createElement('div');
    detail.className = 'local-playlist-detail playlist-detail-loading';

    const header = document.createElement('div');
    header.className = 'local-playlist-header';
    const heading = document.createElement('h2');
    heading.className = 'local-playlist-title';
    heading.textContent = decodeHtmlEntities(record.title || tFeed('feed_playlist', 'Playlist'));
    const meta = document.createElement('div');
    meta.className = 'local-playlist-count';
    meta.textContent = tFeed('feed_loading_videos', 'Loading videos…');
    header.appendChild(heading);
    header.appendChild(meta);
    detail.appendChild(header);

    const toolbar = document.createElement('div');
    toolbar.className = 'local-playlist-toolbar';
    const back = document.createElement('button');
    back.className = 'btn local-playlist-back';
    back.textContent = `← ${tFeed('feed_back', 'Back')}`;
    back.addEventListener('click', () => {
        activePlaylistDetailId = null;
        renderPlaylists();
    });
    toolbar.appendChild(back);
    detail.appendChild(toolbar);

    const status = document.createElement('div');
    status.className = 'playlist-detail-loading-status';
    const spinner = document.createElement('span');
    spinner.className = 'spinner';
    spinner.setAttribute('aria-hidden', 'true');
    const loadingText = document.createElement('span');
    loadingText.className = 'playlist-detail-loading-text';
    loadingText.textContent = tFeed('feed_loading_videos', 'Loading videos…');
    status.append(spinner, loadingText);
    detail.appendChild(status);

    const skeletons = document.createElement('div');
    skeletons.className = 'playlist-detail-skeletons';
    for (let i = 0; i < 3; i++) {
        const row = document.createElement('div');
        row.className = 'playlist-detail-skeleton-row';
        const thumb = document.createElement('div');
        thumb.className = 'playlist-detail-skeleton-thumb';
        const text = document.createElement('div');
        text.className = 'playlist-detail-skeleton-text';
        ['title', 'meta', 'channel'].forEach((kind) => {
            const line = document.createElement('div');
            line.className = `playlist-detail-skeleton-line ${kind}`;
            text.appendChild(line);
        });
        row.appendChild(thumb);
        row.appendChild(text);
        skeletons.appendChild(row);
    }
    detail.appendChild(skeletons);
    return detail;
}

async function renderLocalPlaylistDetail(record, allowImport = true) {
    const list = document.getElementById('playlistsList');
    const section = document.getElementById('playlistsSection');
    if (!list) return;
    setCreatePlaylistVisible(false);
    if (section) section.classList.add('playlists-view-detail');
    list.classList.add('playlists-list-detail');
    activePlaylistDetailId = record.playlistId;
    setPlaylistsNavBackMode(true);
    const renderToken = ++playlistDetailRenderToken;
    list.textContent = '';
    const loadingDetail = buildPlaylistDetailLoading(record);
    list.appendChild(loadingDetail);

    const importedItems = allowImport ? await importSavedPlaylistVideos(record) : (record.items || {});
    if (renderToken !== playlistDetailRenderToken || activePlaylistDetailId !== record.playlistId) return;
    const playlistItems = Object.keys(record.items || {}).length ? record.items : importedItems;
    const videos = orderedPlaylistVideos(record, playlistItems);
    if (videos.some((video) => !video.published || !video.duration)) {
        setPlaylistDetailLoadingMessage(
            loadingDetail,
            tFeed('feed_loading_video_details', 'Loading video details…')
        );
        const meta = loadingDetail.querySelector('.local-playlist-count');
        if (meta) meta.textContent = tFeed('feed_loading_video_details', 'Loading video details…');
        await enrichLocalPlaylistMetadata(record, videos);
        if (renderToken !== playlistDetailRenderToken || activePlaylistDetailId !== record.playlistId) return;
    }

    list.textContent = '';
    const detail = document.createElement('div');
    detail.className = 'local-playlist-detail';

    const header = document.createElement('div');
    header.className = 'local-playlist-header';
    const heading = document.createElement('h2');
    heading.className = 'local-playlist-title';
    heading.textContent = decodeHtmlEntities(record.title || tFeed('feed_playlist', 'Playlist'));
    const meta = document.createElement('div');
    meta.className = 'local-playlist-count';
    meta.textContent = feedPlural('feed_saved_videos', videos.length, '$1 saved video', '$1 saved videos');
    header.appendChild(heading);
    header.appendChild(meta);
    detail.appendChild(header);

    const toolbar = document.createElement('div');
    toolbar.className = 'local-playlist-toolbar';
    const toolbarLeft = document.createElement('div');
    toolbarLeft.className = 'local-playlist-toolbar-left';
    const back = document.createElement('button');
    back.className = 'btn local-playlist-back';
    back.textContent = `← ${tFeed('feed_back', 'Back')}`;
    back.addEventListener('click', () => {
        activePlaylistDetailId = null;
        renderPlaylists();
    });
    toolbarLeft.appendChild(back);
    if (!record._local && record.playlistId) {
        const openYouTube = document.createElement('a');
        openYouTube.className = 'btn';
        openYouTube.href = record.url || `https://www.youtube.com/playlist?list=${record.playlistId}`;
        openYouTube.target = '_blank';
        openYouTube.rel = 'noopener';
        openYouTube.textContent = tFeed('feed_open_on_youtube', 'Open on YouTube');
        toolbarLeft.appendChild(openYouTube);
    }
    const toolbarActions = document.createElement('div');
    toolbarActions.className = 'local-playlist-toolbar-actions';
    appendPlaylistDetailActions(record, toolbarActions, renderPlaylists, (newTitle) => {
        heading.textContent = decodeHtmlEntities(
            newTitle || record.title || tFeed('feed_playlist', 'Playlist')
        );
    });
    toolbar.appendChild(toolbarLeft);
    toolbar.appendChild(toolbarActions);
    detail.appendChild(toolbar);

    const canReorder = videos.length > 1;
    if (canReorder) {
        const hintSeen = (await chrome.storage.local.get(['playlistDragHintSeen'])).playlistDragHintSeen;
        if (!hintSeen) {
            const hint = document.createElement('div');
            hint.className = 'playlist-order-hint';
            hint.textContent = tFeed('feed_drag_reorder_hint', 'Drag the handle to reorder videos.');
            detail.appendChild(hint);
            chrome.storage.local.set({ playlistDragHintSeen: true }).catch(() => {});
        }
    }

    const videosWrap = document.createElement('div');
    videosWrap.className = 'local-playlist-videos';
    videos.forEach((video) => {
        const row = buildResultRow(video, {
            metaText: playlistVideoMetaText(video),
            menuOptions: {
                setAsPlaylistCover: async () => {
                    await setPlaylistCover(record, video.videoId);
                    setStatus(tFeed('feed_playlist_cover_updated', 'Playlist cover updated.'), false);
                },
                removeFromPlaylist: () => removeVideoFromLocalPlaylist(record, video.videoId)
            }
        });
        makePlaylistRowDraggable(row, video, record, videosWrap, canReorder);
        videosWrap.appendChild(row);
    });
    if (!videos.length) {
        const empty = document.createElement('div');
        empty.className = 'playlists-empty';
        empty.textContent = record._local
            ? tFeed(
                'feed_empty_local_playlist',
                'This playlist is empty. Add videos from the feed using ⋮ → Add to local playlist.'
            )
            : tFeed(
                'feed_playlist_import_unavailable',
                'Could not import this playlist yet. Open it on YouTube once, then try again.'
            );
        detail.appendChild(empty);
    } else {
        detail.appendChild(videosWrap);
    }
    list.appendChild(detail);
}

function showPlaylists() {
    rememberView('playlists');
    document.body.classList.remove('shorts-mode');
    setRefreshVisible(false);
    setCreatePlaylistVisible(true);
    setSaveSettingsVisible(false);
    setClearSubscriptionsVisible(false);
    setClearHistoryVisible(false);
    setFeedOptionsVisible(false);
    showFeedStatus(false);
    leaveSearchPage();
    analyticsActive = false;
    subscriptionsActive = false;
    playlistsActive = true;
    historyActive = false;
    settingsActive = false;
    channelActive = false;
    initPlaylistsToolbar();
    ['localHeading', 'grid', 'localSearchResults', 'empty', 'ytSection', 'channelSection'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    const analytics = document.getElementById('analyticsSection');
    if (analytics) analytics.style.display = 'none';
    const subscriptions = document.getElementById('subscriptionsSection');
    if (subscriptions) subscriptions.style.display = 'none';
    const settings = document.getElementById('settingsSection');
    if (settings) settings.style.display = 'none';
    const history = document.getElementById('historySection');
    if (history) history.style.display = 'none';
    const chips = document.querySelector('.chips');
    if (chips) chips.style.display = 'none';
    const playlists = document.getElementById('playlistsSection');
    if (playlists) playlists.style.display = 'block';
    setActiveNav('navPlaylists');
    renderPlaylists();
}

function historyWatchedText(video) {
    const timestamp = Number(video.timestamp || 0);
    const watchedDate = timestamp
        ? new Date(timestamp).toLocaleString(undefined, {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: 'numeric', minute: '2-digit'
        })
        : tFeed('feed_unknown_date', 'Unknown date');
    const duration = Number(video.duration || 0);
    const time = Number(video.time || 0);
    const isImportedEntry = video.importedHistory || (!duration && !time);
    const percent = duration > 0
        ? Math.max(0, Math.min(100, Math.round((time / duration) * 100)))
        : 0;
    if (isImportedEntry) {
        return tFeed('feed_imported_watched_on', 'Imported from YouTube — $1', [watchedDate]);
    }
    return duration > 0
        ? tFeed('feed_watched_on_percent', 'Watched $1 · $2 watched', [
            watchedDate,
            feedFormatNumber(percent / 100, { style: 'percent' })
        ])
        : tFeed('feed_watched_on', 'Watched $1', [watchedDate]);
}
