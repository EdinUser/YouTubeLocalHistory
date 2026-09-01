const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

test('the feed publishes its system theme for popup surfaces to reuse', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'feed-settings.js'), 'utf8');

  expect(source).toContain("chrome.storage.local.set({ systemTheme: theme })");
  expect(source).toContain("if (preference === 'system') persistSystemTheme(theme)");
  expect(source).toContain("systemThemeQuery.addEventListener('change'");
});

test('the popup resolves system theme from the shared extension value before its own media query', () => {
  const preload = fs.readFileSync(path.join(ROOT, 'src', 'popup-preload.js'), 'utf8');
  const theme = fs.readFileSync(path.join(ROOT, 'src', 'popup-theme.js'), 'utf8');
  const popup = fs.readFileSync(path.join(ROOT, 'src', 'popup.js'), 'utf8');

  expect(preload).toContain("['settings', 'popupAccentColor', 'systemTheme']");
  expect(theme.indexOf("chrome.storage.local.get(['systemTheme']"))
    .toBeLessThan(theme.indexOf("window.matchMedia('(prefers-color-scheme: dark)')"));
  expect(popup).toContain('changes.systemTheme?.newValue');
});
