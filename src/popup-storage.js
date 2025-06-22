// Simple storage wrapper for popup using cross-browser storage API
// This creates a compatible interface with the main storage system

(function() {
    'use strict';

    // Browser detection
    const isFirefox = typeof browser !== 'undefined' && typeof chrome !== 'undefined' && browser !== chrome;
    const isChrome = typeof chrome !== 'undefined' && (!isFirefox);

    // Cross-browser storage wrapper
    const storage = {
        async get(keys) {
            if (isFirefox) {
                return await browser.storage.local.get(keys);
            } else {
                return new Promise((resolve) => {
                    chrome.storage.local.get(keys, resolve);
                });
            }
        },

        async set(data) {
            if (isFirefox) {
                return await browser.storage.local.set(data);
            } else {
                return new Promise((resolve) => {
                    chrome.storage.local.set(data, resolve);
                });
            }
        },

        async clear() {
            if (isFirefox) {
                return await browser.storage.local.clear();
            } else {
                return new Promise((resolve) => {
                    chrome.storage.local.clear(resolve);
                });
            }
        }
    };

    // Simple storage wrapper for popup
    class PopupStorage {
        // Get settings
        async getSettings() {
            const result = await storage.get(['settings']);
            return result.settings || null;
        }

        // Save settings
        async setSettings(settings) {
            await storage.set({ 'settings': settings });
        }

        // Clear all data
        async clear() {
            await storage.clear();
        }
    }

    // Create global storage instance for popup
    window.popupStorage = new PopupStorage();

})(); 