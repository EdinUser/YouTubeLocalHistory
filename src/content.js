(function() {
    'use strict';

    // Cross-browser wrapper for storage calls made directly from the content script.
    const isFirefox = (function() {
        try {
            return typeof browser !== 'undefined' && typeof chrome !== 'undefined' && browser !== chrome;
        } catch (e) {
            return false;
        }
    })();
    const isChrome = typeof chrome !== 'undefined' && (!isFirefox);

    const storage = {
        async get(keys) {
            try {
                if (isFirefox) {
                    return await browser.storage.local.get(keys);
                } else {
                    return new Promise((resolve, reject) => {
                        chrome.storage.local.get(keys, (result) => {
                            if (chrome.runtime.lastError) {
                                // YouTube tabs can outlive a reloaded extension context.
                                if (chrome.runtime.lastError.message.includes('Extension context invalidated')) {
                                    log('[STORAGE] Extension context invalidated during get operation, returning empty result');
                                    resolve({});
                                } else {
                                    reject(chrome.runtime.lastError);
                                }
                            } else {
                                resolve(result);
                            }
                        });
                    });
                }
            } catch (error) {
                if (error.message && error.message.includes('Extension context invalidated')) {
                    log('[STORAGE] Extension context invalidated during get operation, returning empty result');
                    return {};
                }
                throw error;
            }
        },

        async set(data) {
            try {
                if (isFirefox) {
                    return await browser.storage.local.set(data);
                } else {
                    return new Promise((resolve, reject) => {
                        chrome.storage.local.set(data, () => {
                            if (chrome.runtime.lastError) {
                                // YouTube tabs can outlive a reloaded extension context.
                                if (chrome.runtime.lastError.message.includes('Extension context invalidated')) {
                                    log('[STORAGE] Extension context invalidated during set operation, ignoring');
                                    resolve();
                                } else {
                                    reject(chrome.runtime.lastError);
                                }
                            } else {
                                resolve();
                            }
                        });
                    });
                }
            } catch (error) {
                if (error.message && error.message.includes('Extension context invalidated')) {
                    log('[STORAGE] Extension context invalidated during set operation, ignoring');
                    return;
                }
                throw error;
            }
        }
    };

    const DB_NAME = 'YouTubeHistoryDB';
    const DB_VERSION = 3;
    const STORE_NAME = 'videoHistory';
    const EXTENSION_VERSION = chrome.runtime.getManifest().version;
    const SAVE_INTERVAL = 5000;

    const DEFAULT_SETTINGS = {
        autoCleanPeriod: 'forever',
        paginationCount: 10,
        overlayTitle: 'viewed',
        accentColor: 'blue',
        overlayColor: 'blue',
        overlayLabelSize: 'medium',
        debug: false,
        pauseHistoryInPlaylists: false,
        localFeedEnabled: true,
        hideAccountUI: false,
        hideRecommendations: true,
        feedRefreshMinutes: 60,
        version: EXTENSION_VERSION
    };
    const OVERLAY_COLORS = {
        blue: '#3ea6ff',
        red: '#ff4e45',
        green: '#2ecc71',
        purple: '#a970ff',
        orange: '#ff9f2f'
    };
    const OVERLAY_LABEL_SIZE_MAP = {
        small: { fontSize: 12, bar: 2 },
        medium: { fontSize: 16, bar: 3 },
        large: { fontSize: 22, bar: 4 },
        xlarge: { fontSize: 28, bar: 5 }
    };
    let db;
    let saveIntervalId;
    let isInitialized = false;
    let initRetryCount = 0;
    const MAX_INIT_RETRIES = 3;
    let currentSettings = DEFAULT_SETTINGS;
    // Track already-initialized video elements to avoid duplicate listeners
    const trackedVideos = new Set();

    // Track event listeners for cleanup
    const videoEventListeners = new WeakMap();

    function getAccentOverlayColor(settings = currentSettings) {
        const colorName = settings?.accentColor || settings?.overlayColor || 'blue';
        return OVERLAY_COLORS[colorName] || OVERLAY_COLORS.blue;
    }

    // Track MutationObservers for cleanup
    const videoObservers = new WeakMap();

    // Cleanup tracking
    let thumbnailObserver = null;
    let shortsVideoObserver = null;
    let initChecker = null;
    let playlistRetryTimeout = null;
    let messageListener = null;
    let urlCheckIntervalId = null;
    let playlistNavigationCheckInterval = null;
    let historyApiTimeout = null;

    // Batches thumbnail overlay work when many YouTube cards load at once.
    let isProcessingThumbnails = false;
    let thumbnailProcessingQueue = new Set();
    let processingTimeout = null;

    // Tracks batches of newly inserted YouTube content during SPA rendering.
    let contentLoadingBatch = new Set();
    let batchProcessingTimeout = null;

    // Debounces thumbnail overlay retries keyed by the YouTube card element.
    const pendingOperations = new Map();
    const ENABLE_NATIVE_THUMBNAIL_OVERLAYS = true;
    let processExistingThumbnails = null;

    // Last video handled by the tracker; prevents duplicate SPA setup.
    let lastProcessedVideoId = null;

    // Keep the outgoing Short's identity and progress when YouTube changes the
    // SPA route before the previous media element emits its final save event.
    let latestShortsSnapshot = null;

    // Used to decide whether a timestamp restore belongs to a fresh navigation.
    let lastSpaNavigationTime = 0;

    // Keep an in-flight restore across media and <video> element replacement
    // while the watch URL still identifies the same YouTube video.
    let pendingRestoreAfterMediaChange = null;
    const RESTORE_MEDIA_SETTLE_MS = 500;

    // Fallback for route changes YouTube does not report through events.
    let lastUrl = window.location.href;

    function videosWithinNode(node) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) return [];
        return [
            ...(node.tagName === 'VIDEO' ? [node] : []),
            ...node.querySelectorAll('video')
        ];
    }

    function getPrimaryVideo() {
        if (typeof document === 'undefined') return null;
        const pathname = window.location?.pathname || '';

        if (pathname.startsWith('/shorts/')) {
            const shortsVideos = [...document.querySelectorAll('ytd-reel-video-renderer video')]
                .filter(video => video.isConnected);
            const isVisible = (video) => {
                const rect = video.getBoundingClientRect?.();
                return !!rect && rect.width > 0 && rect.height > 0;
            };
            const activeShort = shortsVideos.find(video => isVisible(video) && !video.paused && video.readyState >= 1)
                || shortsVideos.find(video => isVisible(video) && video.readyState >= 1)
                || shortsVideos.find(video => !video.paused && video.readyState >= 1);
            if (activeShort) return activeShort;
        }

        const selectors = pathname.startsWith('/shorts/')
            ? [
                'ytd-reel-video-renderer[is-active] video',
                'ytd-reel-video-renderer[active] video',
                'video.html5-main-video'
            ]
            : [
                '#movie_player video.html5-main-video',
                '#movie_player video',
                'ytd-player video.html5-main-video',
                'video.html5-main-video'
            ];

        for (const selector of selectors) {
            const candidate = document.querySelector(selector);
            if (candidate?.isConnected) return candidate;
        }

        const connectedVideos = [...document.querySelectorAll('video')]
            .filter(video => video.isConnected);
        return connectedVideos.find(video => video.readyState >= 1) || connectedVideos[0] || null;
    }

    function isPrimaryVideo(video) {
        return !!video && video.isConnected && getPrimaryVideo() === video;
    }

    function isYouTubeAdPlaying(video) {
        const player = video?.closest?.('#movie_player') || document.querySelector('#movie_player');
        return !!player && (
            player.classList.contains('ad-showing')
            || player.classList.contains('ad-interrupting')
        );
    }

    // YouTube frequently reparents the same player. MutationObserver reports
    // that as a removal plus an addition, but the element is connected again by
    // the time this callback runs. Preserve its listeners and closure state.
    function handleVideoMutations(mutations) {
        const addedVideos = new Set();
        const removedVideos = new Set();

        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                videosWithinNode(node).forEach(video => addedVideos.add(video));
            });
            mutation.removedNodes.forEach((node) => {
                videosWithinNode(node).forEach(video => removedVideos.add(video));
            });
        });

        removedVideos.forEach((video) => {
            if (!video.isConnected && trackedVideos.has(video)) {
                cleanupVideoListeners(video);
            }
        });

        const primaryVideo = getPrimaryVideo();
        if (primaryVideo && addedVideos.has(primaryVideo) && !trackedVideos.has(primaryVideo)) {
            log('[Debug] Found new primary video element to track');
            setupVideoTracking(primaryVideo);
        }
    }

    // YouTube often reuses the document and swaps video elements in-place.
    let videoObserver = new MutationObserver(handleVideoMutations);

    function log(message, data) {
        if (currentSettings.debug) {
            console.log('[ythdb]', message, data || '');
        }
    }

    const RESTORE_TRACE_STORAGE_KEY = '__ytvht_e2e_restore_trace';
    const restoreTraceEntries = [];
    const restoreTraceVideoIds = new WeakMap();
    let nextRestoreTraceVideoId = 1;

    function getRestoreVideoTraceDetails(video) {
        if (!video) return {};
        if (!restoreTraceVideoIds.has(video)) {
            restoreTraceVideoIds.set(video, nextRestoreTraceVideoId++);
        }
        return {
            trackerId: restoreTraceVideoIds.get(video),
            connected: video.isConnected,
            primary: isPrimaryVideo(video),
            className: video.className || '',
            parentId: video.parentElement?.id || ''
        };
    }

    function isRestoreTraceActive() {
        try {
            return window.location.hash.includes('ytvht_e2e_restore_trace');
        } catch (_) {
            return false;
        }
    }

    // Only Firefox's diagnostic test adds this query parameter. Persist the
    // trace in extension storage because YouTube can replace its document
    // shell, which would discard a DOM-backed trace.
    function traceRestore(event, details = {}) {
        if (!isRestoreTraceActive()) return;

        restoreTraceEntries.push({
            at: Date.now(),
            event,
            videoId: new URL(window.location.href).searchParams.get('v') || '',
            ...details
        });
        try {
            const write = chrome.storage.local.set({
                [RESTORE_TRACE_STORAGE_KEY]: restoreTraceEntries.slice(-100)
            });
            if (write && typeof write.catch === 'function') write.catch(() => {});
        } catch (_) {
            // Trace persistence must never affect content-script initialization.
        }
    }

    traceRestore('content-script-loaded', { url: window.location.href });
    log('YouTube Video History Tracker script is running.');

    function startNativeThumbnailOverlays() {
        if (!ENABLE_NATIVE_THUMBNAIL_OVERLAYS) {
            clearNativeThumbnailOverlayArtifacts();
            return;
        }
        if (!ENABLE_NATIVE_THUMBNAIL_OVERLAYS || !document.body || !thumbnailObserver || !processExistingThumbnails) {
            return;
        }

        try {
            thumbnailObserver.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['src', 'href', 'data-visibility-tracking']
            });
        } catch (error) {
            log('[Overlay] Thumbnail observer already active or failed to start', error);
        }

        processExistingThumbnails();
        setTimeout(processExistingThumbnails, 2000);
    }

    function clearNativeThumbnailOverlayArtifacts() {
        document.querySelectorAll('.ytvht-viewed-label, .ytvht-progress-mask, .ytvht-progress-bar, .ytvht-native-progress-line, .ytvht-remove-button')
            .forEach((node) => node.remove());
        document.querySelectorAll('.ytvht-has-overlay, .ytvht-native-page-overlay, .ytvht-native-overlay-target, [data-ytvht-video-id], [data-ytvht-label]')
            .forEach((node) => {
                node.classList.remove('ytvht-has-overlay', 'ytvht-native-page-overlay', 'ytvht-native-overlay-target', 'ytvht-native-overlay-no-progress');
                if (node.dataset?.ytvhtVideoId) delete node.dataset.ytvhtVideoId;
                if (node.dataset?.ytvhtLabel) delete node.dataset.ytvhtLabel;
                node.style?.removeProperty('--ytvht-overlay-color');
                node.style?.removeProperty('--ytvht-label-font-size');
                node.style?.removeProperty('--ytvht-label-padding');
                node.style?.removeProperty('--ytvht-progress-height');
                node.style?.removeProperty('--ytvht-progress-width');
            });
        document.documentElement.removeAttribute('ytvht-native-badge-only');
    }

    // Enhanced cleanup function
    function cleanup() {
        log('Cleaning up resources...');

        // Stop all observers
        if (thumbnailObserver) {
            thumbnailObserver.disconnect();
            thumbnailObserver = null;
        }
        if (shortsVideoObserver) {
            shortsVideoObserver.disconnect();
            shortsVideoObserver = null;
        }
        if (videoObserver) {
            videoObserver.disconnect();
            videoObserver = null;
        }
        if (initChecker) {
            clearInterval(initChecker);
            initChecker = null;
        }
        if (playlistRetryTimeout) {
            clearTimeout(playlistRetryTimeout);
            playlistRetryTimeout = null;
        }
        if (saveIntervalId) {
            clearInterval(saveIntervalId);
            saveIntervalId = null;
        }
        if (urlCheckIntervalId) {
            clearInterval(urlCheckIntervalId);
            urlCheckIntervalId = null;
        }
        if (playlistNavigationCheckInterval) {
            clearInterval(playlistNavigationCheckInterval);
            playlistNavigationCheckInterval = null;
        }
        if (historyApiTimeout) {
            clearTimeout(historyApiTimeout);
            historyApiTimeout = null;
        }
        if (messageListener) {
            // During page unload, the runtime might be disconnected.
            // Check if it's still available before trying to remove the listener.
            if (chrome.runtime && chrome.runtime.onMessage) {
                chrome.runtime.onMessage.removeListener(messageListener);
            }
            messageListener = null;
        }

        // Clean up all pending operations
        for (const [element, ops] of pendingOperations.entries()) {
            if (ops.timeout) clearTimeout(ops.timeout);
            if (ops.rafId) cancelAnimationFrame(ops.rafId);
        }
        pendingOperations.clear();

        // The Set and WeakMap used for trackedVideos and videoEventListeners
        // do not need to be cleared manually. They will be
        // garbage-collected automatically when the page unloads.

        // Reset state variables
        isInitialized = false;
        latestShortsSnapshot = null;
        initRetryCount = 0;
        isProcessingThumbnails = false;
        thumbnailProcessingQueue.clear();
        if (processingTimeout) {
            clearTimeout(processingTimeout);
            processingTimeout = null;
        }

        log('Cleanup completed');
    }

    // Function to clean up video event listeners
    function cleanupVideoListeners(video) {
        if (videoEventListeners.has(video)) {
            const listeners = videoEventListeners.get(video);
            listeners.forEach(({ event, handler }) => {
                try {
                    video.removeEventListener(event, handler);
                } catch (error) {
                    log('Error removing event listener:', error);
                }
            });
            videoEventListeners.delete(video);
        }

        // Clean up MutationObservers
        if (videoObservers.has(video)) {
            const observers = videoObservers.get(video);
            observers.forEach(observer => {
                try {
                    observer.disconnect();
                } catch (error) {
                    log('Error disconnecting observer:', error);
                }
            });
            videoObservers.delete(video);
        }

        trackedVideos.delete(video);
        log('Cleaned up event listeners and observers for video:', video);
    }

    // Register listeners so cleanup can detach them on page unload/reuse.
    function addTrackedEventListener(video, event, handler) {
        if (!videoEventListeners.has(video)) {
            videoEventListeners.set(video, []);
        }
        videoEventListeners.get(video).push({ event, handler });
        video.addEventListener(event, handler);
    }

    // Keep per-video observers together with the video they belong to.
    function addTrackedObserver(video, observer) {
        if (!videoObservers.has(video)) {
            videoObservers.set(video, []);
        }
        videoObservers.get(video).push(observer);
    }

    // Use 'pagehide' for reliable cleanup on page unload
    window.addEventListener('pagehide', cleanup);

    const { injectCSS, updateOverlayCSS } = window.YTVHTContentCss;

    const {
        getVideoId,
        getCleanVideoUrl,
        interceptVideoLinkClicks
    } = window.YTVHTContentUrls.create({
        log,
        getStorage: () => ytStorage
    });

    const {
        savePlaylistInfo,
        tryToSavePlaylist,
        ensurePlaylistIgnoreToggles
    } = window.YTVHTContentPlaylists.create({
        log,
        getStorage: () => ytStorage,
        getPlaylistRetryTimeout: () => playlistRetryTimeout,
        setPlaylistRetryTimeout: (timeoutId) => {
            playlistRetryTimeout = timeoutId;
        }
    });

    // Load settings from browser.storage.local
    async function loadSettings() {
        try {
            const settings = await ytStorage.getSettings() || {};
            let updated = false;

            // Ensure all default settings are present
            for (const key in DEFAULT_SETTINGS) {
                if (!(key in settings)) {
                    settings[key] = DEFAULT_SETTINGS[key];
                    updated = true;
                }
            }
            if (settings.autoCleanPeriod === 90 || settings.autoCleanPeriod === '90') {
                settings.autoCleanPeriod = 'forever';
                updated = true;
            }

            // Save updated settings if needed
            if (updated) {
                await ytStorage.setSettings(settings);
            }

            currentSettings = settings;
            return settings;
        } catch (error) {
            console.error('Error loading settings:', error);
            currentSettings = DEFAULT_SETTINGS;
            return DEFAULT_SETTINGS;
        }
    }

    // Save the current video timestamp (regular videos)
    async function saveTimestamp() {
        if (window.location.pathname.startsWith('/shorts/')) {
            await saveShortsTimestamp();
            return;
        }

        const video = getPrimaryVideo();
        if (!video) return;

        // Playlist-aware pause/ignore logic
        try {
            const urlParams = new URLSearchParams(window.location.search);
            const playlistId = urlParams.get('list');
            if (playlistId) {
                if (currentSettings?.pauseHistoryInPlaylists) {
                    log('Global pause enabled for playlist context; skipping save.');
                    return;
                }
                try {
                    const playlistRecord = await ytStorage.getPlaylist(playlistId);
                    if (playlistRecord?.ignoreVideos) {
                        log('Per-playlist ignore enabled; skipping save.', { playlistId });
                        return;
                    }
                } catch (e) {
                    // ignore read errors, proceed with save
                }
            }
        } catch (e) {
            // ignore URL parsing errors
        }

        let currentTime = video.currentTime;
        const duration = video.duration;
        const videoId = getVideoId();
        if (!videoId) return;

        // Do not update record if timestamp is 0 or duration is not available
        if (!currentTime || currentTime === 0 || !duration || duration === 0) return;

        // If within last 10 seconds, save as duration - 10 (but not less than 0)
        if (currentTime > duration - 10) {
            currentTime = Math.max(0, duration - 10);
        }

        // Get video title with fallbacks
        let title = '';
        const primaryTitle = document.querySelector('h1.ytd-video-primary-info-renderer yt-formatted-string');
        if (primaryTitle?.textContent) {
            title = primaryTitle.textContent.trim();
        }
        if (!title) {
            title = document.title.replace(/ - YouTube$/, '').trim();
        }
        if (!title) {
            const existingRecord = await ytStorage.getVideo(videoId);
            title = existingRecord?.title || 'Unknown Title';
        }
        title = title || 'Unknown Title';

        // Extract channel name and channelId from the channel link
        let channelName = 'Unknown Channel';
        let channelId = '';
        const channelLink = document.querySelector('ytd-video-owner-renderer ytd-channel-name a');
        if (channelLink) {
            channelName = channelLink.textContent.trim();
            // Extract the href, which is either /@handle or /channel/UCxxxx
            const href = channelLink.getAttribute('href') || '';
            if (href.startsWith('/@')) {
                channelId = href.slice(1); // '@handle'
            } else if (href.startsWith('/channel/')) {
                channelId = href.replace('/channel/', ''); // 'UCxxxx...'
            }
        }

        const record = {
            videoId,
            title,
            time: currentTime,
            duration,
            timestamp: Date.now(),
            // Always use clean URL without timestamp parameter
            url: getCleanVideoUrl(),
            channelName,
            channelId
        };

        try {
            // Compute delta against previous saved time to update stats
            let previous = null;
            try { previous = await ytStorage.getVideo(videoId); } catch (_) {}
            const prevTime = previous && typeof previous.time === 'number' ? previous.time : 0;
            const delta = Math.max(0, Math.floor(record.time - prevTime));

            await ytStorage.setVideo(videoId, record);
            if (new URLSearchParams(window.location.search).has('list')) {
                await savePlaylistInfo();
            }
            if (delta > 0 && typeof ytStorage.updateStats === 'function') {
                const prevRatio = (previous && previous.duration) ? (previous.time || 0) / previous.duration : 0;
                const newRatio = (record.duration ? record.time / record.duration : 0);
                const crossedCompleted = record.duration && prevRatio < 0.9 && newRatio >= 0.9;
                const isNewVideo = !previous || !previous.time;
                const metadata = {
                    isNewVideo: !!isNewVideo,
                    isShorts: false,
                    durationSeconds: isNewVideo && isFinite(record.duration) ? Math.floor(record.duration) : 0,
                    crossedCompleted: !!crossedCompleted
                };
                await ytStorage.updateStats(delta, record.timestamp, metadata);
            }
            broadcastVideoUpdate(record);
            log('[Critical] Timestamp saved', { videoId, time: currentTime });
        } catch (error) {
            log('[Error] Failed to save timestamp', { videoId, error });
        }
    }

    function getShortsMetadata(video = getPrimaryVideo(), expectedVideoId = getVideoId()) {
        const reel = video?.closest?.('ytd-reel-video-renderer') || null;
        if (!reel) return { title: 'Unknown Title', channelName: 'Unknown', channelId: 'Unknown' };

        const reelVideoId = [...reel.querySelectorAll('a[href*="/shorts/"]')]
            .map(link => (link.getAttribute('href') || '').match(/\/shorts\/([\w-]+)/)?.[1] || '')
            .find(Boolean);
        if (expectedVideoId && reelVideoId && reelVideoId !== expectedVideoId) {
            return { title: 'Unknown Title', channelName: 'Unknown', channelId: 'Unknown' };
        }

        const titleEl = reel.querySelector([
            'yt-shorts-video-title-view-model h1',
            'yt-shorts-video-title-view-model h2',
            'yt-shorts-video-title-view-model [aria-label]',
            'a.ytp-title-link[href*="/shorts/"]',
            'yt-shorts-video-title-view-model'
        ].join(', '));
        const title = (titleEl?.getAttribute?.('aria-label') || titleEl?.textContent || '').trim() || 'Unknown Title';

        const channelLink = reel.querySelector([
            'yt-reel-channel-bar-view-model a[href^="/@"]',
            'yt-reel-channel-bar-view-model a[href^="/channel/"]',
            'a[href^="/@"][href$="/shorts"]',
            'a[href*="youtube.com/@"][href$="/shorts"]',
            'a[href^="/channel/"]',
            'a[href*="youtube.com/channel/"]',
            'ytd-channel-name a',
            '#owner-name a',
            'a[href^="/@"]'
        ].join(', '));
        const href = channelLink?.getAttribute('href') || '';
        const channelMatch = href.match(/\/channel\/([^/?#]+)/);
        const handleMatch = href.match(/\/@([^/?#]+)/);
        const channelId = (channelMatch?.[1] || handleMatch?.[1] || '').trim() || 'Unknown';
        const channelName = (channelLink?.textContent || '').trim()
            || (handleMatch ? `@${handleMatch[1]}` : '')
            || 'Unknown';

        if (title !== 'Unknown Title') log('Shorts title detected:', title);
        if (channelName !== 'Unknown') log('Shorts channel detected:', channelName);
        return { title, channelName, channelId };
    }

    function captureShortsSnapshot(video = getPrimaryVideo(), expectedVideoId = null) {
        if (!window.location.pathname.startsWith('/shorts/')) return null;

        const routeVideoId = getVideoId();
        const videoId = expectedVideoId || routeVideoId;
        const currentTime = video?.currentTime;
        if (!videoId || routeVideoId !== videoId || !currentTime || currentTime <= 0) return null;

        const priorMetadata = latestShortsSnapshot?.videoId === videoId
            ? latestShortsSnapshot
            : null;
        const currentMetadata = getShortsMetadata(video, videoId);
        const metadata = {
            title: currentMetadata.title !== 'Unknown Title'
                ? currentMetadata.title
                : (priorMetadata?.title || 'Unknown Title'),
            channelName: currentMetadata.channelName !== 'Unknown'
                ? currentMetadata.channelName
                : (priorMetadata?.channelName || 'Unknown'),
            channelId: currentMetadata.channelId !== 'Unknown'
                ? currentMetadata.channelId
                : (priorMetadata?.channelId || 'Unknown')
        };
        latestShortsSnapshot = {
            videoId,
            time: currentTime,
            duration: video.duration,
            title: metadata.title,
            url: `https://www.youtube.com/shorts/${videoId}`,
            isShorts: true,
            channelName: metadata.channelName,
            channelId: metadata.channelId
        };
        return { ...latestShortsSnapshot };
    }

    // Save Shorts timestamp. A captured snapshot can be supplied during SPA
    // navigation, after the URL already points at the next Short.
    async function saveShortsTimestamp(snapshot = null) {
        const currentSnapshot = snapshot || captureShortsSnapshot();
        const videoId = currentSnapshot?.videoId;
        if (!videoId) {
            log('No video ID found for Shorts.');
            return;
        }

        // Playlist-aware pause/ignore logic for Shorts
        try {
            const urlParams = new URLSearchParams(window.location.search);
            const playlistId = urlParams.get('list');
            if (playlistId) {
                if (currentSettings?.pauseHistoryInPlaylists) {
                    log('Global pause enabled for playlist context (Shorts); skipping save.');
                    return;
                }
                try {
                    const playlistRecord = await ytStorage.getPlaylist(playlistId);
                    if (playlistRecord?.ignoreVideos) {
                        log('Per-playlist ignore enabled (Shorts); skipping save.', { playlistId });
                        return;
                    }
                } catch (e) {
                    // ignore read errors
                }
            }
        } catch (e) {
            // ignore URL parsing errors
        }

        const currentTime = currentSnapshot.time;
        const duration = currentSnapshot.duration;

        // Do not update record if timestamp is 0. Allow duration to be unavailable for Shorts.
        if (!currentTime || currentTime === 0) {
            log(`Invalid timestamp (${currentTime}) for Shorts ID ${videoId}, skipping update.`);
            return;
        }

        log(`Saving Shorts timestamp for video ID ${videoId} at time ${currentTime} (duration: ${duration}) from URL: ${window.location.href}`);

        let previous = null;
        try { previous = await ytStorage.getVideo(videoId); } catch (_) {}

        const record = {
            videoId,
            time: currentTime,
            duration,
            timestamp: Date.now(),
            title: currentSnapshot.title !== 'Unknown Title'
                ? currentSnapshot.title
                : (previous?.title || 'Unknown Title'),
            url: currentSnapshot.url,
            isShorts: true,
            channelName: currentSnapshot.channelName !== 'Unknown'
                ? currentSnapshot.channelName
                : (previous?.channelName || 'Unknown'),
            channelId: currentSnapshot.channelId !== 'Unknown'
                ? currentSnapshot.channelId
                : (previous?.channelId || 'Unknown')
        };

        try {
            // Compute delta against previous saved time to update stats
            const prevTime = previous && typeof previous.time === 'number' ? previous.time : 0;
            const delta = Math.max(0, Math.floor(record.time - prevTime));

            await ytStorage.setVideo(videoId, record);
            if (delta > 0 && typeof ytStorage.updateStats === 'function') {
                const prevRatio = (previous && previous.duration) ? (previous.time || 0) / previous.duration : 0;
                const newRatio = (record.duration ? record.time / record.duration : 0);
                const crossedCompleted = record.duration && prevRatio < 0.9 && newRatio >= 0.9;
                const isNewVideo = !previous || !previous.time;
                const metadata = {
                    isNewVideo: !!isNewVideo,
                    isShorts: true,
                    durationSeconds: isNewVideo && isFinite(record.duration) ? Math.floor(record.duration) : 0,
                    crossedCompleted: !!crossedCompleted
                };
                await ytStorage.updateStats(delta, record.timestamp, metadata);
            }
            // Broadcast update after successful save
            broadcastVideoUpdate(record);
            log(`Shorts timestamp successfully saved for video ID ${videoId}: ${currentTime}`);
        } catch (error) {
            log('Error saving Shorts timestamp:', error);
        }
    }

    // Broadcast update to popup
    function broadcastVideoUpdate(videoData) {
        chrome.runtime.sendMessage({
            type: 'videoUpdate',
            data: videoData
        });
    }

    // Apply the user's retention setting to local watch history.
    async function cleanupOldRecords() {
        try {
            if (currentSettings.autoCleanPeriod === 'forever') {
                log('Auto-clean disabled - keeping all records forever');
                return;
            }

            const cutoffTime = Date.now() - (currentSettings.autoCleanPeriod * 24 * 60 * 60 * 1000);
            const allVideos = await ytStorage.getAllVideos();

            for (const videoId in allVideos) {
                const record = allVideos[videoId];
                if (record.timestamp < cutoffTime) {
                    await ytStorage.removeVideo(videoId);
                    log(`Cleaned up old record for video ID: ${videoId}`);
                }
            }
        } catch (error) {
            log('Error during cleanup:', error);
        }
    }

    // Start periodic progress saves while playback is active.
    function startSaveInterval(saveFn = saveTimestamp) {
        if (saveIntervalId) {
            clearInterval(saveIntervalId);
        }
        saveFn();
        saveIntervalId = setInterval(saveFn, SAVE_INTERVAL);
    }

    // Coalesce rapid media events into one storage write.
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // Resolve when the media element fires an event, or fail fast if it stalls.
    function waitForEvent(target, event, timeout = 1000) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                target.removeEventListener(event, onEvent);
                reject(new Error(`Timeout waiting for ${event}`));
            }, timeout);

            function onEvent() {
                clearTimeout(timer);
                target.removeEventListener(event, onEvent);
                resolve();
            }

            target.addEventListener(event, onEvent, { once: true });
        });
    }

    // Set up video tracking
    function setupVideoTracking(video) {
        if (trackedVideos.has(video)) return;
        trackedVideos.add(video);

        let timestampLoaded = false;
        let lastSaveTime = 0;
        const MIN_SAVE_INTERVAL = 1000;

        // Once the user manually moves the playhead, stop auto-restoring the saved
        // position. Without this, seeking backward (e.g. to rewatch a video that was
        // saved near its end) gets yanked forward again, trapping the user in a loop.
        let userInteracted = false;
        let lastUserSeekIntentAt = 0;
        let lastProgrammaticSeekAt = 0;
        let pendingRestore = null;
        let restoreAwaitingMediaChange = false;
        let restoreAttemptInProgress = false;
        // The video ID this closure last set up restoration for; used to detect when a
        // reused <video> element switches to a different video (SPA navigation).
        let trackedClosureVideoId = getVideoId();
        if (pendingRestoreAfterMediaChange && pendingRestoreAfterMediaChange.videoId !== trackedClosureVideoId) {
            pendingRestoreAfterMediaChange = null;
        }
        if (pendingRestoreAfterMediaChange?.ownerVideo && !pendingRestoreAfterMediaChange.ownerVideo.isConnected) {
            pendingRestoreAfterMediaChange.ownerVideo = null;
            pendingRestoreAfterMediaChange.phase = 'awaiting-media';
        }
        const hasPendingMediaTransition = () => (
            pendingRestoreAfterMediaChange && pendingRestoreAfterMediaChange.videoId === getVideoId()
        );
        let restoringPendingMedia = false;
        let restoreAfterMediaLoadScheduled = false;
        const restoreAfterNextMediaMetadata = () => {
            if (!hasPendingMediaTransition() || restoreAfterMediaLoadScheduled) return;
            restoreAfterMediaLoadScheduled = true;
            traceRestore('restore-media-change-detected');
            const restoreAfterMetadata = () => {
                video.removeEventListener('loadedmetadata', restoreAfterMetadata);
                restoreAfterMediaLoadScheduled = false;
                if (!hasPendingMediaTransition()) return;
                const transition = pendingRestoreAfterMediaChange;
                if (transition.ownerVideo && transition.ownerVideo !== video) {
                    if (transition.ownerVideo.isConnected) return;
                    transition.ownerVideo = null;
                }
                if (!isPrimaryVideo(video)) return;
                const pendingTarget = transition.targetTime;
                if (Number.isFinite(video.duration) && video.duration < pendingTarget - 2) {
                    traceRestore('restore-media-still-short', {
                        duration: video.duration,
                        targetTime: pendingTarget
                    });
                    transition.ownerVideo = null;
                    transition.phase = 'awaiting-media';
                    return;
                }
                restoreAwaitingMediaChange = false;
                timestampLoaded = false;
                restoringPendingMedia = true;
                transition.ownerVideo = video;
                transition.phase = 'restoring';
                ensureVideoReady().catch(error => log('[RESTORE] Failed after media change:', error));
            };
            if (video.readyState >= 1) {
                restoreAfterMetadata();
            } else {
                video.addEventListener('loadedmetadata', restoreAfterMetadata);
            }
        };
        // All extension-initiated seeks go through this so we don't mistake our own
        // restore for a user seek in the 'seeking' handler below.
        const restoreVideoTime = (t, reason = 'restore') => {
            traceRestore('restore-seek-requested', {
                currentTime: video.currentTime || 0,
                targetTime: t,
                reason,
                ...getRestoreVideoTraceDetails(video)
            });
            pendingRestore = { targetTime: t, reason };
            pendingRestoreAfterMediaChange = {
                videoId: getVideoId(),
                targetTime: t,
                reason,
                ownerVideo: video,
                phase: 'seeking'
            };
            lastProgrammaticSeekAt = Date.now();
            video.currentTime = t;
        };

        traceRestore('tracker-attached', {
            currentTime: video.currentTime || 0,
            readyState: video.readyState || 0,
            ...getRestoreVideoTraceDetails(video)
        });
        if (isRestoreTraceActive()) {
            [
                'loadedmetadata', 'loadeddata', 'canplay', 'playing',
                'waiting', 'stalled', 'suspend', 'abort', 'emptied', 'error'
            ].forEach((event) => {
                addTrackedEventListener(video, event, () => traceRestore(`video-${event}`, {
                    currentTime: video.currentTime || 0,
                    duration: Number.isFinite(video.duration) ? video.duration : 0,
                    readyState: video.readyState || 0,
                    ...getRestoreVideoTraceDetails(video)
                }));
            });
        }

        const trackingStartedAt = Date.now();
        const guardedSaveTimestamp = async (candidateTime = null) => {
            // A seek into a short pre-roll can be clamped. Do not overwrite the
            // saved position or issue another seek until YouTube loads the next
            // media item and its metadata is available.
            if (pendingRestore || restoreAwaitingMediaChange || (hasPendingMediaTransition() && !restoringPendingMedia)) return;
            const videoId = getVideoId();
            const currentTime = typeof candidateTime === 'number' && candidateTime > 0 ? candidateTime : video.currentTime;
            if (!videoId || currentTime <= 0) return;
            if (window.location.pathname.startsWith('/shorts/') && trackedClosureVideoId && videoId !== trackedClosureVideoId) return;

            try {
                const record = await ytStorage.getVideo(videoId);
                const savedTime = record && typeof record.time === 'number' ? record.time : 0;
                if (savedTime >= 30 && currentTime < savedTime - 2 && Date.now() - trackingStartedAt < 20000) {
                    restoreVideoTime(savedTime, 'save-guard');
                    return;
                }
            } catch (error) {
                log('[RESTORE-GUARD] Failed to inspect saved timestamp before saving:', error);
            }

            await saveTimestamp(candidateTime);
        };

        const debouncedSave = debounce(async () => {
            const now = Date.now();
            if (now - lastSaveTime < MIN_SAVE_INTERVAL) return;
            lastSaveTime = now;
            await guardedSaveTimestamp();
        }, 500);

        const ensureVideoReady = async () => {
            if (timestampLoaded || userInteracted || pendingRestore || restoreAwaitingMediaChange || restoreAttemptInProgress || (hasPendingMediaTransition() && !restoringPendingMedia)) {
                traceRestore('restore-skipped', {
                    timestampLoaded,
                    userInteracted,
                    pendingRestore: !!pendingRestore,
                    restoreAwaitingMediaChange,
                    restoreAttemptInProgress,
                    pendingMediaTransition: !!hasPendingMediaTransition(),
                    restoringPendingMedia
                });
                return;
            }

            const videoId = getVideoId();
            if (!video || !videoId) {
                traceRestore('restore-skipped', { hasVideo: !!video, hasVideoId: !!videoId });
                return;
            }

            traceRestore('restore-attempt-started', {
                currentTime: video.currentTime || 0,
                readyState: video.readyState || 0
            });
            restoreAttemptInProgress = true;

            // Enhanced playlist context detection
            const isPlaylistContext = !!new URLSearchParams(window.location.search).get('list');
            const timeSinceNavigation = Date.now() - lastSpaNavigationTime;
            const isRecentNavigation = timeSinceNavigation < 3000; // 3 seconds

            if (isPlaylistContext && isRecentNavigation) {
                log(`[PLAYLIST] ensureVideoReady called in playlist context (${timeSinceNavigation}ms after navigation)`);
            }

            try {
                // Get saved record using existing storage wrapper
                // Retry logic: In Chrome, service worker might be sleeping, so retry a few times
                let record = null;
                let retries = 3;
                let retryDelay = 200;
                
                for (let attempt = 0; attempt < retries; attempt++) {
                    try {
                        record = await ytStorage.getVideo(videoId);
                        traceRestore('storage-read', {
                            attempt: attempt + 1,
                            found: !!record,
                            savedTime: record && typeof record.time === 'number' ? record.time : null
                        });
                        if (record && record.time && record.time > 0) {
                            break; // Success, exit retry loop
                        }
                    } catch (error) {
                        traceRestore('storage-read-error', {
                            attempt: attempt + 1,
                            message: error && error.message ? error.message : String(error)
                        });
                        log(`[ensureVideoReady] getVideo attempt ${attempt + 1} failed:`, error.message);
                    }
                    if (attempt < retries - 1) {
                        // A waking MV3 worker can return no record before its
                        // storage migration/read is ready, so retry empty reads
                        // as well as rejected reads.
                        await new Promise(resolve => setTimeout(resolve, retryDelay * Math.pow(2, attempt)));
                    }
                }
                
                if (!record || !record.time || record.time <= 0) {
                    traceRestore('restore-no-record');
                    log(`[ensureVideoReady] No valid record found for ${videoId} after ${retries} attempts`);
                    return;
                }

                const currentTime = video.currentTime || 0;
                const savedTime = record.time;

                // Enhanced debug logging using existing log function
                log(`[ensureVideoReady] videoId=${videoId} | current=${currentTime.toFixed(2)}s | saved=${savedTime.toFixed(2)}s`);

                // An ad can be longer than the saved timestamp and accept the seek,
                // which would falsely mark restoration complete before the real
                // video starts. Keep the restore pending until YouTube ends the ad.
                if (isYouTubeAdPlaying(video)) {
                    restoreAwaitingMediaChange = true;
                    restoringPendingMedia = false;
                    pendingRestoreAfterMediaChange = {
                        videoId,
                        targetTime: savedTime,
                        reason: 'youtube-ad-playing',
                        ownerVideo: video,
                        phase: 'awaiting-ad-end'
                    };
                    traceRestore('restore-waiting-for-ad-end', {
                        currentTime,
                        duration: Number.isFinite(video.duration) ? video.duration : 0,
                        targetTime: savedTime
                    });
                    return;
                }

                const tolerance = 2; // 2-second tolerance window

                // CASE 1: YouTube already restored correctly (within tolerance)
                if (Math.abs(currentTime - savedTime) <= tolerance) {
                    traceRestore('restore-already-at-saved-time', { currentTime, savedTime });
                    log(`YouTube already restored timestamp correctly (diff=${(currentTime - savedTime).toFixed(2)}s)`);
                    timestampLoaded = true;
                    restoringPendingMedia = false;
                    pendingRestoreAfterMediaChange = null;
                    return;
                }

                // CASE 2: YouTube did not restore or restored incorrectly
                // Wait until metadata is fully loaded to safely set currentTime
                if (video.readyState < 1) {
                    traceRestore('restore-waiting-for-metadata', { readyState: video.readyState || 0 });
                    await waitForEvent(video, "loadedmetadata", 1000);
                }

                // Pre-roll media has valid metadata but cannot contain the
                // saved position. Seeking it causes Firefox/YouTube to churn
                // through replacement video elements. Keep the restore pending
                // until a media item with a sufficient duration arrives.
                if (Number.isFinite(video.duration) && video.duration > 0 && video.duration < savedTime - 2) {
                    restoreAwaitingMediaChange = true;
                    pendingRestoreAfterMediaChange = {
                        videoId,
                        targetTime: savedTime,
                        reason: 'media-too-short',
                        ownerVideo: null,
                        phase: 'awaiting-media'
                    };
                    traceRestore('restore-media-too-short', {
                        duration: video.duration,
                        targetTime: savedTime
                    });
                    return;
                }

                // Firefox can accept currentTime at HAVE_METADATA while
                // YouTube is still attaching its MediaSource, then replace the
                // player with an empty element. Wait for canplay so the seek is
                // applied only after the selected media is actually usable.
                if (video.readyState < 3) {
                    traceRestore('restore-waiting-for-playable-media', {
                        readyState: video.readyState || 0,
                        duration: Number.isFinite(video.duration) ? video.duration : 0
                    });
                    await waitForEvent(video, 'canplay', 5000);
                }

                if (!isPrimaryVideo(video)) {
                    traceRestore('restore-player-changed-before-seek', {
                        ...getRestoreVideoTraceDetails(video)
                    });
                    return;
                }

                // A main video can reach canplay while YouTube is still
                // finishing an ad/pre-roll handoff. Seeking in that narrow
                // window makes Firefox discard the player. Only carried-over
                // restores need this stability window.
                if (restoringPendingMedia) {
                    const playableDuration = video.duration;
                    traceRestore('restore-waiting-for-media-settle', {
                        duration: Number.isFinite(playableDuration) ? playableDuration : 0,
                        waitMs: RESTORE_MEDIA_SETTLE_MS
                    });
                    await new Promise(resolve => setTimeout(resolve, RESTORE_MEDIA_SETTLE_MS));

                    const durationChanged = Number.isFinite(playableDuration) && (
                        !Number.isFinite(video.duration)
                        || video.duration <= 0
                        || Math.abs(video.duration - playableDuration) > 0.5
                    );
                    if (!isPrimaryVideo(video) || video.readyState < 3 || durationChanged) {
                        traceRestore('restore-media-changed-during-settle', {
                            duration: Number.isFinite(video.duration) ? video.duration : 0,
                            readyState: video.readyState || 0,
                            ...getRestoreVideoTraceDetails(video)
                        });
                        return;
                    }
                }

                // Double-check after the media becomes playable because
                // YouTube may have applied its own resume position meanwhile.
                const currentTimeAfterMetadata = video.currentTime || 0;

                // Right after SPA navigation YouTube often starts the new video from 0,
                // so a restore there is expected. Outside that window, a video that's
                // playing past the saved point is usually a quality/mode change rather
                // than a fresh load — restoring then would yank the user backward.
                const timeSinceSpaNavigation = Date.now() - lastSpaNavigationTime;
                const isRecentSpaNavigation = timeSinceSpaNavigation < 2000; // 2 seconds

                if (Math.abs(currentTimeAfterMetadata - savedTime) > tolerance) {
                    if (isRecentSpaNavigation) {
                        log(`Recent SPA navigation (${timeSinceSpaNavigation}ms ago), restoring → ${savedTime.toFixed(2)}s (current=${currentTimeAfterMetadata.toFixed(2)}s)`);
                        restoreVideoTime(savedTime, 'initial-restore');
                    } else if (!video.paused && currentTimeAfterMetadata > savedTime) {
                        log('Video playing and ahead of saved time, likely mode change - skipping restore');
                    } else {
                        log(`Restoring → ${savedTime.toFixed(2)}s (current=${currentTimeAfterMetadata.toFixed(2)}s)`);
                        restoreVideoTime(savedTime);
                    }
                } else {
                    log(`Already near target position (diff=${(currentTimeAfterMetadata - savedTime).toFixed(2)}s), skipping restore`);
                }

                // A requested seek is only a restore after `seeked` confirms
                // the media accepted the target. A short pre-roll can clamp it.
                if (!pendingRestore) timestampLoaded = true;

                if (!video.paused) {
                    startSaveInterval(guardedSaveTimestamp);
                }
            } catch (err) {
                traceRestore('restore-attempt-error', {
                    message: err && err.message ? err.message : String(err)
                });
                log(`[ensureVideoReady] Error:`, err);
                // Don't set timestampLoaded = true on error, so we can retry
            } finally {
                restoreAttemptInProgress = false;
            }
        };

        const resumePendingRestoreAfterAd = () => {
            const transition = pendingRestoreAfterMediaChange;
            if (
                !restoreAwaitingMediaChange
                || !hasPendingMediaTransition()
                || transition?.reason !== 'youtube-ad-playing'
                || isYouTubeAdPlaying(video)
                || restoreAttemptInProgress
            ) {
                return false;
            }

            restoreAwaitingMediaChange = false;
            restoringPendingMedia = true;
            transition.ownerVideo = video;
            transition.phase = 'restoring';
            traceRestore('restore-ad-ended', {
                currentTime: video.currentTime || 0,
                targetTime: transition.targetTime
            });
            ensureVideoReady().catch(error => log('[RESTORE] Failed after ad ended:', error));
            return true;
        };

        const player = video.closest?.('#movie_player');
        if (player) {
            const adStateObserver = new MutationObserver(resumePendingRestoreAfterAd);
            adStateObserver.observe(player, { attributes: true, attributeFilter: ['class'] });
            addTrackedObserver(video, adStateObserver);
        }

        // Initial attempt
        ensureVideoReady().catch(error => {
            log(`[setupVideoTracking] ensureVideoReady failed:`, error);
        });
        // A replacement video can be inserted after its loadstart already
        // fired. In that case, wait directly for its metadata rather than
        // requiring another loadstart event that may never arrive.
        if (hasPendingMediaTransition()) {
            restoreAfterNextMediaMetadata();
        }
        
        // Fallback: If video starts playing from 0:00 but we have a saved time, restore it
        // This handles cases where getVideo() failed initially but the video started playing
        const fallbackRestore = async () => {
            // Wait a bit for video to start playing
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // YouTube may apply its own partial resume before extension storage
            // is ready. Restore whenever that position is still behind ours.
            if (!timestampLoaded && !userInteracted && !pendingRestore && !restoreAwaitingMediaChange && !restoreAttemptInProgress && (!hasPendingMediaTransition() || restoringPendingMedia) && video.readyState >= 3) {
                try {
                    const videoId = getVideoId();
                    if (!videoId) return;

                    const record = await ytStorage.getVideo(videoId);

                    if (record && record.time && record.time > 30 && video.currentTime < record.time - 2) {
                        // Only restore if saved time is significant (>30s)
                        log(`[fallbackRestore] Restoring from ${video.currentTime.toFixed(1)}s to ${record.time.toFixed(1)}s`);
                        restoreVideoTime(record.time, 'fallback-restore');
                    }
                } catch (error) {
                    log(`[fallbackRestore] Failed:`, error);
                }
            }
        };
        
        // Start fallback restore check
        fallbackRestore().catch(error => {
            log(`[setupVideoTracking] fallbackRestore failed:`, error);
        });

        // Retry after a readiness timeout without racing the initial attempt.
        addTrackedEventListener(video, 'canplay', () => {
            if (resumePendingRestoreAfterAd()) return;
            if (!timestampLoaded && !userInteracted && !pendingRestore && !restoreAwaitingMediaChange && !restoreAttemptInProgress && (!hasPendingMediaTransition() || restoringPendingMedia)) {
                ensureVideoReady().catch(error => log('[RESTORE] Failed on canplay retry:', error));
            }
        });

        addTrackedEventListener(video, 'play', async () => {
            startSaveInterval(guardedSaveTimestamp);

            // Playlist autoplay can bypass normal URL/timestamp restoration, so
            // give the player a moment to settle before restoring saved progress.
            const isPlaylistContext = !!new URLSearchParams(window.location.search).get('list');
            const timeSinceNavigation = Date.now() - lastSpaNavigationTime;
            const videoId = getVideoId();
            let record = null;

            if (videoId) {
                try {
                    record = await ytStorage.getVideo(videoId);
                } catch (error) {
                    log('[play] Failed to read record for autoplay detection:', error);
                }
            }

            const hasSignificantHistory = !!(record && typeof record.time === 'number' && record.time > 30);

            if (isPlaylistContext && timeSinceNavigation < 5000 && hasSignificantHistory) {
                log(`[PLAYLIST] Detected potential autoplay in playlist context (${timeSinceNavigation}ms after navigation) with saved time ${record.time.toFixed(1)}s`);

                setTimeout(async () => {
                    if (!timestampLoaded && video.currentTime < 10) {
                        log('[PLAYLIST] Autoplay detected, attempting delayed timing restoration via ensureVideoReady');
                        await ensureVideoReady();
                    }
                }, 1500);
            }

            // Fallback restoration check: only when we have significant saved time,
            // and only if the user hasn't manually moved the playhead. Otherwise a
            // user who seeks back to the start gets yanked to the saved position.
            if (hasSignificantHistory && !timestampLoaded && !userInteracted && !pendingRestore && !restoreAwaitingMediaChange && (!hasPendingMediaTransition() || restoringPendingMedia)) {
                const savedTime = record.time;
                const currentTime = video.currentTime;

                if (currentTime < 5) {
                    log(`[FALLBACK] Video playing from ${currentTime.toFixed(1)}s but saved time is ${savedTime.toFixed(1)}s, considering restoration`);
                    setTimeout(() => {
                        if (!timestampLoaded && !userInteracted && !pendingRestore && !restoreAwaitingMediaChange && (!hasPendingMediaTransition() || restoringPendingMedia) && video.currentTime < 5) {
                            restoreVideoTime(savedTime);
                            log(`[FALLBACK] Requested restore to ${savedTime.toFixed(1)}s`);
                        }
                    }, 500);
                }
            }
        });
        addTrackedEventListener(video, 'pause', () => {
            captureShortsSnapshot(video, trackedClosureVideoId);
            if (saveIntervalId) {
                clearInterval(saveIntervalId);
                saveIntervalId = null;
            }
            debouncedSave();
        });
        addTrackedEventListener(video, 'timeupdate', () => {
            captureShortsSnapshot(video, trackedClosureVideoId);
            const currentTime = Math.floor(video.currentTime);
            const interval = window.location.pathname.startsWith('/shorts/') ? 5 : 15;
            if (currentTime > 0 && currentTime % interval === 0) debouncedSave();
        });
        addTrackedEventListener(video, 'pointerdown', () => {
            lastUserSeekIntentAt = Date.now();
        });
        addTrackedEventListener(video, 'keydown', () => {
            lastUserSeekIntentAt = Date.now();
        });
        addTrackedEventListener(video, 'seeking', () => {
            // YouTube emits seeking events while selecting its initial position
            // and while resetting media after navigation. Only a seek preceded
            // by user input may opt out of restoring extension history.
            const hasRecentUserSeekIntent = Date.now() - lastUserSeekIntentAt < 1000;
            if (hasRecentUserSeekIntent && Date.now() - lastProgrammaticSeekAt > 800) {
                userInteracted = true;
                pendingRestoreAfterMediaChange = null;
            }
            traceRestore('video-seeking', {
                currentTime: video.currentTime || 0,
                hasRecentUserSeekIntent,
                userInteracted,
                millisecondsSinceProgrammaticSeek: Date.now() - lastProgrammaticSeekAt,
                ...getRestoreVideoTraceDetails(video)
            });
            if (saveIntervalId) {
                clearInterval(saveIntervalId);
                saveIntervalId = null;
            }
        });
        addTrackedEventListener(video, 'seeked', () => {
            captureShortsSnapshot(video, trackedClosureVideoId);
            traceRestore('video-seeked', {
                currentTime: video.currentTime || 0,
                ...getRestoreVideoTraceDetails(video)
            });
            if (pendingRestore) {
                const { targetTime, reason } = pendingRestore;
                pendingRestore = null;
                if (video.currentTime >= targetTime - 2 && isPrimaryVideo(video)) {
                    timestampLoaded = true;
                    restoringPendingMedia = false;
                    pendingRestoreAfterMediaChange = null;
                    traceRestore('restore-seek-confirmed', { currentTime: video.currentTime, targetTime, reason });
                } else {
                    restoringPendingMedia = false;
                    restoreAwaitingMediaChange = true;
                    pendingRestoreAfterMediaChange = {
                        videoId: getVideoId(),
                        targetTime,
                        reason,
                        ownerVideo: null,
                        phase: 'awaiting-media'
                    };
                    traceRestore('restore-seek-clamped', { currentTime: video.currentTime || 0, targetTime, reason });
                    log(`[RESTORE] Seek to ${targetTime.toFixed(2)}s was clamped at ${video.currentTime.toFixed(2)}s; waiting for the next media load.`);
                }
            }
            debouncedSave();
            if (!video.paused) startSaveInterval(guardedSaveTimestamp);
        });

        // Detect video content changes (especially for playlist navigation)
        addTrackedEventListener(video, 'loadstart', () => {
            traceRestore('video-loadstart', {
                currentTime: video.currentTime || 0,
                readyState: video.readyState || 0,
                ...getRestoreVideoTraceDetails(video)
            });
            // Check if this is a playlist video change
            const urlParams = new URLSearchParams(window.location.search);
            const playlistId = urlParams.get('list');
            const currentVideoId = getVideoId();

            // New video loaded into a reused <video> element: clear the manual-seek
            // guard so the next video can restore its own saved position.
            if (currentVideoId && currentVideoId !== trackedClosureVideoId) {
                trackedClosureVideoId = currentVideoId;
                userInteracted = false;
                timestampLoaded = false;
            }

            restoreAfterNextMediaMetadata();


            if (playlistId && currentVideoId && currentVideoId !== lastProcessedVideoId) {
                log(`[VIDEO] Playlist video change detected: ${lastProcessedVideoId} → ${currentVideoId} in playlist ${playlistId}`);
                handlePlaylistNavigation(currentVideoId);
            }
        });

        // SPA navigation can attach listeners after autoplay already started.
        if (!video.paused && !saveIntervalId) {
            log('[SPA] Video already playing during setup, starting save interval immediately');
            startSaveInterval(guardedSaveTimestamp);
        }
    }

    // Check for URL changes (fallback for navigation that doesn't trigger yt-navigate-finish)
    function checkUrlChange() {
        const currentUrl = window.location.href;
        if (currentUrl !== lastUrl) {
            log(`[URL-CHANGE] URL changed from ${lastUrl} to ${currentUrl}`);
            lastUrl = currentUrl;

            // Check if this is a video page navigation
            const videoId = getVideoId();
            if (videoId && videoId !== lastProcessedVideoId) {
                // Check if this is playlist navigation or regular SPA navigation
                const urlParams = new URLSearchParams(window.location.search);
                const playlistId = urlParams.get('list');

                if (playlistId) {
                    log(`[URL-CHANGE] Triggering playlist navigation for video: ${videoId} in playlist: ${playlistId}`);
                    handlePlaylistNavigation(videoId);
                } else {
                    log(`[URL-CHANGE] Triggering SPA navigation for video: ${videoId}`);
                    handleSpaNavigation();
                }
            }
        }
    }

    // This function is called when playlist navigation is detected (video changes within playlist)
    function handlePlaylistNavigation(newVideoId) {
        log(`[PLAYLIST] Handling playlist navigation to video: ${newVideoId}`);

        lastProcessedVideoId = newVideoId;
        lastSpaNavigationTime = Date.now();

        // Playlist autoplay may reuse the previous video's playback position.
        const existingVideo = getPrimaryVideo();
        if (existingVideo) {
            const currentTime = existingVideo.currentTime || 0;
            if (currentTime > 5) {
                log(`[PLAYLIST] Clearing inherited timing from previous playlist video (${currentTime}s)`);
                existingVideo.currentTime = 0;
            } else {
                log('[PLAYLIST] Skipping timing reset; currentTime already near 0s');
            }
            // Force reload of video data by clearing cached state
            existingVideo.dataset.lastVideoId = '';
        }

        // Reset initialization state to allow re-initialization for the new video.
        // The per-video restore flag (timestampLoaded) is reset inside the tracker's
        // own 'loadstart' handler when the video id changes, so nothing to do here.
        isInitialized = false;

        // Stop any existing initialization interval
        if (initChecker) {
            clearInterval(initChecker);
            initChecker = null;
        }

        // Try to find and initialize the video element immediately
        const video = getPrimaryVideo();
        if (video && !trackedVideos.has(video)) {
            log('[PLAYLIST] Video element found immediately, initializing...');
            initializeWithVideo(video);
        } else {
            // Set up observer for video element detection
            let playlistVideoObserver = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            const videos = [
                                ...(node.tagName === 'VIDEO' ? [node] : []),
                                ...node.querySelectorAll('video')
                            ];

                            videos.forEach(video => {
                                if (video === getPrimaryVideo() && !trackedVideos.has(video) && video.offsetWidth > 0 && video.offsetHeight > 0) {
                                    log('[PLAYLIST] Video element detected by observer, initializing...');

                                    // Disconnect the observer
                                    playlistVideoObserver.disconnect();
                                    playlistVideoObserver = null;

                                    // Stop any existing timeout checker
                                    if (initChecker) {
                                        clearInterval(initChecker);
                                        initChecker = null;
                                    }

                                    // Initialize immediately
                                    initializeWithVideo(video);
                                }
                            });
                        }
                    });
                });
            });

            // Start observing
            playlistVideoObserver.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: false
            });

            // Fallback timeout
            setTimeout(() => {
                if (playlistVideoObserver) {
                    playlistVideoObserver.disconnect();
                    log('[PLAYLIST] Video detection timeout, falling back to standard initialization');
                    initializeIfNeeded();
                }
            }, 3000);
        }
    }

    // Shared helper to initialize after navigation when a video element is present
    function initializeWithVideo(video) {
        // Ensure video is actually visible and loaded
        if (video && (video.readyState >= 1 || video.offsetWidth > 0)) {
            // Re-run the initialization logic with the found video
            initializeIfNeeded();
        } else if (video) {
            // Video exists but not ready, wait a bit then initialize
            setTimeout(() => initializeIfNeeded(), 200);
        }
    }

    // This function is called when YouTube's SPA navigation is complete.
    function handleSpaNavigation() {
        const videoId = getVideoId();
        const previousVideoId = lastProcessedVideoId;

        // If we're not on a video page, or it's the same video, do nothing.
        if (!videoId || videoId === previousVideoId) {
            return;
        }

        const outgoingShortsSnapshot = previousVideoId
            && latestShortsSnapshot?.videoId === previousVideoId
            ? { ...latestShortsSnapshot }
            : null;
        if (outgoingShortsSnapshot) {
            saveShortsTimestamp(outgoingShortsSnapshot)
                .catch(error => log('[SPA] Failed to save outgoing Shorts timestamp:', error));
        }

        log(`[SPA] Navigation to new video detected: ${videoId}`);
        lastProcessedVideoId = videoId;
        lastSpaNavigationTime = Date.now();

        // Only a real SPA video-to-video transition can inherit a previous
        // video's time. On the first document video, yt-navigate-finish may
        // arrive after the extension restored progress; resetting then erases
        // the valid restore.
        const existingVideo = getPrimaryVideo();
        const isShortsToShortsNavigation = !!outgoingShortsSnapshot
            && window.location.pathname.startsWith('/shorts/');
        if (previousVideoId && existingVideo && !isShortsToShortsNavigation) {
            const currentTime = existingVideo.currentTime || 0;
            if (currentTime > 5) {
                log(`[SPA] Clearing inherited timing from previous video (${currentTime}s)`);
                existingVideo.currentTime = 0;
            } else {
                log('[SPA] Skipping timing reset; currentTime already near 0s');
            }
            existingVideo.dataset.lastVideoId = '';
        }

        if (window.location.pathname.startsWith('/shorts/') && existingVideo && !trackedVideos.has(existingVideo)) {
            log('[SPA] Attaching Shorts tracking immediately to the active video.');
            setupVideoTracking(existingVideo);
        }

        // Playlist navigation uses delayed restore because autoplay races setup.
        const isPlaylistNavigation = !!new URLSearchParams(window.location.search).get('list');
        if (isPlaylistNavigation) {
            log(`[SPA] Playlist navigation detected - will use enhanced autoplay timing restoration`);
        }

        // Reset the main initialization flag to allow re-initialization for the new page.
        // The per-video restore flag (timestampLoaded) is reset inside the tracker's own
        // 'loadstart' handler when the video id changes.
        isInitialized = false;

        // Stop any existing initialization interval
        if (initChecker) {
            clearInterval(initChecker);
            initChecker = null;
        }

        // Create dedicated SPA video observer for immediate detection
        let spaVideoObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        const videos = [
                            ...(node.tagName === 'VIDEO' ? [node] : []),
                            ...node.querySelectorAll('video')
                        ];

                        videos.forEach(video => {
                            if (video === getPrimaryVideo() && !trackedVideos.has(video) && video.offsetWidth > 0 && video.offsetHeight > 0) {
                                log('[SPA] Video element detected immediately by observer, initializing...');

                                // Enhanced playlist handling: Ensure timing is cleared for new videos
                                if (isPlaylistNavigation) {
                                    log('[SPA] Playlist context: Forcing timing reset for new video element');
                                    video.currentTime = 0;
                                    video.dataset.lastVideoId = '';
                                }

                                // Disconnect the SPA observer since we found the video
                                spaVideoObserver.disconnect();
                                spaVideoObserver = null;

                                // Stop any existing timeout checker
                                if (initChecker) {
                                    clearInterval(initChecker);
                                    initChecker = null;
                                }

                                // Initialize immediately
                                if (window.location.pathname.startsWith('/shorts/')) {
                                    setupVideoTracking(video);
                                }
                                initializeWithVideo(video);
                            }
                        });
                    }
                });
            });
        });

        // Start observing immediately for the new video
        spaVideoObserver.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: false // We only care about new elements, not attribute changes
        });

        const currentSpaVideo = getPrimaryVideo();
        if (window.location.pathname.startsWith('/shorts/') && currentSpaVideo && !trackedVideos.has(currentSpaVideo)) {
            log('[SPA] Active Shorts video was already present; attaching tracking immediately.');
            setupVideoTracking(currentSpaVideo);
        }

        // Fallback timeout-based checking (reduced frequency since observer is primary)
        let spaCheckCount = 0;
        const maxSpaChecks = 3; // Reduced from 5 since observer is primary

        initChecker = setInterval(async () => {
            spaCheckCount++;
            log(`[SPA] Fallback check for video element (${spaCheckCount}/${maxSpaChecks})...`);

            if (await initializeIfNeeded()) {
                log('Fallback initialization successful after SPA navigation.');
                cleanupSpaObserver();
            } else if (spaCheckCount >= maxSpaChecks) {
                log('SPA video detection timeout reached.');
                cleanupSpaObserver();
            }
        }, 1500); // Less frequent since observer is primary

        function cleanupSpaObserver() {
            if (spaVideoObserver) {
                spaVideoObserver.disconnect();
                spaVideoObserver = null;
            }
            if (initChecker) {
                clearInterval(initChecker);
                initChecker = null;
            }
        }
    }

    // Initialize and set up event listeners
    async function initializeIfNeeded() {
        if (isInitialized) {
            return true;
        }

        const video = getPrimaryVideo();
        if (video) {
            log('Found video element, initializing...');
            try {
                // Ensure storage is ready
                await ytStorage.ensureMigrated();
                log('Storage initialized successfully');

                // Inject CSS to avoid CSP issues
                injectCSS();

                if (!trackedVideos.has(video)) {
                    setupVideoTracking(video);
                } else {
                    log('[SPA] Reused video element is already tracked; preserving its listeners and restore state.');
                }
                tryToSavePlaylist();
                showExtensionInfo();

                // Start observing for video changes
                videoObserver.observe(document.body, {
                    childList: true,
                    subtree: true
                });

                startNativeThumbnailOverlays();

                isInitialized = true;
            } catch (error) {
                log('Error initializing storage during video setup:', error);
            }
            return true;
        }

        // --- Shorts fix: observe for video elements dynamically ---
        if (window.location.pathname.startsWith('/shorts/')) {
            // Shorts pages may load video after script runs, so observe for it
            shortsVideoObserver = new MutationObserver(() => {
                const shortsVideo = getPrimaryVideo();
                if (shortsVideo && !trackedVideos.has(shortsVideo)) {
                    log('Shorts video element detected by observer, initializing tracking...');
                    setupVideoTracking(shortsVideo);
                }
            });
            shortsVideoObserver.observe(document.body, { childList: true, subtree: true });
        }
        // ---------------------------------------------------------

        return false;
    }

    // Start observing for video element and playlist changes
    initChecker = setInterval(async () => {
        log('Checking for video element...');
        if (await initializeIfNeeded()) {
            log('Initialization successful. Stopping checker.');
            clearInterval(initChecker);
            initChecker = null;
        }
    }, 1000);

    // Initialize immediately and also retry if needed
    initializeIfNeeded();

    const thumbnailHelpers = window.YTVHTContentThumbnails.create({
        log,
        getStorage: () => ytStorage,
        getCurrentSettings: () => currentSettings,
        updateOverlayCSS,
        overlayColors: OVERLAY_COLORS,
        overlayLabelSizeMap: OVERLAY_LABEL_SIZE_MAP,
        getAccentOverlayColor,
        pendingOperations
    });
    thumbnailObserver = thumbnailHelpers.thumbnailObserver;
    processExistingThumbnails = thumbnailHelpers.processExistingThumbnails;
    thumbnailHelpers.startRemovedElementCleanupObserver();
    startNativeThumbnailOverlays();

    messageListener = window.YTVHTContentMessages.create({
        log,
        getStorage: () => ytStorage,
        isInitialized: () => isInitialized,
        initializeIfNeeded,
        injectCSS,
        updateOverlayCSS,
        overlayColors: OVERLAY_COLORS,
        overlayLabelSizeMap: OVERLAY_LABEL_SIZE_MAP,
        getAccentOverlayColor,
        setCurrentSettings: (settings) => {
            currentSettings = settings;
        },
        processExistingThumbnails: () => {
            if (ENABLE_NATIVE_THUMBNAIL_OVERLAYS) processExistingThumbnails();
        }
    });

    chrome.runtime.onMessage.addListener(messageListener);

    const { showExtensionInfo } = window.YTVHTContentInfo.create({
        log,
        storage
    });

    const {
        maybeShowImportOverlayFromHash
    } = window.YTVHTContentImport.create({
        log,
        getStorage: () => ytStorage
    });

    // Initialize the content script once per YouTube document lifecycle.
    async function initialize() {
        if (isInitialized) {
            return true;
        }

        try {
            injectCSS();
            const settings = await loadSettings() || DEFAULT_SETTINGS;

            if (settings.version !== EXTENSION_VERSION) {
                log('Version updated:', { old: settings.version, new: EXTENSION_VERSION });
                settings.version = EXTENSION_VERSION;
                await ytStorage.setSettings(settings);
            }

            currentSettings = settings;
            updateOverlayCSS(
                OVERLAY_LABEL_SIZE_MAP[currentSettings.overlayLabelSize] || OVERLAY_LABEL_SIZE_MAP.medium,
                getAccentOverlayColor(currentSettings)
            );

            startNativeThumbnailOverlays();

            // Intercept video link clicks to add timestamps
            interceptVideoLinkClicks();

            const primaryVideo = getPrimaryVideo();
            if (primaryVideo && !trackedVideos.has(primaryVideo)) {
                setupVideoTracking(primaryVideo);
            }

            isInitialized = true;
            
            // Check for import hash on initialization
            maybeShowImportOverlayFromHash();
            
            return true;
        } catch (error) {
            log('Error during initialization:', error);
            currentSettings = DEFAULT_SETTINGS;
            return false;
        }
    }

    // Initialize on startup
    initialize();
    
    // Listen for hash changes to show import overlay
    window.addEventListener('hashchange', maybeShowImportOverlayFromHash);

    // Listen for YouTube's own navigation events to handle SPA changes.
    window.addEventListener('yt-navigate-finish', handleSpaNavigation);

    // Additional navigation detection for channel page clicks and other navigation methods
    window.addEventListener('popstate', () => {
        log('[NAVIGATION] popstate event detected');
        checkUrlChange();
    });

    // Poll playlist videos because some autoplay hops skip YouTube navigation events.
    let lastPlaylistVideoId = null;
    playlistNavigationCheckInterval = setInterval(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const playlistId = urlParams.get('list');
        const currentVideoId = getVideoId();

        if (playlistId && currentVideoId) {
            if (currentVideoId !== lastPlaylistVideoId) {
                if (lastPlaylistVideoId) {
                    // Video ID changed within the same playlist
                    log(`[PLAYLIST] Detected playlist navigation: ${lastPlaylistVideoId} → ${currentVideoId} (playlist: ${playlistId})`);
                    handlePlaylistNavigation(currentVideoId);
                }
                lastPlaylistVideoId = currentVideoId;
            }
        } else {
            lastPlaylistVideoId = null;
        }
    }, 500);

    // Periodic URL checking catches route changes missed by YouTube events.
    urlCheckIntervalId = setInterval(checkUrlChange, 500);

    // YouTube emits this on some route updates but not consistently.
    window.addEventListener('yt-page-data-updated', () => {
        log('[NAVIGATION] yt-page-data-updated event detected');
        checkUrlChange();
    });

    // Coalesce pushState/replaceState bursts into one route check.
    function debouncedUrlCheck() {
        if (historyApiTimeout) clearTimeout(historyApiTimeout);
        historyApiTimeout = setTimeout(() => {
            checkUrlChange();
            historyApiTimeout = null;
        }, 10);
    }

    // YouTube routing often goes through History API calls.
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function(...args) {
        originalPushState.apply(this, args);
        log('[NAVIGATION] pushState detected');
        debouncedUrlCheck();
    };

    history.replaceState = function(...args) {
        originalReplaceState.apply(this, args);
        log('[NAVIGATION] replaceState detected');
        debouncedUrlCheck();
    };

    // Direct playlist URLs may not trigger the normal page-data event.
    ensurePlaylistIgnoreToggles();

    // Refresh extension-feed overlays when local history/playlists change.
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local') {
                const hasVideoChanges = Object.keys(changes).some(key =>
                    key.startsWith('video_') || key.startsWith('playlist_')
                );
                if (ENABLE_NATIVE_THUMBNAIL_OVERLAYS && hasVideoChanges) {
                    processExistingThumbnails();
                }
            }
        });
    } else if (typeof browser !== 'undefined' && browser.storage && browser.storage.onChanged) {
        browser.storage.onChanged.addListener((changes, area) => {
            if (area === 'local') {
                const hasVideoChanges = Object.keys(changes).some(key =>
                    key.startsWith('video_') || key.startsWith('playlist_')
                );
                if (ENABLE_NATIVE_THUMBNAIL_OVERLAYS && hasVideoChanges) {
                    // Use the improved processing function
                    processExistingThumbnails();
                }
            }
        });
    }

    // Expose internal navigation helpers for tests only.
    // This is a no-op in production because __YTVHT_TEST__ is not defined.
    if (typeof window !== 'undefined' && window.__YTVHT_TEST__) {
        const resetVideoTrackingForTests = () => {
            [...trackedVideos].forEach(video => cleanupVideoListeners(video));
            pendingRestoreAfterMediaChange = null;
            latestShortsSnapshot = null;
        };
        window.__YTVHT_TEST__.navigation = {
            handleSpaNavigation,
            handlePlaylistNavigation,
            checkUrlChange,
            getLastProcessedVideoId: () => lastProcessedVideoId
        };
        window.__YTVHT_TEST__.core = {
            loadSettings,
            saveTimestamp,
            saveShortsTimestamp,
            savePlaylistInfo,
            ensurePlaylistIgnoreToggles,
            setupVideoTracking,
            getPrimaryVideo,
            getShortsMetadata,
            captureShortsSnapshot,
            handleVideoMutations,
            getPendingRestoreForTests: () => pendingRestoreAfterMediaChange,
            resetVideoTrackingForTests
        };
    }
})();
