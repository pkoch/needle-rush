"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { PlayerAvatar } from './GameArt';
import {
  buildFinaleSchedule, crossedFinaleCue, cueForGroup, getFinaleFrame, ordinal,
  type FinaleCue, type FinaleGroup, type FinalePlayer, type RankedFinalePlayer,
} from '../lib/finale';

export type FinalResultsProps = {
  players: readonly FinalePlayer[];
  playerId: string | null;
  roomKey: string;
  startsAt: number | null;
  mode: 'tv' | 'phone';
  getServerNow: () => number;
  onCue?: (cue: FinaleCue) => void;
  onNewGame?: () => void;
  busy?: boolean;
  soundtrack?: ReactNode;
};

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useLayoutEffect(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

function scoreLabel(score: number) {
  return score < 0 ? `−${Math.abs(score)}` : String(score);
}

function PlayerContents({ player, playerId, feature = false }: { player: RankedFinalePlayer; playerId: string | null; feature?: boolean }) {
  return <>
    <span className="finale-rank" aria-label={`${ordinal(player.rank)} place`}><span aria-hidden="true">{feature ? ordinal(player.rank) : player.rank}</span></span>
    <PlayerAvatar id={player.id}/>
    <span className="finale-player-name" title={player.name}>{player.name}{player.id === playerId && <span className="finale-you-tag">YOU</span>}</span>
    <strong className="finale-player-score" aria-label={`${player.score} points`}><span aria-hidden="true">{scoreLabel(player.score)}</span><small aria-hidden="true">PTS</small></strong>
  </>;
}

function groupAnnouncement(group: FinaleGroup) {
  const names = group.players.map(player => player.name).join(', ');
  return `${group.players.length > 1 ? 'Joint ' : ''}${ordinal(group.rank)} place: ${names}. ${group.score} points.`;
}

/** A new room remounts the ceremony; ordinary polling deliberately does not. */
export default function FinalResults(props: FinalResultsProps) {
  return <FinalResultsScene key={props.roomKey} {...props}/>;
}

function FinalResultsScene(props: FinalResultsProps) {
  const { playerId, roomKey, mode, onNewGame, busy = false } = props;
  const [schedule] = useState(() => buildFinaleSchedule(props.players));
  const [startsAt] = useState(() => Number.isFinite(props.startsAt) ? props.startsAt : null);
  const [elapsed, setElapsed] = useState(() => startsAt === null ? schedule.totalDurationMs : Math.max(0, Math.min(schedule.totalDurationMs, props.getServerNow() - startsAt)));
  const elapsedRef = useRef(elapsed);
  const initialElapsed = useRef(elapsed);
  const latest = useRef(props);
  latest.current = props;
  const reduced = useReducedMotion();
  const spokenGroup = useRef<number | null>(null);
  const playedCues = useRef(new Set<string>());
  const [announcement, setAnnouncement] = useState('The final results.');
  const featureNodes = useRef(new Map<string, HTMLElement>());
  const slotNodes = useRef(new Map<string, HTMLLIElement>());
  const previousSlots = useRef(new Map<string, DOMRect>());
  const previousFullBoard = useRef(false);
  const frame = getFinaleFrame(schedule, elapsed);
  const group = frame.group;
  const fullBoard = frame.stage === 'settling' || frame.stage === 'complete';
  const settledIds = new Set(frame.settledPlayers.map(player => player.id));
  const tier = group ? Math.min(4, group.rank) : fullBoard ? 1 : 0;
  const winnerNames = schedule.winners.map(player => player.name);
  const showConfetti = initialElapsed.current < schedule.revealsEndMs && (group?.rank === 1 || fullBoard);

  useEffect(() => {
    if (startsAt === null || elapsedRef.current >= schedule.totalDurationMs) return;
    let animationFrame = 0;
    let previousVisible = document.visibilityState === 'visible';
    let stopped = false;
    const advance = (allowCue: boolean) => {
      if (stopped) return;
      const before = elapsedRef.current;
      const next = Math.max(before, Math.min(schedule.totalDurationMs, Math.max(0, latest.current.getServerNow() - startsAt)));
      const visible = document.visibilityState === 'visible';
      if (allowCue && visible && previousVisible && mode === 'tv') {
        const crossed = crossedFinaleCue(schedule, before, next);
        if (crossed) {
          const cue = cueForGroup(roomKey, startsAt, crossed);
          if (!playedCues.current.has(cue.eventId)) {
            playedCues.current.add(cue.eventId);
            // An unavailable/closed audio context must not stop the visual ceremony.
            try { latest.current.onCue?.(cue); } catch { /* Continue silently. */ }
          }
        }
      }
      previousVisible = visible;
      elapsedRef.current = next;
      if (next !== before) setElapsed(next);
    };
    const tick = () => {
      advance(true);
      if (elapsedRef.current < schedule.totalDurationMs && !stopped) animationFrame = requestAnimationFrame(tick);
    };
    const visibility = () => {
      previousVisible = false;
      advance(false);
    };
    animationFrame = requestAnimationFrame(tick);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      stopped = true;
      cancelAnimationFrame(animationFrame);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [mode, roomKey, schedule, startsAt]);

  useEffect(() => {
    if (group && spokenGroup.current !== group.index) {
      spokenGroup.current = group.index;
      setAnnouncement(groupAnnouncement(group));
    } else if (frame.stage === 'complete') {
      setAnnouncement('The final ranking is complete.');
    }
  }, [group, frame.stage]);

  // Every featured card flies to the rectangle of its actual reserved leaderboard slot.
  // Setting currentTime from the shared clock also handles late snapshots and resize recovery.
  useLayoutEffect(() => {
    if (!group) return;
    let animations: Animation[] = [];
    const animate = () => {
      animations.forEach(animation => animation.cancel());
      animations = [];
      const age = Math.max(0, elapsedRef.current - group.startsAtMs);
      for (const player of group.players) {
        const node = featureNodes.current.get(player.id);
        const slot = slotNodes.current.get(player.id);
        if (!node || !slot) continue;
        const source = node.getBoundingClientRect();
        const destination = slot.getBoundingClientRect();
        let keyframes: Keyframe[];
        if (reduced || mode === 'phone') {
          keyframes = [
            { opacity: 0, transform: mode === 'phone' && !reduced ? 'translateY(8px)' : 'none', offset: 0 },
            { opacity: 1, transform: 'none', offset: Math.min(180, group.enterMs) / group.durationMs },
            { opacity: 1, transform: 'none', offset: 1 - Math.min(140, group.slotMs) / group.durationMs },
            { opacity: 0, transform: 'none', offset: 1 },
          ];
        } else {
          const dx = destination.left - source.left;
          const dy = destination.top - source.top;
          const sx = destination.width / Math.max(1, source.width);
          const sy = destination.height / Math.max(1, source.height);
          const tilt = group.rank === 1 ? 8 : group.rank <= 3 ? 6 : 4;
          keyframes = [
            { opacity: 0, transform: `translateX(${-source.right - 70}px) rotate(-${tilt}deg) scale(.88)`, offset: 0, easing: 'cubic-bezier(.16,1,.3,1)' },
            { opacity: 1, transform: `translateX(${group.rank <= 3 ? 20 : 12}px) rotate(1.5deg) scale(${group.rank === 1 ? 1.06 : 1.025})`, offset: group.enterMs * .72 / group.durationMs, easing: 'ease-out' },
            { opacity: 1, transform: 'translate(0,0) rotate(0) scale(1)', offset: group.enterMs / group.durationMs },
            { opacity: 1, transform: 'translate(0,0) rotate(0) scale(1)', offset: (group.durationMs - group.slotMs) / group.durationMs, easing: 'cubic-bezier(.5,0,.2,1)' },
            { opacity: 1, transform: `translate(${dx}px,${dy}px) rotate(0) scale(${sx},${sy})`, offset: 1 },
          ];
        }
        const animation = node.animate(keyframes, { duration: group.durationMs, fill: 'both' });
        animation.currentTime = Math.min(group.durationMs, age);
        animations.push(animation);
        // Keep the landing silhouette, without compressing the spotlight typography into a row.
        if (mode === 'tv' && !reduced) {
          const travelStart = group.durationMs - group.slotMs;
          for (const child of Array.from(node.children)) {
            const fade = child.animate([
              { opacity: 1, offset: 0 },
              { opacity: 1, offset: travelStart / group.durationMs },
              { opacity: 0, offset: (travelStart + group.slotMs * .45) / group.durationMs },
              { opacity: 0, offset: 1 },
            ], { duration: group.durationMs, fill: 'both' });
            fade.currentTime = Math.min(group.durationMs, age);
            animations.push(fade);
          }
        }
      }
    };
    const onVisibility = () => { if (document.visibilityState === 'visible') animate(); };
    animate();
    window.addEventListener('resize', animate);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      animations.forEach(animation => animation.cancel());
      window.removeEventListener('resize', animate);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [group, mode, reduced]);

  // Expand the growing side board into its final full-width composition without teleporting rows.
  useLayoutEffect(() => {
    const now = new Map<string, DOMRect>();
    const animations: Animation[] = [];
    slotNodes.current.forEach((slot, id) => {
      const rectangle = slot.getBoundingClientRect();
      now.set(id, rectangle);
      const previous = previousSlots.current.get(id);
      if (fullBoard && !previousFullBoard.current && previous && mode === 'tv' && !reduced) {
        const row = slot.querySelector<HTMLElement>('.finale-row');
        if (row) animations.push(row.animate([
          { transform: `translate(${previous.left - rectangle.left}px,${previous.top - rectangle.top}px) scale(${previous.width / Math.max(1, rectangle.width)},${previous.height / Math.max(1, rectangle.height)})`, transformOrigin: 'top left' },
          { transform: 'translate(0,0) scale(1)', transformOrigin: 'top left' },
        ], { duration: 700, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'both' }));
      }
    });
    previousSlots.current = now;
    previousFullBoard.current = fullBoard;
    const rememberSlots = () => {
      if (!fullBoard) previousSlots.current = new Map(Array.from(slotNodes.current, ([id, slot]) => [id, slot.getBoundingClientRect()]));
    };
    window.addEventListener('resize', rememberSlots);
    return () => {
      animations.forEach(animation => animation.cancel());
      window.removeEventListener('resize', rememberSlots);
    };
  }, [fullBoard, group?.index, mode, reduced]);

  return <section className="finale-scene" data-stage={frame.stage} data-mode={mode} data-tier={tier} data-reduced-motion={reduced} data-room-key={roomKey} data-has-soundtrack={!!props.soundtrack} aria-label="Final results ceremony">
    <div className="finale-atmosphere" aria-hidden="true">
      <i className="finale-beam finale-beam-left"/><i className="finale-beam finale-beam-right"/>
      <div className="finale-orbit finale-orbit-one"/><div className="finale-orbit finale-orbit-two"/>
      <span className="finale-star finale-star-one">✦</span><span className="finale-star finale-star-two">✳</span><span className="finale-star finale-star-three">✦</span>
      {showConfetti && !reduced && <div className="finale-confetti">{Array.from({ length: 44 }, (_, index) => <i key={index} style={{ '--piece': index, left: `${(index * 37) % 100}%`, animationDelay: `${(index % 7) * .09}s` } as CSSProperties}/>)}</div>}
    </div>
    <header className="finale-masthead"><span className="finale-brand"><span className="finale-brand-record" aria-hidden="true"/>NEEDLE RUSH</span><span className="finale-edition">THE AFTER PARTY <span aria-hidden="true">✦</span></span></header>

    {frame.stage === 'opening' && <div className="finale-opening">
      <span className="finale-eyebrow">THE SCORES ARE IN. THE LEGENDS BEGIN.</span>
      <h1>THE FINAL<br/><em>RESULTS.</em></h1>
      <div className="finale-opening-line" aria-hidden="true"><span/><b>✦</b><span/></div>
      <p>Every ear had its moment.<br/>Here comes yours.</p>
    </div>}

    {fullBoard && <header className="finale-winner-banner" data-winners={schedule.winners.length}>
      <span className="finale-winner-kicker"><span aria-hidden="true">✦</span>{schedule.winners.length > 1 ? 'SHARING THE CROWN' : 'THE ROOM HAS A LEGEND'}<span aria-hidden="true">✦</span></span>
      <h1>{!winnerNames.length ? 'WHAT A ROOM.' : winnerNames.length <= 3 ? winnerNames.join(' + ') : `${winnerNames.length} ROOM LEGENDS`}</h1>
      {schedule.winners.length > 0 && <p>{scoreLabel(schedule.winners[0].score)} points <span aria-hidden="true">·</span> {schedule.winners.length > 1 ? 'Joint first place. Every bit deserved.' : 'First place. Certified good ears.'}</p>}
    </header>}

    <div className="finale-content" data-full-board={fullBoard}>
      {!fullBoard && <section className="finale-spotlight" aria-label="Current reveal">
        {group && <div className="finale-reveal" key={group.index} data-rank={group.rank} data-tied={group.players.length > 1} data-group-size={group.players.length} style={{ '--reveal-duration': `${group.durationMs}ms` } as CSSProperties}>
          <div className="finale-reveal-heading"><span className="finale-eyebrow">{group.rank === 1 ? 'TURN IT UP FOR YOUR' : group.rank <= 3 ? 'NOW WE’RE TALKING' : 'MAKE SOME NOISE FOR'}</span><h2>{group.rank === 1 ? (group.players.length > 1 ? 'ROOM LEGENDS' : 'ROOM LEGEND') : `${group.players.length > 1 ? 'JOINT ' : ''}${ordinal(group.rank).toUpperCase()} PLACE`}</h2></div>
          {group.rank <= 3 && <span className="finale-impact-star" aria-hidden="true">✦</span>}
          <div className="finale-feature-grid" data-count={group.players.length} data-dense={group.players.length > 4}>
            {group.players.map(player => <article ref={node => { if (node) featureNodes.current.set(player.id, node); else featureNodes.current.delete(player.id); }} className="finale-feature-card" key={player.id} data-feature-player-id={player.id} data-rank={player.rank} data-you={player.id === playerId} style={{ transformOrigin: 'top left' }}><PlayerContents player={player} playerId={playerId} feature/></article>)}
          </div>
          <p className="finale-reveal-caption">{group.rank === 1 ? 'GOOD EARS. BIG BRAGGING RIGHTS.' : group.rank === 2 ? 'SO CLOSE. SO VERY LOUD.' : group.rank === 3 ? 'THE PODIUM IS CALLING.' : 'THAT’S A PLACE IN THE PARTY.'}</p>
        </div>}
      </section>}

      {frame.stage !== 'opening' && <section className="finale-board" aria-label="Final player ranking">
        <div className="finale-board-heading"><h2>{fullBoard ? 'THE WHOLE ROOM. ALL LEGENDS.' : 'THE RANKING'}</h2><span>{frame.revealedCount} / {schedule.players.length} REVEALED</span></div>
        {schedule.players.length ? <ol className="finale-ranking" data-columns={schedule.players.length > 8 ? 2 : 1} data-count={schedule.players.length} style={{ '--finale-board-rows': schedule.players.length > 8 ? Math.ceil(schedule.players.length / 2) : schedule.players.length } as CSSProperties} aria-label="Ranking, highest score first">
          {schedule.players.map(player => {
            const settled = settledIds.has(player.id);
            return <li className="finale-slot" ref={node => { if (node) slotNodes.current.set(player.id, node); else slotNodes.current.delete(player.id); }} key={player.id} data-empty={!settled} aria-hidden={!settled ? true : undefined}>
              {settled ? <div className="finale-row" data-player-id={player.id} data-rank={player.rank} data-you={player.id === playerId}><PlayerContents player={player} playerId={playerId}/></div> : <div className="finale-placeholder"><span/><i/><span/></div>}
            </li>;
          })}
        </ol> : <p className="finale-empty">No player results are available for this game.</p>}
      </section>}
      {fullBoard && props.soundtrack}
    </div>
    {frame.stage === 'complete' && <footer className="finale-footer">{mode === 'tv' && onNewGame && <button className="button primary finale-new-game" onClick={onNewGame} disabled={busy}>Start new game <span aria-hidden="true">↗</span></button>}{mode === 'phone' && <p>The next encore starts on the TV.</p>}</footer>}
    <p className="finale-live-status" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
  </section>;
}
