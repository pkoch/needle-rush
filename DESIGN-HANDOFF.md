# Needle Rush release 32 source handoff

Matches deployed release 32. HANDOFF-MANIFEST.json records the exact baseline commit and source hashes for selective merging of returned changes.

Includes the compact two-column TV playlist, player character badges for correct/wrong answers, current-song highlight and album art, animated final results, vertical rankings, TV-only crossfading music loop, and existing game/session fixes. Rankings stay hidden during guesses and 1.5-second feedback, then return for countdown/final results. First correct +3 says First!; other correct +1 says Correct!. Wrong guesses cost 3 points, skips 1; ten rounds with no guessing timer. Skipped/unanswered results remain in the API but are omitted from playlist badges.

Visual entrypoints: components/PostgamePlaylist.tsx, components/FinalResults.tsx, components/StandingsList.tsx, components/RoomPanel.tsx, app/globals.css, app/finale.css and app/leaderboard.css. Preserve game rules, timing, audio, auth/API, bridge, migrations and hosting identity. Development-only /playlist-preview and /finale-preview support local visual checks and are unavailable in production. See README.md and RUNBOOK.md for setup; Node >=22.13 is required.

Excludes credentials, environment files, private music, local databases, runtime state, installed dependencies, build output and Git history. Private integration settings must be supplied separately.
