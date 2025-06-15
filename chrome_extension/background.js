console.log('YouTube Video History Tracker background script running.');

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'openPopup') {
        // Create a small window next to the video
        chrome.windows.create({
            url: chrome.runtime.getURL("popup.html"),
            type: "popup",
            width: 600,
            height: 500,
            top: 100,
            left: 100
        });
    }
});

