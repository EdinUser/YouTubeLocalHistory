# YT re:Watch roadmap

This roadmap describes the intended direction after the stable v5.1 release,
published on 14 August 2026.
It is not a promise of dates or final scope. Priorities may change when design,
privacy, browser-policy, or technical findings require it.

Only completed work belongs in the
[changelog](changelog.md). Work listed here is not part of the current stable
release unless its release notes say otherwise.

## Future implementation — Optional AI checks for local re:Watch views

Status: discovery and privacy review required; no target version

AI-labeled video handling currently checks cards only while the user is
browsing an open YouTube page. re:Watch’s own Home, Subscriptions, History,
Shorts, Watch Later, channel, and playlist views use cached results only; they
never send their local video IDs to YouTube.

A future version may offer an explicit, user-started workflow to check local
videos with YouTube’s **Made with AI** disclosure. This must not run merely
because a re:Watch view is opened, rendered, paged, or scrolled. Before any
check starts, the interface must explain that video IDs from the selected local
view will be sent to YouTube and show the number of videos that can be checked.

The workflow should:

- let the user choose a narrow scope, such as currently visible videos or a
  selected local list, and confirm it before sending requests;
- use an open YouTube tab’s runtime context instead of opening background tabs
  or relying on an undocumented extension-page request contract;
- deduplicate fresh cached, queued, and in-flight video IDs;
- use a bounded, visibility-prioritized queue with a strict global concurrency
  and request-start rate limit; and
- allow cancellation, drop stale work after navigation or scope changes, and
  leave cards unchanged for `unknown` results.

The feature must retain re:Watch’s local-data guarantee: in extension-owned
views, **Hide** remains a visible AI badge plus dimming, never deletion or
removal of a local history or saved-video record. It also requires updated
privacy copy, browser-specific packaged tests, and a review of the live
YouTube canary before it can be assigned to a release.

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
