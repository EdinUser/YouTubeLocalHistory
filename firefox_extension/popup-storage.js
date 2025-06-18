// Simple storage wrapper for popup using browser.storage.local
// This creates a compatible interface with the main storage system

(function() {
    'use strict';

    // Simple storage wrapper for popup
    class PopupStorage {
        // Get settings
        async getSettings() {
            const result = await browser.storage.local.get(['settings']);
            return result.settings || null;
        }

        // Save settings
        async setSettings(settings) {
            await browser.storage.local.set({ 'settings': settings });
        }

        // Clear all data
        async clear() {
            await browser.storage.local.clear();
        }
    }

    // Create global storage instance for popup
    window.popupStorage = new PopupStorage();

})(); 