"use client";

import { useEffect, useRef, useState } from 'react';
import FinalResults from './FinalResults';
import { createFinaleAudio } from '../lib/finale-audio';
import type { FinaleCue, FinalePlayer } from '../lib/finale';

type Scenario = '2' | '8' | '16' | 'tied';
type PreviewGame = { players: FinalePlayer[]; startsAt: number; key: string };
const names = ['Maya', 'Theo', 'Jules', 'Raf', 'Nico', 'Zoe', 'Alex', 'Sam', 'Bea', 'Eli', 'Remy', 'Leo', 'Ari', 'Noor', 'Kit', 'Pip'];

function shuffled<T,>(items: T[]) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const next = Math.floor(Math.random() * (index + 1));
    [result[index], result[next]] = [result[next], result[index]];
  }
  return result;
}
function randomPlayers(scenario: Scenario): FinalePlayer[] {
  const count = scenario === 'tied' ? 8 : Number(scenario);
  const scores = shuffled([-6, -3, 0, 2, 4, 6, 8, 10, 12, 15, 17, 20, 22, 25, 27, 30]).slice(0, count);
  if (scenario === 'tied') { scores[0] = 33; scores[1] = 33; }
  return shuffled(names).slice(0, count).map((name, index) => ({ id: `preview-${index}`, name, score: scores[index] }));
}

