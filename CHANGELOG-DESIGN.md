# Needle Rush — visual refresh

Based on the supplied version 15 source archive. The original `DESIGN-HANDOFF.md` and `HANDOFF-MANIFEST.json` are retained as baseline references.

## Visual direction

An original music-party identity: tangerine, acid yellow, violet, warm cream, and deep ink. Oversized condensed typography, vinyl artwork, playful character badges, angled stickers, and crisp offset shadows connect the TV stage with phone controllers and owner controls. No Quiplash logos, characters, artwork, fonts, or other game assets are used.

- Landing: animated vinyl and tonearm composition, floating notes and stars, energetic typographic poster, and a clear join/TV/host hierarchy.
- TV lobby: prominent room code, scannable QR invitation, animated lineup entrances, original player avatars, and a speaker check card.
- Rounds: dark stage, large countdown, animated equalizer, time progress strip, bright answer badges, and a compact full ranking.
- Reveal and finish: correct-answer pop, short confetti burst, and staggered podium entrance with tied ranks preserved.
- Phones: matching palette and typography, comfortable answer targets, restrained feedback motion, and compact small-screen layouts.
- Owner controls: matching cards and labels while keeping TV pairing and player room codes distinct.
- Accessibility: visible keyboard focus, readable contrast, decorative art hidden from assistive technology, preserved status messages, and reduced-motion styles throughout.

## Scope

The changes are presentation only. Existing room state, polling, network requests, audio scheduling, sound confirmation, scoring, answers, timing, authentication, reconnect behavior, owner actions, backend routes, bridge, database migrations, hosting identity, and dependency inputs are preserved. No production deployment or private music was involved.

Changed existing files:

- `app/globals.css`
- `app/layout.tsx`
- `app/page.tsx`
- `app/display/page.tsx`
- `app/join/page.tsx`
- `app/host/page.tsx`
- `components/RoomPanel.tsx`
- `public/favicon.svg`

New files: `app/entry.css`, `components/GameArt.tsx`, the fonts and license files under `public/fonts/`, and this changelog.

## Fonts and artwork

- **Barlow Condensed ExtraBold**, by Jeremy Tribby: SIL Open Font License 1.1. Source: https://github.com/google/fonts/tree/main/ofl/barlowcondensed. License: `public/fonts/BarlowCondensed-OFL.txt`.
- **DM Sans variable**, by the DM Sans project authors: SIL Open Font License 1.1. Source: https://github.com/google/fonts/tree/main/ofl/dmsans. License: `public/fonts/DMSans-OFL.txt`.
- Fonts are bundled locally; there are no runtime font-service requests.
- Vinyl, tonearm, stars, player faces, waveform, confetti, and favicon are original CSS/SVG artwork created for this refresh. No stock or generated raster image dependencies.

## Validation

- TypeScript: `npx tsc --noEmit`.
- Production build: `npm run build` (Vinext/Vite).
- Browser visual checks use local intercepted API fixtures against the real components, with 16 players, tied rankings, TV and phone sizes, and lobby/countdown/playing/reveal/paused/preparing/finished states.
- Verified that a submitted guess disables choices without highlighting the chosen answer or revealing correctness early; phones remain silent.
- Reduced-motion mode disables ongoing animations.
- The supplied baseline hashes confirm backend, bridge, database, hosting, and dependency files are unchanged.

The private end-to-end music/backend integration was not rerun: it requires the original runtime configuration. The existing integration tests remain in the source tree. Screenshots and any motion preview use fictional room/player data and illustrative song choices; they contain no music.

## Running the source

Use the existing README and RUNBOOK. Node >=22.13 is required. Install with `npm ci`, then run `npm run dev`. This archive excludes installed dependencies, builds, local runtime state, test recordings, and secrets.
