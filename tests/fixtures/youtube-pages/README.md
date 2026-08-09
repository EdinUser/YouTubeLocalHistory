# YouTube Page Fixtures

This folder contains the manifest for opt-in static YouTube DOM captures.

Run:

```bash
npm run fixtures:youtube:download
```

The runner writes generated files to:

```text
tests/fixtures/youtube-pages/captures/
```

That directory is ignored on purpose. Captured YouTube HTML can contain volatile markup, generated identifiers, consent state, and accidental local signals. Treat it as local test input unless a fixture has been deliberately reviewed and sanitized.

By default the runner strips page scripts, iframes, `noscript`, and preload hints from `page.html` after the rendered DOM is captured. Use `--preserve-scripts` only for debugging the downloader itself.

Use these captures for deterministic DOM regression tests. Do not use them as proof that live YouTube playback, ads, consent, or browser media behavior still works.

Pass `--with-rss` to additionally save the three configured public RSS readings
under `tests/fixtures/feed/live/`. Those files are ignored and are consumed by
the local full-suite command, `npm run test:local:full`.
