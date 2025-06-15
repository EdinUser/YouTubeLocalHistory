(function() {
    'use strict';

    const DB_NAME = 'YouTubeHistoryDB';
    const DB_VERSION = 3;
    const STORE_NAME = 'videoHistory';
    const DEBUG = false;
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
    function savePlaylistInfo(playlistInfo = null) {
        const info = playlistInfo || getPlaylistInfo();
        if (!info) return;

        log('Saving playlist info:', info);
        
        openDBWithMigration().then(database => {
            db = database;
            const transaction = db.transaction(['playlistHistory'], 'readwrite');
            const store = transaction.objectStore('playlistHistory');
            
            const request = store.put(info);
            request.onsuccess = function() {
                log('Playlist info saved successfully:', info);
            };
            request.onerror = function(event) {
                log('Error saving playlist info:', event.target.error);
            };
        }).catch(error => {
            log('Error saving playlist info:', error);
        });
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

    // Load settings from IndexedDB
    function loadSettings() {
        return new Promise((resolve, reject) => {
            openDBWithMigration().then(database => {
                db = database;
                const transaction = db.transaction(['settings'], 'readonly');
                const store = transaction.objectStore('settings');
                const request = store.get('userSettings');
                request.onsuccess = function() {
                    let settings = request.result?.settings || {};
                    let updated = false;
                    for (const key in DEFAULT_SETTINGS) {
                        if (!(key in settings)) {
                            settings[key] = DEFAULT_SETTINGS[key];
                            updated = true;
                        }
                    }
                    if (updated) {
                        const writeTx = db.transaction(['settings'], 'readwrite');
                        const writeStore = writeTx.objectStore('settings');
                        writeStore.put({ id: 'userSettings', settings });
                    }
                    currentSettings = settings;
                    resolve(settings);
                };
                request.onerror = function() {
                    reject(request.error);
                };
            }).catch(reject);
        });
    }

    // Load and set the saved timestamp
    function loadTimestamp() {
        const videoId = getVideoId();
        if (!videoId) {
            log('No video ID found in URL.');
            return;
        }

        log(`Attempting to load timestamp for video ID: ${videoId} from URL: ${window.location.href}`);

        openDBWithMigration().then(database => {
            db = database;
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(videoId);

            request.onsuccess = function(event) {
                const record = event.target.result;
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
                            video.addEventListener('loadedmetadata', setTime, { once: true });
                        }
                    } else {
                        log('No video element found.');
                    }
                } else {
                    log('No record found for video ID:', videoId);
                }
            };

            request.onerror = function(event) {
                log('Error fetching data from IndexedDB:', event.target.error);
            };
        }).catch(error => {
            log('Error loading timestamp:', error);
        });
    }

    // Save the current video timestamp
    function saveTimestamp() {
        if (!db) {
            log('Database not initialized, retrying in 1 second...');
            setTimeout(saveTimestamp, 1000);
            return;
        }

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
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.put(record);

            request.onsuccess = function() {
                log(`Timestamp successfully saved for video ID ${videoId}: ${currentTime}`);
            };

            request.onerror = function(event) {
                log('Error saving record:', event.target.error);
                // Try to reinitialize database and retry
                openDBWithMigration().then(database => {
                    db = database;
                    setTimeout(saveTimestamp, 1000);
                });
            };
        } catch (error) {
            log('Error during save transaction:', error);
            // Try to reinitialize database and retry
            openDBWithMigration().then(database => {
                db = database;
                setTimeout(saveTimestamp, 1000);
            });
        }
    }

    // Update cleanupOldRecords to use currentSettings.autoCleanPeriod
    function cleanupOldRecords() {
        if (!db) return;
        const cutoffTime = Date.now() - (currentSettings.autoCleanPeriod * 24 * 60 * 60 * 1000);
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();
        request.onsuccess = function() {
            const records = request.result;
            records.forEach(record => {
                if (record.timestamp < cutoffTime) {
                    store.delete(record.videoId);
                }
            });
        };
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

        openDBWithMigration().then(database => {
            db = database;
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(videoId);
            request.onsuccess = function() {
                const record = request.result;
                if (record) {
                    const size = OVERLAY_LABEL_SIZE_MAP[currentSettings.overlayLabelSize] || OVERLAY_LABEL_SIZE_MAP.medium;
                    const label = document.createElement('div');
                    label.className = 'ytvht-viewed-label';
                    label.textContent = currentSettings.overlayTitle;
                    label.style.position = 'absolute';
                    label.style.top = '0';
                    label.style.left = '0';
                    label.style.padding = (size.fontSize / 2) + 'px 4px';
                    label.style.backgroundColor = OVERLAY_COLORS[currentSettings.overlayColor];
                    label.style.color = '#fff';
                    label.style.fontSize = size.fontSize + 'px';
                    label.style.fontWeight = 'bold';
                    label.style.zIndex = '2';
                    label.style.borderRadius = '0 0 4px 0';
                    // Add progress bar
                    const progress = document.createElement('div');
                    progress.className = 'ytvht-progress-bar';
                    progress.style.position = 'absolute';
                    progress.style.bottom = '0';
                    progress.style.left = '0';
                    progress.style.height = size.bar + 'px';
                    progress.style.backgroundColor = OVERLAY_COLORS[currentSettings.overlayColor];
                    progress.style.width = `${(record.time / record.duration) * 100}%`;
                    progress.style.zIndex = '2';
                    thumbnailElement.style.position = 'relative';
                    thumbnailElement.appendChild(label);
                    thumbnailElement.appendChild(progress);
                }
            };
        });
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
            if (!isInitialized) {
                log('Not initialized yet, initializing now');
                initializeIfNeeded();
            }
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
        } else if (message.type === 'clearHistory') {
            openDBWithMigration().then(database => {
                db = database;
                const transaction = db.transaction([STORE_NAME], 'readwrite');
                const store = transaction.objectStore(STORE_NAME);
                const request = store.clear();
                
                request.onsuccess = function() {
                    log('History cleared successfully');
                    sendResponse({status: 'success'});
                };
                
                request.onerror = function() {
                    log('Error clearing history');
                    sendResponse({status: 'error'});
                };
            }).catch(error => {
                log('Error opening database:', error);
                sendResponse({status: 'error'});
            });
            return true;
        } else if (message.type === 'deleteRecord') {
            const videoId = message.videoId;
            openDBWithMigration().then(database => {
                db = database;
                const transaction = db.transaction([STORE_NAME], 'readwrite');
                const store = transaction.objectStore(STORE_NAME);
                const request = store.delete(videoId);
                
                request.onsuccess = function() {
                    log('Record deleted successfully:', videoId);
                    sendResponse({status: 'success'});
                };
                
                request.onerror = function() {
                    log('Error deleting record:', videoId);
                    sendResponse({status: 'error'});
                };
            }).catch(error => {
                log('Error opening database:', error);
                sendResponse({status: 'error'});
            });
            return true;
        } else if (message.type === 'getPlaylists') {
            openDBWithMigration().then(database => {
                db = database;
                const transaction = db.transaction(['playlistHistory'], 'readonly');
                const store = transaction.objectStore('playlistHistory');
                const request = store.getAll();
                
                request.onsuccess = function() {
                    log('Sending playlists to popup:', request.result);
                    sendResponse({playlists: request.result});
                };
                
                request.onerror = function() {
                    log('Error getting playlists');
                    sendResponse({playlists: []});
                };
            }).catch(error => {
                log('Error opening database:', error);
                sendResponse({playlists: []});
            });
            return true;
        } else if (message.type === 'deletePlaylist') {
            const playlistId = message.playlistId;
            openDBWithMigration().then(database => {
                db = database;
                const transaction = db.transaction(['playlistHistory'], 'readwrite');
                const store = transaction.objectStore('playlistHistory');
                const request = store.delete(playlistId);
                
                request.onsuccess = function() {
                    log('Playlist deleted successfully:', playlistId);
                    sendResponse({status: 'success'});
                };
                
                request.onerror = function() {
                    log('Error deleting playlist:', playlistId);
                    sendResponse({status: 'error'});
                };
            }).catch(error => {
                log('Error opening database:', error);
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

    // On startup, load settings
    loadSettings().then(settings => {
        currentSettings = settings;
    });
})();

