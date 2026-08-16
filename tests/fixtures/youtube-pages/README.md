# YouTube Page Fixtures

This folder contains reviewed, sanitized static YouTube DOM fixtures. They are
committed so offline tests never need to contact YouTube.

Run:

```bash
npm run fixtures:youtube:download
```

The runner refreshes files in:

```text
tests/fixtures/youtube-pages/captures/
```

The downloader automatically runs the final sanitizer. To sanitize existing
fixtures again without downloading them, run:

```bash
npm run fixtures:youtube:sanitize
```

The sanitizer removes scripts, external resource URLs, inline event handlers,
tracking-style data attributes, consent and browser chrome, and screenshots.
Review the resulting diff before committing. The tests must continue to run
with no request to YouTube or another third party.

By default the runner removes executable and network-capable markup from
`page.html` after the rendered DOM is captured. `--preserve-scripts` disables
this protection only for local downloader debugging; never commit such output.

Use these captures for deterministic DOM regression tests. Do not use them as proof that live YouTube playback, ads, consent, or browser media behavior still works.

Pass `--with-rss` to additionally save the three configured public RSS readings
under `tests/fixtures/feed/live/`. Those files are ignored and are consumed by
the local full-suite command, `npm run test:local:full`.
