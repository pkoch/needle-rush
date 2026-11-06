# Needle Rush development and deployment

The full product contract is ../proposals/needle-rush/GOAL.md in the server workspace. The game is in acceptance testing. Real library preparation is verified; browser audio/recovery and the physical party trial remain outstanding.

## Current services

The Sites Worker owns rooms and sessions in D1. Private R2 is provisioned for future clips. The outbound connector is installed, enabled and running under its resource limits. The owner identity is provisioned, bootstrap is disabled, and the owner explicitly approved public internet access. Guest pages are public; owner and connector operations and private clips remain authorized server-side.

## Owner setup

Production defaults to locked hosting. On a confirmed owner-private Site, temporarily set BOOTSTRAP_ENABLED=true using Sites runtime environment tools and deploy the same source. The owner signs in at /host and clicks Claim this private Site; the first atomic claim records the per-Site authenticated user ID in D1. Then remove/disable BOOTSTRAP_ENABLED and deploy before enabling any anonymous audience. Never enable bootstrap on a public Site. Alternatively provision OWNER_USER_ID as the exact trusted per-Site owner identifier through Sites runtime settings. Owner identity cannot be obtained by accepting an arbitrary guest's claim.

## Lobby flow

The signed-in owner uses /display on the TV for both shared audio and game controls. /host redirects there. Opening /display automatically creates or reopens the current active room; Start new game cancels the existing match and makes a fresh room. TV pairing is absent from the interface. The TV page and every music/control API require the exact configured owner identity. A display cookie alone grants no music or host access.

Guest phones scan the TV QR or open /join and enter the room code. They are always players, require no login, and receive a random editable two-word BIP39 name plus Another name. Player cookies are HttpOnly, Secure and SameSite=Strict; they remain room-bound. Mutating API calls require matching Origin. Capacity, name uniqueness and a single active room remain database-enforced.

## Verification

Run python3 -m unittest discover -s tests -v for production SQL/migration tests. These test concurrent capacity, case-normalized name uniqueness, lobby-only joins, single active room and one successful pairing claim. They do not prove HTTP authorization, browser behavior or Cloudflare D1 production concurrency. Run npx tsc --noEmit and the Sites build helper with the project-local Node runtime on PATH.

Keep credentials out of this source tree. Follow the installed Sites skill for source synchronization, migration deployment and rollback to a prior saved version. Do not edit applied migrations.

## Running a party

Open /display on the TV or connected laptop and sign in as the owner. The current game opens immediately; choose Start new game for a fresh match. A ready private music pack is claimed automatically; cold preparation shows progress. Future packs contain twelve excerpts (ten rounds plus two reserves), with two warm packs and a 24-hour expiry. Original music and connector resource limits are unchanged.

TV sound unlocks automatically when the browser permits it. Otherwise the first tap or non-modifier keypress anywhere on the TV unlocks audio and acquires the speaker lease without playing a test. The Rick Astley check is optional and repeatable. Phones scan the QR and join as players; the owner participates using a phone in the same guest flow. Once music, TV audio and two players are ready, any joined player can tap Start game on their phone; the TV also offers Start. Only room members or the owner can start, and concurrent starts are idempotent. Pause, resume, end, new-game and lobby removals remain owner-only on the TV. Phones remain silent.

Ten scored rounds: first correct +3, later correct +1, wrong −3, skip −1; one action per player, no answer deadline. Each excerpt loops until everyone acts. A 1.5-second reveal keeps the chosen/correct cards bright and overlays points, then a three-second countdown fades the outgoing song during its first two seconds. The next track starts at the countdown end. After the tenth reveal, player screens show only the final ranking beneath the game header. TV rankings are one enlarged vertical list, with animated movement and counting scores, respecting reduced motion.

Refresh opens the server current active match directly, ignoring stale TV localStorage room codes; audio follows the browser permission and first-interaction rules. Genuine decode failures pause and void the interrupted round; brief heartbeat gaps do not. Resume reloads the next clip. New game cancels the old room and clears players/scores.

## Connector operations

The user unit is needle-rush-bridge.service. Use systemctl --user status or journalctl --user -u needle-rush-bridge.service to inspect it. Do not restart while a preparation job is still encoding merely because it is slow: inspect job progress and the service first. CPUQuota=25%, MemoryMax=256M, TasksMax=32. Configuration is owner-only ~/.config/needle-rush/connector.json and private cache is ~/.local/state/needle-rush. No inbound tunnel exists. Source files are read-only.

Rotate the connector credential only when requested or required: stop the worker between jobs, generate a new high-entropy value into the mode-600 local configuration, set the same value as secret Sites CONNECTOR_SECRET, deploy an existing saved version to apply the environment, and restart/verify the worker. Never put values in commands, source, logs or this runbook.

For rollback, deploy a known previous saved version through the native Sites tools while preserving the current audience and disabled bootstrap. Applied D1 migrations remain; rollback code must be compatible. The service can be stopped independently without affecting media services. Keep original media, credentials and state for diagnosis.

