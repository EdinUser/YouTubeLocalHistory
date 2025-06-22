console.log('YouTube Video History Tracker background script running.');

// Keep track of active popup windows
let activePopupWindow = null;

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
    
    if (message.type === 'importHistory') {
        console.log('Background script handling import request');
        
        // Instead of handling file selection in background, send message back to popup
        // The popup will handle the file selection and send the data back
        sendResponse({ action: 'selectFile', mergeMode: message.mergeMode });
    }
});

