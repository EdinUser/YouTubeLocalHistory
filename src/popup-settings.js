// Popup settings storage and UI wiring.
// Load settings from storage
async function loadSettings() {
    try {
        const settings = await ytStorage.getSettings() || {};
        let updated = false;

        // Ensure all default settings exist
        for (const key in DEFAULT_SETTINGS) {
            if (!(key in settings)) {
                settings[key] = DEFAULT_SETTINGS[key];
                updated = true;
            }
        }
        if (settings.autoCleanPeriod === 90 || settings.autoCleanPeriod === '90') {
            settings.autoCleanPeriod = 'forever';
            updated = true;
        }

        // Save back if we added any defaults
        if (updated) {
            await ytStorage.setSettings(settings);
        }

        return settings;
    } catch (error) {
        console.error('Error loading settings:', error);
        return {...DEFAULT_SETTINGS}; // Return a copy of defaults
    }
}

// Save settings to storage
async function saveSettings(settings) {
    try {
        // Remove parasite sub-object if present
        if ('settings' in settings) {
            delete settings.settings;
        }
        await ytStorage.setSettings(settings);
        localStorage.setItem('ytvhtThemePreference', settings.themePreference || 'system');
        localStorage.setItem('ytvhtAccentColor',
            settings.accentColor || settings.overlayColor || 'blue');
        return true;
    } catch (error) {
        console.error('Error saving settings:', error);
        return false;
    }
}

// Update settings UI with current values
function updateSettingsUI(settings) {
    const autoCleanSelect = document.getElementById('ytvhtAutoCleanPeriod');
    if (settings.autoCleanPeriod === 'forever') {
        autoCleanSelect.value = 'forever';
    } else {
        // For numeric values, select the closest available option or the value itself
        const numericValue = parseInt(settings.autoCleanPeriod) || 90;
        if (['30', '90', '180'].includes(numericValue.toString())) {
            autoCleanSelect.value = numericValue.toString();
        } else {
            // If it's a custom value, default to 90
            autoCleanSelect.value = '90';
        }
    }
    document.getElementById('ytvhtPaginationCount').value = settings.paginationCount;
    document.getElementById('ytvhtOverlayTitle').value = settings.overlayTitle;
    document.getElementById('ytvhtOverlayColor').value = settings.overlayColor;
    document.getElementById('ytvhtOverlayLabelSize').value = settings.overlayLabelSize;
    document.getElementById('ytvhtDebugMode').checked = settings.debug;
    const pauseChk = document.getElementById('ytvhtPauseHistoryInPlaylists');
    if (pauseChk) pauseChk.checked = !!settings.pauseHistoryInPlaylists;
    const localFeedChk = document.getElementById('ytvhtLocalFeedEnabled');
    if (localFeedChk) localFeedChk.checked = settings.localFeedEnabled !== false;
    const hideAccountChk = document.getElementById('ytvhtHideAccountUI');
    if (hideAccountChk) hideAccountChk.checked = settings.hideAccountUI === true;
    const hideRecsChk = document.getElementById('ytvhtHideRecommendations');
    if (hideRecsChk) {
        hideRecsChk.checked = (typeof settings.hideRecommendations === 'boolean')
            ? settings.hideRecommendations
            : (settings.hideHomeRecommendations !== false);
    }
    const feedRefreshInput = document.getElementById('ytvhtFeedRefreshMinutes');
    if (feedRefreshInput) feedRefreshInput.value = settings.feedRefreshMinutes || 60;
    document.getElementById('ytvhtVersion').textContent = EXTENSION_VERSION;
    updateColorPreview(settings.overlayColor);
}

// Update color preview
function updateColorPreview(color) {
    const preview = document.getElementById('ytvhtColorPreview');
    preview.style.backgroundColor = OVERLAY_COLORS[color];
}

