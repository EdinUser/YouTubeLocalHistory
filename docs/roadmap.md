# YT re:Watch roadmap

This roadmap describes the intended direction after the stable v5.1 release,
published on 14 August 2026.
It is not a promise of dates or final scope. Priorities may change when design,
privacy, browser-policy, or technical findings require it.

Only completed work belongs in the
[changelog](changelog.md). Work listed here is not part of the current stable
release unless its release notes say otherwise.

## v5.2 — Experimental AI-labeled video handling

Status: planned experimental feature

An opt-in setting will let users badge, dim, or hide videos that YouTube itself
marks as made with AI. It is not a general AI detector: an unmarked video is
not confirmed non-AI. When enabled, re:Watch will make a paced direct YouTube
lookup only for previously unchecked cards near the viewport and cache the
result locally. The implementation remains conditional on packaged Chrome and
Firefox canaries because the YouTube response is undocumented.

## Future discovery — Optional OAuth and expanded YouTube imports

Status: discovery required; no target version

The planned direction is to make supported YouTube data easier to
bring into re:Watch without changing the extension's local-first storage
model.

Planned areas include:

- an optional OAuth connection with narrowly defined permissions;
- importing the user's YouTube subscriptions;
- importing YouTube playlists as references containing their title, available
  basic details, and original YouTube link;
- retaining appropriate file-based imports alongside OAuth-supported flows;
- clearly explaining authentication, token storage, requested access, and
  what remains local.

Imported YouTube playlist references will open their original playlist on
YouTube. They are not the same as extension-managed local playlists.

### History import

YouTube history exports and page formats are unstable. History import will
remain experimental or under investigation until a reliable, privacy-safe
workflow can be verified. It is not assigned to a numbered release.

It is not a guaranteed part of a numbered release until its permissions,
token storage, privacy behavior, and cross-browser design are verified.

## Future discovery — Cross-device synchronization

Status: discovery required; no target version

YT re:Watch currently stores data locally. Manual backup and restore remain the
supported way to move data between devices.

Chrome and Firefox synchronization APIs have different limits, behavior, and
failure modes. They also do not provide one shared cross-browser storage
service. A solution must be researched before automatic synchronization can be
promised.

The discovery should determine:

- which data should synchronize: settings, subscriptions, playlist references,
  local playlists, watch progress, or full history;
- realistic data sizes, update frequency, quotas, throttling, and recovery
  behavior;
- whether browser-provided synchronization is sufficient;
- whether cross-browser synchronization requires an external provider or a
  re:Watch service;
- authentication, encryption, key management, deletion, and privacy behavior;
- conflict resolution when multiple devices modify the same records offline;
- migration, rollback, cost, maintenance, and browser-store implications.

The discovery must produce an architectural proposal and a tested prototype
before synchronization is assigned to a release version. Until then,
automatic synchronization is not promised and re:Watch remains local-first.

## Future implementation — Embedded YouTube videos

Status: future implementation; no target version

YT re:Watch may extend local history and watch-progress tracking to YouTube
videos embedded on websites outside YouTube. The intended approach is to
observe playback from within the YouTube player frame without requesting
broad access to the surrounding website.

The implementation should address:

- ordinary YouTube embeds and privacy-enhanced `youtube-nocookie.com` embeds;
- recording meaningful playback rather than merely detecting a loaded player;
- progress updates, completed-video behavior, and repeated visits;
- embedded playlists and players that change videos without reloading;
- avoiding collection of the embedding page's URL or contents by default;
- a fresh manifest-permission and privacy review;
- equivalent Chrome and Firefox behavior, static coverage, and opt-in live
  canary tests.

This work requires focused discovery and a cross-browser design before it is
assigned to a release version.

## Pre-release process

When a planned release becomes testable, development builds may use semantic
pre-release versions such as:

- `v5.2.0-alpha.1` for incomplete developer testing;
- `v5.2.0-beta.1` for broader testing of mostly complete behavior;
- `v5.2.0-rc.1` for an intended release candidate;
- `v5.2.0` for the stable release.

Every pre-release should state what is incomplete, list known limitations and
data risks, explain any backup requirements, and provide a feedback channel.

## Maintaining this roadmap

Future ideas may be added here as they arise. Each item should identify its
status and intended user outcome without promising a date before its scope and
technical design are understood.
