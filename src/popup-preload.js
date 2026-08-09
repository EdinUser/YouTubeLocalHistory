(() => {
    const ACCENTS = {
        blue: { main: '#3ea6ff', hover: '#65b8ff' },
        red: { main: '#ff4e45', hover: '#ff7069' },
        green: { main: '#2ecc71', hover: '#55d98b' },
        purple: { main: '#a970ff', hover: '#bd91ff' },
        orange: { main: '#ff9f2f', hover: '#ffb45c' }
    };

    function prefersDark() {
        return !!(window.matchMedia &&
            window.matchMedia('(prefers-color-scheme: dark)').matches);
    }

    function applyThemePreference(preference) {
        const effective = preference === 'dark' ||
            ((!preference || preference === 'system') && prefersDark())
            ? 'dark'
            : 'light';
        document.documentElement.setAttribute('data-theme', effective);
        document.documentElement.style.colorScheme = effective;
    }

    function applyAccent(colorName) {
        const color = ACCENTS[colorName] || ACCENTS.blue;
        const style = document.documentElement.style;
        style.setProperty('--button-bg', color.main);
        style.setProperty('--button-hover', color.hover);
        style.setProperty('--button-hover-bg', color.hover);
        style.setProperty('--link-color', color.main);
        style.setProperty('--link-hover-color', color.hover);
        style.setProperty('--message-border', color.main);
    }

    try {
        applyThemePreference(localStorage.getItem('ytvhtThemePreference') || 'system');
        applyAccent(localStorage.getItem('ytvhtAccentColor') || 'blue');

        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
            chrome.storage.local.get(['settings', 'popupAccentColor'], (result) => {
                const settings = result?.settings || {};
                const themePreference = settings.themePreference || 'system';
                const accentColor = result?.popupAccentColor ||
                    settings.accentColor ||
                    settings.overlayColor ||
                    'blue';
                localStorage.setItem('ytvhtThemePreference', themePreference);
                localStorage.setItem('ytvhtAccentColor', accentColor);
                applyThemePreference(themePreference);
                applyAccent(accentColor);
            });
        }
    } catch {
        applyThemePreference('system');
    }
})();
