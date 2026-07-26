const FEED_SETTINGS_DEFAULTS = {
    autoCleanPeriod: 'forever',
    paginationCount: 10,
    themePreference: 'system',
    accentColor: 'blue',
    overlayTitle: 'Viewed',
    overlayColor: 'blue',
    overlayLabelSize: 'medium',
    debug: false,
    pauseHistoryInPlaylists: false,
    localFeedEnabled: true,
    hideAccountUI: false,
    hideRecommendations: true,
    defaultFeedPage: 'last',
    feedRefreshMinutes: 60
};

const ACCENT_COLORS = {
    blue: '#3ea6ff',
    red: '#ff4e45',
    green: '#2ecc71',
    purple: '#a970ff',
    orange: '#ff9f2f'
};

function applyFeedTheme(preference) {
    const dark = preference === 'dark' ||
        (preference === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

function applyAccentColor(color) {
    document.documentElement.dataset.accent = ACCENT_COLORS[color] ? color : 'blue';
    document.documentElement.style.setProperty(
        '--accent',
        ACCENT_COLORS[color] || ACCENT_COLORS.blue
    );
}

async function loadFeedSettingsForm() {
    const stored = (await ytStorage.getSettings()) || {};
    if (stored.autoCleanPeriod === 90 || stored.autoCleanPeriod === '90') {
        stored.autoCleanPeriod = 'forever';
        await ytStorage.setSettings(stored);
    }
    const settings = { ...FEED_SETTINGS_DEFAULTS, ...stored };
    document.getElementById('feedSettingTheme').value = settings.themePreference;
    document.getElementById('feedSettingAccent').value =
        settings.accentColor || settings.overlayColor || 'blue';
    const defaultPageSelect = document.getElementById('feedSettingDefaultPage');
    if (defaultPageSelect) defaultPageSelect.value = settings.defaultFeedPage || 'last';
    const refreshSelect = document.getElementById('feedSettingRefresh');
    const refreshValue = String(settings.feedRefreshMinutes || 60);
    refreshSelect.value = [...refreshSelect.options].some((option) => option.value === refreshValue)
        ? refreshValue
        : '60';
    document.getElementById('feedSettingAutoClean').value = String(settings.autoCleanPeriod);
    applyFeedTheme(settings.themePreference);
    applyAccentColor(settings.accentColor);
}

function notifySettingsChanged(settings) {
    try {
        chrome.tabs.query({ url: ['*://*.youtube.com/*'] }, (tabs) => {
            (tabs || []).forEach((tab) => {
                chrome.tabs.sendMessage(tab.id, { type: 'updateSettings', settings }).catch(() => {});
                chrome.tabs.sendMessage(tab.id, { type: 'ytvhtSettingsChanged' }).catch(() => {});
            });
        });
    } catch (_) { /* YouTube pages will pick settings up next load */ }
}

async function saveFeedSettings() {
    const existing = (await ytStorage.getSettings()) || {};
    const cleanRefresh = Math.max(5, Math.min(1440,
        Number(document.getElementById('feedSettingRefresh').value || 60)));
    const autoCleanValue = document.getElementById('feedSettingAutoClean').value;
    const color = document.getElementById('feedSettingAccent').value;
    const settings = {
        ...FEED_SETTINGS_DEFAULTS,
        ...existing,
        themePreference: document.getElementById('feedSettingTheme').value,
        accentColor: color,
        overlayTitle: 'Viewed',
        overlayColor: color,
        overlayLabelSize: 'medium',
        defaultFeedPage: document.getElementById('feedSettingDefaultPage')?.value || 'last',
        feedRefreshMinutes: cleanRefresh,
        autoCleanPeriod: autoCleanValue === 'forever' ? 'forever' : Number(autoCleanValue)
    };
    await ytStorage.setSettings(settings);
    await chrome.storage.local.set({ popupAccentColor: color });
    localStorage.setItem('ytvhtThemePreference', settings.themePreference);
    localStorage.setItem('ytvhtAccentColor', color);
    overlayTitle = 'Viewed';
    applyFeedTheme(settings.themePreference);
    applyAccentColor(settings.accentColor);
    notifySettingsChanged(settings);
    const message = document.getElementById('feedSettingsMessage');
    message.textContent = '';
}

function showSettings() {
    rememberView('settings');
    document.body.classList.remove('shorts-mode');
    setRefreshVisible(false);
    setCreatePlaylistVisible(false);
    setSaveSettingsVisible(false);
    setClearSubscriptionsVisible(false);
    setClearHistoryVisible(false);
    setFeedOptionsVisible(false);
    showFeedStatus(false);
    leaveSearchPage();
    analyticsActive = false;
    subscriptionsActive = false;
    playlistsActive = false;
    historyActive = false;
    settingsActive = true;
    channelActive = false;
    ['localHeading', 'grid', 'localSearchResults', 'empty', 'ytSection', 'channelSection'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    ['analyticsSection', 'subscriptionsSection', 'playlistsSection', 'historySection'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    const chips = document.querySelector('.chips');
    if (chips) chips.style.display = 'none';
    const section = document.getElementById('settingsSection');
    if (section) section.style.display = 'block';
    setActiveNav('navSettings');
    loadFeedSettingsForm().catch((error) => {
        console.error('[settings] could not load settings', error);
    });
}
