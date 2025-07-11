(function() {
    'use strict';

    // Browser detection and cross-browser storage wrapper - safer approach
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
            if (isFirefox) {
                return await browser.storage.local.get(keys);
            } else {
                return new Promise((resolve) => {
                    chrome.storage.local.get(keys, resolve);
                });
            }
        },

        async set(data) {
            if (isFirefox) {
                return await browser.storage.local.set(data);
            } else {
                return new Promise((resolve) => {
                    chrome.storage.local.set(data, resolve);
                });
            }
        }
    };

    const DB_NAME = 'YouTubeHistoryDB';
    const DB_VERSION = 3;
    const STORE_NAME = 'videoHistory';
    const EXTENSION_VERSION = chrome.runtime.getManifest().version; // Get version from manifest
    const SAVE_INTERVAL = 5000; // Save every 5 seconds

    const DEFAULT_SETTINGS = {
        autoCleanPeriod: 90, // days
        paginationCount: 10,
        overlayTitle: 'viewed',
        overlayColor: 'blue',
        overlayLabelSize: 'medium',
        debug: false, // Add debug setting
        version: EXTENSION_VERSION // Add version to settings
    };
    const OVERLAY_COLORS = {
        blue: '#4285f4',
        red: '#ea4335',
        green: '#34a853',
        purple: '#9c27b0',
        orange: '#ff9800'
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
    const trackedVideos = new WeakSet();

    // Track event listeners for cleanup
    const videoEventListeners = new WeakMap();

    // Cleanup tracking
    let thumbnailObserver = null;
    let shortsVideoObserver = null;
    let initChecker = null;
    let playlistRetryTimeout = null;
    let messageListener = null;

    // Track thumbnail processing state
    let isProcessingThumbnails = false;
    let thumbnailProcessingQueue = new Set();
    let processingTimeout = null;

    // Track YouTube's content loading state
    let contentLoadingBatch = new Set();
    let batchProcessingTimeout = null;

    // Track pending operations
    const pendingOperations = new Map(); // Map<Element, {timeout: number, rafId: number}>

    // Track the last processed video ID to handle SPA navigation
    let lastProcessedVideoId = null;

    // Track video changes in YouTube's SPA
    let videoObserver = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    // Check if this node is a video or contains a video
                    const videos = [
                        ...(node.tagName === 'VIDEO' ? [node] : []),
                        ...node.querySelectorAll('video')
                    ];

                    videos.forEach(video => {
                        if (!trackedVideos.has(video)) {
                            log('[Debug] Found new video element to track');
                            setupVideoTracking(video);
                        }
                    });
                }
            });

            // Handle removed videos
            mutation.removedNodes.forEach((node) => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    const videos = [
                        ...(node.tagName === 'VIDEO' ? [node] : []),
                        ...node.querySelectorAll('video')
                    ];

                    videos.forEach(video => {
                        if (trackedVideos.has(video)) {
                            cleanupVideoListeners(video);
                        }
                    });
                }
            });
        });
    });

    function log(message, data) {
        if (currentSettings.debug) {
            console.log('[ythdb]', message, data || '');
        }
    }

    log('YouTube Video History Tracker script is running.');

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
        if (messageListener) {
            chrome.runtime.onMessage.removeListener(messageListener);
            messageListener = null;
        }

        // Clean up all pending operations
        for (const [element, ops] of pendingOperations.entries()) {
            if (ops.timeout) clearTimeout(ops.timeout);
            if (ops.rafId) cancelAnimationFrame(ops.rafId);
        }
        pendingOperations.clear();

        // The WeakSet and WeakMap used for trackedVideos and videoEventListeners
        // do not need to be (and cannot be) cleared manually. They will be
        // garbage-collected automatically when the page unloads.

        // Reset state variables
        isInitialized = false;
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
            trackedVideos.delete(video);
            log('Cleaned up event listeners for video:', video);
        }
    }

    // Helper function to add tracked event listeners
    function addTrackedEventListener(video, event, handler) {
        if (!videoEventListeners.has(video)) {
            videoEventListeners.set(video, []);
        }
        videoEventListeners.get(video).push({ event, handler });
        video.addEventListener(event, handler);
    }

    // Use 'pagehide' for reliable cleanup on page unload
    window.addEventListener('pagehide', cleanup);

    // Inject CSS to avoid CSP issues with inline styles
    function injectCSS() {
        if (document.getElementById('ytvht-styles')) return; // Already injected

        const style = document.createElement('style');
        style.id = 'ytvht-styles';
        style.textContent = `
            .ytvht-viewed-label {
                position: absolute !important;
                top: 0 !important;
                left: 0 !important;
                padding: 8px 4px !important;
                background-color: #4285f4 !important;
                color: #fff !important;
                font-size: 16px !important;
                font-weight: bold !important;
                z-index: 2 !important;
                border-radius: 0 0 4px 0 !important;
                pointer-events: none !important;
            }
            .ytvht-progress-bar {
                position: absolute !important;
                bottom: 0 !important;
                left: 0 !important;
                height: 3px !important;
                background-color: #4285f4 !important;
                z-index: 2 !important;
                pointer-events: none !important;
            }
            .ytvht-info {
                position: absolute !important;
                top: -120px !important;
                right: 0 !important;
                background: var(--yt-spec-brand-background-primary, #0f0f0f) !important;
                border: 1px solid var(--yt-spec-text-secondary, #aaa) !important;
                border-radius: 8px !important;
                padding: 12px !important;
                width: 300px !important;
                z-index: 9999 !important;
                color: var(--yt-spec-text-primary, #fff) !important;
                font-size: 14px !important;
                box-shadow: 0 4px 8px rgba(0,0,0,0.1) !important;
            }
            .ytvht-info-content {
                display: flex !important;
                align-items: start !important;
                gap: 12px !important;
            }
            .ytvht-info-text {
                flex-grow: 1 !important;
            }
            .ytvht-info-title {
                font-weight: 500 !important;
                margin-bottom: 8px !important;
                color: #fff !important;
            }
            .ytvht-info-description {
                color: #aaa !important;
                line-height: 1.4 !important;
            }
            .ytvht-info-highlight {
                color: #fff !important;
                background: rgba(255,255,255,0.1) !important;
                padding: 2px 6px !important;
                border-radius: 4px !important;
            }
            .ytvht-close {
                background: none !important;
                border: none !important;
                padding: 4px 8px !important;
                cursor: pointer !important;
                color: #aaa !important;
                font-size: 20px !important;
                opacity: 0.8 !important;
                transition: opacity 0.2s !important;
            }
            .ytvht-close:hover {
                opacity: 1 !important;
            }
        `;
        document.head.appendChild(style);
    }

    // Update overlay CSS with current settings to avoid inline styles
    function updateOverlayCSS(size, color) {
        let styleElement = document.getElementById('ytvht-dynamic-styles');
        if (!styleElement) {
            styleElement = document.createElement('style');
            styleElement.id = 'ytvht-dynamic-styles';
            document.head.appendChild(styleElement);
        }

        styleElement.textContent = `
            .ytvht-viewed-label {
                padding: ${size.fontSize / 2}px 4px !important;
                background-color: ${color} !important;
                font-size: ${size.fontSize}px !important;
            }
            .ytvht-progress-bar {
                height: ${size.bar}px !important;
                background-color: ${color} !important;
            }
        `;
    }

    // Extract video ID from any YouTube URL format
    function getVideoId() {
        const url = window.location.href;

        // Try to get from URL parameters first
        const urlParams = new URLSearchParams(window.location.search);
        const videoId = urlParams.get('v');
        if (videoId) return videoId;

        // Try to match various URL patterns
        const patterns = [
            /(?:youtube\.com\/watch\/([^\/\?]+))/i,  // youtube.com/watch/VIDEO_ID
            /(?:youtube\.com\/embed\/([^\/\?]+))/i,  // youtube.com/embed/VIDEO_ID
            /(?:youtube\.com\/v\/([^\/\?]+))/i,      // youtube.com/v/VIDEO_ID
            /(?:youtu\.be\/([^\/\?]+))/i,            // youtu.be/VIDEO_ID
            /(?:youtube\.com\/shorts\/([^\/\?]+))/i  // youtube.com/shorts/VIDEO_ID
        ];

        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match && match[1]) {
                return match[1];
            }
        }

        // If no pattern matches, try the last path segment
        const pathSegments = window.location.pathname.split('/').filter(Boolean);
        if (pathSegments.length > 0) {
            const lastSegment = pathSegments[pathSegments.length - 1];
            // Only return if it looks like a video ID (typically 11 characters)
            if (/^[a-zA-Z0-9_-]{11}$/.test(lastSegment)) {
                return lastSegment;
            }
        }

        log('Could not extract video ID from URL:', url);
        return null;
    }

    // Get clean video URL without any parameters
    function getCleanVideoUrl() {
        const videoId = getVideoId();
        if (!videoId) return null;
        return `https://www.youtube.com/watch?v=${videoId}`;
    }

    // Get playlist info from URL with better title detection
    function getPlaylistInfo() {
        const urlParams = new URLSearchParams(window.location.search);
        const playlistId = urlParams.get('list');
        if (!playlistId) {
            log('No playlist ID found in URL');
            return null;
        }

        log('Found playlist ID:', playlistId);

        // Try multiple selectors for playlist title with fallback
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
            // Additional selectors for newer YouTube layouts
            'ytd-playlist-panel-renderer h3 yt-formatted-string',
            'ytd-playlist-panel-renderer .title',
            '#secondary-inner ytd-playlist-panel-renderer .title',
            'ytd-playlist-header-renderer h1.ytd-playlist-header-renderer',
            '.playlist-title yt-formatted-string',
            '.ytd-playlist-panel-renderer .index-message + .title'
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

        const playlistInfo = {
            playlistId,
            title: playlistTitle,
            url: `https://www.youtube.com/playlist?list=${playlistId}`,
            timestamp: Date.now()
        };

        log('Created playlist info:', playlistInfo);
        return playlistInfo;
    }

    // Save playlist info
    async function savePlaylistInfo(playlistInfo = null) {
        const info = playlistInfo || getPlaylistInfo();
        if (!info) return;

        log('Saving playlist info:', info);

        try {
            await ytStorage.setPlaylist(info.playlistId, info);
            log('Playlist info saved successfully:', info);
        } catch (error) {
            log('Error saving playlist info:', error);
        }
    }

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

    // Load and set the saved timestamp with retries
    async function loadTimestamp() {
        const videoId = getVideoId();
        if (!videoId) {
            log('No video ID found in URL.');
            return;
        }

        log(`Attempting to load timestamp for video ID: ${videoId} from URL: ${window.location.href}`);

        try {
            const record = await ytStorage.getVideo(videoId);
            if (record) {
                const video = document.querySelector('video');
                if (video) {
                    log(`Found record for video ID ${videoId}:`, record);

                    // Wait for video to be ready with retries
                    const setTime = async (retryCount = 0) => {
                        const maxRetries = 10;
                        const retryDelay = 500;

                        if (retryCount >= maxRetries) {
                            log(`Failed to set timestamp after ${maxRetries} retries`);
                            return;
                        }

                        // Check if video duration is available and valid
                        if (video.duration && !isNaN(video.duration) && video.duration > 0) {
                            if (record.time > 0 && record.time < video.duration) {
                                // Ensure we're not too close to the end
                                const timeToSet = Math.min(record.time, video.duration - 1);
                                video.currentTime = timeToSet;
                                log(`Timestamp set for video ID ${videoId}: ${timeToSet} (duration: ${video.duration})`);

                                // Verify the time was actually set
                                setTimeout(() => {
                                    if (Math.abs(video.currentTime - timeToSet) > 1) {
                                        log('Time was not set correctly, retrying...');
                                        setTime(retryCount + 1);
                                    }
                                }, 100);
                            } else {
                                log(`Invalid timestamp ${record.time} for video duration ${video.duration}, skipping`);
                            }
                        } else {
                            log(`Video duration not ready (${video.duration}), retrying in ${retryDelay}ms...`);
                            setTimeout(() => setTime(retryCount + 1), retryDelay);
                        }
                    };

                    // Try to set time immediately if video is ready
                    if (video.readyState >= 1) {
                        setTime();
                    } else {
                        // Wait for metadata and then try
                        log('Video not ready, waiting for loadedmetadata event');
                        video.addEventListener('loadedmetadata', () => setTime(), { once: true });

                        // Also set up a backup timeout in case the event doesn't fire
                        setTimeout(() => {
                            if (video.readyState >= 1) {
                                setTime();
                            }
                        }, 1000);
                    }
                } else {
                    log('No video element found.');
                }
            } else {
                log('No record found for video ID:', videoId);
            }
        } catch (error) {
            log('Error loading timestamp:', error);
        }
    }

    // Save the current video timestamp (regular videos)
    async function saveTimestamp() {
        if (window.location.pathname.startsWith('/shorts/')) {
            await saveShortsTimestamp();
            return;
        }

        const video = document.querySelector('video');
        if (!video) return;

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
            url: getCleanVideoUrl(),
            channelName,
            channelId
        };

        try {
            await ytStorage.setVideo(videoId, record);
            broadcastVideoUpdate(record);
            log('[Critical] Timestamp saved', { videoId, time: currentTime });
        } catch (error) {
            log('[Error] Failed to save timestamp', { videoId, error });
        }
    }

    // Save Shorts timestamp
    async function saveShortsTimestamp() {
        const videoId = getVideoId();
        if (!videoId) {
            log('No video ID found for Shorts.');
            return;
        }

        const video = document.querySelector('video');
        if (!video) {
            log('No video element found for Shorts.');
            return;
        }

        let currentTime = video.currentTime;
        const duration = video.duration;

        // Do not update record if timestamp is 0 or duration is not available
        if (!currentTime || currentTime === 0 || !duration || duration === 0) {
            log(`Invalid timestamp (${currentTime}) or duration (${duration}) for Shorts ID ${videoId}, skipping update.`);
            return;
        }

        log(`Saving Shorts timestamp for video ID ${videoId} at time ${currentTime} (duration: ${duration}) from URL: ${window.location.href}`);

        let title = 'Unknown Title';
        const shortsTitleEl = document.querySelector('yt-shorts-video-title-view-model h2 span');
        if (shortsTitleEl && shortsTitleEl.textContent?.trim()) {
            title = shortsTitleEl.textContent.trim();
            log('Shorts title detected:', title);
        } else {
            // Fallback: use document title, but clean up " - YouTube Shorts"
            let docTitle = document.title.replace(/ - YouTube Shorts$/, '').trim();
            if (docTitle && docTitle.length > 0 && docTitle !== 'YouTube') {
                title = docTitle;
                log('Shorts title fallback from document.title:', title);
            }
        }

        // Extract channel name and channelId for Shorts
        let channelName = 'Unknown';
        let channelId = 'Unknown';
        const channelLink = document.querySelector('ytd-channel-name a, #owner-name a');
        if (channelLink) {
            channelName = channelLink.textContent?.trim() || 'Unknown';
            const href = channelLink.getAttribute('href') || '';
            const match = href.match(/\/channel\/([a-zA-Z0-9_-]+)/) || href.match(/\/@([a-zA-Z0-9_\.-]+)/);
            if (match) {
                channelId = match[1];
            } else {
                channelId = href;
            }
        }

        const record = {
            videoId: videoId,
            time: currentTime,
            duration: duration,
            timestamp: Date.now(),
            title: title,
            url: getCleanVideoUrl(),
            isShorts: true,
            channelName,
            channelId
        };

        try {
            await ytStorage.setVideo(videoId, record);
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

    // Update cleanupOldRecords to use currentSettings.autoCleanPeriod
    async function cleanupOldRecords() {
        try {
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

    // Start periodic saving with shorter interval
    function startSaveInterval() {
        if (saveIntervalId) {
            clearInterval(saveIntervalId);
        }
        saveTimestamp(); // Save immediately
        saveIntervalId = setInterval(saveTimestamp, 5000); // Changed from SAVE_INTERVAL to fixed 5000ms
    }

    // Debounce helper function
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

    // Set up video tracking
    function setupVideoTracking(video) {
        if (trackedVideos.has(video)) return;
        trackedVideos.add(video);

        let timestampLoaded = false;
        let lastSaveTime = 0;
        const MIN_SAVE_INTERVAL = 1000;

        const debouncedSave = debounce(async () => {
            const now = Date.now();
            if (now - lastSaveTime < MIN_SAVE_INTERVAL) return;
            lastSaveTime = now;
            await saveTimestamp();
        }, 500);

        const ensureVideoReady = async () => {
            if (timestampLoaded) return;

            if (video.readyState < 1) {
                await new Promise(resolve => {
                    video.addEventListener('loadedmetadata', resolve, { once: true });
                });
            }

            // A short delay to allow YouTube's scripts to restore video state first
            await new Promise(resolve => setTimeout(resolve, 250));

            // If currentTime is already set, we are likely in a mode-change
            // and YouTube has already restored the time. Don't interfere.
            if (video.currentTime > 1) {
                log('Video already in progress, skipping timestamp load to avoid interruption.');
            } else {
                await loadTimestamp();
            }

            timestampLoaded = true;

            if (!video.paused) {
                startSaveInterval();
            }
        };

        ensureVideoReady().catch(error => {
            log('[Error] Video initialization failed', error);
        });

        // Event handlers with minimal logging
        addTrackedEventListener(video, 'play', () => startSaveInterval());
        addTrackedEventListener(video, 'pause', () => {
            if (saveIntervalId) {
                clearInterval(saveIntervalId);
                saveIntervalId = null;
            }
            debouncedSave();
        });
        addTrackedEventListener(video, 'timeupdate', () => {
            const currentTime = Math.floor(video.currentTime);
            if (currentTime % 15 === 0) debouncedSave();
        });
        addTrackedEventListener(video, 'seeking', () => {
            if (saveIntervalId) {
                clearInterval(saveIntervalId);
                saveIntervalId = null;
            }
        });
        addTrackedEventListener(video, 'seeked', () => {
            debouncedSave();
            if (!video.paused) startSaveInterval();
        });
        addTrackedEventListener(window, 'beforeunload', () => saveTimestamp());
    }

    // This function is called when YouTube's SPA navigation is complete.
    function handleSpaNavigation() {
        const videoId = getVideoId();

        // If we're not on a video page, or it's the same video, do nothing.
        if (!videoId || videoId === lastProcessedVideoId) {
            return;
        }
        log(`[SPA] Navigation to new video detected: ${videoId}`);
        lastProcessedVideoId = videoId;

        // Reset the main initialization flag to allow re-initialization for the new page.
        isInitialized = false;

        // Stop any existing initialization interval, as we are starting a new one.
        if (initChecker) {
            clearInterval(initChecker);
            initChecker = null;
        }

        // Re-run the initialization logic, which will find the video and set up tracking.
        // The logic includes retries in case the video element is not immediately available.
        initializeIfNeeded();
        initChecker = setInterval(() => {
            log('Checking for video element after SPA navigation...');
            if (initializeIfNeeded()) {
                log('Initialization successful after SPA navigation. Stopping checker.');
                clearInterval(initChecker);
                initChecker = null;
            }
        }, 1000);
    }

    // Initialize and set up event listeners
    async function initializeIfNeeded() {
        if (isInitialized) {
            return true;
        }

        const video = document.querySelector('video');
        if (video) {
            log('Found video element, initializing...');
            try {
                // If the video element is being reused from a previous page, clean up old listeners first.
                if (trackedVideos.has(video)) {
                    log('[SPA] Reused video element detected. Cleaning up listeners before re-initializing.');
                    cleanupVideoListeners(video);
                }

                // Ensure storage is ready
                await ytStorage.ensureMigrated();
                log('Storage initialized successfully');

                // Inject CSS to avoid CSP issues
                injectCSS();

                setupVideoTracking(video);
                tryToSavePlaylist();
                showExtensionInfo();

                // Start observing for video changes
                videoObserver.observe(document.body, {
                    childList: true,
                    subtree: true
                });

                // Start observing for thumbnails and process existing ones
                log('Starting thumbnail observer and processing existing thumbnails.');
                thumbnailObserver.observe(document.body, { childList: true, subtree: true });
                processExistingThumbnails();

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
                const shortsVideo = document.querySelector('video');
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

    // Try to save playlist with optimized retry mechanism
    function tryToSavePlaylist(retries = 3) {
        // First check if we're even on a page that could have a playlist
        const urlParams = new URLSearchParams(window.location.search);
        const playlistId = urlParams.get('list');
        
        if (!playlistId) {
            // No playlist ID in URL, no need to retry
            log('No playlist ID in URL, skipping playlist save');
            return;
        }

        log(`Trying to save playlist (${retries} retries left)...`);
        const playlistInfo = getPlaylistInfo();
        
        if (playlistInfo) {
            log('Playlist info found, saving...');
            savePlaylistInfo(playlistInfo);
        } else if (retries > 0) {
            // Only retry if we have a playlist ID but couldn't get the title
            // This means the UI probably hasn't loaded yet
            log(`Playlist title not found for ID ${playlistId}, will retry in 3 seconds... (${retries} retries left)`);
            clearTimeout(playlistRetryTimeout);
            
            // Exponential backoff: wait longer between retries
            const delay = Math.min(3000 * (4 - retries), 5000);
            playlistRetryTimeout = setTimeout(() => {
                // Check if we're still on the same playlist before retrying
                const currentPlaylistId = new URLSearchParams(window.location.search).get('list');
                if (currentPlaylistId === playlistId) {
                    tryToSavePlaylist(retries - 1);
                } else {
                    log('Playlist ID changed, stopping retry attempts');
                }
            }, delay);
        } else {
            // If we've run out of retries but have a playlist ID, save with a default title
            if (playlistId) {
                log('Failed to get playlist title after retries, saving with default title');
                const defaultInfo = {
                    playlistId,
                    title: 'Untitled Playlist',
                    url: `https://www.youtube.com/playlist?list=${playlistId}`,
                    timestamp: Date.now()
                };
                savePlaylistInfo(defaultInfo);
            } else {
                log('Failed to save playlist after all retries');
            }
        }
    }

    // Start observing for video element and playlist changes
    initChecker = setInterval(() => {
        log('Checking for video element...');
        if (initializeIfNeeded()) {
            log('Initialization successful. Stopping checker.');
            clearInterval(initChecker);
            initChecker = null;
        }
    }, 1000);

    // Initialize immediately and also retry if needed
    initializeIfNeeded();

    // Update overlays to use currentSettings.overlayTitle and overlayColor
    function getVideoIdFromThumbnail(thumbnail) {
        // Check for playlist panel video renderers first (most specific)
        if (thumbnail.tagName === 'YTD-PLAYLIST-PANEL-VIDEO-RENDERER' || thumbnail.closest('ytd-playlist-panel-video-renderer')) {
            // Try to get from the video ID from the href attribute
            const videoLink = thumbnail.querySelector('a#wc-endpoint[href*="watch?v="]');
            if (videoLink) {
                return videoLink.href.match(/[?&]v=([^&]+)/)?.[1];
            }

            // Try to get from the thumbnail link
            const thumbnailLink = thumbnail.querySelector('a#thumbnail[href*="watch?v="]');
            if (thumbnailLink) {
                return thumbnailLink.href.match(/[?&]v=([^&]+)/)?.[1];
            }
        }

        // Check for regular playlist video renderers
        if (thumbnail.tagName === 'YTD-PLAYLIST-VIDEO-RENDERER' || thumbnail.closest('ytd-playlist-video-renderer')) {
            const videoId = thumbnail.getAttribute('data-video-id') || thumbnail.getAttribute('video-id');
            if (videoId) return videoId;

            const playlistLink = thumbnail.querySelector('a#video-title[href*="watch?v="], a#thumbnail[href*="watch?v="]');
            if (playlistLink) {
                return playlistLink.href.match(/[?&]v=([^&]+)/)?.[1];
            }
        }

        // Check for compact video renderer (right column)
        if (thumbnail.tagName === 'YTD-COMPACT-VIDEO-RENDERER' || thumbnail.closest('ytd-compact-video-renderer')) {
            const videoId = thumbnail.getAttribute('video-id');
            if (videoId) return videoId;
            
            const compactLink = thumbnail.querySelector('a#thumbnail[href*="watch?v="]');
            if (compactLink) {
                return compactLink.href.match(/[?&]v=([^&]+)/)?.[1];
            }
        }

        if (thumbnail.tagName === 'YT-LOCKUP-VIEW-MODEL' || thumbnail.closest('yt-lockup-view-model')) {
            const lockupLink = thumbnail.querySelector('a[href*="watch?v="]');
            if (lockupLink) {
                const videoId = lockupLink.href.match(/[?&]v=([^&]+)/)?.[1];
                return videoId;
            }
        }

        // Check for regular video links
        let anchor = thumbnail.querySelector('a#thumbnail[href*="watch?v="], a#video-title[href*="watch?v="]');
        if (anchor) {
            return anchor.href.match(/[?&]v=([^&]+)/)?.[1];
        }

        // Check if the thumbnail itself is the anchor
        if (thumbnail.tagName === 'A' && (thumbnail.id === 'thumbnail' || thumbnail.id === 'video-title')) {
            if (thumbnail.href.includes('watch?v=')) {
                return thumbnail.href.match(/[?&]v=([^&]+)/)?.[1];
            }
            // Check for Shorts
            if (thumbnail.href.includes('/shorts/')) {
                return thumbnail.href.match(/\/shorts\/([^\/\?]+)/)?.[1];
            }
        }

        // Check for Shorts links in nested elements
        anchor = thumbnail.querySelector('a[href*="/shorts/"]');
        if (anchor) {
            return anchor.href.match(/\/shorts\/([^\/\?]+)/)?.[1];
        }

        return null;
    }

    function addViewedLabelToThumbnail(thumbnailElement, videoId) {
        if (!thumbnailElement || !videoId) return;

        // For playlist items, we need to target the thumbnail container
        let targetElement = thumbnailElement;
        
        if (thumbnailElement.tagName === 'YT-LOCKUP-VIEW-MODEL' || thumbnailElement.closest('yt-lockup-view-model')) {
            const thumbnailContainer = thumbnailElement.querySelector('.yt-lockup-view-model-wiz__content-image');
            if (thumbnailContainer) {
                targetElement = thumbnailContainer;
            } else {
                return;
            }
        }
        // If we're in a playlist panel video renderer, find the thumbnail container
        else if (thumbnailElement.tagName === 'YTD-PLAYLIST-PANEL-VIDEO-RENDERER' || thumbnailElement.closest('ytd-playlist-panel-video-renderer')) {
            const thumbnailContainer = thumbnailElement.querySelector('#thumbnail-container ytd-thumbnail') || 
                                    thumbnailElement.querySelector('ytd-thumbnail') ||
                                    thumbnailElement.querySelector('#thumbnail-container');
            if (thumbnailContainer) {
                targetElement = thumbnailContainer;
            } else {
                return; // Can't find a suitable container
            }
        }
        // For regular playlist items
        else if (thumbnailElement.tagName === 'YTD-PLAYLIST-VIDEO-RENDERER' || thumbnailElement.closest('ytd-playlist-video-renderer')) {
            const thumbnailContainer = thumbnailElement.querySelector('ytd-thumbnail') || 
                                    thumbnailElement.querySelector('a#thumbnail');
            if (thumbnailContainer) {
                targetElement = thumbnailContainer;
            } else {
                return;
            }
        }
        // For other video types, keep existing logic
        else if (thumbnailElement.tagName !== 'YTD-THUMBNAIL' && !(thumbnailElement.tagName === 'A' && thumbnailElement.id === 'thumbnail')) {
            const inner = thumbnailElement.querySelector('ytd-thumbnail, a#thumbnail');
            if (inner) {
                targetElement = inner;
            } else {
                return;
            }
        }

        // Ensure the target element has relative positioning
        targetElement.style.position = 'relative';

        let label = targetElement.querySelector('.ytvht-viewed-label');
        let progress = targetElement.querySelector('.ytvht-progress-bar');

        ytStorage.getVideo(videoId).then(record => {
            if (record) {
                const size = OVERLAY_LABEL_SIZE_MAP[currentSettings.overlayLabelSize] || OVERLAY_LABEL_SIZE_MAP.medium;
                const color = OVERLAY_COLORS[currentSettings.overlayColor];

                updateOverlayCSS(size, color);

                if (!label) {
                    label = document.createElement('div');
                    label.className = 'ytvht-viewed-label';
                    targetElement.appendChild(label);
                }

                if (label.textContent !== currentSettings.overlayTitle) {
                    label.textContent = currentSettings.overlayTitle;
                }

                if (!progress) {
                    progress = document.createElement('div');
                    progress.className = 'ytvht-progress-bar';
                    targetElement.appendChild(progress);
                }

                const newWidth = `${(record.time / record.duration) * 100}%`;
                if (progress.style.width !== newWidth) {
                    progress.style.width = newWidth;
                }
            } else {
                label?.remove();
                progress?.remove();
            }
        }).catch(error => {
            log('[Error] Failed to process thumbnail', { videoId, error });
            label?.remove();
            progress?.remove();
        });
    }

    // Update the mutation observer to include playlist panel items
    thumbnailObserver = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            // Handle attribute changes that might indicate content loading
            if (mutation.type === 'attributes') {
                const target = mutation.target;
                if (target.tagName === 'IMG' && target.id === 'img') {
                    const videoElement = target.closest('ytd-playlist-panel-video-renderer, ytd-playlist-video-renderer, ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-compact-radio-renderer, yt-lockup-view-model');
                    if (videoElement) {
                        processVideoElement(videoElement);
                    }
                }
                return;
            }

            // Handle added nodes
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    // Process the node itself if it's a video element
                    if (node.tagName && (
                        node.tagName === 'YTD-PLAYLIST-PANEL-VIDEO-RENDERER' ||
                        node.tagName === 'YTD-PLAYLIST-VIDEO-RENDERER' ||
                        node.tagName === 'YTD-RICH-ITEM-RENDERER' ||
                        node.tagName === 'YTD-GRID-VIDEO-RENDERER' ||
                        node.tagName === 'YTD-VIDEO-RENDERER' ||
                        node.tagName === 'YTD-COMPACT-VIDEO-RENDERER' ||
                        node.tagName === 'YTD-COMPACT-RADIO-RENDERER' ||
                        node.tagName === 'YT-LOCKUP-VIEW-MODEL'
                    )) {
                        processVideoElement(node);
                    }

                    // Also check for video elements inside the added node
                    const videoElements = node.querySelectorAll('ytd-playlist-panel-video-renderer, ytd-playlist-video-renderer, ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-compact-radio-renderer, yt-lockup-view-model');
                    if (videoElements.length > 0) {
                        videoElements.forEach(element => processVideoElement(element));
                    }
                }
            });
        });
    });

    // Add processing for playlist panel items
    function processExistingThumbnails() {
        // Process playlist panel videos first (most specific)
        const playlistPanelVideos = document.querySelectorAll('ytd-playlist-panel-video-renderer');
        playlistPanelVideos.forEach(element => processVideoElement(element));

        // Process regular playlist videos
        const playlistVideos = document.querySelectorAll('ytd-playlist-video-renderer');
        playlistVideos.forEach(element => processVideoElement(element));

        // Process main feed thumbnails
        const mainThumbnails = document.querySelectorAll('ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-video-renderer');
        mainThumbnails.forEach(element => processVideoElement(element));

        // Process right column recommendations
        const rightColumnThumbnails = document.querySelectorAll('ytd-compact-video-renderer, ytd-compact-radio-renderer, yt-lockup-view-model');
        rightColumnThumbnails.forEach(element => processVideoElement(element));
    }

    // Enhanced processVideoElement with cleanup tracking
    function processVideoElement(element) {
        // Clean up any existing pending operations for this element
        if (pendingOperations.has(element)) {
            const ops = pendingOperations.get(element);
            if (ops.timeout) clearTimeout(ops.timeout);
            if (ops.rafId) cancelAnimationFrame(ops.rafId);
            pendingOperations.delete(element);
        }

        const ops = {};
        ops.rafId = requestAnimationFrame(() => {
            ops.rafId = null;
            
            // Only log for our target video
            if (element.innerHTML.includes('u_Lxkt50xOg')) {
                log('Found target video in element, processing...');
            }

            const videoId = getVideoIdFromThumbnail(element);
            if (videoId) {
                if (videoId === 'u_Lxkt50xOg') {
                    log('Found target video! Processing overlay...');
                }
                addViewedLabelToThumbnail(element, videoId);
                pendingOperations.delete(element);
            } else {
                // If we can't get the video ID yet, try again after a short delay
                ops.timeout = setTimeout(() => {
                    ops.timeout = null;
                    const retryVideoId = getVideoIdFromThumbnail(element);
                    if (retryVideoId) {
                        if (retryVideoId === 'u_Lxkt50xOg') {
                            log('Found target video on retry! Processing overlay...');
                        }
                        addViewedLabelToThumbnail(element, retryVideoId);
                    } else if (element.innerHTML.includes('u_Lxkt50xOg')) {
                        log('Failed to extract video ID for target video even after retry');
                    }
                    pendingOperations.delete(element);
                }, 100);
            }
        });
        
        pendingOperations.set(element, ops);
    }

    // Handle messages from popup
    messageListener = function(message, sender, sendResponse) {
        if (message.type === 'getHistory') {
            if (!isInitialized) {
                log('Not initialized yet, initializing now');
                initializeIfNeeded();
            }
            ytStorage.getAllVideos().then(allVideos => {
                const history = Object.values(allVideos);
                log('Sending history to popup:', history);
                sendResponse({history: history});
            }).catch(error => {
                log('Error getting history:', error);
                sendResponse({history: []});
            });
            return true;
        } else if (message.type === 'exportHistory') {
            if (!isInitialized) {
                log('Not initialized yet, initializing now');
                initializeIfNeeded();
            }
            Promise.all([
                ytStorage.getAllVideos(),
                ytStorage.getAllPlaylists()
            ]).then(([allVideos, allPlaylists]) => {
                const history = Object.values(allVideos);
                const playlists = Object.values(allPlaylists);
                log('Sending export data to popup:', { history, playlists });
                sendResponse({history: history, playlists: playlists});
            }).catch(error => {
                log('Error getting export data:', error);
                sendResponse({history: [], playlists: []});
            });
            return true;
        } else if (message.type === 'importHistory') {
            const records = message.records || [];
            const playlists = message.playlists || [];
            const mergeMode = message.mergeMode || false;

            log(`Importing ${records.length} videos and ${playlists.length} playlists (merge: ${mergeMode})`);

            if (mergeMode) {
                // Merge mode: combine with existing data
                Promise.all([
                    ytStorage.getAllVideos(),
                    ytStorage.getAllPlaylists()
                ]).then(([existingVideos, existingPlaylists]) => {
                    let importedVideos = 0;
                    let importedPlaylists = 0;

                    // Merge videos (keep newest timestamp if duplicate)
                    const mergedVideos = { ...existingVideos };
                    records.forEach(record => {
                        const existing = mergedVideos[record.videoId];
                        if (!existing || record.timestamp > existing.timestamp) {
                            mergedVideos[record.videoId] = record;
                            importedVideos++;
                        }
                    });

                    // Merge playlists (keep newest timestamp if duplicate)
                    const mergedPlaylists = { ...existingPlaylists };
                    playlists.forEach(playlist => {
                        const existing = mergedPlaylists[playlist.playlistId];
                        if (!existing || playlist.timestamp > existing.timestamp) {
                            mergedPlaylists[playlist.playlistId] = playlist;
                            importedPlaylists++;
                        }
                    });

                    // Save merged data
                    const savePromises = [];
                    Object.values(mergedVideos).forEach(video => {
                        savePromises.push(ytStorage.setVideo(video.videoId, video));
                    });
                    Object.values(mergedPlaylists).forEach(playlist => {
                        savePromises.push(ytStorage.setPlaylist(playlist.playlistId, playlist));
                    });

                    Promise.all(savePromises).then(() => {
                        log(`Merge completed: ${importedVideos} videos, ${importedPlaylists} playlists`);
                        sendResponse({
                            status: 'success',
                            importedVideos: importedVideos,
                            importedPlaylists: importedPlaylists
                        });
                    }).catch(error => {
                        log('Error saving merged data:', error);
                        sendResponse({status: 'error'});
                    });
                }).catch(error => {
                    log('Error getting existing data for merge:', error);
                    sendResponse({status: 'error'});
                });
            } else {
                // Replace mode: clear existing and import new
                ytStorage.clear().then(() => {
                    let importedVideos = 0;
                    let importedPlaylists = 0;

                    const savePromises = [];
                    records.forEach(record => {
                        savePromises.push(ytStorage.setVideo(record.videoId, record));
                        importedVideos++;
                    });
                    playlists.forEach(playlist => {
                        savePromises.push(ytStorage.setPlaylist(playlist.playlistId, playlist));
                        importedPlaylists++;
                    });

                    Promise.all(savePromises).then(() => {
                        log(`Import completed: ${importedVideos} videos, ${importedPlaylists} playlists`);
                        sendResponse({
                            status: 'success',
                            importedVideos: importedVideos,
                            importedPlaylists: importedPlaylists
                        });
                    }).catch(error => {
                        log('Error saving imported data:', error);
                        sendResponse({status: 'error'});
                    });
                }).catch(error => {
                    log('Error clearing existing data:', error);
                    sendResponse({status: 'error'});
                });
            }
            return true;
        } else if (message.type === 'clearHistory') {
            ytStorage.clear().then(() => {
                log('History cleared successfully');
                sendResponse({status: 'success'});
            }).catch(error => {
                log('Error clearing history:', error);
                sendResponse({status: 'error'});
            });
            return true;
        } else if (message.type === 'deleteRecord') {
            const videoId = message.videoId;
            ytStorage.removeVideo(videoId).then(() => {
                log('Record deleted successfully:', videoId);
                sendResponse({status: 'success'});
            }).catch(error => {
                log('Error deleting record:', videoId);
                sendResponse({status: 'error'});
            });
            return true;
        } else if (message.type === 'getPlaylists') {
            ytStorage.getAllPlaylists().then(allPlaylists => {
                const playlists = Object.values(allPlaylists);
                log('Sending playlists to popup:', playlists);
                sendResponse({playlists: playlists});
            }).catch(error => {
                log('Error getting playlists:', error);
                sendResponse({playlists: []});
            });
            return true;
        } else if (message.type === 'deletePlaylist') {
            const playlistId = message.playlistId;
            ytStorage.removePlaylist(playlistId).then(() => {
                log('Playlist deleted successfully:', playlistId);
                sendResponse({status: 'success'});
            }).catch(error => {
                log('Error deleting playlist:', playlistId);
                sendResponse({status: 'error'});
            });
            return true;
        } else if (message.type === 'updateSettings') {
            currentSettings = message.settings;
            // If debug was toggled, log the change
            if (currentSettings.debug) {
                console.log('[ythdb] Debug mode enabled');
            }
            injectCSS();
            updateOverlayCSS(
                OVERLAY_LABEL_SIZE_MAP[currentSettings.overlayLabelSize] || OVERLAY_LABEL_SIZE_MAP.medium,
                OVERLAY_COLORS[currentSettings.overlayColor] || OVERLAY_COLORS.blue
            );
            // Reprocess thumbnails with new settings
            processExistingThumbnails();
            sendResponse({status: 'success'});
            return true;
        }
        return false;
    };

    chrome.runtime.onMessage.addListener(messageListener);

    function showExtensionInfo() {
        // Check if we've already shown the info
        storage.get(['infoShown']).then(result => {
            if (!result.infoShown) {
                const topLevelButtons = document.querySelector('#top-level-buttons-computed');
                if (!topLevelButtons) return;

                // Create info container
                const infoDiv = document.createElement('div');
                infoDiv.className = 'ytvht-info';

                // Create content structure using CSS classes
                const contentDiv = document.createElement('div');
                contentDiv.className = 'ytvht-info-content';

                const textDiv = document.createElement('div');
                textDiv.className = 'ytvht-info-text';

                const titleDiv = document.createElement('div');
                titleDiv.className = 'ytvht-info-title';
                titleDiv.textContent = '📺 YouTube History Tracker Active';

                const descDiv = document.createElement('div');
                descDiv.className = 'ytvht-info-description';
                descDiv.innerHTML = 'Your video progress is being tracked! Click the extension icon <span class="ytvht-info-highlight">↗️</span> in the toolbar to view your history.';

                const closeButton = document.createElement('button');
                closeButton.className = 'ytvht-close';
                closeButton.textContent = '×';

                // Assemble the structure
                textDiv.appendChild(titleDiv);
                textDiv.appendChild(descDiv);
                contentDiv.appendChild(textDiv);
                contentDiv.appendChild(closeButton);
                infoDiv.appendChild(contentDiv);

                // Add close button functionality
                closeButton.addEventListener('click', () => {
                    infoDiv.style.display = 'none';
                    // Remember that we've shown the info
                    storage.set({ infoShown: true });
                });

                // Insert the info div
                const container = topLevelButtons.closest('#actions');
                if (container) {
                    container.style.position = 'relative';
                    container.appendChild(infoDiv);
                } else {
                    topLevelButtons.parentElement.style.position = 'relative';
                    topLevelButtons.parentElement.appendChild(infoDiv);
                }

                // Log that we're showing the info
                log('Info div added to page');
            }
        }).catch(error => {
            log('Error checking infoShown status:', error);
        });
    }

    // Update initialize() to handle version updates
    async function initialize() {
        if (isInitialized) {
            return true;
        }

        try {
            injectCSS();
            const settings = await loadSettings() || DEFAULT_SETTINGS;
            
            // Check for version update
            if (settings.version !== EXTENSION_VERSION) {
                log('Version updated:', { old: settings.version, new: EXTENSION_VERSION });
                settings.version = EXTENSION_VERSION;
                await ytStorage.setSettings(settings);
            }

            currentSettings = settings;
            updateOverlayCSS(
                OVERLAY_LABEL_SIZE_MAP[currentSettings.overlayLabelSize] || OVERLAY_LABEL_SIZE_MAP.medium,
                OVERLAY_COLORS[currentSettings.overlayColor] || OVERLAY_COLORS.blue
            );

            // Start observing immediately
            if (document.body) {
                thumbnailObserver.observe(document.body, {
                    childList: true,
                    subtree: true,
                    attributes: true,
                    attributeFilter: ['src', 'href', 'data-visibility-tracking']
                });

                processExistingThumbnails();

                // Set up a backup check for lazy-loaded content
                setTimeout(processExistingThumbnails, 2000);
            }

            isInitialized = true;
            return true;
        } catch (error) {
            log('Error during initialization:', error);
            currentSettings = DEFAULT_SETTINGS;
            return false;
        }
    }

    // Initialize on startup
    initialize();

    // Listen for YouTube's own navigation events to handle SPA changes.
    window.addEventListener('yt-navigate-finish', handleSpaNavigation);

    // Update the storage change listener to use the improved thumbnail processing
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local') {
                const hasVideoChanges = Object.keys(changes).some(key =>
                    key.startsWith('video_') || key.startsWith('playlist_')
                );
                if (hasVideoChanges) {
                    // Use the improved processing function
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
                if (hasVideoChanges) {
                    // Use the improved processing function
                    processExistingThumbnails();
                }
            }
        });
    }
})();
