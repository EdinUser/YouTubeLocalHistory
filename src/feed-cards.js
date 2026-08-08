// ----- card builder ------------------------------------------------------
// At/above this fraction watched, a video counts as fully watched.
const COMPLETED_RATIO = 0.9;

// Add the watched overlay to a thumbnail wrapper: a progress bar (how far you
// got) plus a label that only says "viewed" when you actually finished — for a
// partial watch it shows the percent instead, so a 2-minute peek isn't "viewed".
function addWatchedOverlay(thumbWrap, record) {
    if (!record) return;
    const time = Number(record.time || 0);
    const importedEntry = !!record.importedHistory || (time <= 0 && Number(record.timestamp || 0) > 0);
    if (time <= 0 && !importedEntry) return;
    const dur = Number(record.duration) || 0;
    const ratio = dur > 0 ? time / dur : 0;
    const completed = importedEntry || (dur > 0 && ratio >= COMPLETED_RATIO);

    const label = document.createElement('div');
    label.className = 'ytvht-viewed-label';
    if (completed) {
        label.textContent = overlayTitle;
    } else if (dur > 0) {
        label.textContent = Math.round(ratio * 100) + '%';
        label.classList.add('ytvht-partial');
    } else {
        // Watched but length unknown — show the title muted rather than imply done.
        label.textContent = overlayTitle;
        label.classList.add('ytvht-partial');
    }
    thumbWrap.appendChild(label);

    if (importedEntry || (dur > 0 && time > 0)) {
        const progress = document.createElement('div');
        progress.className = 'ytvht-progress-bar';
        progress.style.width = importedEntry ? '100%' : Math.max(0, Math.min(100, ratio * 100)) + '%';
        thumbWrap.appendChild(progress);
    }
}

function refreshWatchedOverlayForVideo(videoId) {
    if (!videoId) return;
    document.querySelectorAll(`[data-ytvht-video-id="${videoId}"] .ytvht-thumb-wrap`).forEach((thumbWrap) => {
        thumbWrap.querySelectorAll('.ytvht-viewed-label, .ytvht-progress-bar').forEach((overlay) => overlay.remove());
        addWatchedOverlay(thumbWrap, watchedMap[videoId] || null);
    });
}

function videoSaveRecord(video) {
    return {
        videoId: video.videoId,
        title: decodeHtmlEntities(video.title || ''),
        channelName: decodeHtmlEntities(video.channelName || ''),
        channelThumbnail: video.channelThumbnail || '',
        thumbnail: video.thumbnail || `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`,
        url: video.url || `https://www.youtube.com/watch?v=${video.videoId}`,
        duration: Number(video.duration || 0),
        savedAt: Date.now()
    };
}

async function saveFeedFeedback() {
    await chrome.storage.local.set({ feedFeedback });
}

function appendSvgMarkup(svg, markup) {
    const doc = new DOMParser().parseFromString(
        `<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`,
        'image/svg+xml'
    );
    Array.from(doc.documentElement.childNodes).forEach((node) => {
        svg.appendChild(document.importNode(node, true));
    });
}

function findSubscriptionForVideo(video) {
    const key = channelKey(video && video.channelName);
    const ids = [video && video.channelId, video && video.ucid, video && video.handle]
        .filter(Boolean)
        .map((id) => String(id).toLowerCase());
    return (localSubscriptions || []).find((subscription) => {
        if (key && channelKey(subscription.channelName) === key) return true;
        const subIds = [subscription.id, subscription.ucid, subscription.handle, subscription.channelId]
            .filter(Boolean)
            .map((id) => String(id).toLowerCase());
        return ids.some((id) => subIds.includes(id));
    }) || null;
}

async function saveVideoToLocalPlaylist(playlists, id, title, video) {
    const playlist = playlists[id] || {
        id, title, createdAt: Date.now(), items: {}
    };
    playlist.title = title;
    playlist.updatedAt = Date.now();
    playlist.items = playlist.items || {};
    playlist.order = Array.isArray(playlist.order)
        ? playlist.order.filter((videoId) => playlist.items[videoId])
        : Object.keys(playlist.items);
    if (!playlist.order.includes(video.videoId)) playlist.order.push(video.videoId);
    playlist.items[video.videoId] = videoSaveRecord(video);
    playlists[id] = playlist;
    await chrome.storage.local.set({ localVideoPlaylists: playlists });
}

