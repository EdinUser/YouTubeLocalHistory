// ----- in-extension channel page -----------------------------------------
let activeChannelInfo = null;

function channelIdentity(info) {
    const ids = [info && info.channelId, info && info.ucid, info && info.handle]
        .filter(Boolean)
        .map((id) => String(id).toLowerCase());
    const name = channelKey(info && info.channelName);
    return { ids, name };
}

function videoMatchesChannelInfo(video, info) {
    const target = channelIdentity(info);
    const sourceIds = [video && video.channelId, video && video.ucid, video && video.handle]
        .filter(Boolean)
        .map((id) => String(id).toLowerCase());
    if (target.ids.some((id) => sourceIds.includes(id))) return true;
    const url = video && video.channelUrl;
    if (url && target.ids.some((id) => String(url).toLowerCase().includes(id))) return true;
    return target.name && channelKey(video && video.channelName) === target.name;
}

function bestChannelInfoFromVideo(video) {
    const info = channelInfoFromVideo(video) || {};
    return {
        channelId: info.channelId || video.channelId || info.ucid || info.handle || channelKey(video.channelName),
        ucid: info.ucid || video.ucid || null,
        handle: info.handle || video.handle || null,
        channelName: video.channelName || info.channelName || 'Unknown channel',
        thumbnail: video.channelThumbnail || info.thumbnail || null,
        url: info.url || video.channelUrl || video.url || ''
    };
}

function normalizeChannelInfo(info) {
    return {
        channelId: info.channelId || info.ucid || info.handle || channelKey(info.channelName),
        ucid: info.ucid || null,
        handle: info.handle || null,
        channelName: info.channelName || 'Unknown channel',
        thumbnail: info.thumbnail || info.channelThumbnail || null,
        url: info.url || ''
    };
}

function collectChannelVideos(info) {
    const byId = new Map();
    const sources = []
        .concat(youtubeSearchResults || [])
        .concat(buildLocalIndex());
    sources.forEach((video) => {
        if (!video || video._type === 'channel' || !videoMatchesChannelInfo(video, info)) return;
        const key = video.videoId || `${channelKey(video.channelName)}:${normalizeText(video.title)}`;
        if (!key || byId.has(key)) return;
        applyLocalChannelArtwork(video);
        byId.set(key, video);
    });
    return Array.from(byId.values()).sort((a, b) => {
        const ageA = relativeAgeDays(a._whenText);
        const ageB = relativeAgeDays(b._whenText);
        const timeA = Number(a.published || 0) || (ageA == null ? 0 : Date.now() - ageA * 86400000);
        const timeB = Number(b.published || 0) || (ageB == null ? 0 : Date.now() - ageB * 86400000);
        return timeB - timeA;
    });
}

function renderChannelAvatar(container, info) {
    container.textContent = '';
    if (info.thumbnail) {
        const img = document.createElement('img');
        img.className = 'channel-view-avatar';
        img.src = info.thumbnail;
        img.alt = '';
        container.appendChild(img);
    } else {
        const fallback = document.createElement('div');
        fallback.className = 'channel-view-avatar';
        fallback.textContent = decodeHtmlEntities(info.channelName || '?').charAt(0).toUpperCase();
        container.appendChild(fallback);
    }
}

function renderChannelPage(info) {
    activeChannelInfo = normalizeChannelInfo(info);
    const title = document.getElementById('channelTitle');
    const meta = document.getElementById('channelMeta');
    const avatar = document.getElementById('channelAvatar');
    const actions = document.getElementById('channelActions');
    const videos = document.getElementById('channelVideos');
    const empty = document.getElementById('channelEmpty');
    if (!title || !meta || !avatar || !actions || !videos || !empty) return;

    renderChannelAvatar(avatar, activeChannelInfo);
    title.textContent = decodeHtmlEntities(activeChannelInfo.channelName || 'Unknown channel');
    const channelVideos = collectChannelVideos(activeChannelInfo);
    meta.textContent = [
        activeChannelInfo.handle || activeChannelInfo.ucid || '',
        `${channelVideos.length} video${channelVideos.length === 1 ? '' : 's'} found`
    ].filter(Boolean).join(' • ');

    actions.textContent = '';
    actions.appendChild(buildSubscribeButton(activeChannelInfo));
    if (activeChannelInfo.url) {
        const open = document.createElement('a');
        open.className = 'btn';
        open.href = activeChannelInfo.url;
        open.target = '_blank';
        open.rel = 'noopener';
        open.textContent = 'Open on YouTube';
        actions.appendChild(open);
    }

    videos.textContent = '';
    channelVideos.forEach((video) => videos.appendChild(buildResultRow(video)));
    empty.style.display = channelVideos.length ? 'none' : 'block';
}

function showChannelPage(info) {
    if (youtubeSearchTimer) {
        clearTimeout(youtubeSearchTimer);
        youtubeSearchTimer = null;
    }
    youtubeSearchRequestId++;
    youtubeSearchLoadingMore = false;
    document.body.classList.remove('shorts-mode');
    setRefreshVisible(false);
    setCreatePlaylistVisible(false);
    setSaveSettingsVisible(false);
    setClearSubscriptionsVisible(false);
    setClearHistoryVisible(false);
    setFeedOptionsVisible(false);
    showFeedStatus(false);
    channelActive = true;
    analyticsActive = false;
    subscriptionsActive = false;
    playlistsActive = false;
    historyActive = false;
    settingsActive = false;
    ['localHeading', 'grid', 'localSearchResults', 'empty', 'ytSection',
        'analyticsSection', 'subscriptionsSection', 'playlistsSection',
        'historySection', 'settingsSection'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    hideSearchControls();
    const chips = document.querySelector('.chips');
    if (chips) chips.style.display = 'none';
    const section = document.getElementById('channelSection');
    if (section) section.style.display = 'block';
    setActiveNav('');
    renderChannelPage(info);
}

function hideChannelPage() {
    channelActive = false;
    const section = document.getElementById('channelSection');
    if (section) section.style.display = 'none';
}