Refreshing the TV opens pairing instead of automatically reopening its remembered room. Choose Reconnect to previous game only when you want to continue it. To start a fresh match, end the old game in owner controls and choose New game. Player-phone reconnect behavior is unchanged.

Between rounds the display preloads and decodes one upcoming clip during current play. The answer reveal lasts 1.5 seconds with full-volume music and personal result overlays. A three-second countdown follows: outgoing music fades over its first two seconds and stops before the next song. Active snapshots poll every 200 ms. Every round uses the three-second countdown. A missing preload falls back to display readiness without exposing preparation details; actual audio failures still pause safely.

Preparation progress appears as completed/total clips and a percentage in owner controls. Opening an older lobby automatically queues a missing preparation job. The encoder now measures excerpt loudness at 44.1 kHz and applies bounded gain plus a peak limiter before 192 kbps MP3 encoding, avoiding dynamic loudnorm’s 192 kHz path. It retains 30-second duration/tag/size validation, sequential encoding, 25% of one CPU and 256 MiB. Performance depends on the source and current CPU conditions; two tested excerpts ranged from roughly 1.1–2.1 times faster, not a demonstrated tenfold improvement. Stage timings are logged without titles, paths or credentials.



TV reliability release 20: filled speaker/setup/error panels explicitly use dark ink on their light background. The footer displays the current TV release. HTML/RSC page responses are no-store and include X-Needle-Release. Increment lib/release.ts when publishing client changes: snapshots include that release, and newer clients stop audio and present Load update on a mismatch. Existing pre-20 tabs cannot retroactively run this detector; close old TV tabs once and open /display?release=20. Reconnect to previous game preserves the current match and requires a fresh sound confirmation.


Release 21: each player’s own accepted option stays selected, including after reloading and during reveal. Only that player receives their option ID; correctness remains hidden until closure. Every song starts after an authoritative three-second countdown, including preloaded rounds and resume. This does not add an answer deadline. The leaderboard is one vertical descending list; the TV uses a wide sidebar to retain answer space. Rank changes animate with FLIP and score changes pulse, respecting reduced motion.

Release 22: matches contain ten scored rounds; future music packs contain twelve clips, preserving reuse of older packs. Reveal keeps the chosen and correct answers bright, dims other choices, and overlays the personal point delta. Skips receive an explicit −1 result. Choices disappear during the next countdown.

Release 24: countdown shows plain 3, 2, 1, GO! and refreshes clock state with each snapshot. Snapshot receive/send timestamps exclude server processing time from clock-offset estimates; TV lobby polling is 200 ms and player lobby polling 500 ms, avoiding the old two-second first-round delay. The separate final podium is removed: the single vertical ranking uses larger rows, a wider TV sidebar and full-width final standings. Rank movement, score counting and row flashes animate score updates, respecting reduced motion.

Release 25: the join form prefills a random editable name from two distinct words in the canonical 2048-word BIP39 English list, vendored locally. Another name rerolls the suggestion. Round result feedback lasts 1500 ms; the subsequent three-second countdown and two-second fade remain unchanged. Enable game audio acquires the TV speaker lease and unlocks audio without fetching or playing the sound-check clip. The repeatable Rick Astley test remains optional.

On the final player screen, hide the stage and guess feedback so only the final ranking remains beneath the game header. The final round still receives its 1.5-second result reveal before the final ranking.

Release 25 also consolidates ownership and playback in the TV. Guest phones have no host controls; only the owner TV needs sign-in. Legacy pairing routes are owner-authenticated and are unused by the current UI.

Release 26: removed the TV intermediary page and open-controls button. The authenticated TV looks up the current active room before creating one, so refresh does not create or select stale games. Room-member Start uses the same server music/audio/player readiness guards as owner Start; other owner controls and music access remain private. Player views retain the round/final label but remove the large joining-code block. Skip aligns with the answer column at full width. No dedicated Enable game audio button remains. Next-game-from-phone is a future step; the current new-game control remains on the owner TV.

## Release 27: precise session status, post-game loop and transition rankings

A player form does not poll room snapshots until joining, except when explicitly restoring the same saved room. Old-room cookies do not produce expiry notices on a new room's join form. Joining aborts previous polls and advances a request epoch, preventing late failures from replacing a successful session. The server reports missing, unknown, other-room, revoked and actually expired sessions separately. Only expires_at <= server time uses an expiry message; successful rejoining clears it.

After the final song fades to silence, the TV loops the ten CLOSED/scored match excerpts in play order, crossfading with equal-power curves over two seconds, including track ten back to track one. The controller schedules on the Web Audio clock, preloads one upcoming clip and keeps its queue bounded if the audio clock suspends. It stops and aborts loading on new game, lost speaker lease, navigation, cancellation or disconnection. Transient clip errors retry and clear after recovery. Phones remain silent.