async function saveVideoToSavedPlaylist(playlistId, playlist, video) {
    const localItems = { ...((playlist && playlist.localItems) || {}) };
    const localOrder = Array.isArray(playlist && playlist.localOrder)
        ? playlist.localOrder.filter((videoId) => localItems[videoId])
        : Object.keys(localItems);
    if (!localOrder.includes(video.videoId)) localOrder.push(video.videoId);
    localItems[video.videoId] = videoSaveRecord(video);
    await ytStorage.setPlaylist(playlistId, {
        ...(playlist || {}),
        playlistId,
        localItems,
        localOrder,
        timestamp: Date.now(),
        lastUpdated: Date.now()
    });
}

async function addVideoToLocalPlaylist(video) {
    document.querySelectorAll('.video-menu').forEach((menu) => { menu.hidden = true; });
    document.querySelectorAll('.ytvht-feed-card.video-menu-open').forEach((card) => {
        card.classList.remove('video-menu-open');
    });

    const stored = await chrome.storage.local.get(['localVideoPlaylists']);
    const playlists = stored.localVideoPlaylists || {};
    let savedYouTubePlaylists = {};
    try { savedYouTubePlaylists = await ytStorage.getAllPlaylists(); } catch (_) { /* local playlists still work */ }
    const backdrop = document.getElementById('playlistPicker');
    const list = document.getElementById('playlistPickerList');
    const closeButton = document.getElementById('playlistPickerClose');
    const createForm = document.getElementById('playlistPickerCreate');
    const nameInput = document.getElementById('playlistPickerName');
    if (!backdrop || !list || !closeButton || !createForm || !nameInput) return false;

    return new Promise((resolve) => {
        let finished = false;
        const finish = (saved) => {
            if (finished) return;
            finished = true;
            backdrop.hidden = true;
            document.removeEventListener('keydown', onKeydown);
            resolve(saved);
        };
        const onKeydown = (event) => {
            if (event.key === 'Escape') finish(false);
        };

        list.textContent = '';
        const localRecords = Object.values(playlists)
            .filter((playlist) => playlist && playlist.title)
            .map((playlist) => ({ ...playlist, _source: 'local' }));
        const youtubeRecords = Object.entries(savedYouTubePlaylists || {})
            .map(([playlistId, playlist]) => ({
                ...(playlist || {}),
                playlistId: (playlist && playlist.playlistId) || playlistId,
                _source: 'youtube'
            }))
            .filter((playlist) => playlist.title);
        const records = [...localRecords, ...youtubeRecords]
            .sort((a, b) =>
                Number(b.updatedAt || b.lastUpdated || b.timestamp || b.createdAt || 0) -
                Number(a.updatedAt || a.lastUpdated || a.timestamp || a.createdAt || 0)
            );
        if (!records.length) {
            const empty = document.createElement('div');
            empty.className = 'playlist-picker-empty';
            empty.textContent = tFeed('feed_no_playlists_create', 'No playlists yet. Create your first one below.');
            list.appendChild(empty);
        }
        records.forEach((playlist) => {
            const option = document.createElement('button');
            option.type = 'button';
            option.className = 'playlist-picker-option';
            const thumb = document.createElement('div');
            thumb.className = 'playlist-picker-thumb';
            const seedId = playlistSeedVideoId(playlist);
            const thumbnail = playlist.thumbnail ||
                (seedId ? `https://i.ytimg.com/vi/${seedId}/mqdefault.jpg` : '');
            if (thumbnail) {
                const image = document.createElement('img');
                image.src = thumbnail;
                image.alt = '';
                image.addEventListener('error', () => {
                    image.remove();
                    const fallback = document.createElement('div');
                    fallback.className = 'playlist-picker-thumb-fallback';
                    fallback.textContent = '▶';
                    thumb.appendChild(fallback);
                }, { once: true });
                thumb.appendChild(image);
            } else {
                const fallback = document.createElement('div');
                fallback.className = 'playlist-picker-thumb-fallback';
                fallback.textContent = '▶';
                thumb.appendChild(fallback);
            }
            const text = document.createElement('span');
            text.className = 'playlist-picker-text';
            const title = document.createElement('strong');
            title.textContent = playlist.title;
            const count = document.createElement('span');
            count.className = 'playlist-picker-meta';
            const total = Object.keys(
                playlist._source === 'youtube' ? (playlist.localItems || {}) : (playlist.items || {})
            ).length;
            count.textContent = playlist._source === 'youtube'
                ? (total
                    ? feedPlural('feed_locally_added_videos', total, '$1 locally added video', '$1 locally added videos')
                    : tFeed('feed_saved_playlist', 'Saved playlist'))
                : feedPlural('feed_videos', total, '$1 video', '$1 videos');
            text.appendChild(title);
            text.appendChild(count);
            const saveIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            saveIcon.setAttribute('class', 'playlist-picker-save-icon');
            saveIcon.setAttribute('viewBox', '0 0 24 24');
            saveIcon.setAttribute('aria-hidden', 'true');
            appendSvgMarkup(saveIcon, '<path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z"></path>');
            option.appendChild(thumb);
            option.appendChild(text);
            option.appendChild(saveIcon);
            option.addEventListener('click', async () => {
                option.disabled = true;
                try {
                    if (playlist._source === 'youtube') {
                        await saveVideoToSavedPlaylist(playlist.playlistId, playlist, video);
                    } else {
                        await saveVideoToLocalPlaylist(playlists, playlist.id, playlist.title, video);
                    }
                    finish(true);
                } catch (error) {
                    console.error('[playlist picker] save failed', error);
                    option.disabled = false;
                }
            });
            list.appendChild(option);
        });

        closeButton.onclick = () => finish(false);
        backdrop.onclick = (event) => {
            if (event.target === backdrop) finish(false);
        };
        createForm.onsubmit = async (event) => {
            event.preventDefault();
            const title = nameInput.value.trim();
            if (!title) {
                nameInput.focus();
                return;
            }
            let id = normalizeText(title).replace(/\s+/g, '-') || `playlist-${Date.now()}`;
            const sameTitle = Object.values(playlists).find((playlist) =>
                normalizeText(playlist.title) === normalizeText(title)
            );
            if (sameTitle) id = sameTitle.id;
            else if (playlists[id]) id = `${id}-${Date.now()}`;
            const submit = createForm.querySelector('button[type="submit"]');
            if (submit) submit.disabled = true;
            try {
                await saveVideoToLocalPlaylist(playlists, id, title, video);
                finish(true);
            } catch (error) {
                console.error('[playlist picker] create failed', error);
            } finally {
                if (submit) submit.disabled = false;
            }
        };

        nameInput.value = '';
        backdrop.hidden = false;
        document.addEventListener('keydown', onKeydown);
        setTimeout(() => {
            const firstOption = list.querySelector('.playlist-picker-option');
            (firstOption || nameInput).focus();
        }, 0);
    });
}

