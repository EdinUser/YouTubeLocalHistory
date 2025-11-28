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
            try {
                if (isFirefox) {
                    return await browser.storage.local.get(keys);
                } else {
                    return new Promise((resolve, reject) => {
                        chrome.storage.local.get(keys, (result) => {
                            if (chrome.runtime.lastError) {
                                // Handle extension context invalidated error
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
                                // Handle extension context invalidated error
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
    const EXTENSION_VERSION = chrome.runtime.getManifest().version; // Get version from manifest
    const SAVE_INTERVAL = 5000; // Save every 5 seconds

    const DEFAULT_SETTINGS = {
        autoCleanPeriod: 90, // days
        paginationCount: 10,
        overlayTitle: 'viewed',
        overlayColor: 'blue',
        overlayLabelSize: 'medium',
        debug: false, // Add debug setting
        pauseHistoryInPlaylists: false,
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
    const trackedVideos = new Set();

    // Track event listeners for cleanup
    const videoEventListeners = new WeakMap();

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

    // Track the last time SPA navigation occurred
    let lastSpaNavigationTime = 0;

    // Track current URL for navigation detection
    let lastUrl = window.location.href;

    // DRY-RUN LOGGING: Event-driven content change detection
    let simulatedLastContentChangeTime = 0;

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

    // Helper function to add tracked event listeners
    function addTrackedEventListener(video, event, handler) {
        if (!videoEventListeners.has(video)) {
            videoEventListeners.set(video, []);
        }
        videoEventListeners.get(video).push({ event, handler });
        video.addEventListener(event, handler);
    }

    // Helper function to add tracked observers
    function addTrackedObserver(video, observer) {
        if (!videoObservers.has(video)) {
            videoObservers.set(video, []);
        }
        videoObservers.get(video).push(observer);
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
                z-index: 9999 !important;
                border-radius: 0 0 4px 0 !important;
                pointer-events: none !important;
            }
            .ytvht-progress-bar {
                position: absolute !important;
                bottom: 0 !important;
                left: 0 !important;
                height: 3px !important;
                background-color: #4285f4 !important;
                z-index: 9999 !important;
                pointer-events: none !important;
            }
            .ytvht-remove-button {
                position: absolute !important;
                bottom: 10px !important;
                right: 10px !important;
                width: 26px !important;
                height: 26px !important;
                line-height: 26px !important;
                text-align: center !important;
                font-size: 18px !important;
                font-weight: 700 !important;
                color: #fff !important;
                background: #4285f4 !important;
                border: none !important;
                border-radius: 50% !important;
                cursor: pointer !important;
                z-index: 10000 !important;
                pointer-events: auto !important;
                opacity: 0 !important;
                transition: opacity 0.15s ease-in-out !important;
                user-select: none !important;
            }
            ytd-thumbnail:hover .ytvht-remove-button,
            a#thumbnail:hover .ytvht-remove-button,
            ytd-playlist-video-renderer:hover .ytvht-remove-button,
            ytd-playlist-panel-video-renderer:hover .ytvht-remove-button,
            yt-lockup-view-model:hover .ytvht-remove-button,
            ytd-video-renderer:hover .ytvht-remove-button,
            ytd-rich-item-renderer:hover .ytvht-remove-button,
            ytd-grid-video-renderer:hover .ytvht-remove-button {
                opacity: 0.95 !important;
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
            .ytvht-ignore-toggle {
                position: absolute !important;
                top: 8px !important;
                right: 8px !important;
                background: #4285f4 !important;
                color: #fff !important;
                border: none !important;
                border-radius: 14px !important;
                font-size: 12px !important;
                line-height: 1 !important;
                padding: 6px 10px !important;
                cursor: pointer !important;
                z-index: 10001 !important;
                opacity: 0.9 !important;
            }
            .ytvht-ignore-toggle[aria-pressed="true"] {
                background: #666 !important;
            }
            .ytvht-ignore-row {
                margin-top: 8px !important;
            }
            .ytvht-ignore-toggle.header {
                position: static !important;
                display: inline-flex !important;
            }
            .ytvht-ignore-toggle.action {
                position: static !important;
                display: inline-flex !important;
                margin-left: 8px !important;
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
            .ytvht-remove-button {
                background: ${color} !important;
            }
            .ytvht-ignore-toggle {
                background: ${color} !important;
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

    /**
     * Clean YouTube URL by removing timestamp and other parameters
     * @param {string} url - YouTube URL
     * @returns {string} Clean URL with only video ID
     */
    function cleanVideoUrl(url) {
        if (!url) return url;
        
        // Handle relative URLs by making them absolute
        let absoluteUrl = url;
        if (url.startsWith('/')) {
            absoluteUrl = 'https://www.youtube.com' + url;
        } else if (!url.startsWith('http://') && !url.startsWith('https://')) {
            // If it's not absolute and not relative, assume it's a YouTube URL
            if (url.includes('youtube.com') || url.includes('youtu.be')) {
                absoluteUrl = 'https://' + url.replace(/^https?:\/\//, '');
            } else {
                // Can't parse, return as-is
                return url;
            }
        }
        
        try {
            const urlObj = new URL(absoluteUrl);
            const videoId = urlObj.searchParams.get('v') || 
                           (urlObj.pathname.includes('/shorts/') ? urlObj.pathname.split('/shorts/')[1]?.split('/')[0] : null);
            
            if (!videoId) return url; // Return original if we can't extract video ID
            
            // Return clean URL
            if (urlObj.pathname.includes('/shorts/')) {
                return `https://www.youtube.com/shorts/${videoId}`;
            } else {
                return `https://www.youtube.com/watch?v=${videoId}`;
            }
        } catch (e) {
            // If URL parsing fails, try to extract video ID manually
            const videoIdMatch = absoluteUrl.match(/[?&]v=([^&]+)/) || absoluteUrl.match(/\/shorts\/([^\/\?]+)/);
            if (videoIdMatch) {
                const videoId = videoIdMatch[1];
                if (absoluteUrl.includes('/shorts/')) {
                    return `https://www.youtube.com/shorts/${videoId}`;
                } else {
                    return `https://www.youtube.com/watch?v=${videoId}`;
                }
            }
            // If all else fails, return original URL
            return url;
        }
    }

    /**
     * Add timestamp parameter to YouTube URL
     * @param {string} url - YouTube URL
     * @param {number} timeSeconds - Time in seconds
     * @returns {string} URL with timestamp parameter
     */
    function addTimestampToUrl(url, timeSeconds) {
        if (!url || !timeSeconds || timeSeconds <= 0) return url;
        
        try {
            // First clean the URL to remove any existing timestamp
            const cleanUrl = cleanVideoUrl(url);
            
            // If cleaning failed or returned original, use original URL
            const urlToUse = cleanUrl || url;
            
            try {
                const urlObj = new URL(urlToUse);
                // Add 't' parameter (YouTube accepts both 't=123' and 't=123s')
                urlObj.searchParams.set('t', Math.floor(timeSeconds) + 's');
                return urlObj.toString();
            } catch (e) {
                // If URL parsing fails, try simple string manipulation
                if (urlToUse.includes('watch?v=') || urlToUse.includes('/shorts/')) {
                    const separator = urlToUse.includes('?') ? '&' : '?';
                    return `${urlToUse}${separator}t=${Math.floor(timeSeconds)}s`;
                }
                return urlToUse;
            }
        } catch (error) {
            // If anything fails, return original URL without timestamp
            log(`[Content] Failed to add timestamp to URL: ${error} (${url})`);
            return url;
        }
    }

    /**
     * Add timestamp to a video link if we have saved progress
     */
    async function addTimestampToLink(anchor) {
        const href = anchor.getAttribute('href');
        if (!href) return;

        log(`[Link Intercept] Processing anchor with href: ${href}`);

        // Extract video ID from URL
        let videoId = null;
        if (href.includes('watch?v=')) {
            const match = href.match(/[?&]v=([^&]+)/);
            videoId = match ? match[1] : null;
        } else if (href.includes('/shorts/')) {
            const match = href.match(/\/shorts\/([^\/\?]+)/);
            videoId = match ? match[1] : null;
        }

        if (!videoId) {
            log(`[Link Intercept] No video ID found in href: ${href}`);
            return;
        }

        log(`[Link Intercept] Found video ID: ${videoId}`);

        // Check if we have saved progress for this video
        try {
            const record = await ytStorage.getVideo(videoId);
            log(`[Link Intercept] Retrieved record for ${videoId}:`, record);

            if (record && record.time && record.time > 0) {
                // Modify the href to include timestamp
                const newUrl = addTimestampToUrl(href, record.time);
                log(`[Link Intercept] Original URL: ${href}`);
                log(`[Link Intercept] Modified URL: ${newUrl}`);

                if (newUrl !== href) {
                    anchor.setAttribute('href', newUrl);
                    log(`[Link Intercept] ✅ Added timestamp ${record.time}s to video ${videoId}`);
                } else {
                    log(`[Link Intercept] URL unchanged, timestamp not added`);
                }
            } else {
                log(`[Link Intercept] No saved progress found for video ${videoId}`);
            }
        } catch (error) {
            // Silently fail - don't break navigation if storage check fails
            log(`[Link Intercept] ❌ Failed to check video ${videoId}:`, error);
        }
    }

    /**
     * Intercept clicks on video links and add timestamp if we have saved progress
     */
    function interceptVideoLinkClicks() {
        // Intercept clicks on video links
        document.addEventListener('click', async (e) => {
            // Find the closest anchor element
            let anchor = e.target.closest('a[href*="watch?v="], a[href*="/shorts/"]');
            if (!anchor) {
                // If no anchor found, check if we're clicking on an overlay element
                // and try to find the anchor in the parent hierarchy
                const overlayElement = e.target.closest('.ytvht-viewed-label, .ytvht-progress-bar');
                if (overlayElement) {
                    anchor = overlayElement.closest('a[href*="watch?v="], a[href*="/shorts/"]');
                    log(`[Click Intercept] Click on overlay, found anchor: ${anchor ? anchor.href : 'none'}`);
                }
            }

            if (!anchor) {
                log(`[Click Intercept] No anchor found for click target:`, e.target);
                return;
            }

            log(`[Click Intercept] Found anchor for video link: ${anchor.href}`);
            await addTimestampToLink(anchor);
        }, true); // Use capture phase to intercept before YouTube's handlers

        // Also process links when thumbnails are processed (for dynamically loaded content)
        // This is handled by the existing thumbnail processing logic
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
            '.ytd-playlist-panel-renderer .index-message + .title',
            // New page header-based layouts
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

        const playlistInfo = {
            playlistId,
            title: playlistTitle,
            url: `https://www.youtube.com/playlist?list=${playlistId}`,
            timestamp: Date.now()
        };

        log('Created playlist info:', playlistInfo);
        return playlistInfo;
    }

    // Save playlist info (merge with existing to preserve flags)
    async function savePlaylistInfo(playlistInfo = null) {
        const info = playlistInfo || getPlaylistInfo();
        if (!info) return;

        log('Saving playlist info:', info);

        try {
            const existing = await ytStorage.getPlaylist(info.playlistId);
            const merged = {
                ...(existing || {}),
                ...info,
                lastUpdated: Date.now()
            };
            // Ensure we don't drop custom flags like ignoreVideos from existing
            await ytStorage.setPlaylist(info.playlistId, merged);
            log('Playlist info saved successfully:', merged);
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

        let currentTime = video.currentTime;
        const duration = video.duration;

        // Do not update record if timestamp is 0. Allow duration to be unavailable for Shorts.
        if (!currentTime || currentTime === 0) {
            log(`Invalid timestamp (${currentTime}) for Shorts ID ${videoId}, skipping update.`);
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
            // Compute delta against previous saved time to update stats
            let previous = null;
            try { previous = await ytStorage.getVideo(videoId); } catch (_) {}
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

    // Update cleanupOldRecords to use currentSettings.autoCleanPeriod
    async function cleanupOldRecords() {
        try {
            // Skip cleanup if set to "forever"
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

    // Helper function for waiting for events with timeout
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

        const debouncedSave = debounce(async () => {
            const now = Date.now();
            if (now - lastSaveTime < MIN_SAVE_INTERVAL) return;
            lastSaveTime = now;
            await saveTimestamp();
        }, 500);

        const ensureVideoReady = async () => {
            if (timestampLoaded) return;

            const videoId = getVideoId();
            if (!video || !videoId) return;

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
                        if (record && record.time && record.time > 0) {
                            break; // Success, exit retry loop
                        }
                    } catch (error) {
                        log(`[ensureVideoReady] getVideo attempt ${attempt + 1} failed:`, error.message);
                        if (attempt < retries - 1) {
                            // Wait before retry (exponential backoff)
                            await new Promise(resolve => setTimeout(resolve, retryDelay * Math.pow(2, attempt)));
                        }
                    }
                }
                
                if (!record || !record.time || record.time <= 0) {
                    log(`[ensureVideoReady] No valid record found for ${videoId} after ${retries} attempts`);
                    return;
                }

                const currentTime = video.currentTime || 0;
                const savedTime = record.time;

                // Enhanced debug logging using existing log function
                log(`[ensureVideoReady] videoId=${videoId} | current=${currentTime.toFixed(2)}s | saved=${savedTime.toFixed(2)}s`);

                const tolerance = 2; // 2-second tolerance window

                // CASE 1: YouTube already restored correctly (within tolerance)
                if (Math.abs(currentTime - savedTime) <= tolerance) {
                    log(`YouTube already restored timestamp correctly (diff=${(currentTime - savedTime).toFixed(2)}s)`);
                    timestampLoaded = true;
                    return;
                }

                // CASE 2: YouTube did not restore or restored incorrectly
                // Wait until metadata is fully loaded to safely set currentTime
                if (video.readyState < 1) {
                    await waitForEvent(video, "loadedmetadata", 1000);
                }

                // Double-check after metadata is loaded
                const currentTimeAfterMetadata = video.currentTime || 0;

                // Check if we're within a short time window of SPA navigation
                const timeSinceSpaNavigation = Date.now() - lastSpaNavigationTime;
                const isRecentSpaNavigation = timeSinceSpaNavigation < 2000; // 2 seconds

                // DRY-RUN: Simulate event-driven content change detection
                const timeSinceSimulatedContentChange = Date.now() - simulatedLastContentChangeTime;
                const isRecentSimulatedContentChange = timeSinceSimulatedContentChange < 1000; // 1 second for events

                // Enhanced logging for analysis
                log(`[DRY-RUN] Video state: paused=${video.paused}, currentTime=${currentTimeAfterMetadata.toFixed(2)}s, savedTime=${savedTime.toFixed(2)}s`);
                log(`[DRY-RUN] Time windows: SPA=${timeSinceSpaNavigation}ms ago (${isRecentSpaNavigation ? 'RECENT' : 'OLD'}), ContentChange=${timeSinceSimulatedContentChange}ms ago (${isRecentSimulatedContentChange ? 'RECENT' : 'OLD'})`);

                if (Math.abs(currentTimeAfterMetadata - savedTime) > tolerance) {
                    // CURRENT LOGIC (time-based SPA navigation)
                    if (isRecentSpaNavigation) {
                        log(`[CURRENT] Recent SPA navigation (${timeSinceSpaNavigation}ms ago), restoring from storage → ${savedTime.toFixed(2)}s (YouTube current=${currentTimeAfterMetadata.toFixed(2)}s)`);
                        video.currentTime = savedTime;
                    } else {
                        // Not recent SPA navigation - check if it's a mode change
                        if (!video.paused && currentTimeAfterMetadata > savedTime) {
                            log(`[CURRENT] Video is playing and ahead of saved time, likely mode change - skipping restore`);
                        } else {
                            log(`[CURRENT] Restoring from storage → ${savedTime.toFixed(2)}s (YouTube current=${currentTimeAfterMetadata.toFixed(2)}s)`);
                            video.currentTime = savedTime;
                        }
                    }

                    // PROPOSED LOGIC (event-driven content change)
                    if (isRecentSimulatedContentChange) {
                        log(`[PROPOSED] Recent content change (${timeSinceSimulatedContentChange}ms ago), would restore → ${savedTime.toFixed(2)}s`);
                    } else if (!video.paused && currentTimeAfterMetadata > savedTime) {
                        log(`[PROPOSED] Video playing and ahead, likely mode change - would skip restore`);
                    } else {
                        log(`[PROPOSED] Would restore from storage → ${savedTime.toFixed(2)}s`);
                    }
                } else {
                    log(`[BOTH] Skipping manual restore; already near target position (diff=${(currentTimeAfterMetadata - savedTime).toFixed(2)}s)`);
                }

                timestampLoaded = true;

                if (!video.paused) {
                    startSaveInterval();
                }
            } catch (err) {
                log(`[ensureVideoReady] Error:`, err);
                // Don't set timestampLoaded = true on error, so we can retry
            }
        };

        // Initial attempt
        ensureVideoReady().catch(error => {
            log(`[setupVideoTracking] ensureVideoReady failed:`, error);
        });
        
        // Fallback: If video starts playing from 0:00 but we have a saved time, restore it
        // This handles cases where getVideo() failed initially but the video started playing
        const fallbackRestore = async () => {
            // Wait a bit for video to start playing
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Check if we still haven't loaded the timestamp and video is at/near 0:00
            if (!timestampLoaded && video.currentTime < 5 && video.readyState >= 1) {
                try {
                    const videoId = getVideoId();
                    if (!videoId) return;
                    
                    log(`[fallbackRestore] Video playing from ${video.currentTime.toFixed(1)}s, attempting restore...`);
                    const record = await ytStorage.getVideo(videoId);
                    
                    if (record && record.time && record.time > 30) {
                        // Only restore if saved time is significant (>30s)
                        log(`[fallbackRestore] Restoring to ${record.time.toFixed(1)}s`);
                        video.currentTime = record.time;
                        timestampLoaded = true;
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

        // Event handlers with minimal logging
        addTrackedEventListener(video, 'play', async () => {
            // Start save interval as usual
            startSaveInterval();

            // ENHANCED PLAYLIST AUTOPLAY DETECTION
            // Check if this might be playlist autoplay that bypassed URL timestamp
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
                // This might be playlist autoplay with meaningful history - delay timing restoration
                log(`[PLAYLIST] Detected potential autoplay in playlist context (${timeSinceNavigation}ms after navigation) with saved time ${record.time.toFixed(1)}s`);

                // Wait a bit for autoplay to settle, then restore timing if still near start
                setTimeout(async () => {
                    if (!timestampLoaded && video.currentTime < 10) {
                        log('[PLAYLIST] Autoplay detected, attempting delayed timing restoration via ensureVideoReady');
                        await ensureVideoReady();
                    }
                }, 1500); // Wait 1.5s for autoplay to complete
            }

            // Fallback restoration check: only when we have significant saved time
            if (hasSignificantHistory) {
                const savedTime = record.time;
                const currentTime = video.currentTime;
                
                // If playing from near beginning (0-5s) but saved time is much higher
                if (currentTime < 5) {
                    log(`[FALLBACK] Video playing from ${currentTime.toFixed(1)}s but saved time is ${savedTime.toFixed(1)}s, considering restoration`);
                    // Small delay to avoid interrupting YouTube's own restoration
                    setTimeout(() => {
                        if (video.currentTime < 5) { // Double-check it wasn't restored
                            video.currentTime = savedTime;
                            log(`[FALLBACK] Restored to ${savedTime.toFixed(1)}s`);
                        }
                    }, 500);
                }
            }
        });
        addTrackedEventListener(video, 'pause', () => {
            if (saveIntervalId) {
                clearInterval(saveIntervalId);
                saveIntervalId = null;
            }
            debouncedSave();
        });
        addTrackedEventListener(video, 'timeupdate', () => {
            const currentTime = Math.floor(video.currentTime);
            const interval = window.location.pathname.startsWith('/shorts/') ? 5 : 15;
            if (currentTime > 0 && currentTime % interval === 0) debouncedSave();
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

        // ENHANCED VIDEO CHANGE DETECTION
        // Detect video content changes (especially for playlist navigation)
        addTrackedEventListener(video, 'loadstart', () => {
            simulatedLastContentChangeTime = Date.now();
            log(`[VIDEO] Video loadstart detected - content change at ${simulatedLastContentChangeTime}`);

            // Check if this is a playlist video change
            const urlParams = new URLSearchParams(window.location.search);
            const playlistId = urlParams.get('list');
            const currentVideoId = getVideoId();

            if (playlistId && currentVideoId && currentVideoId !== lastProcessedVideoId) {
                log(`[VIDEO] Playlist video change detected: ${lastProcessedVideoId} → ${currentVideoId} in playlist ${playlistId}`);
                handlePlaylistNavigation(currentVideoId);
            }
        });

        addTrackedEventListener(video, 'emptied', () => {
            simulatedLastContentChangeTime = Date.now();
            log(`[DRY-RUN] Video emptied detected - content change at ${simulatedLastContentChangeTime}`);
        });

        // Add src attribute observer for dry-run logging
        const dryRunSrcObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'src') {
                    simulatedLastContentChangeTime = Date.now();
                    log(`[DRY-RUN] Video src changed - content change at ${simulatedLastContentChangeTime}`);
                }
            });
        });
        dryRunSrcObserver.observe(video, { attributes: true, attributeFilter: ['src'] });
        addTrackedObserver(video, dryRunSrcObserver);

        // FIX: Start save interval immediately if video is already playing
        // This handles SPA navigation where video auto-starts before listeners are attached
        if (!video.paused && !saveIntervalId) {
            log('[SPA] Video already playing during setup, starting save interval immediately');
            startSaveInterval();
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

        // Update processed video ID
        lastProcessedVideoId = newVideoId;
        lastSpaNavigationTime = Date.now();

        // CRITICAL: Clear any inherited timing from previous playlist video
        const existingVideo = document.querySelector('video');
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
            existingVideo.dataset.timestampLoaded = 'false';
        }

        // Reset initialization state to allow re-initialization for the new video
        isInitialized = false;

        // Reset timestampLoaded flags for all tracked videos
        trackedVideos.forEach(video => {
            if (!video) return;
            // Clear any explicit timestampLoaded property used by older logic
            if (video.timestampLoaded !== undefined) {
                video.timestampLoaded = false;
            }
            // Clear dataset flag so restoration logic can run again
            if (video.dataset) {
                video.dataset.timestampLoaded = 'false';
            }
        });

        // Stop any existing initialization interval
        if (initChecker) {
            clearInterval(initChecker);
            initChecker = null;
        }

        // Try to find and initialize the video element immediately
        const video = document.querySelector('video');
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
                                if (!trackedVideos.has(video) && video.offsetWidth > 0 && video.offsetHeight > 0) {
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

        // If we're not on a video page, or it's the same video, do nothing.
        if (!videoId || videoId === lastProcessedVideoId) {
            return;
        }
        log(`[SPA] Navigation to new video detected: ${videoId}`);
        lastProcessedVideoId = videoId;
        lastSpaNavigationTime = Date.now(); // Track when navigation occurred

        // CRITICAL: Clear any inherited timing from previous video immediately
        // This prevents new videos from appearing with the previous video's timing
        const existingVideo = document.querySelector('video');
        if (existingVideo) {
            const currentTime = existingVideo.currentTime || 0;
            if (currentTime > 5) {
                log(`[SPA] Clearing inherited timing from previous video (${currentTime}s)`);
                existingVideo.currentTime = 0;
            } else {
                log('[SPA] Skipping timing reset; currentTime already near 0s');
            }
            // Force reload of video data by clearing cached state
            existingVideo.dataset.lastVideoId = '';
            existingVideo.dataset.timestampLoaded = 'false';
            // Also reset any timestampLoaded state
            if (existingVideo.timestampLoaded !== undefined) {
                existingVideo.timestampLoaded = false;
            }
        }

        // Track playlist context for enhanced autoplay handling
        const isPlaylistNavigation = !!new URLSearchParams(window.location.search).get('list');
        if (isPlaylistNavigation) {
            log(`[SPA] Playlist navigation detected - will use enhanced autoplay timing restoration`);
        }

        // Reset the main initialization flag to allow re-initialization for the new page.
        isInitialized = false;
        
        // Reset timestampLoaded flags for all tracked videos to allow restoration retry.
        // This is critical for SPA navigation where videos might load before getVideo() succeeds.
        trackedVideos.forEach(video => {
            if (!video) return;
            if (video.timestampLoaded !== undefined) {
                video.timestampLoaded = false;
            }
            if (video.dataset) {
                video.dataset.timestampLoaded = 'false';
            }
        });

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
                            if (!trackedVideos.has(video) && video.offsetWidth > 0 && video.offsetHeight > 0) {
                                log('[SPA] Video element detected immediately by observer, initializing...');

                                // Enhanced playlist handling: Ensure timing is cleared for new videos
                                if (isPlaylistNavigation) {
                                    log('[SPA] Playlist context: Forcing timing reset for new video element');
                                    video.currentTime = 0;
                                    video.dataset.lastVideoId = '';
                                    video.dataset.timestampLoaded = 'false';
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

        // Fallback timeout-based checking (reduced frequency since observer is primary)
        let spaCheckCount = 0;
        const maxSpaChecks = 3; // Reduced from 5 since observer is primary

        initChecker = setInterval(() => {
            spaCheckCount++;
            log(`[SPA] Fallback check for video element (${spaCheckCount}/${maxSpaChecks})...`);

            if (initializeIfNeeded()) {
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
            // Attach UI toggle if possible
            attachPlaylistIgnoreToggles();
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
                    attachPlaylistIgnoreToggles();
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
                attachPlaylistIgnoreToggles();
            } else {
                log('Failed to save playlist after all retries');
            }
        }
    }

    // Attach playlist ignore toggle in playlist header and sidebar panel
    async function attachPlaylistIgnoreToggles() {
        try {
            const urlParams = new URLSearchParams(window.location.search);
            const playlistId = urlParams.get('list');
            if (!playlistId) return;

            const playlistRecord = await ytStorage.getPlaylist(playlistId);
            const isIgnored = !!playlistRecord?.ignoreVideos;
            log('[Toggle] Preparing toggles for playlist', { playlistId, isIgnored });

            const headerSelectors = [
                'ytd-playlist-header-renderer',
                'ytd-playlist-metadata-header-renderer',
                'yt-page-header-view-model'
            ];
            const panelSelector = 'ytd-playlist-panel-renderer';

            // Utility: search inside possible shadow hosts
            const queryDeep = (root, selector) => {
                try {
                    const el = root.querySelector(selector);
                    if (el) return el;
                } catch (_) {}
                return null;
            };

            const findActionsRow = () => {
                // 1) Try in document
                let row = document.querySelector('.ytFlexibleActionsViewModelActionRow');
                if (row) return row;

                // 2) Try in yt-flexible-actions-view-model shadow
                const flexHost = document.querySelector('yt-flexible-actions-view-model');
                if (flexHost && flexHost.shadowRoot) {
                    row = queryDeep(flexHost.shadowRoot, '.ytFlexibleActionsViewModelActionRow');
                    if (row) return row;
                }

                // 3) Try under yt-page-header-view-model shadow
                const headerHost = document.querySelector('yt-page-header-view-model');
                if (headerHost && headerHost.shadowRoot) {
                    row = queryDeep(headerHost.shadowRoot, '.ytFlexibleActionsViewModelActionRow');
                    if (row) return row;
                }

                return null;
            };

            // Helper to create or update a toggle inside a container
            const ensureToggleIn = (container) => {
                if (!container) return;
                try {
                    // Make container positioned so absolute child works
                    const stylePos = window.getComputedStyle(container).position;
                    if (stylePos === 'static') {
                        container.style.position = 'relative';
                    }
                    log('[Toggle] ensureToggleIn container matched', container.tagName || 'node');
                    let btn = container.querySelector('.ytvht-ignore-toggle');
                    if (!btn) {
                        btn = document.createElement('button');
                        btn.className = 'ytvht-ignore-toggle';
                        btn.type = 'button';
                        container.appendChild(btn);
                        log('[Toggle] Inserted sidebar/context button');
                    }
                    const setBtnState = (pressed) => {
                        btn.setAttribute('aria-pressed', pressed ? 'true' : 'false');
                        btn.textContent = pressed ? (chrome.i18n?.getMessage('content_toggle_paused') || 're:Watch — History paused. Click to activate') : (chrome.i18n?.getMessage('content_toggle_pause') || 're:Watch — Click to pause history');
                        btn.title = pressed ? (chrome.i18n?.getMessage('content_toggle_paused_title') || 're:Watch — History is paused for this playlist. Click to activate tracking') : (chrome.i18n?.getMessage('content_toggle_pause_title') || 're:Watch — Click to pause history for this playlist');
                    };
                    setBtnState(isIgnored);

                    btn.onclick = async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        try {
                            const existing = await ytStorage.getPlaylist(playlistId);
                            const toggled = !(existing?.ignoreVideos);
                            const merged = {
                                ...(existing || {}),
                                playlistId,
                                url: `https://www.youtube.com/playlist?list=${playlistId}`,
                                ignoreVideos: toggled,
                                lastUpdated: Date.now(),
                                timestamp: existing?.timestamp || Date.now()
                            };
                            await ytStorage.setPlaylist(playlistId, merged);
                            setBtnState(toggled);
                        } catch (err) {
                            // no-op on failure
                        }
                    };
                } catch (err) {
                    // silent
                }
            };

            // Helper to create/update a header-row toggle placed under YT buttons
            const ensureHeaderToggle = (headerEl) => {
                if (!headerEl) return;
                try {
                    // Prefer placing after actions row if we can find it
                    let actionsEl = findActionsRow();
                    if (!actionsEl) {
                        // Fallback selectors in light DOM
                        const actionSelectors = [
                            '#primary-actions',
                            '#actions',
                            '#top-level-buttons-computed',
                            '.actions'
                        ];
                        for (const sel of actionSelectors) {
                            const el = headerEl.querySelector(sel);
                            if (el) { actionsEl = el; log('[Toggle] Actions row matched selector', sel); break; }
                        }
                    }

                    let btn;
                    if (actionsEl) {
                        // Place on its own line AFTER the actions row
                        let row = actionsEl.parentNode?.querySelector('.ytvht-ignore-row');
                        if (!row) {
                            row = document.createElement('div');
                            row.className = 'ytvht-ignore-row';
                            if (actionsEl.parentNode) {
                                actionsEl.parentNode.insertBefore(row, actionsEl.nextSibling);
                            } else {
                                headerEl.appendChild(row);
                            }
                            log('[Toggle] Inserted header row after actions');
                        }
                        btn = row.querySelector('.ytvht-ignore-toggle');
                        if (!btn) {
                            btn = document.createElement('button');
                            btn.className = 'ytvht-ignore-toggle header';
                            btn.type = 'button';
                            row.appendChild(btn);
                            log('[Toggle] Inserted header button in its own row');
                        }
                    } else {
                        // Fallback: dedicated row below actions
                        let row = headerEl.querySelector('.ytvht-ignore-row');
                        if (!row) {
                            row = document.createElement('div');
                            row.className = 'ytvht-ignore-row';
                            headerEl.appendChild(row);
                            log('[Toggle] Inserted header row at end of header (no actions found)');
                        }
                        btn = row.querySelector('.ytvht-ignore-toggle');
                        if (!btn) {
                            btn = document.createElement('button');
                            btn.className = 'ytvht-ignore-toggle header';
                            btn.type = 'button';
                            row.appendChild(btn);
                            log('[Toggle] Inserted header button in fallback row');
                        }
                    }

                    const setBtnState = (pressed) => {
                        btn.setAttribute('aria-pressed', pressed ? 'true' : 'false');
                        btn.textContent = pressed ? (chrome.i18n?.getMessage('content_toggle_paused') || 're:Watch — History paused. Click to activate') : (chrome.i18n?.getMessage('content_toggle_pause') || 're:Watch — Click to pause history');
                        btn.title = pressed ? (chrome.i18n?.getMessage('content_toggle_paused_title') || 're:Watch — History is paused for this playlist. Click to activate tracking') : (chrome.i18n?.getMessage('content_toggle_pause_title') || 're:Watch — Click to pause history for this playlist');
                    };
                    setBtnState(isIgnored);

                    btn.onclick = async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        try {
                            const existing = await ytStorage.getPlaylist(playlistId);
                            const toggled = !(existing?.ignoreVideos);
                            const merged = {
                                ...(existing || {}),
                                playlistId,
                                url: `https://www.youtube.com/playlist?list=${playlistId}`,
                                ignoreVideos: toggled,
                                lastUpdated: Date.now(),
                                timestamp: existing?.timestamp || Date.now()
                            };
                            await ytStorage.setPlaylist(playlistId, merged);
                            setBtnState(toggled);
                        } catch (err) {
                            // silent
                        }
                    };
                } catch (err) {
                    // silent
                }
            };

            // Playlist page header(s) — place below the action buttons
            for (const sel of headerSelectors) {
                const header = document.querySelector(sel);
                if (header) { log('[Toggle] Header matched selector', sel); ensureHeaderToggle(header); }
            }

            // Right sidebar playlist panel on watch page
            const panel = document.querySelector(panelSelector);
            if (panel) { log('[Toggle] Sidebar panel found'); ensureToggleIn(panel); }

            // If still no header toggle, try absolute insertion into yt-page-header-view-model content
            const pageHeader = document.querySelector('yt-page-header-view-model');
            if (pageHeader && !pageHeader.querySelector('.ytvht-ignore-toggle')) {
                log('[Toggle] Fallback inserting into page header');
                ensureHeaderToggle(pageHeader);
            }
        } catch (_) {
            // silent
        }
    }

    // Ensure toggles exist on playlist pages (where no video element may exist)
    function ensurePlaylistIgnoreToggles(retries = 12) {
        try {
            const hasList = new URLSearchParams(window.location.search).get('list');
            if (!hasList) return;

            attachPlaylistIgnoreToggles();

            if (retries > 0) {
                const header = document.querySelector('yt-page-header-view-model, ytd-playlist-header-renderer, ytd-playlist-metadata-header-renderer');
                const headerToggle = header ? header.querySelector('.ytvht-ignore-toggle') : null;
                if (!headerToggle) {
                    const delay = 500;
                    setTimeout(() => ensurePlaylistIgnoreToggles(retries - 1), delay);
                }
            }
        } catch (e) {
            // silent
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

        // Check for regular video links (legacy ids) and generic anchors
        let anchor = thumbnail.querySelector('a#thumbnail[href*="watch?v="], a#video-title[href*="watch?v="]');
        if (anchor) {
            return anchor.href.match(/[?&]v=([^&]+)/)?.[1];
        }

        // New home layout often uses anchors without ids
        anchor = thumbnail.querySelector('a[href*="/watch?v="]');
        if (anchor) {
            return anchor.href.match(/[?&]v=([^&]+)/)?.[1];
        }

        // Some containers expose a data attribute with the id
        const dataVideoId = thumbnail.getAttribute('data-video-id') ||
                            thumbnail.getAttribute('data-context-item-id') ||
                            thumbnail.getAttribute('data-content-id');
        if (dataVideoId && /^[a-zA-Z0-9_-]{11}$/.test(dataVideoId)) {
            return dataVideoId;
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
            const thumbnailContainer = thumbnailElement.querySelector('.yt-lockup-view-model-wiz__content-image') ||
                                       thumbnailElement.querySelector('a[href*="/watch?v="]') ||
                                       thumbnailElement.querySelector('ytd-thumbnail') ||
                                       thumbnailElement.querySelector('#thumbnail');
            if (thumbnailContainer) {
                targetElement = thumbnailContainer;
            } else {
                // Fallback to the entire tile to ensure visibility on new layouts
                targetElement = thumbnailElement;
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
            const inner = thumbnailElement.querySelector('ytd-thumbnail, a#thumbnail, a[href*="/watch?v="]');
            if (inner) {
                targetElement = inner;
            } else {
                // As a last resort, overlay the element itself
                targetElement = thumbnailElement;
            }
        }

        // Ensure the target element has relative positioning
        targetElement.style.position = 'relative';

        let label = targetElement.querySelector('.ytvht-viewed-label');
        let progress = targetElement.querySelector('.ytvht-progress-bar');
        let removeBtn = targetElement.querySelector('.ytvht-remove-button');

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

                if (!removeBtn) {
                    removeBtn = document.createElement('button');
                    removeBtn.className = 'ytvht-remove-button';
                    removeBtn.setAttribute('type', 'button');
                    removeBtn.setAttribute('title', 'Remove from YT re:Watch history');
                    removeBtn.textContent = '×';
                    removeBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        ytStorage.removeVideo(videoId).then(() => {
                            label?.remove();
                            progress?.remove();
                            removeBtn?.remove();
                        }).catch(() => {
                            // no-op: silent fail
                        });
                    }, { once: false });
                    targetElement.appendChild(removeBtn);
                }
            } else {
                label?.remove();
                progress?.remove();
                removeBtn?.remove();
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
        // Include new lockup-based tiles on home page
        const mainThumbnails = document.querySelectorAll('ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-video-renderer, yt-lockup-view-model');
        mainThumbnails.forEach(element => processVideoElement(element));

        // Process right column recommendations
        const rightColumnThumbnails = document.querySelectorAll('ytd-compact-video-renderer, ytd-compact-radio-renderer, yt-lockup-view-model');
        rightColumnThumbnails.forEach(element => processVideoElement(element));
    }

    // Enhanced processVideoElement with improved cleanup and debug logging
    function processVideoElement(element) {
        if (!element || !element.isConnected) {
            if (currentSettings?.debug) log('[Overlay] Skipping invalid or disconnected element');
            return;
        }

        // Clean up any existing pending operations for this element
        if (pendingOperations.has(element)) {
            const ops = pendingOperations.get(element);
            if (ops.timeout) {
                if (currentSettings?.debug) log('[Overlay] Clearing existing timeout for element');
                clearTimeout(ops.timeout);
            }
            if (ops.rafId) {
                if (currentSettings?.debug) log('[Overlay] Cancelling existing animation frame for element');
                cancelAnimationFrame(ops.rafId);
            }
            pendingOperations.delete(element);
        }

        const ops = {};

        const process = (retryCount = 0) => {
            if (!element.isConnected) {
                if (currentSettings?.debug) log('[Overlay] Element no longer connected, aborting');
                return;
            }

            const videoId = getVideoIdFromThumbnail(element);
            if (videoId) {
                // YouTube home uses templated/shadow DOM; skip strict HTML containment check
                addViewedLabelToThumbnail(element, videoId);
                return;
            }

            // Retry logic with exponential backoff
            if (retryCount < 2) {
                const delay = 100 * (retryCount + 1);
                // Don't log retry attempts - they're normal behavior
                ops.timeout = setTimeout(() => {
                    ops.timeout = null;
                    process(retryCount + 1);
                }, delay);
                pendingOperations.set(element, ops);
            } // No logging for max retries - normal behavior with YouTube's dynamic content
        };

        // Initial processing - no need to log this
        ops.rafId = requestAnimationFrame(() => {
            ops.rafId = null;
            process();
        });

        pendingOperations.set(element, ops);
    }

    // Add cleanup observer for removed elements
    if (typeof MutationObserver !== 'undefined' && !window.ytvhtCleanupObserver) {
        window.ytvhtCleanupObserver = new MutationObserver((mutations) => {
            if (!currentSettings?.debug) return;

            mutations.forEach((mutation) => {
                mutation.removedNodes.forEach((node) => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        const elements = [node, ...node.querySelectorAll('*')];
                        elements.forEach(el => {
                            if (pendingOperations.has(el)) {
                                // Don't log cleanup of removed elements by default
                                const ops = pendingOperations.get(el);
                                if (ops.timeout) clearTimeout(ops.timeout);
                                if (ops.rafId) cancelAnimationFrame(ops.rafId);
                                pendingOperations.delete(el);
                            }
                        });
                    }
                });
            });
        });

        window.ytvhtCleanupObserver.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Don't log observer startup
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
        } else if (message.type === 'pauseVideoForImport') {
            try {
                const video = document.querySelector('video');
                if (video && !video.paused) {
                    video.pause();
                    log('Paused video for import flow');
                }
                sendResponse({ status: 'success' });
            } catch (error) {
                log('Error pausing video for import:', error);
                sendResponse({ status: 'error', error: error && error.message ? error.message : String(error) });
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

    // Import overlay functionality
    async function runImport(records, playlists, mergeMode) {
        return ytStorage.importRecords(records || [], playlists || [], !!mergeMode);
    }

    function maybeShowImportOverlayFromHash() {
        if (window.location.hash === '#ytlh_import') {
            showImportOverlay();
        }
    }

    function showImportOverlay() {
        if (document.getElementById('ytvhtImportOverlay')) {
            return;
        }
        if (!document.body) {
            return;
        }

        const overlay = document.createElement('div');
        overlay.id = 'ytvhtImportOverlay';
        overlay.style.position = 'fixed';
        overlay.style.inset = '0';
        overlay.style.background = 'rgba(0,0,0,0.4)';
        overlay.style.zIndex = '999999';
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';

        const modal = document.createElement('div');
        modal.style.background = '#222';
        modal.style.color = '#fff';
        modal.style.padding = '20px';
        modal.style.borderRadius = '8px';
        modal.style.minWidth = '360px';
        modal.style.maxWidth = '480px';
        modal.style.boxShadow = '0 4px 16px rgba(0,0,0,0.5)';

        modal.innerHTML = `
            <h3 style="margin-top:0;margin-bottom:12px;">Choose a file to import:</h3>
            <input id="ytvhtImportFile" type="file" accept=".json" style="margin: 10px 0; width: 100%;">
            <div style="margin: 10px 0; font-size: 13px;">
                <label style="margin-right:12px;">
                    <input id="ytvhtImportMerge" type="radio" name="ytvhtImportMode" checked>
                    Merge with existing data
                </label>
                <label>
                    <input id="ytvhtImportReplace" type="radio" name="ytvhtImportMode">
                    Replace existing data
                </label>
            </div>
            <div style="margin-top: 12px; text-align: right;">
                <button id="ytvhtImportCancel" style="margin-right:8px;">Cancel</button>
                <button id="ytvhtImportStart">Import</button>
            </div>
            <div id="ytvhtImportStatus" style="margin-top: 10px; font-size: 12px;"></div>
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        const fileInput = modal.querySelector('#ytvhtImportFile');
        const mergeRadio = modal.querySelector('#ytvhtImportMerge');
        const statusEl = modal.querySelector('#ytvhtImportStatus');

        modal.querySelector('#ytvhtImportCancel').onclick = () => {
            overlay.remove();
            if (window.location.hash === '#ytlh_import') {
                try {
                    history.replaceState(null, '', window.location.pathname + window.location.search);
                } catch (e) {
                    log('Error clearing import hash:', e);
                }
            }
        };

        modal.querySelector('#ytvhtImportStart').onclick = async () => {
            const file = fileInput.files && fileInput.files[0];
            if (!file) {
                statusEl.textContent = 'Please choose a JSON file.';
                return;
            }

            try {
                statusEl.textContent = 'Reading file...';
                const text = await file.text();
                const data = JSON.parse(text);

                let records = [];
                let playlists = [];
                let mergeMode = !!mergeRadio.checked;

                if (data && typeof data === 'object' && data.history) {
                    if (Array.isArray(data.history)) {
                        records = data.history;
                    } else if (typeof data.history === 'object') {
                        records = Object.values(data.history);
                    } else {
                        throw new Error('Invalid file format: unexpected history structure');
                    }

                    if (Array.isArray(data.playlists)) {
                        playlists = data.playlists;
                    } else if (data.playlists && typeof data.playlists === 'object') {
                        playlists = Object.values(data.playlists);
                    }
                } else if (Array.isArray(data)) {
                    records = data;
                    mergeMode = false;
                } else {
                    throw new Error('Invalid file format: expected an array of videos or an object with history/playlists');
                }

                if (!records.length && !playlists.length) {
                    statusEl.textContent = 'No videos or playlists found in file.';
                    return;
                }

                statusEl.textContent = 'Importing...';

                try {
                    const response = await runImport(records, playlists, mergeMode);

                    if (response && response.status === 'success') {
                        statusEl.textContent =
                            `Import complete: ${response.importedVideos} videos, ` +
                            `${response.importedPlaylists} playlists.`;
                    } else {
                        const errorMsg = response && response.error ? response.error : 'Unknown error';
                        statusEl.textContent = `Import failed: ${errorMsg}`;
                        console.error('Import failed:', errorMsg);
                    }
                } catch (importError) {
                    console.error('Import overlay error:', importError);
                    let errorMsg = importError.message || 'Unknown error';
                    
                    // Provide user-friendly error messages
                    if (errorMsg.includes('Extension context invalidated') || errorMsg.includes('Background script')) {
                        errorMsg = 'Extension context lost. Please reload the extension and try again.';
                    } else if (errorMsg.includes('IndexedDB')) {
                        errorMsg = 'IndexedDB not available. Please reload the extension.';
                    }
                    
                    statusEl.textContent = `Error: ${errorMsg}`;
                }
            } catch (err) {
                console.error('Import overlay error:', err);
                statusEl.textContent = `Error: ${err.message || 'Unknown error'}`;
            }
        };
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

            // Intercept video link clicks to add timestamps
            interceptVideoLinkClicks();

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

    // ENHANCED PLAYLIST NAVIGATION DETECTION
    // Detect playlist video changes that don't trigger yt-navigate-finish
    let lastPlaylistVideoId = null;
    playlistNavigationCheckInterval = setInterval(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const playlistId = urlParams.get('list');
        const currentVideoId = getVideoId();

        // Only monitor if we're in a playlist
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
            // Not in a playlist anymore
            lastPlaylistVideoId = null;
        }
    }, 500); // Check every 500ms for playlist changes

    // Periodic URL checking as fallback (every 500ms)
    urlCheckIntervalId = setInterval(checkUrlChange, 500);

    // Try additional YouTube navigation events
    window.addEventListener('yt-page-data-updated', () => {
        log('[NAVIGATION] yt-page-data-updated event detected');
        checkUrlChange();
    });

    // Debounced URL check for history API changes
    function debouncedUrlCheck() {
        if (historyApiTimeout) clearTimeout(historyApiTimeout);
        historyApiTimeout = setTimeout(() => {
            checkUrlChange();
            historyApiTimeout = null;
        }, 10);
    }

    // Listen for history API changes
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

    // Also ensure playlist toggles on direct playlist pages
    ensurePlaylistIgnoreToggles();

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

    // Expose internal navigation helpers for tests only.
    // This is a no-op in production because __YTVHT_TEST__ is not defined.
    if (typeof window !== 'undefined' && window.__YTVHT_TEST__) {
        window.__YTVHT_TEST__.navigation = {
            handleSpaNavigation,
            handlePlaylistNavigation,
            checkUrlChange,
            getLastProcessedVideoId: () => lastProcessedVideoId
        };
        window.__YTVHT_TEST__.core = {
            saveTimestamp,
            saveShortsTimestamp
        };
    }
})();