// Handle settings tab
async function initSettingsTab() {
    log('Initializing settings tab...');
    const settings = await loadSettings();
    log('Loaded settings:', settings);

    // Update UI with current values
    updateSettingsUI(settings);

    // Auto-clean period
    const autoCleanPeriod = document.getElementById('ytvhtAutoCleanPeriod');
    if (autoCleanPeriod) {
        autoCleanPeriod.addEventListener('change', async function () {
            const settings = await loadSettings();
            const value = this.value;
            settings.autoCleanPeriod = value === 'forever' ? 'forever' : parseInt(value);
            await saveSettings(settings);
            showMessage(chrome.i18n.getMessage('message_auto_clean_updated'));
        });
    } else {
        log('Error: Auto-clean period element not found');
    }

    // Pagination count
    const paginationCount = document.getElementById('ytvhtPaginationCount');
    if (paginationCount) {
        paginationCount.addEventListener('change', async function () {
            const settings = await loadSettings();
            settings.paginationCount = parseInt(this.value);
            await saveSettings(settings);

            // Update page size variables
            pageSize = settings.paginationCount;
            shortsPageSize = settings.paginationCount;
            playlistPageSize = settings.paginationCount;

            // Reload current pages with new page size
            await loadCurrentPages();

            showMessage(chrome.i18n.getMessage('message_pagination_count_updated'));
        });
    } else {
        log('Error: Pagination count element not found');
    }

    // Overlay title
    const overlayTitle = document.getElementById('ytvhtOverlayTitle');
    if (overlayTitle) {
        overlayTitle.addEventListener('change', async function () {
            const settings = await loadSettings();
            settings.overlayTitle = this.value;
            await saveSettings(settings);
            showMessage(chrome.i18n.getMessage('message_overlay_title_updated'));
        });
    } else {
        log('Error: Overlay title element not found');
    }

    // Overlay color
    const overlayColor = document.getElementById('ytvhtOverlayColor');
    if (overlayColor) {
        overlayColor.addEventListener('change', async function () {
            const settings = await loadSettings();
            settings.overlayColor = this.value;
            updateColorPreview(this.value);
            await saveSettings(settings);
            showMessage(chrome.i18n.getMessage('message_overlay_color_updated'));
        });
    } else {
        log('Error: Overlay color element not found');
    }

    // Overlay label size
    const overlayLabelSize = document.getElementById('ytvhtOverlayLabelSize');
    if (overlayLabelSize) {
        overlayLabelSize.addEventListener('change', async function () {
            const settings = await loadSettings();
            settings.overlayLabelSize = this.value;
            await saveSettings(settings);
            showMessage(chrome.i18n.getMessage('message_overlay_size_updated'));
        });
    } else {
        log('Error: Overlay label size element not found');
    }

    // Theme preference
    const themePreference = document.getElementById('ytvhtThemePreference');
    if (themePreference) {
        themePreference.value = settings.themePreference || 'system';
        themePreference.addEventListener('change', async function () {
            const settings = await loadSettings();
            settings.themePreference = this.value;
            await saveSettings(settings);
            await applyTheme(this.value);
            showMessage(chrome.i18n.getMessage('message_theme_preference_updated'));
        });
    } else {
        log('Error: Theme preference element not found');
    }

    // Debug mode
    const debugMode = document.getElementById('ytvhtDebugMode');
    if (debugMode) {
        debugMode.checked = settings.debug || false;
        debugMode.addEventListener('change', async function () {
            const settings = await loadSettings();
            settings.debug = this.checked;
            await saveSettings(settings);
            showMessage(chrome.i18n.getMessage('message_debug_mode_enabled'));
        });
    } else {
        log('Error: Debug mode element not found');
    }

    // Pause history in playlists
    const pauseInPlaylists = document.getElementById('ytvhtPauseHistoryInPlaylists');
    if (pauseInPlaylists) {
        pauseInPlaylists.checked = settings.pauseHistoryInPlaylists || false;
        pauseInPlaylists.addEventListener('change', async function () {
            const s = await loadSettings();
            s.pauseHistoryInPlaylists = this.checked;
            await saveSettings(s);
            const enabledMsg = chrome.i18n.getMessage('message_pause_in_playlists_enabled') || 'Paused history in playlists enabled';
            const disabledMsg = chrome.i18n.getMessage('message_pause_in_playlists_disabled') || 'Paused history in playlists disabled';
            showMessage(this.checked ? enabledMsg : disabledMsg);
        });
    } else {
        log('Error: Pause history in playlists element not found');
    }

    // Local subscriptions feed
    const localFeedEnabled = document.getElementById('ytvhtLocalFeedEnabled');
    if (localFeedEnabled) {
        localFeedEnabled.checked = settings.localFeedEnabled !== false;
        localFeedEnabled.addEventListener('change', async function () {
            const s = await loadSettings();
            s.localFeedEnabled = this.checked;
            await saveSettings(s);
            notifyYouTubeTabs({ type: 'ytvhtSettingsChanged' });
            showMessage(chrome.i18n.getMessage('message_settings_saved') || 'Settings saved');
        });
    }

    // Hide login & account UI.
    const hideAccountUI = document.getElementById('ytvhtHideAccountUI');
    if (hideAccountUI) {
        hideAccountUI.checked = settings.hideAccountUI === true;
        hideAccountUI.addEventListener('change', async function () {
            const s = await loadSettings();
            s.hideAccountUI = this.checked;
            await saveSettings(s);
            notifyYouTubeTabs({ type: 'ytvhtSettingsChanged' });
            showMessage(chrome.i18n.getMessage('message_settings_saved') || 'Settings saved');
        });
    }

    // Hide recommendations & popups
    const hideRecs = document.getElementById('ytvhtHideRecommendations');
    if (hideRecs) {
        hideRecs.checked = (typeof settings.hideRecommendations === 'boolean')
            ? settings.hideRecommendations
            : (settings.hideHomeRecommendations !== false);
        hideRecs.addEventListener('change', async function () {
            const s = await loadSettings();
            s.hideRecommendations = this.checked;
            await saveSettings(s);
            notifyYouTubeTabs({ type: 'ytvhtSettingsChanged' });
            showMessage(chrome.i18n.getMessage('message_settings_saved') || 'Settings saved');
        });
    }

    // Feed refresh interval
    const feedRefreshMinutes = document.getElementById('ytvhtFeedRefreshMinutes');
    if (feedRefreshMinutes) {
        feedRefreshMinutes.value = settings.feedRefreshMinutes || 60;
        feedRefreshMinutes.addEventListener('change', async function () {
            const s = await loadSettings();
            let val = parseInt(this.value, 10);
            if (!isFinite(val) || val < 5) val = 5;
            if (val > 1440) val = 1440;
            this.value = val;
            s.feedRefreshMinutes = val;
            await saveSettings(s);
            notifyYouTubeTabs({ type: 'ytvhtSettingsChanged' });
            showMessage(chrome.i18n.getMessage('message_settings_saved') || 'Settings saved');
        });
    }

    // Version display
    const versionElement = document.getElementById('ytvhtVersion');
    if (versionElement) {
        versionElement.textContent = EXTENSION_VERSION;
    } else {
        log('Error: Version element not found');
    }

    log('Settings tab initialization complete');
}
