(function() {
    'use strict';

    function createContentMessageListener(dependencies) {
        const log = dependencies.log;
        const getStorage = dependencies.getStorage;
        const isInitialized = dependencies.isInitialized;
        const initializeIfNeeded = dependencies.initializeIfNeeded;
        const injectCSS = dependencies.injectCSS;
        const updateOverlayCSS = dependencies.updateOverlayCSS;
        const overlayColors = dependencies.overlayColors;
        const overlayLabelSizeMap = dependencies.overlayLabelSizeMap;
        const getAccentOverlayColor = dependencies.getAccentOverlayColor;
        const setCurrentSettings = dependencies.setCurrentSettings;
        const processExistingThumbnails = dependencies.processExistingThumbnails;

        return function contentMessageListener(message, sender, sendResponse) {
            const storage = getStorage();

            if (message.type === 'getHistory') {
                if (!isInitialized()) {
                    log('Not initialized yet, initializing now');
                    initializeIfNeeded();
                }
                storage.getAllVideos().then(allVideos => {
                    const history = Object.values(allVideos);
                    log('Sending history to popup:', history);
                    sendResponse({history: history});
                }).catch(error => {
                    log('Error getting history:', error);
                    sendResponse({history: []});
                });
                return true;
            } else if (message.type === 'exportHistory') {
                if (!isInitialized()) {
                    log('Not initialized yet, initializing now');
                    initializeIfNeeded();
                }
                Promise.all([
                    storage.getAllVideos(),
                    storage.getAllPlaylists()
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
                storage.clear().then(() => {
                    log('History cleared successfully');
                    sendResponse({status: 'success'});
                }).catch(error => {
                    log('Error clearing history:', error);
                    sendResponse({status: 'error'});
                });
                return true;
            } else if (message.type === 'deleteRecord') {
                const videoId = message.videoId;
                storage.removeVideo(videoId).then(() => {
                    log('Record deleted successfully:', videoId);
                    sendResponse({status: 'success'});
                }).catch(error => {
                    log('Error deleting record:', videoId);
                    sendResponse({status: 'error'});
                });
                return true;
            } else if (message.type === 'getPlaylists') {
                storage.getAllPlaylists().then(allPlaylists => {
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
                storage.removePlaylist(playlistId).then(() => {
                    log('Playlist deleted successfully:', playlistId);
                    sendResponse({status: 'success'});
                }).catch(error => {
                    log('Error deleting playlist:', playlistId);
                    sendResponse({status: 'error'});
                });
                return true;
            } else if (message.type === 'updateSettings') {
                const currentSettings = message.settings;
                setCurrentSettings(currentSettings);
                if (currentSettings.debug) {
                    console.log('[ythdb] Debug mode enabled');
                }
                injectCSS();
                updateOverlayCSS(
                    overlayLabelSizeMap[currentSettings.overlayLabelSize] || overlayLabelSizeMap.medium,
                    getAccentOverlayColor
                        ? getAccentOverlayColor(currentSettings)
                        : (overlayColors[currentSettings.accentColor] || overlayColors[currentSettings.overlayColor] || overlayColors.blue)
                );
                processExistingThumbnails();
                sendResponse({status: 'success'});
                return true;
            }

            return false;
        };
    }

    window.YTVHTContentMessages = {
        create: createContentMessageListener
    };
})();
