# Build Instructions

This guide explains how to install dependencies, run checks, and load YT re:Watch for local browser testing.

## Prerequisites

- Node.js 18 or newer
- npm
- Git
- Firefox or Chrome/Chromium
- Git Bash, WSL, or another Bash-compatible shell if you want to run `build.sh`

## Install

```bash
git clone https://github.com/EdinUser/YouTubeLocalHistory.git
cd YouTubeLocalHistory
npm install
```

## Local Firefox Testing

This is the recommended development path on Windows.

```bash
npm run prepare:firefox
```

Then open Firefox:

1. Go to `about:debugging`.
2. Click `This Firefox`.
3. Click `Load Temporary Add-on`.
4. Select `build/firefox/manifest.json`.

After code changes, run `npm run prepare:firefox` again, then reload the temporary add-on.

## Local Chrome Testing

Use the release build script to prepare `build/chrome`, or copy the source files into a Chrome build folder using the same file list from `build.sh`.

Then open Chrome:

1. Go to `chrome://extensions/`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select `build/chrome`.

## Checks

Run these before opening a pull request:

```bash
npm run lint
npm test -- --runInBand
npm run prepare:firefox
npx web-ext lint --source-dir=build/firefox
```

Useful test commands:

```bash
npm test
npm run test:unit
npm run test:integration
npm run test:memory
npm run test:e2e
npm run test:coverage
```

`npm run test:e2e` uses Playwright. If browsers are missing, run:

```bash
npx playwright install
```

## Release Packaging

The release script builds browser folders and creates ZIP packages in `dist/`.

```bash
npm run build
```

or directly:

```bash
./build.sh
```

Notes:

- `build.sh` is a Bash script. On Windows, run it from Git Bash or WSL.
- Chrome CRX signing requires `google-chrome` and a private key at `certs/privatekey.pem`, or paths supplied through `CHROME_EXTENSION_DIR` and `PRIVATE_KEY_PATH`.
- If Chrome signing is not configured, the Chrome ZIP may still be useful, but CRX generation can warn or fail depending on your environment.

Expected release outputs:

- `dist/youtube-local-history-chrome-v{version}.zip`
- `dist/youtube-local-history-chrome-v{version}.crx` when signing succeeds
- `dist/youtube-local-history-firefox-v{version}.zip`

## Project Structure

```text
src/
  _locales/                  Translation files
  manifest.chrome.json       Chrome extension manifest
  manifest.firefox.json      Firefox extension manifest
  background.js              Extension background script
  content*.js                YouTube page content scripts
  popup*.js                  Toolbar popup
  feed*.js                   Full local feed page
  import.html, import.js     Import page
  storage.js                 Browser storage wrapper
  indexeddb-storage.js       IndexedDB history storage
```

## Debugging

- Enable Debug Mode in Settings for extra logs.
- Use `about:debugging` in Firefox to inspect the temporary extension.
- Use `chrome://extensions/` in Chrome to inspect service worker/content script errors.
- If the local feed looks stale, reload the extension and click `Refresh` in the feed page.

For more technical details, see [Technical Documentation](./technical.md).
