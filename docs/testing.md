# Testing

The v5 test strategy separates deterministic release gates from external YouTube canaries. Both Chrome and Firefox are first-class targets.

## Primary commands

```bash
npm run test:local:offline
```

Runs every deterministic local gate: Jest, packaged Chromium runtime/static tests, Firefox lint/smoke/static tests, and the required browser builds. It does not depend on live YouTube pages, public RSS, or public channel metadata.

```bash
npm run test:canary
```

Runs external-change detectors: live RSS and channel metadata checks, Chrome live YouTube/permission checks, and Firefox live YouTube/permission checks. The grouped runner continues after a failed group so one external problem does not hide the remaining results. This command is suitable for a scheduled cron or CI job.

```bash
npm run test:local:full
```

Runs the widest available local command: refreshes captured fixtures, runs Jest, live RSS/metadata checks, all configured Chromium extension tests with the permission canary enabled, and all Firefox tests with the permission canary enabled. It intentionally includes external checks and can fail because of YouTube availability, consent, experiments, anti-bot behavior, or markup changes.

## Focused suites

```bash
npm test                         # all Jest suites
npm run test:unit
npm run test:integration
npm run test:memory
npm run test:coverage

npm run test:e2e:offline         # Chromium packaged runtime + captured DOM
npm run test:e2e:static          # Chromium captured-DOM project
npm run test:firefox:offline     # Firefox lint + smoke + captured DOM

npm run test:canary:chrome       # Chrome live site + permission canaries
npm run test:canary:firefox      # Firefox live site + permission canaries
npm run test:permissions-canary:live
npm run test:playlist-canary:live
```

`npm run test:e2e` runs the configured Chromium Playwright projects and includes live specs. Use `test:e2e:offline` when external YouTube must not affect the result.

## Why live tests are canaries

A live YouTube failure can be caused by product markup, consent presentation, localization, experiments, network state, rate limits, CAPTCHA/anti-bot behavior, or an actual extension regression. It is an alert requiring investigation, not a deterministic proof that a local code change is wrong.

The live suites remain valuable because they warn when:

- a selector or SPA event contract changes;
- a public RSS/channel endpoint changes behavior;
- host permissions no longer cover a required request;
- video, playlist, Shorts, or resume behavior diverges in production.

The consent helper targets the main page and known consent frames, using semantic controls and bounded fallbacks. Optional `yt-storage.json` can preserve a locally accepted consent state; it must remain gitignored.

## Captured YouTube DOM

Deterministic browser tests use reference documents under `helpers/important/` and captured fixtures under `tests/fixtures/youtube/`. They exercise selectors and extension behavior without requesting live YouTube.

When a live canary exposes new markup:

1. capture the smallest relevant subtree;
2. remove personal/session data;
3. add or update the fixture;
4. reproduce the issue in Chrome and Firefox fixture suites;
5. change production logic only after the deterministic regression is present.

This keeps store-release gates stable while retaining early warning for external changes.

## Browser execution

Chromium tests use Playwright with an unpacked extension from `build/e2e/chrome`. Firefox tests use Selenium with a temporary profile and the extension from `build/e2e/firefox`.

Both are headless by default. Set `PW_HEADED=1` for supported visible debugging flows. Install Playwright's Chromium once when needed:

```bash
npx playwright install chromium
```

Firefox tests require a compatible Firefox installation and geckodriver available to the fixture.

## Release artifacts

```bash
npm run test:release:artifacts
npm run test:release:chrome
npm run test:release:firefox
```

The artifact integration gate builds in isolation and verifies Chrome/Firefox directory and archive parity plus referenced manifest/HTML files. The release browser commands run the static release-feed contract against `build/chrome` and `build/firefox`.

## Documentation checks

```bash
npm run docs:safety
npm run docs:build
```

`docs:safety` checks tracked documentation assets for privacy problems. The screenshot generator uses fictional data and blocks external requests.

## Interpreting failures

- A deterministic Jest/static failure blocks release until understood.
- A Chrome-only or Firefox-only deterministic failure must be investigated in that browser; the other browser passing is not sufficient.
- A live canary failure should record the failing external contract and be reproduced against a captured fixture when possible.
- Never weaken a deterministic assertion merely because a live page is unstable.
