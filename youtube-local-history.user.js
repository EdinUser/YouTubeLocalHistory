// ==UserScript==
// @name         YouTube Video History Tracker with IndexedDB
// @namespace    http://tampermonkey.net/
// @version      1.10
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
    let db;

    function log(message) {
        if (DEBUG) {
            console.log(message);
        }
    }

    log('YouTube Video History Tracker script is running.');

    // Open the IndexedDB
    function openDB() {
        return new Promise((resolve, reject) => {
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
                console.error('IndexedDB error:', event.target.errorCode);
                reject(event.target.errorCode);
            };
        });
    }

    // Save the current video timestamp
    function saveTimestamp() {
        const video = document.querySelector('video');
        if (video) {
            const currentTime = video.currentTime;
            const videoId = new URLSearchParams(window.location.search).get('v') || window.location.pathname.split('/').pop();
            if (videoId) {
                const transaction = db.transaction([STORE_NAME], 'readwrite');
                const store = transaction.objectStore(STORE_NAME);
                const record = { videoId: videoId, time: currentTime, timestamp: Date.now() };
                store.put(record);
                log(`Timestamp saved for video ID ${videoId}: ${currentTime}`);
            }
        }
    }

    // Load and set the saved timestamp
    function loadTimestamp() {
        const videoId = new URLSearchParams(window.location.search).get('v') || window.location.pathname.split('/').pop();
        if (videoId) {
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(videoId);

            request.onsuccess = function(event) {
                const record = event.target.result;
                if (record) {
                    const video = document.querySelector('video');
                    if (video) {
                        video.currentTime = record.time;
                        log(`Timestamp loaded for video ID ${videoId}: ${record.time}`);
                    }
                }
            };

            request.onerror = function(event) {
                console.error('Error fetching data from IndexedDB:', event.target.errorCode);
            };
        }
    }

    // Initialize and set up event listeners
    openDB().then(() => {
        const video = document.querySelector('video');

        if (video) {
            // Load timestamp when the video is loaded
            video.addEventListener('loadedmetadata', loadTimestamp);

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
            }
        }
    }).catch(error => {
        console.error('Failed to open IndexedDB:', error);
    });
})();
