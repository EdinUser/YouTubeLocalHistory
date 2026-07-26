// ----- subscribe (from search results) -----------------------------------
async function findSub(info) {
    for (const k of [info.ucid, info.handle, info.channelId].filter(Boolean)) {
        const s = await ytStorage.getSubscription(k);
        if (s) return s;
    }
    const wantedName = channelKey(info.channelName);
    if (wantedName) {
        const subscriptions = await ytStorage.getSubscriptionList();
        const byName = subscriptions.find((subscription) =>
            channelKey(subscription.channelName) === wantedName
        );
        if (byName) return byName;
    }
    return null;
}

function subscribeButtonKey(info) {
    return channelKey(info.channelName) ||
        String(info.ucid || info.handle || info.channelId || '').toLowerCase();
}

function matchesSubscribeInfo(subscription, info) {
    if (!subscription || !info) return false;
    const keys = [info.ucid, info.handle, info.channelId].filter(Boolean)
        .map((key) => String(key).toLowerCase());
    const subKeys = [subscription.id, subscription.ucid, subscription.handle, subscription.channelId]
        .filter(Boolean)
        .map((key) => String(key).toLowerCase());
    if (keys.some((key) => subKeys.includes(key))) return true;
    return channelKey(subscription.channelName) === channelKey(info.channelName);
}

function isSubbedCached(info) {
    return (localSubscriptions || []).some((subscription) => matchesSubscribeInfo(subscription, info));
}

function paintSubscribeButton(button, subbed) {
    button.textContent = subbed ? '✓ Subscribed' : '＋ Subscribe';
    button.classList.toggle('subbed', subbed);
    button.classList.remove('loading');
    button.removeAttribute('aria-label');
}

function paintMatchingSubscribeButtons(info, subbed) {
    const key = subscribeButtonKey(info);
    document.querySelectorAll('.subbtn').forEach((button) => {
        if (button.dataset.channelKey !== key) return;
        paintSubscribeButton(button, subbed);
    });
}

function buildSubscribeButton(info) {
    const btn = document.createElement('button');
    btn.className = 'subbtn';
    btn.dataset.channelKey = subscribeButtonKey(info);
    paintSubscribeButton(btn, isSubbedCached(info));
    async function paint() {
        try {
            const subbed = !!(await findSub(info));
            paintMatchingSubscribeButtons(info, subbed);
        } catch (_) {
            btn.textContent = '＋ Subscribe';
            btn.classList.remove('loading');
        }
    }
    btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        btn.disabled = true;
        try {
            const existing = await findSub(info);
            if (existing) {
                await ytStorage.removeSubscription(existing.id);
            } else {
                await ytStorage.addSubscription({
                    id: info.channelId, ucid: info.ucid, handle: info.handle,
                    channelName: info.channelName, thumbnail: info.thumbnail, url: info.url
                });
                if (!info.ucid || !info.thumbnail) await enrichSubscription(info);
                setStatus(`Subscribed to ${info.channelName || 'channel'} — click Refresh to load their videos.`, false);
            }
            localSubscriptions = await ytStorage.getSubscriptionList();
            await paint();
        } finally {
            btn.disabled = false;
        }
    });
    paint();
    return btn;
}

// A wide YouTube-style search-result row (big thumbnail left, info right).
function buildResultRow(video, opts) {
    opts = opts || {};
    applyLocalChannelArtwork(video);
    const row = document.createElement('div');
    row.className = 'yt-row';

    const thumbLink = document.createElement('a');
    thumbLink.className = 'yt-row-thumb';
    thumbLink.href = video.url; thumbLink.target = '_blank'; thumbLink.rel = 'noopener';
    const tw = document.createElement('div');
    tw.className = 'ytvht-thumb-wrap';
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = video.thumbnail || `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`;
    img.alt = '';
    tw.appendChild(img);

    addWatchedOverlay(tw, opts.overlayRecord || watchedMap[video.videoId]);
    const durText = cleanDurationText(video._durationText) ||
        (video.duration > 0 ? formatDuration(video.duration) : '');
    if (videoIsLive(video)) {
        addLiveBadge(tw);
    } else if (durText) {
        const d = document.createElement('span');
        d.className = 'ytvht-card-duration';
        d.textContent = durText;
        tw.appendChild(d);
    }
    thumbLink.appendChild(tw);

    const info = document.createElement('div');
    info.className = 'yt-row-info';

    const title = document.createElement('a');
    title.className = 'yt-row-title';
    title.href = video.url; title.target = '_blank'; title.rel = 'noopener';
    title.textContent = decodeHtmlEntities(video.title || '');
    title.title = title.textContent;

    const meta = document.createElement('div');
    meta.className = 'yt-row-meta';
    meta.textContent = opts.metaText || videoMetaText(video);

    const chan = document.createElement('a');
    chan.className = 'yt-row-channel';
    chan.href = video.channelUrl || video.url; chan.target = '_blank'; chan.rel = 'noopener';
    chan.addEventListener('click', (event) => {
        event.preventDefault();
        showChannelPage(bestChannelInfoFromVideo(video));
    });
    if (video.channelThumbnail) {
        const a = document.createElement('img');
        a.className = 'yt-row-ava'; a.src = video.channelThumbnail; a.alt = '';
        chan.appendChild(a);
    }
    const cspan = document.createElement('span');
    cspan.textContent = decodeHtmlEntities(video.channelName || '');
    chan.appendChild(cspan);

    info.appendChild(title);
    info.appendChild(meta);
    info.appendChild(chan);

    row.appendChild(thumbLink);
    row.appendChild(info);
    const actions = document.createElement('div');
    actions.className = 'yt-row-actions';
    if (opts.subscribeInfo) {
        const subscribe = buildSubscribeButton(opts.subscribeInfo);
        subscribe.classList.add('yt-row-subscribe');
        actions.appendChild(subscribe);
    } else {
        row.classList.add('yt-row-menu-only');
        actions.classList.add('menu-only');
    }
    actions.appendChild(buildVideoMenu(video, opts.menuOptions));
    row.appendChild(actions);
    return row;
}

function channelInfoFromVideo(v) {
    const url = v.channelUrl || '';
    const ucid = (url.match(/\/channel\/(UC[\w-]+)/) || [])[1] || null;
    const handle = (url.match(/\/(@[\w.\-]+)/) || [])[1] || null;
    if (!ucid && !handle) return null;
    return {
        channelId: ucid || handle, ucid, handle,
        channelName: v.channelName, thumbnail: v.channelThumbnail, url
    };
}
