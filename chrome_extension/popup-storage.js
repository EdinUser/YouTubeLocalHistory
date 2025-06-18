// Popup storage wrapper for Chrome extension
class PopupStorage {
    constructor() {
        this.migrated = false;
    }

    // Check if migration is needed and perform it
    async ensureMigrated() {
        if (this.migrated) return;

        try {
            const result = await chrome.storage.local.get(['__migrated__']);
            if (result.__migrated__) {
                this.migrated = true;
                return;
            }

            // Try to migrate from IndexedDB
            await this.migrateFromIndexedDB();
            
            await chrome.storage.local.set({ '__migrated__': true });
            this.migrated = true;
            console.log('[Popup Storage] Migration completed successfully');
        } catch (error) {
            console.log('[Popup Storage] Migration skipped or failed:', error.message);
            this.migrated = true;
        }
    }

    // Migrate settings from IndexedDB
    async migrateFromIndexedDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('YouTubeHistoryDB', 3);
            
            request.onerror = () => reject(new Error('IndexedDB not accessible'));
            
            request.onsuccess = async (event) => {
                const db = event.target.result;
                
                try {
                    if (db.objectStoreNames.contains('settings')) {
                        const settings = await this.getFromStore(db, 'settings', 'userSettings');
                        if (settings) {
                            await chrome.storage.local.set({ 'settings': settings });
                            console.log('[Popup Storage] Migrated settings from IndexedDB');
                        }
                    }
                    db.close();
                    resolve();
                } catch (error) {
                    db.close();
                    reject(error);
                }
            };
        });
    }

    // Helper to get a single item from an IndexedDB store
    getFromStore(db, storeName, key) {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.get(key);
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    // Get settings
    async getSettings() {
        await this.ensureMigrated();
        const result = await chrome.storage.local.get(['settings']);
        return result.settings || null;
    }

    // Save settings
    async setSettings(settings) {
        await this.ensureMigrated();
        await chrome.storage.local.set({ 'settings': settings });
    }

    // Clear all data
    async clear() {
        await chrome.storage.local.clear();
        this.migrated = false;
    }
}

// Create global storage instance
window.popupStorage = new PopupStorage(); 