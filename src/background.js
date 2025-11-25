console.log('YouTube Video History Tracker background script running.');

// Import required scripts for Chrome service worker
if (typeof importScripts === 'function') {
    try {
        importScripts('indexeddb-storage.js', 'storage.js'); // sync-service.js removed - redundant with hybrid storage
        // Verify critical globals are available
        if (typeof ytIndexedDBStorage === 'undefined') {
            console.error('[Background] ytIndexedDBStorage not available after import');
        }
        if (typeof ytStorage === 'undefined') {
            console.error('[Background] ytStorage not available after import');
        }
    } catch (e) {
        console.error('Background: Failed to import scripts:', e.message);
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

        // Handle content script storage RPC calls (ytStorageCall)
        if (message.type === 'ytStorageCall') {
            if (typeof ytStorage === 'undefined') {
                console.error('[Background] ytStorage not available');
                sendResponse({ error: 'ytStorage not available' });
                return;
            }

            const { method, args } = message;
            if (!method || typeof ytStorage[method] !== 'function') {
                console.error(`[Background] Unknown method: ${method}`);
                sendResponse({ error: `Unknown method: ${method}` });
                return;
            }

            // For importRecords, ensure IndexedDB is available
            if (method === 'importRecords') {
                if (typeof ytIndexedDBStorage === 'undefined') {
                    console.error('[Background] ytIndexedDBStorage not available for import');
                    sendResponse({ error: 'IndexedDB storage not available. Please reload the extension.' });
                    return;
                }
            }

            // Call the method on ytStorage instance
            Promise.resolve(ytStorage[method](...args))
                .then(result => {
                    sendResponse({ result: result });
                })
                .catch(error => {
                    console.error(`[Background] ytStorageCall error for ${method}:`, error);
                    const errorMessage = error && error.message ? error.message : String(error);
                    sendResponse({ error: errorMessage });
                });

            return true; // Indicates async response
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

