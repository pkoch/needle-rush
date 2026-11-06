"use client";

import { useEffect, useState } from 'react';
import FinalResults from './FinalResults';
import PostgamePlaylist, { type PostgameSong } from './PostgamePlaylist';

const names = ['Maya', 'Theo', 'Jules', 'Raf', 'Nico', 'Zoe', 'Alex', 'Sam', 'Bea', 'Eli', 'Remy', 'Leo', 'Ari', 'Noor', 'Kit', 'Midnight Listener'];
const tracks = [
  ['Neon Afterglow', 'The Electric Hours'],
  ['One More Night on the Dance Floor', 'Velvet Radio'],
  ['Golden Hour', 'Luna & the Satellites'],
  ['Come Around Again', 'The Daydream Club'],
  ['Midnight City Lights', 'Stereo Hearts'],
  ['Turn It Up', 'Saturday People'],
  ['Somewhere Between the Stars', 'The Weekend Echo'],
  ['Nothing but Sunshine', 'Cassette Summer'],
  ['Last Train Home', 'Northern Arcade'],
  ['Stay for the Encore', 'Paper Moon Parade'],
] as const;

export default function PlaylistPreview() {
  const [hydrated,setHydrated] = useState(false);
  useEffect(()=>setHydrated(true),[]);
  const [count, setCount] = useState(16);
  const [playingIndex, setPlayingIndex] = useState(4);
  const [run, setRun] = useState(0);
  const [mode, setMode] = useState<'tv' | 'phone'>('tv');
  useEffect(() => {
    const query = matchMedia('(max-width: 899px)');
    const update = () => setMode(query.matches ? 'phone' : 'tv');
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  const players = names.slice(0, count).map((name, index) => ({ id: `playlist-demo-player-${index}`, name, score: 27 - index * 2 }));
  const songs: PostgameSong[] = tracks.map(([title, artist], trackIndex) => ({
    id: `playlist-demo-track-${trackIndex}`, title, artist, artworkUrl: null,
    results: players.map((player, playerIndex) => {
      const choice = (playerIndex + trackIndex * 3) % 10;
      return {
        playerId: player.id, name: player.name,
        outcome: trackIndex === 0 ? 'correct' : trackIndex === 1 ? 'wrong' : choice < 6 ? 'correct' : choice < 8 ? 'wrong' : choice === 8 ? 'skipped' : 'unanswered',
      };
    }),
  }));

  return <main className={`playlist-preview-shell ${mode === 'tv' ? 'tv' : 'controller'}`}>
    <style>{`
      .playlist-preview-shell { width:100%;max-width:none;min-height:100svh;margin:0;padding:0;background:#1a0c32;color:#fff6df; }
      .playlist-preview-toolbar { position:fixed;z-index:60;top:12px;right:28px;display:flex;align-items:center;gap:8px;padding:5px 7px;border:1px solid #a78aff50;border-radius:8px;background:#1a0c32f5;box-shadow:0 3px 15px #0002; }
      .playlist-preview-toolbar>span { color:#c7a8ee;font:800 9px var(--font-body);letter-spacing:.08em; }
      .playlist-preview-toolbar select,.playlist-preview-toolbar button { min-height:29px;padding:5px 8px;border:1px solid #a78aff70;border-radius:5px;background:#291640;color:#fff6df;font:700 10px var(--font-body);cursor:pointer; }
      .playlist-preview-toolbar button { background:#e5ff54;border-color:#e5ff54;color:#211629; }
      .playlist-preview-toolbar :is(select,button):focus-visible { outline:3px solid #e5ff54;outline-offset:3px; }
      .playlist-preview-shell .finale-edition { visibility:hidden; }
      @media(max-width:899px) {
        .playlist-preview-toolbar { top:16px;left:16px;right:16px;justify-content:space-between;gap:5px;padding:4px 6px; }
        .playlist-preview-toolbar>span { font-size:8px; }
        .playlist-preview-shell .finale-masthead { visibility:hidden; }
      }
    `}</style>
    <div className="playlist-preview-toolbar" role="group" aria-label="Local soundtrack preview controls">
      <span>LOCAL DEMO · SILENT</span>
      <select disabled={!hydrated} aria-label="Preview player count" value={count} onChange={event => setCount(Number(event.target.value))}>
        <option value={2}>2 players</option><option value={8}>8 players</option><option value={16}>16 players</option>
      </select>
      <button type="button" disabled={!hydrated} onClick={() => setPlayingIndex(index => (index + 1) % tracks.length)}>Next track ↗</button>
    </div>
    <FinalResults
      roomKey={`playlist-demo-${count}-${run}`}
      players={players} playerId={mode === 'phone' ? players[0].id : null}
      startsAt={null} mode={mode} getServerNow={Date.now}
      onNewGame={mode === 'tv' ? () => { setPlayingIndex(0); setRun(value => value + 1); } : undefined}
      soundtrack={<PostgamePlaylist songs={songs} playingId={songs[playingIndex].id}/>}
    />
  </main>;
}
