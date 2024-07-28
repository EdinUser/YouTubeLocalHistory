// ==UserScript==
// @name         YouTube Video History Tracker with IndexedDB
// @namespace    http://tampermonkey.net/
// @version      1.12
// @description  Store YouTube video timestamps using IndexedDB for larger storage capacity without expiry
// @author       Edin User
// @match        https://www.youtube.com/watch*
// @match        https://www.youtube.com/embed/*
// @match        https://m.youtube.com/watch*
// @grant        none
// @homepage     https://github.com/EdinUser/YouTubeLocalHistory
// ==/UserScript==

(function() {
    'use strict';

    const DB_NAME = 'YouTubeHistoryDB';
    const DB_VERSION = 1;
    const STORE_NAME = 'videoHistory';
    const DEBUG = false;
    const SAVE_INTERVAL = 5000; // Save every 5 seconds
    const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // Clean up once a day
    const RECORD_LIFETIME = 3 * 30 * 24 * 60 * 60 * 1000; // 3 months in milliseconds
    let db;
    let saveIntervalId;

    function log(message, data) {
        if (DEBUG) {
            console.log(message, data || '');
        }
    }

    log('YouTube Video History Tracker script is running.');

    // Extract video ID from URL
    function getVideoId() {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get('v') || window.location.pathname.split('/').pop();
    }

    // Open the IndexedDB
    function openDB() {
        return new Promise((resolve, reject) => {
            log('Opening IndexedDB...');
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = function(event) {
                db = event.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'videoId' });
                }
                log('Database upgrade needed and completed.');
            };

            request.onsuccess = function(event) {
                db = event.target.result;
                log('Database opened successfully.');
                resolve();
            };

            request.onerror = function(event) {
                log('IndexedDB error:', event.target.errorCode);
                reject(event.target.errorCode);
            };
        });
    }

    // Save the current video timestamp
    function saveTimestamp() {
        const video = document.querySelector('video');
        if (video) {
            const currentTime = video.currentTime;
            const videoId = getVideoId();
            if (videoId) {
                log(`Saving timestamp for video ID ${videoId} at time ${currentTime}`);
                const transaction = db.transaction([STORE_NAME], 'readwrite');
                const store = transaction.objectStore(STORE_NAME);
                const record = { videoId: videoId, time: currentTime, timestamp: Date.now() };
                const request = store.put(record);

                request.onsuccess = function() {
                    log(`Timestamp successfully saved for video ID ${videoId}: ${currentTime}`);
                };

                request.onerror = function(event) {
                    log('Error saving record:', event.target.errorCode);
                };
            } else {
                log('No video ID found.');
            }
        } else {
            log('No video element found.');
        }
    }

    // Load and set the saved timestamp
    function loadTimestamp() {
        const videoId = getVideoId();
        if (videoId) {
            log(`Loading timestamp for video ID ${videoId}`);
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(videoId);

            request.onsuccess = function(event) {
                const record = event.target.result;
                if (record) {
                    const video = document.querySelector('video');
                    if (video) {
                        log(`Found record for video ID ${videoId}:`, record);
                        video.currentTime = record.time;
                        log(`Timestamp loaded for video ID ${videoId}: ${record.time}`);
                    } else {
                        log('No video element found.');
                    }
                } else {
                    log('No record found for video ID:', videoId);
                }
            };

            request.onerror = function(event) {
                log('Error fetching data from IndexedDB:', event.target.errorCode);
            };
        } else {
            log('No video ID found in URL.');
        }
    }

    // Remove records older than RECORD_LIFETIME
    function cleanupOldRecords() {
        const threshold = Date.now() - RECORD_LIFETIME;
        log('Cleaning up records older than', new Date(threshold));
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.openCursor();

        request.onsuccess = function(event) {
            const cursor = event.target.result;
            if (cursor) {
                if (cursor.value.timestamp < threshold) {
                    log('Deleting old record:', cursor.value);
                    cursor.delete();
                }
                cursor.continue();
            } else {
                log('Old record cleanup complete.');
            }
        };

        request.onerror = function(event) {
            log('Error during cleanup:', event.target.errorCode);
        };
    }

    // Start the interval to save the timestamp every few seconds
    function startSaveInterval() {
        if (saveIntervalId) {
            clearInterval(saveIntervalId);
        }
        saveIntervalId = setInterval(() => {
            saveTimestamp();
        }, SAVE_INTERVAL);
    }

    // Initialize and set up event listeners
    function initialize() {
        const video = document.querySelector('video');
        if (video) {
            log('Video element found on page. Setting up event listeners.');

            // Load timestamp when the video is loaded
            video.addEventListener('loadedmetadata', loadTimestamp);

            // Start saving timestamp periodically when the video starts playing
            video.addEventListener('play', () => {
                log('Video started playing. Starting save interval.');
                startSaveInterval();
            });

            // Stop saving timestamp when the video is paused
            video.addEventListener('pause', () => {
                log('Video paused. Clearing save interval.');
                clearInterval(saveIntervalId);
                saveTimestamp(); // Save timestamp when paused
            });

            // Detect clicks on the progress bar
            const progressBar = document.querySelector('.ytp-progress-bar');
            if (progressBar) {
                progressBar.addEventListener('mousedown', () => {
                    log('User interaction started on progress bar (mousedown)');
                    setTimeout(() => {
                        video.pause();
                        saveTimestamp();
                        log('Timestamp saved after user interaction on progress bar (mousedown)');
                        video.play();
                        log('Video resumed after saving timestamp');
                    }, 100); // Delay to ensure the timestamp is correctly set
                });

                progressBar.addEventListener('mouseup', () => {
                    log('User interaction ended on progress bar (mouseup)');
                });

                progressBar.addEventListener('click', () => {
                    log('User clicked on progress bar (click)');
                    setTimeout(() => {
                        video.pause();
                        saveTimestamp();
                        log('Timestamp saved after user clicked on progress bar (click)');
                        video.play();
                        log('Video resumed after saving timestamp');
                    }, 100); // Delay to ensure the timestamp is correctly set
                });

                progressBar.addEventListener('touchstart', () => {
                    log('User touched progress bar (touchstart)');
                    setTimeout(() => {
                        video.pause();
                        saveTimestamp();
                        log('Timestamp saved after user touched progress bar (touchstart)');
                        video.play();
                        log('Video resumed after saving timestamp');
                    }, 100); // Delay to ensure the timestamp is correctly set
                });

                progressBar.addEventListener('touchend', () => {
                    log('User touch ended on progress bar (touchend)');
                });

                log('Event listeners set up on progress bar.');
            } else {
                log('No progress bar found.');
            }
        } else {
            log('No video element found on page.');
        }
    }

    // Use a MutationObserver to wait for the video element
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.addedNodes.length) {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeName === 'VIDEO') {
                        log('Video element added to the page.');
                        observer.disconnect(); // Stop observing once the video is found
                        initialize(); // Initialize the script
                    }
                });
            }
        });
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Open the database and set up cleanup interval
    openDB().then(() => {
        log('Database opened and ready.');
        initialize(); // Attempt to initialize immediately in case the video element is already present
        cleanupOldRecords(); // Perform initial cleanup
        setInterval(cleanupOldRecords, CLEANUP_INTERVAL); // Set up periodic cleanup
    }).catch(error => {
        log('Failed to open IndexedDB:', error);
    });
})();
