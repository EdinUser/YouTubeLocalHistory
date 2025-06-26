console.log('YouTube Video History Tracker background script running.');

// Keep track of active popup windows
let activePopupWindow = null;

// Store the last video update to handle popup opens
let lastVideoUpdate = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Background script received message:', message);
    
    if (message.type === 'openPopup') {
        // Create a small window next to the video
        activePopupWindow = chrome.windows.create({
            url: chrome.runtime.getURL("popup.html"),
            type: "popup",
            width: 600,
            height: 500,
            top: 100,
            left: 100
        });
    }
    
    // Handle video updates from content script
    if (message.type === 'videoUpdate') {
        lastVideoUpdate = message.data;
        // Broadcast to all tabs (popup will pick it up if open)
        chrome.runtime.sendMessage({
            type: 'videoUpdateFromBackground',
            data: message.data
        }).catch(error => {
            // This error is expected when no listeners are available (popup closed)
            console.log('Could not broadcast video update:', error);
        });
    }

    // Handle popup requesting latest update
    if (message.type === 'getLatestUpdate') {
        sendResponse({ lastUpdate: lastVideoUpdate });
    }
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
            }).catch(error => {
                // This error is expected when no listeners are available
                console.log('Could not broadcast storage update:', error);
            });
        }
    }
});

