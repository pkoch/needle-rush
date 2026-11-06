# Music sources and personalization

## Implemented foundation

The game server already consumes provider-independent questions and opaque MP3 clips. The refactor removes Jellyfin assumptions from the bridge's planning and delivery stages. It preserves v32 behavior while creating a boundary for additional sources.

`CatalogSource.catalog()` yields `Track(track_id, title, artist, duration, reference)`. A `ClipSource` also supplies `audio_file(track_id, reference, work_dir)` as a context manager and `artwork(track_id, reference)` as a bounded JPEG or `None`. Provider references stay private. They must be JSON-serializable and must not contain credentials or access tokens.

The current clip transport requires source audio of at least 45 seconds, from which the existing planner chooses a random 30-second excerpt. The shared encoder handles loudness, format, tags, checksums, and validation. Providers must be permitted to supply audio for this processing and delivery; catalog access or an SDK player alone is not that capability.

To add an exportable-file provider:

1. Implement the contract in a new adapter module. Keep authentication and provider-specific IDs in that module. Bound downloads, timeouts, and catalog sizes, and avoid logging secrets or signed URLs.
2. Register its factory in `sources.py`; configure a stable source ID and provider type.
3. Download temporary audio only inside `work_dir` and remove it on context exit. Borrowed local originals must remain unmodified. Never pass a remote URL to FFmpeg.
4. Return `None` only for genuinely absent artwork. Raise sanitized errors for transient failures so they remain retryable.
5. Verify discovery, duplicate/excluded songs, exact source routing, resume, transient errors, cleanup, and uploaded-field privacy. `test_support.py` provides an independent fixture, not a production source.

Catalog aggregation keeps the first configured source for duplicate normalized artist/title pairs. This preserves the current deduplication behavior; it does not yet distinguish studio/live/remastered recordings through ISRC or other recording identifiers. Future cross-service matching should prefer an exact recording ID, then carefully checked title/artist/duration metadata.

New private manifests embed `{version: 1, id, trackId, reference}` under `source`. Old top-level `path`, `itemId`, and `albumId` fields remain readable without rewriting the manifest. Stable routing prevents config reordering from changing a resumed pack's provider.

## Product direction agreed during discussion

The objective is for every player to influence the music with little effort. Service login was proposed as a convenience, and is not a prerequisite for the first version. Manual copy/paste imports are not the desired experience. The host's Jellyfin collection is mostly their own taste, so broad catalog coverage matters as much as collecting preferences.

Scope is now personal/family use, without monetization or public events. This narrows the intended audience; it does not itself override a provider's API terms or turn Jellyfin into a music license.

A practical first experience is a phone lobby step: search and tap a few favorite artists, then mark ready. Reuse preferences on later visits if desired. An approved account or scrobbler connection could populate that same preference model later. Artist choices should be validated against actually playable tracks before promising representation.

Keep preferences separate from playback sources. The next pipeline is: collect preferences, find candidate recordings, resolve playable audio, distribute selections fairly, freeze the pack, prepare or preload it, and start the match. Current generic warm packs are prepared before players join; personalized packs need a later preparation point or a cache selected after preferences are known.

A match has ten rounds and can have sixteen players. Do not promise one unique song per person per match. Prefer tracks representing shared tastes and rotate selection across matches. Handle sparse catalogs explicitly rather than silently replacing everyone's choices with the host's library.

## Preview-based rounds: proposed, not implemented

Official previews can be sufficient for gameplay. A preview source must describe the actual playable clip and duration separately from the full song's duration. Do not send a 30-second preview into the current 45-second eligibility check or random-offset encoder.

Add a separate playback transport for provider-hosted preview URLs or an official SDK. Stream through the permitted mechanism; do not assume permission to download, transcode, cache, or rehost. Resolve expiring URLs near playback and handle unavailable tracks before the round begins. Never substitute unofficial endpoints or another app's credentials when access fails.

For timed rounds, start the shared clock when the designated speaker begins playback. Publish a server-controlled deadline based on the validated clip duration, keep TV and phones synchronized, and close guesses once. Missing answers should become unanswered at expiry. Prevent replay loops; handle buffering, playback failure, host handoff, and backgrounded devices without relying solely on one browser's `ended` event. Preserve existing points rules until a separate scoring change is agreed.

Preview playback also affects the postgame playlist: it should replay the authorized excerpt and show attribution/link requirements, rather than implying that a full recording is available. Confirm whether attribution can wait until answer reveal; always-visible title/artist requirements would conflict with a hidden-answer quiz.

## Provider research, checked 6 November 2026

These are integration findings, not a legal clearance for the app. Confirm the exact use and current access before committing to a provider.

- Spotify explicitly prohibits games, including trivia, in its standard developer policy. Its preview clips have promotional-use restrictions. Using Spotify only for preferences does not automatically exempt a game from the policy. https://developer.spotify.com/policy
- TIDAL's published Developer Guidelines require express written approval for games/quizzes and mixing its content with other services. Playback uses the official player SDK. Treat it as an approval-dependent integration. https://developer.tidal.com/documentation/guidelines/guidelines-developer-guidelines
- Apple's iTunes Search API previews are for promotion, not independent entertainment. https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/
- Deezer's published API terms cover noncommercial applications, up-to-30-second access without Premium+, and strictly private use within a family scope. They do not give explicit quiz approval. Other uses require review. https://developers.deezer.com/termsofuse
- Deezer's Community Manager reported on 19 October 2025 that creation of new API access for private individuals had been disabled; no reopening was verified in this research. Confirm authorized access before relying on account login or treating an anonymous endpoint response as permission. https://en.deezercommunity.com/features-feedback-44/api-auth-impossible-80857?postid=254887
- Jamendo offers per-track Creative Commons material and commercial licensing. Check the actual track license, API conditions, and game-specific scope. Catalog recognition may not fit the familiar-song goal. https://devportal.jamendo.com/api_terms_of_use and https://support-licensing.jamendo.com/individual-licenses
- Tuned Global offers game music infrastructure and licensing support, but requires rights-holder agreements; its catalog is not automatically cleared for any game. https://solutions.tunedglobal.com/commercial-music-provider-for-game-developers
- YouTube's standard developer rules do not permit extracting audio or treating a hidden video player as an MP3 source. A permitted visible-player experience would require different game presentation. https://developers.google.com/youtube/terms/developer-policies

The next provider decision is a small Deezer feasibility check for the private family scope: authorized API access, permitted quiz use and answer concealment, representative track coverage, and direct browser preview playback. If access or terms do not fit, retain Jellyfin and seek a permission-based source instead of building around an unsupported integration.

Live feasibility observation: on 6 November 2026, opening the official public Deezer search endpoint in a browser returned three catalog records with preview URLs without a login. The preview-media navigation was blocked by the browser client, so actual audio playback and duration were not verified. This observation confirms endpoint availability only, not authorized application access or quiz permission.