function buildVideoMenu(video, options) {
    options = options || {};
    const wrap = document.createElement('div');
    wrap.className = 'video-menu-wrap';
    const toggle = document.createElement('button');
    toggle.className = 'video-menu-button';
    toggle.type = 'button';
    toggle.textContent = '⋮';
    toggle.title = tFeed('feed_video_options', 'Video options');
    toggle.setAttribute('aria-label', tFeed('feed_video_options', 'Video options'));
    const menu = document.createElement('div');
    menu.className = 'video-menu';
    menu.hidden = true;

    const actions = [];
    if (options.showRecommendationFeedback) {
        actions.push(
        [tFeed('feed_more_from_channel', 'More from this channel'), '<path d="M7 10v10H4V10h3Z"></path><path d="M10 20h7.2a2 2 0 0 0 2-1.6l1.2-6A2 2 0 0 0 18.4 10H15l.6-3.1A2.4 2.4 0 0 0 13.2 4L10 10v10Z"></path>', async () => {
            const key = channelKey(video.channelName);
            if (key) {
                feedFeedback.channelMore[key] = Math.min(
                    5,
                    Number(feedFeedback.channelMore[key] || 0) + 1
                );
                if (feedFeedback.channelLess[key]) {
                    feedFeedback.channelLess[key] = Math.max(
                        0,
                        Number(feedFeedback.channelLess[key]) - 1
                    );
                }
            }
            await saveFeedFeedback();
            setStatus(tFeed('feed_recommend_more_from_status', "We'll recommend more from $1.", [
                decodeHtmlEntities(video.channelName || tFeed('feed_this_channel', 'this channel'))
            ]), false);
            return tFeed('feed_recommend_more_status', "We'll recommend more");
        }],
        [tFeed('feed_less_from_channel', 'Less from this channel'), '<circle cx="9" cy="8" r="3"></circle><path d="M3.5 18c.5-3.5 2.4-5 5.5-5 1.2 0 2.2.2 3 .7"></path><path d="M15 16h6"></path>', async () => {
            const key = channelKey(video.channelName);
            if (key) feedFeedback.channelLess[key] = Math.min(5, Number(feedFeedback.channelLess[key] || 0) + 1);
            await saveFeedFeedback();
            if (!playlistsActive) render();
        }]
        );
    }
    if (options.showHideVideo !== false) {
        actions.push(
        [tFeed('feed_hide_this_video', 'Hide this video'), '<circle cx="12" cy="12" r="9"></circle><path d="m9 9 6 6M15 9l-6 6"></path>', async () => {
            feedFeedback.notInterested[video.videoId] = Date.now();
            await saveFeedFeedback();
            if (!playlistsActive) render();
        }]
        );
    }
    if (options.showUnsubscribe) {
        actions.push(
        [tFeed('feed_unsubscribe', 'Unsubscribe'), '<circle cx="9" cy="8" r="3"></circle><path d="M3.5 18c.5-3.5 2.4-5 5.5-5 1.2 0 2.2.2 3 .7"></path><path d="M15 11h6"></path>', async () => {
            const subscription = findSubscriptionForVideo(video);
            if (!subscription) return tFeed('feed_not_subscribed', 'Not subscribed');
            await ytIndexedDBStorage.deleteSubscriptionRecord(subscription.channelId);
            await ytIndexedDBStorage.deleteChannelSyncState(subscription.channelId);
            localSubscriptions = (await ytvhtFeedViewData.loadCanonicalFeedViewData(ytIndexedDBStorage)).subscriptions;
            allVideos = allVideos.filter((item) =>
                channelKey(item.channelName) !== channelKey(subscription.channelName)
            );
            const channelName = decodeHtmlEntities(subscription.channelName || video.channelName || tFeed('feed_channel', 'channel'));
            setStatus(tFeed('feed_unsubscribed_from_status', `Unsubscribed from ${channelName}.`, [channelName]), false);
            if (!playlistsActive) render();
            return tFeed('feed_unsubscribed', 'Unsubscribed');
        }]
        );
    }
    actions.push(
        [tFeed('feed_save_to_watch_later', 'Save to Watch Later'), '<circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path>', async () => {
            await ytStorage.setWatchLater(video.videoId, videoSaveRecord(video));
            return tFeed('feed_saved_to_watch_later', 'Saved to Watch Later');
        }],
        [tFeed('feed_add_to_playlist', 'Add to playlist'), '<path d="M4 6h9M4 11h9M4 16h6"></path><path d="M17 12v8M13 16h8"></path>', async () => {
            const saved = await addVideoToLocalPlaylist(video);
            return saved ? tFeed('feed_added_to_playlist', 'Added to playlist') : '';
        }]
    );
    if (typeof options.setAsPlaylistCover === 'function') {
        actions.push(
            [tFeed('feed_set_as_playlist_cover', 'Set as playlist cover'), '<rect x="4" y="4" width="16" height="16" rx="2"></rect><path d="m4 15 4-4 3 3 5-6 4 5"></path><circle cx="9" cy="9" r="1.5"></circle>', async () => {
                await options.setAsPlaylistCover(video);
                return tFeed('feed_cover_updated', 'Cover updated');
            }]
        );
    }
    if (typeof options.removeFromPlaylist === 'function') {
        actions.push(
            [tFeed('feed_remove_from_playlist', 'Remove from this playlist'), '<path d="M4 7h16"></path><path d="m9 7 .7-2h4.6l.7 2"></path><path d="M7 7l1 13h8l1-13"></path>', async () => {
                await options.removeFromPlaylist(video);
                return '';
            }]
        );
    }
    actions.forEach(([label, iconPaths, action]) => {
        const item = document.createElement('button');
        item.className = 'video-menu-item';
        item.type = 'button';
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        icon.setAttribute('class', 'video-menu-icon');
        icon.setAttribute('viewBox', '0 0 24 24');
        icon.setAttribute('aria-hidden', 'true');
        appendSvgMarkup(icon, iconPaths);
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
                const confirmation = await action();
                if (confirmation) {
                    text.textContent = confirmation;
                    setTimeout(() => { text.textContent = label; }, 1200);
                }
            } catch (error) {
                console.error('[video menu] action failed', error);
            } finally {
                item.disabled = false;
            }
        });
        menu.appendChild(item);
    });
    toggle.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const card = wrap.closest('.ytvht-feed-card');
        document.querySelectorAll('.video-menu').forEach((other) => {
            if (other !== menu) {
                other.hidden = true;
                other.closest('.ytvht-feed-card')?.classList.remove('video-menu-open');
            }
        });
        menu.hidden = !menu.hidden;
        if (card) card.classList.toggle('video-menu-open', !menu.hidden);
    });
    wrap.appendChild(toggle);
    wrap.appendChild(menu);
    return wrap;
}

