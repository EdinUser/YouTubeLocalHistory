(function() {
    'use strict';

    const DB_NAME = 'YouTubeHistoryDB';
    const DB_VERSION = 3; // Increment version for settings store
    const STORE_NAME = 'videoHistory';
    const DEBUG = false;

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
    const SAVE_INTERVAL = 5000; // Save every 5 seconds
    const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // Clean up once a day
    const RECORD_LIFETIME = 3 * 30 * 24 * 60 * 60 * 1000; // 3 months in milliseconds
    const DEFAULT_SETTINGS = {
        autoCleanPeriod: 90, // days
        paginationCount: 10,
        overlayTitle: 'viewed',
        overlayColor: 'blue',
        overlayLabelSize: 'medium'
    };

    // Color mapping for overlay colors
    const OVERLAY_COLORS = {
        blue: '#4285f4',
        red: '#ea4335',
        green: '#34a853',
        purple: '#9c27b0',
        orange: '#ff9800'
    };

    let db;
    let saveIntervalId;
    let isInitialized = false;
    let currentSettings = DEFAULT_SETTINGS;

    function log(message, data) {
        if (DEBUG) {
            console.log('[ythdb]', message, data || '');
        }
    }

    log('YouTube Video History Tracker script is running.');

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
        if (!playlistId) return null;

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
            '#playlist-name'
        ];

        let playlistTitle = null;
        for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element) {
                playlistTitle = element.textContent?.trim();
                if (playlistTitle && playlistTitle !== 'Unknown Playlist') {
                    break;
                }
            }
        }

        if (!playlistTitle || playlistTitle === 'Unknown Playlist') {
            return null;
        }

        return {
            playlistId,
            title: playlistTitle,
            url: `https://www.youtube.com/playlist?list=${playlistId}`,
            timestamp: Date.now()
        };
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

    // Migration-safe DB open/upgrade routine
    function openDBWithMigration() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = function(event) {
                const db = event.target.result;
                log('Database upgrade needed. Creating stores...');

                // Create video history store if it doesn't exist
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'videoId' });
                    log('Created video history store');
                }

                // Create playlist history store if it doesn't exist
                if (!db.objectStoreNames.contains('playlistHistory')) {
                    db.createObjectStore('playlistHistory', { keyPath: 'playlistId' });
                    log('Created playlist history store');
                }

                // Create settings store if it doesn't exist
                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings', { keyPath: 'id' });
                    log('Created settings store');
                }
            };

            request.onsuccess = function(event) {
                const database = event.target.result;
                log('Database opened successfully');
                resolve(database);
            };

            request.onerror = function(event) {
                log('Error opening database:', event.target.error);
                reject(event.target.error);
            };
        });
    }

    // Load settings from storage
    async function loadSettings() {
        try {
            const settings = await ytStorage.getSettings();
            return settings;
        } catch (error) {
            log('Error loading settings:', error);
            return null;
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

    // Save the current video timestamp
    async function saveTimestamp() {
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

        log(`Saving timestamp for video ID ${videoId} at time ${currentTime} (duration: ${duration}) from URL: ${window.location.href}`);

        // Get video title from YouTube's page
        const title = document.querySelector('h1.ytd-video-primary-info-renderer')?.textContent?.trim() ||
                     document.querySelector('h1.title.style-scope.ytd-video-primary-info-renderer')?.textContent?.trim() ||
                     'Unknown Title';

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
            log('Error saving record:', error);
        }
    }

    // Clean up old records based on settings
    async function cleanupOldRecords() {
        const cutoffTime = Date.now() - (currentSettings.autoCleanPeriod * 24 * 60 * 60 * 1000);
        log(`Cleaning up records older than ${new Date(cutoffTime).toISOString()}`);

        try {
            const allVideos = await ytStorage.getAllVideos();
            let deletedCount = 0;

            for (const [videoId, record] of Object.entries(allVideos)) {
                if (record.timestamp < cutoffTime) {
                    await ytStorage.removeVideo(videoId);
                    deletedCount++;
                }
            }

            log(`Cleaned up ${deletedCount} old records`);
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
                video.addEventListener('loadedmetadata', () => {
                    if (!timestampLoaded) {
                        log('Video metadata loaded, loading timestamp');
                        loadTimestamp();
                        timestampLoaded = true;
                    }
                }, { once: true });
            }
        };

        // Try to load timestamp immediately
        ensureVideoReady();

        // Also try again after a short delay to handle late initialization
        setTimeout(ensureVideoReady, 1000);

        // Start saving timestamp periodically when the video starts playing
        video.addEventListener('play', () => {
            log('Video started playing. Starting save interval.');
            startSaveInterval();
        });

        // Stop saving timestamp when the video is paused
        video.addEventListener('pause', () => {
            log('Video paused. Clearing save interval.');
            if (saveIntervalId) {
                clearInterval(saveIntervalId);
                saveIntervalId = null;
            }
            saveTimestamp(); // Save timestamp when paused
        });

        // Save timestamp when video progress changes significantly
        video.addEventListener('timeupdate', () => {
            const currentTime = Math.floor(video.currentTime);
            if (currentTime % 30 === 0) { // Save every 30 seconds
                saveTimestamp();
            }
        });

        // Handle seeking
        video.addEventListener('seeking', () => {
            log('Video seeking');
            if (saveIntervalId) {
                clearInterval(saveIntervalId);
                saveIntervalId = null;
            }
        });

        video.addEventListener('seeked', () => {
            log('Video seeked');
            saveTimestamp();
            if (!video.paused) {
                startSaveInterval();
            }
        });

        // Save on unload
        window.addEventListener('beforeunload', () => {
            log('Page unloading, saving final timestamp');
            saveTimestamp();
        });

        // Handle popup messages
        chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
            if (message.type === 'getHistory') {
                openDBWithMigration().then(database => {
                    db = database;
                    const transaction = db.transaction([STORE_NAME], 'readonly');
                    const store = transaction.objectStore(STORE_NAME);
                    const request = store.getAll();

                    request.onsuccess = function() {
                        log('Sending history to popup:', request.result);
                        sendResponse({history: request.result});
                    };

                    request.onerror = function() {
                        log('Error getting history');
                        sendResponse({history: []});
                    };
                }).catch(error => {
                    log('Error opening database:', error);
                    sendResponse({history: []});
                });
                return true;
            } else if (message.type === 'getSettings') {
                loadSettings().then(settings => {
                    sendResponse({settings: settings});
                }).catch(error => {
                    log('Error loading settings:', error);
                    sendResponse({settings: DEFAULT_SETTINGS});
                });
                return true;
            } else if (message.type === 'updateSettings') {
                currentSettings = message.settings;
                // Reprocess thumbnails with new settings
                processExistingThumbnails();
                sendResponse({status: 'success'});
                return true;
            }
        });
    }

    // Initialize database and set up event listeners
    function initializeIfNeeded() {
        if (isInitialized) {
            return true;
        }

        const video = document.querySelector('video');
        if (video) {
            log('Found video element, initializing...');
            openDBWithMigration().then(database => {
                db = database;
                log('Database initialized successfully');
                setupVideoTracking(video);
                tryToSavePlaylist();
                showExtensionInfo();

                // Start observing for thumbnails and process existing ones
                log('Starting thumbnail observer and processing existing thumbnails.');
                thumbnailObserver.observe(document.body, { childList: true, subtree: true });
                processExistingThumbnails();

                isInitialized = true;
            }).catch(error => {
                log('Error initializing database during video setup:', error);
            });
            return true;
        }
        return false;
    }

    // Try to save playlist with retries
    function tryToSavePlaylist(retries = 10) {
        const playlistInfo = getPlaylistInfo();
        if (playlistInfo) {
            savePlaylistInfo(playlistInfo);
        } else if (retries > 0) {
            log(`Playlist title not found, will retry in 1.5 seconds... (${retries} retries left)`);
            setTimeout(() => {
                tryToSavePlaylist(retries - 1);
            }, 1500);
        }
    }

    // Start observing for video element and playlist changes
    const initChecker = setInterval(() => {
        log('Checking for video element...');
        if (initializeIfNeeded()) {
            log('Initialization successful. Stopping checker.');
            clearInterval(initChecker);
        }
    }, 1000);

    // Initialize immediately and also retry if needed
    initializeIfNeeded();

    // Add "Viewed" label and progress bar to thumbnails
    async function addViewedLabelToThumbnail(thumbnailElement, videoId) {
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

        try {
            const record = await ytStorage.getVideo(videoId);
            if (record) {
                const size = OVERLAY_LABEL_SIZE_MAP[currentSettings.overlayLabelSize] || OVERLAY_LABEL_SIZE_MAP.medium;

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
        } catch (error) {
            log('Error checking video record:', error);
        }
    }

    // Watch for new thumbnails being added to the page
    const thumbnailObserver = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    // Look for thumbnails in all possible layouts
                    const thumbnails = node.querySelectorAll('ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-thumbnail, ytd-compact-video-renderer');
                    thumbnails.forEach((thumbnail) => {
                        const anchor = thumbnail.querySelector('a#thumbnail[href*="watch?v="]');
                        if (anchor) {
                            const videoId = anchor.href.match(/[?&]v=([^&]+)/)?.[1];
                            if (videoId) {
                                addViewedLabelToThumbnail(thumbnail, videoId);
                            }
                        }
                    });
                }
            });
        });
    });

    // Process any existing thumbnails
    function processExistingThumbnails() {
        const thumbnails = document.querySelectorAll('ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-thumbnail, ytd-compact-video-renderer');
        thumbnails.forEach((thumbnail) => {
            const anchor = thumbnail.querySelector('a#thumbnail[href*="watch?v="]');
            if (anchor) {
                const videoId = anchor.href.match(/[?&]v=([^&]+)/)?.[1];
                if (videoId) {
                    addViewedLabelToThumbnail(thumbnail, videoId);
                }
            }
        });
    }

    // Handle messages from popup
    chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
        if (message.type === 'getHistory') {
            ytStorage.getAllVideos().then(allVideos => {
                const history = Object.values(allVideos);
                log('Sending history to popup:', history);
                sendResponse({history: history});
            }).catch(error => {
                log('Error getting history:', error);
                sendResponse({history: []});
            });
            return true;
        } else if (message.type === 'getSettings') {
            loadSettings().then(settings => {
                sendResponse({settings: settings});
            }).catch(error => {
                log('Error loading settings:', error);
                sendResponse({settings: DEFAULT_SETTINGS});
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
        }
        return false;
    });

    function showExtensionInfo() {
        // Check if we've already shown the info
        chrome.storage.local.get(['infoShown'], function(result) {
            if (!result.infoShown) {
                const topLevelButtons = document.querySelector('#top-level-buttons-computed');
                if (!topLevelButtons) return;

                // Create info container
                const infoDiv = document.createElement('div');
                infoDiv.className = 'ythdb-info';
                infoDiv.style.cssText = `
                    position: absolute;
                    top: -120px;
                    right: 0;
                    background: var(--yt-spec-brand-background-primary, #0f0f0f);
                    border: 1px solid var(--yt-spec-text-secondary, #aaa);
                    border-radius: 8px;
                    padding: 12px;
                    width: 300px;
                    z-index: 9999;
                    color: var(--yt-spec-text-primary, #fff);
                    font-size: 14px;
                    box-shadow: 0 4px 8px rgba(0,0,0,0.1);
                `;

                // Add content with more visible styling
                infoDiv.innerHTML = `
                    <div style="display: flex; align-items: start; gap: 12px;">
                        <div style="flex-grow: 1;">
                            <div style="font-weight: 500; margin-bottom: 8px; color: #fff;">📺 YouTube History Tracker Active</div>
                            <div style="color: #aaa; line-height: 1.4;">
                                Your video progress is being tracked! Click the extension icon 
                                <span style="color: #fff; background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px;">↗️</span> 
                                in the toolbar to view your history.
                            </div>
                        </div>
                        <button class="ythdb-close" style="
                            background: none;
                            border: none;
                            padding: 4px 8px;
                            cursor: pointer;
                            color: #aaa;
                            font-size: 20px;
                            opacity: 0.8;
                            transition: opacity 0.2s;
                        ">×</button>
                    </div>
                `;

                // Add close button functionality
                const closeButton = infoDiv.querySelector('.ythdb-close');
                closeButton.addEventListener('mouseover', () => {
                    closeButton.style.opacity = '1';
                });
                closeButton.addEventListener('mouseout', () => {
                    closeButton.style.opacity = '0.8';
                });
                closeButton.addEventListener('click', () => {
                    infoDiv.style.display = 'none';
                    // Remember that we've shown the info
                    chrome.storage.local.set({ infoShown: true });
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
        } catch (error) {
            log('Error loading settings:', error);
            currentSettings = DEFAULT_SETTINGS;
        }
    }

    // Initialize on startup
    initialize();
})();