The owner-only afterparty-clip endpoint accepts only CLOSED clips in a completed ten-round room, during its final reveal or FINISHED phase. Correct tracks/reserves/voids stay scoped by room and status. Completed-room clips remain private until the existing 24-hour finished-room expiry; cancelled or expired rooms are cleaned by the existing connector. Explicit owner cancellation also works on a finished room and revokes its loop audio. Starting another game stops the old loop but the old completed archive may remain until its expiry.

During countdown, hide the scoring legend and decorative headline; center a large count above the phone leaderboard and in the TV main stage. Keep the live count available to screen readers. Standings show a mint/green up arrow or pink/red down arrow to the right of points when the observed tied rank improves or falls. No arrow is invented for an unchanged or unknown previous rank. Arrows persist from reveal through countdown/finale, animate gently, and respect reduced motion.

## Release 28: soundtrack list, current-track artwork and no version footer

The final TV screen places rankings beside a numbered list of the ten scored songs; phones show the list beneath their rankings. The current song is highlighted and has a now-playing card with library album art. Missing art uses a neutral record illustration. No song list or artwork is exposed before FINISHED. The debug version/description footer is removed; release mismatch protection and no-store headers remain.

The loop announces playback from its audio clock, not during prefetch. The active TV reports the track ID through its authenticated heartbeat. D1 stores one row per room, with a five-second freshness cutoff. Reports use request-receive timestamps to reject stale out-of-order updates; stop reports leave a timestamped null-track marker so an old heartbeat cannot restart a stale indicator. Player views read the same current track and cannot report playback themselves.

Album art uses the outbound connector and existing owner-private manifests to identify the exact source file/Jellyfin album. New manifests retain local item/album IDs; older manifests resolve the exact source path against the local catalog. Missing manifests never trigger title-based artwork guessing. The connector fetches bounded 512px JPEG thumbnails from local Jellyfin, uploads checksum-verified images to room-scoped private R2, and treats absent covers as optional. Idle sync handles at most twelve pending covers per thirty seconds; artwork failures cannot block audio preparation. --covers-only permits a bounded backfill without re-encoding songs or changing jobs. Existing CPU/memory/task limits and read-only originals remain.

Migration 0007 adds nullable round artwork keys, artwork status and room-scoped postgame playback with cascade cleanup. Apply only pending local migrations; Sites applies hosted migrations before its Worker. Artwork reads require owner authentication or a matching player session in a FINISHED room. The existing room cleanup deletes artwork alongside clips.

## Release 29: merged leaderboard design

The external design handoff was compared with its exact release-26 source baseline. Imported only its finale components, scoped ranking/finale styles, timing/synth helpers and tests; retained the current bridge, migrations, dependencies, music loop, playback/artwork endpoints and session logic. The only API addition is `finaleStartsAt`, derived from the existing finished deadline. Final scores reveal in ascending rank groups on a shared server-adjusted clock, without replay on polling, late arrivals or tab recovery. TV cues share the existing speaker lease/context; phones remain silent. The post-game music loop keeps its existing start/fade timing and continues through the ceremony. The final vertical ranking sits beside the ten-song soundtrack on TVs and above it on phones, retaining current-song marking and album art. No version/description footer returns. The owner new-game action appears when the ceremony completes. The local-only finale preview remains unavailable in production.

Rankings are absent during PLAYING (and preparation); REVEAL and COUNTDOWN show them, with the existing animated mint/pink movement arrows. LOBBY retains its player lineup. The final answer reveal introduces the ceremony without disclosing the final ranking early. Actual game rules, 10 rounds, untimed guesses, skip penalties, optional Rick Astley check and automatic preparation are unchanged.

## Release 30: per-song results in the final soundtrack

Each completed match song includes player names grouped as Correct, Wrong, Skipped or No guess. Results are derived from stored attempts joined to that room's closed rounds and players; absent attempts are never classified as wrong. Only authenticated FINISHED snapshots expose the list. Mid-game privacy and scoring are unchanged. The TV soundtrack has its own keyboard-accessible scroll area for long result lists, while phones show the full list in normal page flow. Actual now-playing marking, cover art, final ceremony and vertical ranking remain.

Release 31: hide the ranking during the 1500 ms REVEAL answer-feedback phase on both TV and phones. Countdown and final rankings remain, with lobby lineup retained. TV feedback uses the full answer stage. Scoring, audio and transition timing unchanged.
The first correct answer's +3 overlay and feedback say First!; subsequent correct +1 feedback keeps Correct!.

Release 32: selectively merged the playlist redesign against exact v31 source. Answered players use matching character badges with green checks/coral crosses; compact TV layouts use initials with full-name/outcome accessible labels and hover titles. Skips and unanswered results remain in the authenticated API but are omitted visually. TV setlist uses two columns of five in round order, with the vertical ranking beside it; phones stack cards normally. Album art/current-song marking, afterparty audio, hidden feedback rankings and First! +3 behavior retained. The silent playlist-preview page is development-only.