export default function FinalePreview() {
  const [scenario, setScenario] = useState<Scenario>('8');
  const [game, setGame] = useState<PreviewGame | null>(null);
  const [mode, setMode] = useState<'tv' | 'phone'>('tv');
  const [sound, setSound] = useState(true);
  const [starting, setStarting] = useState(false);
  const context = useRef<AudioContext | null>(null);
  const audio = useRef<ReturnType<typeof createFinaleAudio> | null>(null);
  const enabled = useRef(true);
  enabled.current = sound && mode === 'tv';
  const sequence = useRef(0);

  useEffect(() => {
    const query = matchMedia('(max-width: 899px)');
    const change = () => setMode(query.matches ? 'phone' : 'tv');
    change(); query.addEventListener('change', change);
    const hide = () => { if (document.visibilityState === 'hidden') audio.current?.cancel(); };
    document.addEventListener('visibilitychange', hide);
    return () => {
      query.removeEventListener('change', change);
      document.removeEventListener('visibilitychange', hide);
      audio.current?.cancel();
      void context.current?.close();
    };
  }, []);

  async function start(reuse = false) {
    if (starting) return;
    setStarting(true);
    audio.current?.cancel();
    if (enabled.current) {
      try {
        context.current ??= new AudioContext();
        await context.current.resume();
        audio.current ??= createFinaleAudio(context.current, () => enabled.current && document.visibilityState === 'visible', Date.now);
      } catch { /* The visual demo remains available without audio. */ }
    }
    const startsAt = Date.now();
    setGame({ players: reuse && game ? game.players : randomPlayers(scenario), startsAt, key: `local-preview-${startsAt}-${++sequence.current}` });
    setStarting(false);
  }
  const cue = (event: FinaleCue) => { audio.current?.play(event); };
  const toggleSound = () => {
    audio.current?.cancel();
    setSound(value => !value);
  };

  const controls = <>
    <label className="preview-scenario"><span className="preview-label">ROOM</span><select aria-label="Preview room size" value={scenario} onChange={event => setScenario(event.target.value as Scenario)}><option value="2">2 players</option><option value="8">8 players</option><option value="16">16 players</option><option value="tied">Tied winners</option></select></label>
    {mode === 'tv' && <button className="preview-sound" type="button" aria-pressed={sound} onClick={toggleSound}>{sound ? 'Sound on ♪' : 'Sound off'}</button>}
  </>;

  return <main className={`finale-preview-shell ${mode === 'tv' ? 'tv' : 'controller'}`}>
    <style>{`
      .finale-preview-shell { width:100%; max-width:none; min-height:100svh; margin:0; padding:0; background:#1a0c32; color:#fff6df; }
      .preview-welcome { min-height:100svh; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:40px 24px; text-align:center; overflow:hidden; position:relative; isolation:isolate; background:radial-gradient(ellipse at 50% 40%,#6531b755,transparent 65%); }
      .preview-welcome::before { content:''; position:absolute; z-index:-1; width:70vw; min-width:500px; aspect-ratio:1; border:1px solid #a78aff30; border-radius:50%; box-shadow:0 0 0 70px #a78aff08,0 0 0 140px #a78aff06; }
      .preview-eyebrow { color:#a78aff; font-size:10px; font-weight:800; letter-spacing:.24em; }
      .preview-welcome h1 { font:800 clamp(80px,11vw,160px)/.8 var(--font-display); letter-spacing:-.02em; margin:27px 0 23px; text-shadow:5px 6px 0 #0c031c,8px 9px 0 #7961e8; }
      .preview-welcome h1 em { display:block; font-style:normal; color:#e5ff54; }
      .preview-welcome > p { font-size:14px; color:#cbb5e5; line-height:1.6; max-width:390px; margin:0 0 28px; }
      .preview-start-controls { display:flex; align-items:center; gap:12px; margin-bottom:22px; }
      .preview-scenario { display:flex; align-items:center; gap:9px; }
      .preview-label { color:#bda2db; font-size:8px; letter-spacing:.15em; font-weight:800; }
      .finale-preview-shell select,.preview-sound,.preview-replay { min-height:36px; border:1px solid #a78aff70; border-radius:6px; padding:8px 10px; font:700 11px var(--font-body); background:#291640; color:#fff6df; }
      .finale-preview-shell select { cursor:pointer; }
      .finale-preview-shell option { background:#291640; color:#fff6df; }
      .preview-watch { display:flex; align-items:center; gap:24px; border:2px solid #0c031c; border-radius:10px; background:#e5ff54; color:#211629; box-shadow:5px 6px 0 #0c031c; min-height:62px; padding:16px 28px; font:800 16px var(--font-body); cursor:pointer; }
      .preview-watch span { font-size:22px; }
      .preview-welcome > small { color:#a58bbf; font-size:10px; margin-top:25px; }
      .preview-toolbar { position:fixed; z-index:60; right:30px; top:14px; display:flex; align-items:center; gap:8px; padding:6px 8px; border:1px solid #a78aff30; border-radius:10px; background:#1a0c32ed; box-shadow:0 3px 15px #0002; }
      .preview-toolbar .preview-label { display:none; }
      .preview-toolbar .preview-replay:last-child { background:#e5ff54; border-color:#e5ff54; color:#211629; }
      .finale-preview-shell:has(.preview-toolbar) .finale-edition { visibility:hidden; }
      .finale-preview-shell button:focus-visible,.finale-preview-shell select:focus-visible { outline:3px solid #e5ff54; outline-offset:3px; }
      @media(max-width:899px) {
        .preview-toolbar { position:absolute; top:68px; left:18px; right:18px; justify-content:center; padding:6px; gap:6px; }
        .preview-toolbar .preview-replay { padding:8px; font-size:10px; }
        .finale-preview-shell:has(.preview-toolbar) .finale-masthead { margin-bottom:68px; }
        .finale-preview-shell:has(.preview-toolbar) .finale-opening { padding-top:20px; }
        .preview-welcome h1 { font-size:88px; }
        .preview-welcome > p { font-size:12px; }
      }
    `}</style>
    {!game ? <section className="preview-welcome">
      <span className="preview-eyebrow">NEEDLE RUSH · LOCAL PREVIEW</span>
      <h1>FRONT-ROW<em>SEATS.</em></h1>
      <p>A room full of random scores. One big reveal.<br/>Turn it up and see who takes the crown.</p>
      <div className="preview-start-controls">{controls}</div>
      <button className="preview-watch" disabled={starting} onClick={() => void start()}>Watch the finale <span aria-hidden="true">↗</span></button>
      <small>{mode === 'tv' ? 'Original sound cues included. No game setup needed.' : 'Quiet phone preview. No game setup needed.'}</small>
    </section> : <>
      <div className="preview-toolbar" aria-label="Local preview controls">
        {controls}
        <button type="button" className="preview-replay" disabled={starting} onClick={() => void start(true)}>Replay</button>
        <button type="button" className="preview-replay" disabled={starting} onClick={() => void start()}>New random scores ↗</button>
      </div>
      <FinalResults players={game.players} playerId={mode === 'phone' ? game.players[0].id : null} roomKey={game.key} startsAt={game.startsAt} mode={mode} getServerNow={Date.now} onCue={mode === 'tv' ? cue : undefined} onNewGame={mode === 'tv' ? () => void start() : undefined}/>
    </>}
  </main>;
}
