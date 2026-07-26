(function() {
    'use strict';

    function createContentPlaylistHelpers(dependencies) {
        const log = dependencies.log;
        const getStorage = dependencies.getStorage;
        const getPlaylistRetryTimeout = dependencies.getPlaylistRetryTimeout;
        const setPlaylistRetryTimeout = dependencies.setPlaylistRetryTimeout;

        function getPlaylistInfo() {
            const urlParams = new URLSearchParams(window.location.search);
            const playlistId = urlParams.get('list');
            if (!playlistId) {
                log('No playlist ID found in URL');
                return null;
            }

            log('Found playlist ID:', playlistId);

            const selectors = [
                'ytd-playlist-panel-renderer #playlist-title yt-formatted-string',
                'ytd-playlist-panel-renderer #playlist-name yt-formatted-string',
                'ytd-playlist-panel-renderer .title yt-formatted-string',
                '.ytd-watch-flexy[playlist] .playlist-title',
                '#secondary .title.ytd-playlist-panel-renderer',
                'ytd-playlist-metadata-header-renderer yt-formatted-string.title',
                'h3.ytd-playlist-panel-renderer',
                '#playlist-title',
                '#playlist-name',
                'ytd-playlist-panel-renderer h3 yt-formatted-string',
                'ytd-playlist-panel-renderer .title',
                '#secondary-inner ytd-playlist-panel-renderer .title',
                'ytd-playlist-header-renderer h1.ytd-playlist-header-renderer',
                '.playlist-title yt-formatted-string',
                '.ytd-playlist-panel-renderer .index-message + .title',
                'yt-page-header-view-model h1.dynamicTextViewModelH1 span',
                'yt-page-header-view-model .yt-page-header-view-model__page-header-title h1 span',
                'yt-dynamic-text-view-model h1.dynamicTextViewModelH1 span'
            ];

            let playlistTitle = null;
            for (const selector of selectors) {
                const element = document.querySelector(selector);
                if (element) {
                    playlistTitle = element.textContent?.trim();
                    log(`Tried selector "${selector}": "${playlistTitle}"`);
                    if (playlistTitle && playlistTitle !== 'Unknown Playlist' && playlistTitle.length > 0) {
                        log('Found valid playlist title:', playlistTitle);
                        break;
                    }
                }
            }

            if (!playlistTitle || playlistTitle === 'Unknown Playlist') {
                log('No valid playlist title found');
                return null;
            }

            let thumbnail = '';
            const currentVideoId = urlParams.get('v');
            if (currentVideoId) {
                thumbnail = `https://i.ytimg.com/vi/${currentVideoId}/hqdefault.jpg`;
            } else {
                const firstVideoLink = document.querySelector(
                    'ytd-playlist-video-renderer a[href*="watch?v="], ' +
                    'ytd-playlist-panel-video-renderer a[href*="watch?v="]'
                );
                if (firstVideoLink) {
                    try {
                        const firstVideoId = new URL(firstVideoLink.href, location.origin).searchParams.get('v');
                        if (firstVideoId) thumbnail = `https://i.ytimg.com/vi/${firstVideoId}/hqdefault.jpg`;
                    } catch (_) { /* thumbnail enrichment can retry later */ }
                }
            }

            const localItems = {};
            document.querySelectorAll(
                'ytd-playlist-video-renderer, ytd-playlist-panel-video-renderer'
            ).forEach((row) => {
                const link = row.querySelector('a[href*="watch?v="]');
                if (!link) return;
                let videoId = '';
                try { videoId = new URL(link.href, location.origin).searchParams.get('v') || ''; } catch (_) { return; }
                if (!videoId || localItems[videoId]) return;
                const titleElement = row.querySelector(
                    '#video-title, #video-title-link, .title, yt-formatted-string.title'
                );
                const channelElement = row.querySelector(
                    'ytd-channel-name a, #byline a, .byline a, .channel-name a'
                );
                const durationElement = row.querySelector(
                    'ytd-thumbnail-overlay-time-status-renderer, #text.ytd-thumbnail-overlay-time-status-renderer'
                );
                localItems[videoId] = {
                    videoId,
                    title: titleElement?.textContent?.trim() || link.title || 'YouTube video',
                    channelName: channelElement?.textContent?.trim() || '',
                    channelUrl: channelElement?.href || '',
                    thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
                    url: `https://www.youtube.com/watch?v=${videoId}`,
                    _durationText: (durationElement?.textContent || '')
                        .replace(/\s+/g, ' ')
                        .match(/\b(?:\d+:)?\d{1,2}:\d{2}\b/)?.[0] || '',
                    savedAt: Date.now()
                };
            });

            const playlistInfo = {
                playlistId,
                title: playlistTitle,
                url: `https://www.youtube.com/playlist?list=${playlistId}`,
                timestamp: Date.now(),
                ...(currentVideoId ? { videoId: currentVideoId } : {}),
                ...(thumbnail ? { thumbnail } : {}),
                ...(Object.keys(localItems).length ? {
                    localItems,
                    videoCount: Object.keys(localItems).length
                } : {})
            };

            log('Created playlist info:', playlistInfo);
            return playlistInfo;
        }

        async function savePlaylistInfo(playlistInfo = null) {
            const info = playlistInfo || getPlaylistInfo();
            if (!info) return;

            log('Saving playlist info:', info);

            try {
                const existing = await getStorage().getPlaylist(info.playlistId);
                const merged = {
                    ...(existing || {}),
                    ...info,
                    ...((existing?.localItems || info.localItems) ? {
                        localItems: {
                            ...((existing && existing.localItems) || {}),
                            ...(info.localItems || {})
                        }
                    } : {}),
                    lastUpdated: Date.now()
                };
                if (merged.localItems) merged.videoCount = Object.keys(merged.localItems).length;
                await getStorage().setPlaylist(info.playlistId, merged);
                log('Playlist info saved successfully:', merged);
            } catch (error) {
                log('Error saving playlist info:', error);
            }
        }

        function tryToSavePlaylist(retries = 3) {
            if (window.location.pathname.startsWith('/watch') ||
                window.location.pathname.startsWith('/shorts/')) {
                log('Skipping automatic playlist save during video playback');
                attachPlaylistIgnoreToggles();
                return;
            }

            const urlParams = new URLSearchParams(window.location.search);
            const playlistId = urlParams.get('list');

            if (!playlistId) {
                log('No playlist ID in URL, skipping playlist save');
                return;
            }

            log(`Trying to save playlist (${retries} retries left)...`);
            const playlistInfo = getPlaylistInfo();

            if (playlistInfo) {
                log('Playlist info found, saving...');
                savePlaylistInfo(playlistInfo);
                attachPlaylistIgnoreToggles();
            } else if (retries > 0) {
                log(`Playlist title not found for ID ${playlistId}, will retry in 3 seconds... (${retries} retries left)`);
                clearTimeout(getPlaylistRetryTimeout());

                const delay = Math.min(3000 * (4 - retries), 5000);
                setPlaylistRetryTimeout(setTimeout(() => {
                    const currentPlaylistId = new URLSearchParams(window.location.search).get('list');
                    if (currentPlaylistId === playlistId) {
                        tryToSavePlaylist(retries - 1);
                        attachPlaylistIgnoreToggles();
                    } else {
                        log('Playlist ID changed, stopping retry attempts');
                    }
                }, delay));
            } else {
                log('Failed to get playlist title after retries; skipping placeholder playlist save');
                attachPlaylistIgnoreToggles();
            }
        }

        async function attachPlaylistIgnoreToggles() {
            document.querySelectorAll('.ytvht-ignore-toggle, .ytvht-ignore-row')
                .forEach((node) => node.remove());
        }

        function ensurePlaylistIgnoreToggles(retries = 12) {
            attachPlaylistIgnoreToggles();
        }

        return {
            getPlaylistInfo,
            savePlaylistInfo,
            tryToSavePlaylist,
            attachPlaylistIgnoreToggles,
            ensurePlaylistIgnoreToggles
        };
    }

    window.YTVHTContentPlaylists = {
        create: createContentPlaylistHelpers
    };
})();
