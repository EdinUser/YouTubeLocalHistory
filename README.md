# ![YT re:Watch](./src/icon48.png) YT re:Watch

[![Tests](https://github.com/EdinUser/YouTubeLocalHistory/actions/workflows/ci.yml/badge.svg)](https://github.com/EdinUser/YouTubeLocalHistory/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/EdinUser/YouTubeLocalHistory)](https://github.com/EdinUser/YouTubeLocalHistory/releases)
[![Chrome Web Store](https://img.shields.io/badge/Get_it_on-Chrome_Web_Store-4285F4?logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/local-youtube-video-histo/pebiokefjgdbfnkolmblaaladkmpilba)
[![Firefox Add-ons](https://img.shields.io/badge/Get_it_on-Firefox_Add--ons-FF7139?logo=firefox-browser&logoColor=white)](https://addons.mozilla.org/firefox/addon/yt-rewatch/)

Private local YouTube history, watch progress, channel subscriptions, analytics, and an in-browser feed. No Google login is required.

YT re:Watch keeps its history inside your browser profile. It works while you switch YouTube accounts or watch logged out, restores saved positions when possible, and gives you a local feed built from channels you explicitly follow in re:Watch.

📚 [User guide](./docs/index.md) · [Complete walkthrough](./docs/detailed_guide.md) · [FAQ](./docs/faq.md) · [Changelog](./CHANGELOG.md)

## What v5.2 includes

- **Local watch history and resume:** saves progress for regular videos and Shorts and restores it across YouTube's single-page navigation.
- **Viewed overlays:** adds progress indicators to re:Watch cards and supported YouTube thumbnail layouts.
- **Experimental AI-label handling:** optionally badges, dims, or hides videos that YouTube itself discloses as made with AI.
- **Local channel follows:** follow or unfollow channels inside re:Watch without changing a YouTube account subscription.
- **Local feed:** public channel RSS builds a cached Home, chronological Subscriptions, and Shorts inventory.
- **Channels management:** review followed channels, import subscriptions from Google Takeout, and explicitly restore channels kept in the Ignored list after a local unfollow.
- **Local search:** searches saved history, cached feed videos, and channels without sending the typed query to YouTube.
- **History, Watch Later, and local playlists:** keep viewing records, saved YouTube playlist links, and extension-managed playlists in one full-page interface.
- **Private analytics:** watch time, completion, hourly/daily activity, top channels, skipped channels, and unfinished long videos are calculated locally.
- **Manual portability:** back up and restore the documented profile data using a JSON file.
- **Chrome and Firefox support:** deterministic packaged-extension suites cover the same core product behavior in both browsers.

## Interface

The toolbar popup is intentionally compact:

- Continue Watching
- Watch Later
- Open Feed

The full feed page contains:

| View | Purpose |
| --- | --- |
| **Home** | A locally regenerated mix of cached videos using freshness, watch activity, and local feedback |
| **Subscriptions** | Cached uploads from locally followed channels, sortable by upload or detection time |
| **Watch Later** | Locally saved videos, newest first |
| **Shorts** | Known short-form videos and watched Shorts |
| **Playlists** | Local playlists you manage, alongside saved YouTube playlist references that open on YouTube |
| **History** | Locally recorded videos, progress, duration, and watched time |
| **Channels** | Following and, when needed, Ignored channel management |
| **Analytics** | Locally calculated watch statistics and insights |
| **Settings** | Appearance, retention, feed timing, imports, backup/restore, and reset controls |

Home and Subscriptions render stable 50-card pages as you scroll. Subscriptions retains its selected upload-date or detection-date ordering through **Reload view** and **Show**. Checking for new videos is separate from reloading the current local view, so a background scan does not unexpectedly replace or reorder visible cards. When uploads are found, re:Watch offers a deliberate **Show** action.

The compact popup and full-page interface show the installed extension version beside the re:Watch icon, making it easier to identify the active build when reporting a problem.

Watch Later is independent of YouTube's account playlist. Right-click a recognized video or Short and choose **Save to Watch Later (local)**, or use a re:Watch video menu; the full-page Watch Later view provides newest-first Open and Remove actions.

## Local subscriptions and feed

re:Watch subscriptions are independent from YouTube account subscriptions.

You can add channels by:

- following a supported channel directly from YouTube;
- using a video-card channel action;
- entering a canonical channel or public handle in Channels;
- importing `subscriptions.csv` from Google Takeout.

A local unfollow stops future scans and removes that channel's cached feed inventory without deleting independent watch history. re:Watch records the choice locally. A later import reports that channel as ignored instead of silently following it again; the user can review it in **Channels → Ignored** and explicitly follow it again.

The feed is best-effort discovery rather than a mirror of a signed-in YouTube account. Public RSS may not represent membership, age-restricted, region-restricted, removed, or otherwise unavailable videos. YouTube applies its own access rules when a video is opened.

## Playlists in v5.2

v5 stores references to YouTube playlists encountered while the extension is active. A saved reference keeps useful public metadata and opens the original playlist on YouTube.

re:Watch does **not** crawl or hydrate every video in a YouTube playlist in the background. You can create and manage extension-owned local playlists separately; they never modify a YouTube-account playlist.

## Privacy and network boundaries

YT re:Watch does not run an application server and does not collect your saved watch history.

Stored locally:

- history and playback progress;
- local channel follows and local-unfollow exclusions;
- cached subscription-feed inventory and scheduler state;
- Watch Later and saved playlist references;
- settings, analytics, local feedback, and documented backup data.

Direct YouTube requests used by the local feed:

- public channel RSS checks;
- public channel or handle pages when identity or presentation metadata is needed;
- YouTube-hosted thumbnails, avatars, and banners displayed by the UI.
- YouTube oEmbed metadata only when a locally saved Watch Later item is missing its title or channel.

Feed metadata requests omit browser credentials. Local search does not contact YouTube. The extension does not subscribe, unsubscribe, like, comment, or modify a YouTube account.

This is not a network-anonymity tool. YouTube can still observe ordinary page and media requests, cookies, IP addresses, browser fingerprinting, advertising, and recommendation signals. See the [privacy documentation](./docs/privacy.md) for the complete boundary.

## Data and backups

The extension uses `browser.storage.local`/`chrome.storage.local` with IndexedDB for larger durable datasets.

The v5 backup includes documented profile state such as:

- history and progress;
- canonical local subscriptions and ignored-channel exclusions;
- YouTube playlist references and Watch Later;
- settings and locally calculated statistics;
- recommendation preferences and selected reusable caches.

Rebuildable feed inventory, scheduler leases/runs, and transient UI state are not authoritative backup data. Restore merges supported backup records into the current profile. Backups are plain JSON; keep them somewhere you trust.

**Clear history** removes viewing history data without deleting canonical local-feed state. **Reset all data** removes all extension data in the browser profile, including subscriptions, feed state, ignored-channel exclusions, settings, and caches.

## Installation

### Browser stores

- [Install from the Chrome Web Store](https://chromewebstore.google.com/detail/local-youtube-video-histo/pebiokefjgdbfnkolmblaaladkmpilba)
- [Install from Firefox Add-ons](https://addons.mozilla.org/firefox/addon/yt-rewatch/)

### Development build

```bash
git clone https://github.com/EdinUser/YouTubeLocalHistory.git
cd YouTubeLocalHistory
npm install
```

Prepare browser-specific unpacked builds:

```bash
npm run build:e2e:chrome
npm run build:e2e:firefox
```

Load `build/e2e/chrome` from `chrome://extensions` or `build/e2e/firefox/manifest.json` from Firefox `about:debugging`.

## Testing

The normal deterministic local suite is:

```bash
npm run test:local:offline
```

The live YouTube/public-metadata warning suite is deliberately separate:

```bash
npm run test:canary
```

To exercise only the versioned static HTML fixtures in both browsers:

```bash
npm run test:static
```

To run every available local and live group, including fresh fixture capture:

```bash
npm run test:local:full
```

See [docs/testing.md](./docs/testing.md) for individual Chromium and Firefox commands, deterministic fixture coverage, and the role of live canaries.

## Release build

```bash
npm run build
```

Release archives are written to `dist/`. The Chrome and Firefox packages use separate manifests but share the same runtime source and localized interface.

## Languages

- English
- Bulgarian
- German
- Spanish
- French

## Support and contribution

- [Documentation site](https://rewatch.kirilov.dev/)
- [GitHub issues](https://github.com/EdinUser/YouTubeLocalHistory/issues)
- [Community forum](https://community.kirilov.dev/t/re-watch)
- [Telegram community](https://t.me/+eFftKWGVvSpiZjZk)
- [Discord community](https://discord.gg/9fuvSzP7Qr)
- [Contributing guide](./docs/contributing.md)

## License

MIT License. See [LICENSE](./LICENSE).
