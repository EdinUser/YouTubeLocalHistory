# Build instructions

## Prerequisites

- Node.js 18 or newer;
- npm and Git;
- Bash (native, Git Bash, or WSL for the release scripts);
- Chromium/Chrome for Playwright extension testing;
- Firefox and a compatible geckodriver for Firefox extension testing.

## Install

```bash
git clone https://github.com/EdinUser/YouTubeLocalHistory.git
cd YouTubeLocalHistory
npm install
```

## Development builds

Prepare the unpacked Chrome test extension:

```bash
npm run build:e2e:chrome
```

Load `build/e2e/chrome` from `chrome://extensions/` with Developer mode enabled.

Prepare the unpacked Firefox test extension:

```bash
npm run build:e2e:firefox
```

Load `build/e2e/firefox/manifest.json` from `about:debugging` → **This Firefox** → **Load Temporary Add-on**. `npm run firefox:run` prepares and launches the temporary Firefox extension through the project helper.

`npm run prepare:firefox` remains available for the conventional `build/firefox` development package.

## Release checks

Start with deterministic cross-browser coverage:

```bash
npm run lint
npm run test:local:offline
npm run docs:safety
npm run docs:build
npm run test:release:artifacts
```

Run external canaries separately:

```bash
npm run test:canary
```

For the widest available command, including fixture refresh and all live checks:

```bash
npm run test:local:full
```

See [Testing](testing.md) for why deterministic gates and live canaries are reported separately.

## Release packages

```bash
npm run build
```

This invokes `build.sh`, copies the explicit release file set, and creates packages under `dist/`:

- `youtube-local-history-chrome-v{version}.zip`;
- `youtube-local-history-chrome-v{version}.crx` when Chrome signing is configured;
- `youtube-local-history-firefox-v{version}.zip`.

Chrome CRX signing requires a Chrome executable and `certs/privatekey.pem`, or paths provided through `CHROME_EXTENSION_DIR` and `PRIVATE_KEY_PATH`. ZIP artifacts can still be produced when CRX signing is unavailable.

## Release structure

```text
src/
  _locales/                  localized messages
  manifest.chrome.json       Chrome manifest
  manifest.firefox.json      Firefox manifest
  background.js              background/service-worker runtime
  content*.js                YouTube integration and tracking
  popup*.js                  compact toolbar popup
  feed*.js                   full local feed interface
  indexeddb-storage.js       extension-origin IndexedDB repository
  storage.js                 shared compatibility/storage API
```

`build.sh` copies files explicitly. When adding a loaded source file, update its copy list and the owning manifest or HTML load order, then run the release-artifact test.

## Debugging a local build

- Enable Debug Mode in re:Watch Settings for additional extension logs.
- Inspect Firefox from `about:debugging`.
- Inspect Chrome extension pages and its service worker from `chrome://extensions/`.
- Select **Reload** to redraw the feed from local storage.
- Select **Check** when you intend to scan eligible public channel feeds.
- Reload existing YouTube tabs after rebuilding or reloading the extension.