function buildCard(video) {
    applyLocalChannelArtwork(video);
    const record = watchedMap[video.videoId] || null;

    const card = document.createElement('div');
    card.className = 'ytvht-feed-card';
    card.dataset.ytvhtVideoId = video.videoId;

    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'ytvht-thumb-wrap';
    const img = document.createElement('img');
    img.loading = 'lazy';
    const normalThumbnail = video.thumbnail || `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`;
    img.src = normalThumbnail;
    img.alt = '';
    thumbWrap.appendChild(img);

    addWatchedOverlay(thumbWrap, record);

    const durationSeconds = (video && video.duration > 0)
        ? video.duration
        : (video && video.videoId && durationCache[video.videoId] > 0
            ? durationCache[video.videoId]
            : (record && record.duration > 0 ? record.duration : 0));
    // YouTube search results carry a pre-formatted length string instead.
    const durationText = cleanDurationText(video._durationText) ||
        (durationSeconds > 0 ? formatDuration(durationSeconds) : '');
    if (videoIsLive(video)) {
        addLiveBadge(thumbWrap);
    } else if (durationText) {
        const dur = document.createElement('span');
        dur.className = 'ytvht-card-duration';
        dur.textContent = durationText;
        thumbWrap.appendChild(dur);
    }

    const thumbLink = document.createElement('a');
    thumbLink.className = 'ytvht-thumb-link';
    thumbLink.href = video.url;
    thumbLink.target = '_blank';
    thumbLink.rel = 'noopener';
    thumbLink.appendChild(thumbWrap);

    const body = document.createElement('div');
    body.className = 'ytvht-card-body';

    const avatarLink = document.createElement('a');
    avatarLink.className = 'ytvht-avatar-link';
    avatarLink.href = video.channelUrl || video.url;
    avatarLink.target = '_blank';
    avatarLink.rel = 'noopener';
    const channelName = decodeHtmlEntities(feedChannelTitle(video.channelName));
    avatarLink.title = channelName;
    if (video.channelThumbnail) {
        const avatar = document.createElement('img');
        avatar.className = 'ytvht-card-avatar';
        avatar.loading = 'lazy';
        avatar.src = video.channelThumbnail;
        avatar.alt = '';
        avatarLink.appendChild(avatar);
    } else {
        const avatar = document.createElement('div');
        avatar.className = 'ytvht-card-avatar';
        avatar.textContent = (channelName || '?').charAt(0).toUpperCase();
        avatarLink.appendChild(avatar);
    }
    body.appendChild(avatarLink);

    const text = document.createElement('div');
    text.className = 'ytvht-card-text';

    const titleLink = document.createElement('a');
    titleLink.className = 'ytvht-card-title';
    titleLink.href = video.url;
    titleLink.target = '_blank';
    titleLink.rel = 'noopener';
    const title = decodeHtmlEntities(feedVideoTitle(video.title));
    titleLink.textContent = title;
    titleLink.title = title;

    const channelLink = document.createElement('a');
    channelLink.className = 'ytvht-card-channel';
    channelLink.href = video.channelUrl || video.url;
    channelLink.target = '_blank';
    channelLink.rel = 'noopener';
    channelLink.textContent = channelName;

    const channelRow = document.createElement('div');
    channelRow.className = 'ytvht-card-channel-row';
    channelRow.appendChild(channelLink);

    const metaParts = [videoViewsText(video), videoAgeText(video)].filter(Boolean);
    let meta = null;
    if (metaParts.length) {
        meta = document.createElement('div');
        meta.className = 'ytvht-card-meta';
        meta.textContent = metaParts.join(' • ');
    }

    const memberText = memberBadgeText(video);
    let memberBadge = null;
    if (memberText) {
        memberBadge = document.createElement('div');
        memberBadge.className = 'ytvht-member-badge';
        const icon = document.createElement('span');
        icon.className = 'ytvht-member-badge-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = '*';
        const label = document.createElement('span');
        label.textContent = memberText;
        memberBadge.append(icon, label);
    }

    text.appendChild(titleLink);
    text.appendChild(channelRow);
    if (meta) text.appendChild(meta);
    if (memberBadge) text.appendChild(memberBadge);
    body.appendChild(text);
    body.appendChild(buildVideoMenu(video, {
        showRecommendationFeedback: !shortsOnly && !subscriptionsChronological,
        showUnsubscribe: !shortsOnly && !playlistsActive && !historyActive,
        showHideVideo: !playlistsActive && !historyActive
    }));

    card.appendChild(thumbLink);
    card.appendChild(body);
    return card;
}

