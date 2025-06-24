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
    const DEBUG = true;
    const SAVE_INTERVAL = 5000; // Save every 5 seconds

    const DEFAULT_SETTINGS = {
        autoCleanPeriod: 90, // days
        paginationCount: 10,
        overlayTitle: 'viewed',
        overlayColor: 'blue',
        overlayLabelSize: 'medium'
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

    function log(message, data) {
        if (DEBUG) {
            console.log('[ythdb]', message, data || '');
        }
    }

    log('YouTube Video History Tracker script is running.');

    // Cleanup function to prevent memory leaks
    function cleanup() {
        log('Cleaning up resources...');
        
        try {
            // Disconnect observers
            if (thumbnailObserver) {
                thumbnailObserver.disconnect();
                thumbnailObserver = null;
            }
            
            if (shortsVideoObserver) {
                shortsVideoObserver.disconnect();
                shortsVideoObserver = null;
            }
            
            // Clear intervals
            if (initChecker) {
                clearInterval(initChecker);
                initChecker = null;
            }
            
            if (saveIntervalId) {
                clearInterval(saveIntervalId);
                saveIntervalId = null;
            }
            
            // Clear timeouts
            if (playlistRetryTimeout) {
                clearTimeout(playlistRetryTimeout);
                playlistRetryTimeout = null;
            }
            
            // Remove message listener
            if (messageListener) {
                chrome.runtime.onMessage.removeListener(messageListener);
                messageListener = null;
            }
            
            // Clean up video event listeners
            trackedVideos.clear();
            videoEventListeners.clear();
        } catch (error) {
            log('Error during cleanup:', error);
        }
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

    // Setup cleanup on page unload only (not both beforeunload and pagehide)
    window.addEventListener('beforeunload', cleanup);

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

    // Load and set the saved timestamp
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

                    // Wait for video to be ready
                    const setTime = () => {
                        if (record.time > 0 && record.time < video.duration) {
                            video.currentTime = record.time;
                            log(`Timestamp set for video ID ${videoId}: ${record.time} (duration: ${video.duration})`);
                        } else {
                            log(`Invalid timestamp ${record.time} for video duration ${video.duration}, skipping`);
                        }
                    };

                    if (video.readyState >= 1) {
                        setTime();
                    } else {
                        log('Video not ready, waiting for loadedmetadata event');
                        video.addEventListener('loadedmetadata', setTime, {once: true});
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

    // Save the current video timestamp for Shorts
    async function saveShortsTimestamp() {
        const video = document.querySelector('video');
        if (!video) {
            log('No video element found.');
            return;
        }

        const currentTime = video.currentTime;
        const duration = video.duration;
        const videoId = getVideoId();
        if (!videoId) {
            log('No video ID found.');
            return;
        }

        // Do not update record if timestamp is 0
        if (!currentTime || currentTime === 0) {
            log(`Detected Shorts timestamp 0 for video ID ${videoId}, skipping update.`);
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

        const record = {
            videoId: videoId,
            time: currentTime,
            duration: duration,
            timestamp: Date.now(),
            title: title,
            url: getCleanVideoUrl(),
            isShorts: true // <--- Mark as Shorts for UI filtering
        };

        try {
            await ytStorage.setVideo(videoId, record);
            log(`Shorts timestamp successfully saved for video ID ${videoId}: ${currentTime}`);
        } catch (error) {
            log('Error saving Shorts timestamp:', error);
        }
    }

    // Save the current video timestamp (regular videos)
    async function saveTimestamp() {
        if (window.location.pathname.startsWith('/shorts/')) {
            await saveShortsTimestamp();
            return;
        }

        const video = document.querySelector('video');
        if (!video) {
            log('No video element found.');
            return;
        }

        let currentTime = video.currentTime;
        const duration = video.duration;
        const videoId = getVideoId();
        if (!videoId) {
            log('No video ID found.');
            return;
        }

        // Do not update record if timestamp is 0
        if (!currentTime || currentTime === 0) {
            log(`Detected timestamp 0 for video ID ${videoId}, skipping update.`);
            return;
        }

        // If within last 10 seconds, save as duration - 10 (but not less than 0)
        if (duration && currentTime > duration - 10) {
            const adjustedTime = Math.max(0, duration - 10);
            log(`Current time (${currentTime}) is within last 10s of duration (${duration}), saving as ${adjustedTime}`);
            currentTime = adjustedTime;
        }

        log(`Saving timestamp for video ID ${videoId} at time ${currentTime} (duration: ${duration}) from URL: ${window.location.href}`);

        let title = 'Unknown Title';
        const titleSelectors = [
            'h1.ytd-video-primary-info-renderer',
            'h1.title.style-scope.ytd-video-primary-info-renderer',
            'h1.ytd-reel-player-header-renderer',
            'h1.ytd-reel-player-overlay-renderer',
            'ytd-reel-player-header-renderer h1',
            'ytd-reel-player-overlay-renderer h1',
            'ytd-reel-player-header-renderer yt-formatted-string',
            'ytd-reel-player-overlay-renderer yt-formatted-string',
            '.ytd-reel-player-header-renderer .title',
            '.ytd-reel-player-overlay-renderer .title',
            'ytd-reel-player-header-renderer .title yt-formatted-string',
            'ytd-reel-player-overlay-renderer .title yt-formatted-string'
        ];
        for (const selector of titleSelectors) {
            const element = document.querySelector(selector);
            if (element) {
                const text = element.textContent?.trim();
                if (text && text.length > 0 && text !== 'Unknown Title') {
                    title = text;
                    log(`Found title using selector "${selector}": "${title}"`);
                    break;
                }
            }
        }

        const record = {
            videoId: videoId,
            time: currentTime,
            duration: duration,
            timestamp: Date.now(),
            title: title,
            url: getCleanVideoUrl()
        };

        try {
            await ytStorage.setVideo(videoId, record);
            log(`Timestamp successfully saved for video ID ${videoId}: ${currentTime}`);
        } catch (error) {
            log('Error saving timestamp:', error);
        }
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

    // Start periodic saving
    function startSaveInterval() {
        if (saveIntervalId) {
            clearInterval(saveIntervalId);
        }
        saveTimestamp(); // Save immediately
        saveIntervalId = setInterval(saveTimestamp, SAVE_INTERVAL);
    }

    // Set up video tracking
    function setupVideoTracking(video) {
        if (trackedVideos.has(video)) {
            log('Video already tracked, skipping setup.');
            return;
        }
        trackedVideos.add(video);

        log('Setting up video tracking for video element:', video);

        let timestampLoaded = false;

        // Function to ensure video is ready before loading timestamp
        const ensureVideoReady = () => {
            if (timestampLoaded) {
                log('Timestamp already loaded, skipping');
                return;
            }

            if (video.readyState >= 1) {
                log('Video is ready, loading timestamp');
                loadTimestamp();
                timestampLoaded = true;
            } else {
                log('Video not ready, waiting for loadedmetadata event');
                const metadataHandler = () => {
                    if (!timestampLoaded) {
                        log('Video metadata loaded, loading timestamp');
                        loadTimestamp();
                        timestampLoaded = true;
                    }
                };
                addTrackedEventListener(video, 'loadedmetadata', metadataHandler);
            }
        };

        // Try to load timestamp immediately
        ensureVideoReady();

        // Also try again after a short delay to handle late initialization
        setTimeout(ensureVideoReady, 1000);

        // Start saving timestamp periodically when the video starts playing
        const playHandler = () => {
            log('Video started playing. Starting save interval.');
            startSaveInterval();
        };
        addTrackedEventListener(video, 'play', playHandler);

        // Stop saving timestamp when the video is paused
        const pauseHandler = () => {
            log('Video paused. Clearing save interval.');
            if (saveIntervalId) {
                clearInterval(saveIntervalId);
                saveIntervalId = null;
            }
            saveTimestamp(); // Save timestamp when paused
        };
        addTrackedEventListener(video, 'pause', pauseHandler);

        // Save timestamp when video progress changes significantly
        const timeupdateHandler = () => {
            const currentTime = Math.floor(video.currentTime);
            if (currentTime % 30 === 0) { // Save every 30 seconds
                saveTimestamp();
            }
        };
        addTrackedEventListener(video, 'timeupdate', timeupdateHandler);

        // Handle seeking
        const seekingHandler = () => {
            log('Video seeking');
            if (saveIntervalId) {
                clearInterval(saveIntervalId);
                saveIntervalId = null;
            }
        };
        addTrackedEventListener(video, 'seeking', seekingHandler);

        const seekedHandler = () => {
            log('Video seeked');
            saveTimestamp();
            if (!video.paused) {
                startSaveInterval();
            }
        };
        addTrackedEventListener(video, 'seeked', seekedHandler);

        // Save on unload
        const beforeunloadHandler = () => {
            log('Page unloading, saving final timestamp');
            saveTimestamp();
        };
        addTrackedEventListener(window, 'beforeunload', beforeunloadHandler);
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
                // Ensure storage is ready
                await ytStorage.ensureMigrated();
                log('Storage initialized successfully');

                // Inject CSS to avoid CSP issues
                injectCSS();

                setupVideoTracking(video);
                tryToSavePlaylist();
                showExtensionInfo();

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

    // Try to save playlist with retries
    function tryToSavePlaylist(retries = 10) {
        log(`Trying to save playlist (${retries} retries left)...`);
        const playlistInfo = getPlaylistInfo();
        if (playlistInfo) {
            log('Playlist info found, saving...');
            savePlaylistInfo(playlistInfo);
        } else if (retries > 0) {
            log(`Playlist title not found, will retry in 1.5 seconds... (${retries} retries left)`);
            playlistRetryTimeout = setTimeout(() => {
                tryToSavePlaylist(retries - 1);
            }, 1500);
        } else {
            log('Failed to save playlist after all retries');
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
    function addViewedLabelToThumbnail(thumbnailElement, videoId) {
        if (!thumbnailElement || !videoId) return;

        // Only add overlays to ytd-thumbnail or its anchor child
        if (thumbnailElement.tagName !== 'YTD-THUMBNAIL' && !(thumbnailElement.tagName === 'A' && thumbnailElement.id === 'thumbnail')) {
            // Try to find the ytd-thumbnail or anchor inside
            const inner = thumbnailElement.querySelector('ytd-thumbnail, a#thumbnail');
            if (inner) {
                thumbnailElement = inner;
            } else {
                return; // Not a valid target
            }
        }

        // Remove all existing overlays in this thumbnail
        thumbnailElement.querySelectorAll('.ytvht-viewed-label, .ytvht-progress-bar').forEach(el => el.remove());

        ytStorage.getVideo(videoId).then(record => {
            if (record) {
                const size = OVERLAY_LABEL_SIZE_MAP[currentSettings.overlayLabelSize] || OVERLAY_LABEL_SIZE_MAP.medium;
                const color = OVERLAY_COLORS[currentSettings.overlayColor];

                // Create custom CSS for this specific overlay with current settings
                updateOverlayCSS(size, color);

                const label = document.createElement('div');
                label.className = 'ytvht-viewed-label';
                label.textContent = currentSettings.overlayTitle;

                // Add progress bar
                const progress = document.createElement('div');
                progress.className = 'ytvht-progress-bar';
                progress.style.width = `${(record.time / record.duration) * 100}%`;

                thumbnailElement.style.position = 'relative';
                thumbnailElement.appendChild(label);
                thumbnailElement.appendChild(progress);
            }
        }).catch(error => {
            log('Error getting video record for thumbnail:', error);
        });
    }

    // Watch for new thumbnails being added to the page
    thumbnailObserver = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    // Look for thumbnails in all possible layouts (regular videos and Shorts)
                    const thumbnails = node.querySelectorAll('ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-thumbnail, ytd-compact-video-renderer, ytd-reel-item-renderer');
                    thumbnails.forEach((thumbnail) => {
                        // Check for regular video links
                        let anchor = thumbnail.querySelector('a#thumbnail[href*="watch?v="]');
                        if (anchor) {
                            const videoId = anchor.href.match(/[?&]v=([^&]+)/)?.[1];
                            if (videoId) {
                                addViewedLabelToThumbnail(thumbnail, videoId);
                            }
                        } else {
                            // Check for Shorts links
                            anchor = thumbnail.querySelector('a[href*="/shorts/"]');
                            if (anchor) {
                                const videoId = anchor.href.match(/\/shorts\/([^\/\?]+)/)?.[1];
                                if (videoId) {
                                    addViewedLabelToThumbnail(thumbnail, videoId);
                                }
                            }
                        }
                    });
                }
            });
            
            // Check for removed video elements and clean up their listeners
            mutation.removedNodes.forEach((node) => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    // Check if the removed node is a video element
                    if (node.tagName === 'VIDEO') {
                        cleanupVideoListeners(node);
                    }
                    // Also check for video elements within the removed node
                    const videos = node.querySelectorAll('video');
                    videos.forEach(video => {
                        cleanupVideoListeners(video);
                    });
                }
            });
        });
    });

    // Process any existing thumbnails
    function processExistingThumbnails() {
        const thumbnails = document.querySelectorAll('ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-thumbnail, ytd-compact-video-renderer, ytd-reel-item-renderer');
        thumbnails.forEach((thumbnail) => {
            // Check for regular video links
            let anchor = thumbnail.querySelector('a#thumbnail[href*="watch?v="]');
            if (anchor) {
                const videoId = anchor.href.match(/[?&]v=([^&]+)/)?.[1];
                if (videoId) {
                    addViewedLabelToThumbnail(thumbnail, videoId);
                }
            } else {
                // Check for Shorts links
                anchor = thumbnail.querySelector('a[href*="/shorts/"]');
                if (anchor) {
                    const videoId = anchor.href.match(/\/shorts\/([^\/\?]+)/)?.[1];
                    if (videoId) {
                        addViewedLabelToThumbnail(thumbnail, videoId);
                    }
                }
            }
        });
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

    // Initialize everything
    async function initialize() {
        injectCSS();

        try {
            const settings = await loadSettings() || DEFAULT_SETTINGS;
            currentSettings = settings;

            updateOverlayCSS(
                OVERLAY_LABEL_SIZE_MAP[currentSettings.overlayLabelSize] || OVERLAY_LABEL_SIZE_MAP.medium,
                OVERLAY_COLORS[currentSettings.overlayColor] || OVERLAY_COLORS.blue
            );

            log('Settings loaded:', settings);

            // Process existing thumbnails after settings are loaded
            setTimeout(() => {
                processExistingThumbnails();
            }, 1000);
        } catch (error) {
            log('Error loading settings:', error);
            currentSettings = DEFAULT_SETTINGS;
        }
    }

    // Initialize on startup
    initialize();
})();
