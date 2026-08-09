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

            const playlistInfo = {
                playlistId,
                title: playlistTitle,
                url: `https://www.youtube.com/playlist?list=${playlistId}`,
                timestamp: Date.now(),
                ...(currentVideoId ? { videoId: currentVideoId } : {}),
                ...(thumbnail ? { thumbnail } : {})
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
                    lastUpdated: Date.now()
                };
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

        function playlistToggleAnchor() {
            // On a playlist URL YouTube keeps the title/actions in the page
            // header; while playing from one it keeps them in the playlist
            // panel.  These are structural selectors and do not depend on a
            // localized YouTube label.
            const isVisible = (element) => {
                if (!element || element.closest('[hidden], [aria-hidden="true"]')) return false;
                // This also runs under JSDOM integration coverage, where all
                // layout geometry is zero. Structural hidden state is the
                // portable signal we need to reject stale YouTube panels.
                return true;
            };
            if (window.location.pathname.startsWith('/watch')) {
                return Array.from(document.querySelectorAll(
                    'ytd-playlist-panel-renderer #header, ytd-playlist-panel-renderer .header, ytd-playlist-panel-renderer #container'
                )).find(isVisible) || null;
            }
            const selectors = [
                'yt-page-header-view-model .ytFlexibleActionsViewModelActionRow',
                'yt-page-header-view-model',
                'ytd-playlist-sidebar-primary-info-renderer ytd-menu-renderer #top-level-buttons-computed',
                'ytd-playlist-sidebar-primary-info-renderer #menu',
                'ytd-playlist-sidebar-primary-info-renderer',
                'ytd-playlist-metadata-header-renderer #actions',
                'ytd-playlist-metadata-header-renderer',
                'ytd-playlist-header-renderer #actions',
                'ytd-playlist-header-renderer'
            ];
            // YouTube commonly leaves an old sidebar in the DOM with `hidden`
            // while the current playlist uses a page-header view model. Never
            // mount the control under that hidden copy.
            for (const selector of selectors) {
                const anchor = Array.from(document.querySelectorAll(selector))
                    .find(isVisible);
                if (anchor) return anchor;
            }
            return null;
        }

        function setPlaylistToggleState(button, paused) {
            button.setAttribute('aria-pressed', paused ? 'true' : 'false');
            button.dataset.ytvhtPlaylistHistoryPaused = paused ? 'true' : 'false';
            button.title = paused
                ? 're:Watch: playlist history paused'
                : 're:Watch: playlist history active';
            button.replaceChildren();
            const icon = document.createElement('img');
            icon.src = (globalThis.browser?.runtime || globalThis.chrome?.runtime).getURL('icon48.png');
            icon.alt = '';
            icon.width = 16;
            icon.height = 16;
            button.append(icon, document.createTextNode(paused ? 'History paused' : 'History active'));
        }

        function playlistToggleContainer(anchor) {
            if (window.location.pathname.startsWith('/watch')) return anchor;
            let row = anchor.parentElement?.querySelector(':scope > .ytvht-playlist-history-row');
            if (!row) {
                row = document.createElement('div');
                row.className = 'ytvht-playlist-history-row';
                if (anchor.parentElement) anchor.parentElement.insertBefore(row, anchor.nextSibling);
                else anchor.append(row);
            }
            return row;
        }

        async function attachPlaylistIgnoreToggles() {
            const playlistId = new URLSearchParams(window.location.search).get('list');
            if (!playlistId) {
                document.querySelectorAll('.ytvht-playlist-history-toggle').forEach((node) => node.remove());
                return;
            }
            const anchor = playlistToggleAnchor();
            if (!anchor) return;
            const container = playlistToggleContainer(anchor);

            // A SPA may retain the old header briefly. Reuse the one local
            // control and move it into the row belonging to the live actions.
            let button = container.querySelector(':scope > .ytvht-playlist-history-toggle') ||
                document.querySelector('.ytvht-playlist-history-toggle');
            if (!button) {
                button = document.createElement('button');
                button.type = 'button';
                button.className = 'ytvht-playlist-history-toggle';
                button.addEventListener('click', async (event) => {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    const currentPlaylistId = button.dataset.ytvhtPlaylistId;
                    if (!currentPlaylistId || button.disabled) return;
                    button.disabled = true;
                    try {
                        const existing = await getStorage().getPlaylist(currentPlaylistId);
                        const paused = !existing?.ignoreVideos;
                        await getStorage().setPlaylist(currentPlaylistId, {
                            ...(existing || {}),
                            playlistId: currentPlaylistId,
                            url: `https://www.youtube.com/playlist?list=${currentPlaylistId}`,
                            ignoreVideos: paused,
                            timestamp: existing?.timestamp || Date.now(),
                            lastUpdated: Date.now()
                        });
                        setPlaylistToggleState(button, paused);
                    } catch (error) {
                        log('Could not update playlist history preference', error);
                    } finally {
                        button.disabled = false;
                    }
                }, true);
            }
            if (button.parentElement !== container) container.append(button);
            button.dataset.ytvhtPlaylistId = playlistId;
            const record = await getStorage().getPlaylist(playlistId);
            setPlaylistToggleState(button, Boolean(record?.ignoreVideos));
        }

        function ensurePlaylistIgnoreToggles(retries = 12) {
            const mounted = attachPlaylistIgnoreToggles().catch((error) => {
                log('Could not mount playlist history control', error);
                return null;
            });
            if (retries > 0 && new URLSearchParams(window.location.search).has('list') && !playlistToggleAnchor()) {
                setTimeout(() => ensurePlaylistIgnoreToggles(retries - 1), 500);
            }
            return mounted;
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