function videoMetaText(video) {
    if (video._source === 'youtube-search' && (video._viewsText || video._whenText)) {
        return [video._viewsText, video._whenText].filter(Boolean).join(' • ');
    }
    if (video._historyOnly) {
        return video.published ? relativeTime(video.published) : '';
    }
    return [formatViews(video.views), relativeTime(video.published)].filter(Boolean).join(' • ');
}

function videoViewsText(video) {
    if (video._source === 'youtube-search' && video._viewsText) return video._viewsText;
    return formatViews(video.views);
}

function videoAgeText(video) {
    if (video._source === 'youtube-search' && video._whenText) return video._whenText;
    if (video._historyOnly && video._whenText && !video.published) return video._whenText;
    if (video._publishedUnreliable) return video._whenText || '';
    if (video.published) return relativeTime(video.published);
    return '';
}

function memberBadgeText(video) {
    const text = String(video?._memberBadgeText || video?.memberBadgeText || '').toLowerCase();
    if (/members?[^a-z0-9]{0,20}only/.test(text)) return tFeed('feed_members_only', 'Members only');
    if (/members?[^a-z0-9]{0,20}first/.test(text)) return tFeed('feed_members_first', 'Members first');
    return '';
}

function videoIsMembersOnly(video) {
    return !!memberBadgeText(video);
}

function videoIsLive(video) {
    if (!video) return false;
    if (video.isLive === true || video._isLive === true) return true;
    const status = [
        video._liveText,
        video._viewsText,
        video._whenText
    ].filter(Boolean).join(' ').toLowerCase();
    return /\blive now\b|\bwatching\b/.test(status);
}

function addLiveBadge(thumbnail) {
    const badge = document.createElement('span');
    badge.className = 'ytvht-live-badge';
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    appendSvgMarkup(icon,
        '<path d="M8.5 8.5a5 5 0 0 0 0 7M5.7 5.7a9 9 0 0 0 0 12.6M15.5 8.5a5 5 0 0 1 0 7M18.3 5.7a9 9 0 0 1 0 12.6"/>' +
        '<circle cx="12" cy="12" r="2.2"/>'
    );
    const text = document.createElement('span');
    text.textContent = tFeed('feed_live', 'LIVE');
    badge.appendChild(icon);
    badge.appendChild(text);
    thumbnail.appendChild(badge);
}
