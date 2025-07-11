console.log('YouTube Video History Tracker background script running.');

// Import required scripts for Chrome service worker
if (typeof importScripts === 'function') {
    try {
        importScripts('storage.js', 'sync-service.js');
    } catch (e) {
        console.log('Background: Failed to import scripts (expected in Firefox):', e.message);
    }
}

// In-memory state for non-session storage environments (like Firefox)
let inMemoryState = {
    activePopupWindowId: null,
    lastVideoUpdate: null
};

// Use session storage for a more reliable state in Chrome's service worker
const stateManager = {
    async get(key) {
        if (chrome.storage.session) {
            const result = await chrome.storage.session.get(key);
            return result[key];
        }
        return inMemoryState[key];
    },
    async set(data) {
        if (chrome.storage.session) {
            return await chrome.storage.session.set(data);
        }
        inMemoryState = { ...inMemoryState, ...data };
    }
};


chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
        console.log('Background script received message:', message.type, 'from sender:', sender.tab ? 'content' : 'popup');
        
        if (message.type === 'openPopup') {
            const popupId = await stateManager.get('activePopupWindowId');
            if (popupId) {
                try {
                    await chrome.windows.update(popupId, { focused: true });
                    return;
                } catch (e) {
                    // Window no longer exists
                }
            }

            const newWindow = await chrome.windows.create({
                url: chrome.runtime.getURL("popup.html"),
                type: "popup",
                width: 600,
                height: 500,
                top: 100,
                left: 100
            });
            await stateManager.set({ activePopupWindowId: newWindow.id });
        }
        
        if (message.type === 'videoUpdate') {
            await stateManager.set({ lastVideoUpdate: message.data });

            chrome.runtime.sendMessage({
                type: 'videoUpdateFromBackground',
                data: message.data
            }).catch(() => {
                // Expected when popup is closed - no need to log
            });
        }

        if (message.type === 'getLatestUpdate') {
            const lastUpdate = await stateManager.get('lastVideoUpdate');
            sendResponse({ lastUpdate: lastUpdate });
            return; // Return early because we're using sendResponse
        }

        // Handle sync-related messages
        if (message.type === 'getSyncStatus') {
            if (typeof ytSyncService !== 'undefined') {
                sendResponse(ytSyncService.getStatus());
            } else {
                sendResponse({ status: 'not_available', enabled: false, available: false });
            }
        }

        if (message.type === 'enableSync') {
            if (typeof ytSyncService !== 'undefined') {
                ytSyncService.enableSync().then(success => {
                    sendResponse({ success: success });
                });
                return true;
            } else {
                sendResponse({ success: false });
            }
        }

        if (message.type === 'disableSync') {
            if (typeof ytSyncService !== 'undefined') {
                ytSyncService.disableSync().then(success => {
                    sendResponse({ success: success });
                });
                return true;
            } else {
                sendResponse({ success: false });
            }
        }

        if (message.type === 'triggerSync') {
            console.log('[Background] 🔥 Received triggerSync message');
            if (typeof ytSyncService !== 'undefined') {
                console.log('[Background] 🔥 ytSyncService exists, calling triggerSync()');
                ytSyncService.triggerSync().then(success => {
                    console.log('[Background] 🔥 triggerSync() returned:', success);
                    sendResponse({ success: success });
                }).catch(error => {
                    console.error('[Background] ❌ triggerSync() failed:', error);
                    sendResponse({ success: false });
                });
                return true;
            } else {
                console.log('[Background] ❌ ytSyncService not available');
                sendResponse({ success: false });
            }
        }

        if (message.type === 'uploadNewData') {
            if (typeof ytSyncService !== 'undefined') {
                ytSyncService.uploadNewData(message.videoId).then(success => {
                    sendResponse({ success: success });
                });
                return true;
            } else {
                sendResponse({ success: false });
            }
        }

        if (message.type === 'triggerFullSync') {
            if (typeof ytSyncService !== 'undefined') {
                ytSyncService.triggerFullSync().then(success => {
                    sendResponse({ success: success });
                });
                return true;
            } else {
                sendResponse({ success: false });
            }
        }

        if (message.type === 'testFirefoxSync') {
            if (typeof ytSyncService !== 'undefined') {
                ytSyncService.testFirefoxSync().then(testKey => {
                    sendResponse({ success: !!testKey, testKey: testKey });
                });
                return true;
            } else {
                sendResponse({ success: false });
            }
        }

        if (message.type === 'debugSyncStorage') {
            console.log('[Background] 🔍 Received debugSyncStorage message');
            if (typeof ytSyncService !== 'undefined') {
                console.log('[Background] 🔍 ytSyncService exists, calling debugSyncStorage()');
                ytSyncService.debugSyncStorage().then(result => {
                    console.log('[Background] 🔍 debugSyncStorage result:', result);
                    sendResponse({ success: !!result, data: result });
                }).catch(error => {
                    console.error('[Background] ❌ debugSyncStorage failed:', error);
                    sendResponse({ success: false, error: error.message });
                });
                return true;
            } else {
                console.log('[Background] ❌ ytSyncService not available for debug');
                sendResponse({ success: false, error: 'ytSyncService not available' });
            }
        }

        if (message.type === 'testSyncDelay') {
            if (typeof ytSyncService !== 'undefined') {
                ytSyncService.testSyncDelay().then(testKey => {
                    sendResponse({ success: !!testKey, testKey: testKey });
                });
                return true;
            } else {
                sendResponse({ success: false });
            }
        }

        if (message.type === 'updateSyncDebug') {
            if (typeof ytSyncService !== 'undefined') {
                ytSyncService.updateDebugSetting().then(() => {
                    sendResponse({ success: true });
                });
                return true;
            } else {
                sendResponse({ success: false });
            }
        }

        if (message.type === 'testSyncFlow') {
            console.log('[Background] 🧪 Received testSyncFlow message');
            if (typeof ytSyncService !== 'undefined') {
                console.log('[Background] 🧪 ytSyncService exists, calling testSyncFlow()');
                ytSyncService.testSyncFlow().then(success => {
                    console.log('[Background] 🧪 testSyncFlow() returned:', success);
                    sendResponse({ success: success });
                }).catch(error => {
                    console.error('[Background] ❌ testSyncFlow() failed:', error);
                    sendResponse({ success: false, error: error.message });
                });
                return true;
            } else {
                console.log('[Background] ❌ ytSyncService not available for testSyncFlow');
                sendResponse({ success: false, error: 'ytSyncService not available' });
            }
        }

        if (message.type === 'testSyncImprovements') {
            console.log('[Background] 🚀 Received testSyncImprovements message');
            if (typeof ytSyncService !== 'undefined') {
                console.log('[Background] 🚀 ytSyncService exists, calling testSyncImprovements()');
                ytSyncService.testSyncImprovements().then(result => {
                    console.log('[Background] 🚀 testSyncImprovements() returned:', result);
                    sendResponse({ success: !!result, data: result });
                }).catch(error => {
                    console.error('[Background] ❌ testSyncImprovements() failed:', error);
                    sendResponse({ success: false, error: error.message });
                });
                return true;
            } else {
                console.log('[Background] ❌ ytSyncService not available for testSyncImprovements');
                sendResponse({ success: false });
            }
        }

    })();
    return true; // Indicates async response
});

// Listen for storage changes
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
        // Check if any video records were changed
        const videoChanges = Object.entries(changes).filter(([key]) => key.startsWith('video_'));
        if (videoChanges.length > 0) {
            // Broadcast changes to any open popups
            chrome.runtime.sendMessage({
                type: 'storageUpdate',
                changes: videoChanges
            }).catch(() => {
                // Expected when popup is closed - no need to log
            });
        }
    }
});

// Clean up session storage when a popup window is closed
chrome.windows.onRemoved.addListener(async (windowId) => {
    const activeId = await stateManager.get('activePopupWindowId');
    if (windowId === activeId) {
        await stateManager.set({ activePopupWindowId: null });
    }
});

