function saveCurrentExtensionTab(tabName) {
    if (typeof tabName === 'string') {
        localStorage.setItem('ythdb_currentTab', tabName);
    }
}

/**
 * Reads the currently saved extension tab from localStorage.
 * @returns {string|null} The name of the saved tab, or null if not set.
 */
function getCurrentExtensionTab() {
    return localStorage.getItem('ythdb_currentTab');
}

// Function to check system dark mode preference
async function getSystemColorScheme() {
    try {
        log('=== Starting theme detection ===');

        // 1. First check prefers-color-scheme media query
        const darkMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        const lightMediaQuery = window.matchMedia('(prefers-color-scheme: light)');

        log(`[Theme Detection] Media query - prefers-color-scheme: ${darkMediaQuery.matches ? 'dark' : lightMediaQuery.matches ? 'light' : 'not set'}`);

        if (darkMediaQuery.matches) {
            log('[Theme Detection] Using dark theme from media query');
            return 'dark';
        }
        if (lightMediaQuery.matches) {
            log('[Theme Detection] Using light theme from media query');
            return 'light';
        }

        // 2. Try to get the browser's theme info
        if (typeof browser !== 'undefined' && browser.theme && typeof browser.theme.getCurrent === 'function') {
            try {
                log('[Theme Detection] Attempting to get browser theme info...');
                const themeInfo = await browser.theme.getCurrent();
                log('[Theme Detection] Browser theme info:', JSON.stringify(themeInfo, null, 2));

                if (themeInfo && themeInfo.colors) {
                    // Log all color values for debugging
                    log('[Theme Detection] Theme colors:', Object.entries(themeInfo.colors)
                        .map(([key, value]) => `${key}: ${value}`)
                        .join('\n  '));

                    // Check for explicit dark theme indicators
                    if (themeInfo.colors.color_scheme === 'dark' ||
                        (themeInfo.colors.theme_collection &&
                            themeInfo.colors.theme_collection.private_browsing === 'dark')) {
                        log('[Theme Detection] Detected dark theme from explicit indicators');
                        return 'dark';
                    }

                    // Check for common dark theme properties
                    const themeColors = JSON.stringify(themeInfo.colors).toLowerCase();
                    const hasDarkIndicator = ['dark', 'night', 'black'].some(key =>
                        themeColors.includes(key));

                    if (hasDarkIndicator) {
                        log('[Theme Detection] Detected dark theme from color analysis');
                        return 'dark';
                    }
                }
            } catch (e) {
                log('[Theme Detection] Error getting browser theme:', e);
            }
        } else {
            log('[Theme Detection] Browser theme API not available');
        }

        // 3. Check for high contrast mode
        if (window.matchMedia('(forced-colors: active)').matches) {
            log('[Theme Detection] High contrast mode detected');
            if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
                return 'dark';
            }
        }

        // 4. Check the document's background color as a last resort
        const bgColor = window.getComputedStyle(document.documentElement).backgroundColor;
        log(`[Theme Detection] Document background color: ${bgColor}`);

        // Simple check for dark background
        if (bgColor) {
            const rgb = bgColor.match(/\d+/g);
            if (rgb && rgb.length >= 3) {
                const brightness = (parseInt(rgb[0]) * 299 +
                    parseInt(rgb[1]) * 587 +
                    parseInt(rgb[2]) * 114) / 1000;
                const isDark = brightness < 128;
                log(`[Theme Detection] Background brightness: ${brightness}, isDark: ${isDark}`);
                return isDark ? 'dark' : 'light';
            }
        }

        log('[Theme Detection] No dark theme detected, defaulting to light');
        return 'light';

    } catch (error) {
        log('[Theme Detection] Error in getSystemColorScheme:', error);
        return 'light'; // Default to light on error
    }
}

function toggleDarkMode(enable) {
    log('=== toggleDarkMode called with:', enable);

    try {
        const theme = enable ? 'dark' : 'light';
        log(`Setting theme to: ${theme}`);

        // Set data-theme attribute on html and body
        document.documentElement.setAttribute('data-theme', theme);
        document.body.setAttribute('data-theme', theme);

        // Toggle dark-mode class on body
        if (enable) {
            document.body.classList.add('dark-mode');
        } else {
            document.body.classList.remove('dark-mode');
        }

        // Force a reflow to ensure styles are applied
        document.body.offsetHeight;

        // Log the current state after applying theme
        const htmlTheme = document.documentElement.getAttribute('data-theme');
        const bodyTheme = document.body.getAttribute('data-theme');
        const bodyClasses = document.body.className;
        const computedBg = window.getComputedStyle(document.body).backgroundColor;
        const computedColor = window.getComputedStyle(document.body).color;

        log('Theme applied:', {
            'html data-theme': htmlTheme,
            'body data-theme': bodyTheme,
            'body classes': bodyClasses,
            'computed bg': computedBg,
            'computed color': computedColor
        });

    } catch (error) {
        console.error('Error in toggleDarkMode:', error);
    }
}

// Keep the popup theme button label in sync with the active preference.
function updateThemeToggleText(themePreference) {
    const themeText = document.getElementById('themeText');
    const toggleButton = document.getElementById('ytvhtToggleTheme');

    if (themeText) {
        let text = 'Theme';
        let tooltip = 'Toggle theme';

        switch (themePreference) {
            case 'light':
                text = 'Light';
                tooltip = 'Switch to dark theme';
                break;
            case 'dark':
                text = 'Dark';
                tooltip = 'Switch to light theme';
                break;
            case 'system':
            default:
                text = 'Auto';
                tooltip = 'Currently following system theme - Click to override';
                break;
        }

        themeText.textContent = text;
        if (toggleButton) {
            toggleButton.title = tooltip;
        }
    }
}

// Apply theme based on settings or override
async function applyTheme(themePreference) {
    let effectiveTheme = themePreference;
    if (!effectiveTheme || effectiveTheme === 'system') {
        effectiveTheme = await getSystemColorScheme();
    }
    toggleDarkMode(effectiveTheme === 'dark');
    updateThemeToggleText(themePreference || 'system');
}

// Toggle theme between light and dark (never "system" from the button)
async function toggleTheme() {
    try {
        const settings = await loadSettings();
        let newTheme;
        // Only toggle between light and dark
        if (settings.themePreference === 'dark') {
            newTheme = 'light';
        } else {
            newTheme = 'dark';
        }
        // Override the saved preference (even if it was "system")
        settings.themePreference = newTheme;
        await saveSettings(settings);
        updateThemeToggleText(newTheme);
        await applyTheme(newTheme);
    } catch (error) {
        console.error('Error in toggleTheme:', error);
    }
}
