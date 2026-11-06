/** Shared presentation timing. All times below are milliseconds, relative to the finish deadline. */
export type FinalePlayer = Readonly<{ id: string; name: string; score: number }>;
export type RankedFinalePlayer = FinalePlayer & Readonly<{ rank: number; position: number }>;
export type FinaleGroup = Readonly<{
  index: number;
  rank: number;
  score: number;
  players: readonly RankedFinalePlayer[];
  startsAtMs: number;
  endsAtMs: number;
  durationMs: number;
  enterMs: number;
  slotMs: number;
  slotStartsAtMs: number;
}>;
export type FinaleSchedule = Readonly<{
  players: readonly RankedFinalePlayer[];
  winners: readonly RankedFinalePlayer[];
  groups: readonly FinaleGroup[];
  introMs: number;
  settleMs: number;
  revealsEndMs: number;
  totalDurationMs: number;
}>;
export type FinaleCue = Readonly<{
  eventId: string;
  kind: 'reveal' | 'third' | 'second' | 'winner';
  rank: number;
  groupIndex: number;
  /** Absolute, server-adjusted wall-clock time of this reveal. */
  startsAt: number;
}>;
export type FinaleFrame = Readonly<{
  stage: 'opening' | 'reveal' | 'settling' | 'complete';
  group: FinaleGroup | null;
  settledPlayers: readonly RankedFinalePlayer[];
  revealedCount: number;
}>;

export const FINALE_INTRO_MS = 2000;
export const FINALE_SETTLE_MS = 1000;

export function groupDuration(rank: number): number {
  return rank === 1 ? 2000 : rank === 2 ? 1600 : rank === 3 ? 1400 : 800;
}

export function ordinal(rank: number): string {
  const tens = rank % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : rank % 10 === 1 ? 'st' : rank % 10 === 2 ? 'nd' : rank % 10 === 3 ? 'rd' : 'th';
  return `${rank}${suffix}`;
}

/** Stable sorting preserves the API's join-time / player-ID order inside a tie. */
export function buildFinaleSchedule(input: readonly FinalePlayer[]): FinaleSchedule {
  const sorted = input.map(player => ({ ...player })).sort((a, b) => b.score - a.score);
  const players = Object.freeze(sorted.map((player, position) => Object.freeze({
    ...player,
    position,
    rank: sorted.findIndex(candidate => candidate.score === player.score) + 1,
  })));
  const descendingGroups: RankedFinalePlayer[][] = [];
  for (const player of players) {
    const last = descendingGroups.at(-1);
    if (last?.[0].score === player.score) last.push(player);
    else descendingGroups.push([player]);
  }
  let cursor = FINALE_INTRO_MS;
  const groups = Object.freeze(descendingGroups.reverse().map((members, index) => {
    const rank = members[0].rank;
    const durationMs = groupDuration(rank);
    const enterMs = rank === 1 ? 450 : rank === 2 ? 400 : rank === 3 ? 350 : 220;
    const slotMs = rank === 1 ? 500 : rank === 2 ? 450 : rank === 3 ? 400 : 260;
    const startsAtMs = cursor;
    cursor += durationMs;
    return Object.freeze({
      index, rank, score: members[0].score, players: Object.freeze(members),
      startsAtMs, endsAtMs: cursor, durationMs, enterMs, slotMs,
      slotStartsAtMs: cursor - slotMs,
    });
  }));
  return Object.freeze({
    players,
    winners: Object.freeze(players.filter(player => player.rank === 1)),
    groups,
    introMs: input.length ? FINALE_INTRO_MS : 0,
    settleMs: input.length ? FINALE_SETTLE_MS : 0,
    revealsEndMs: input.length ? cursor : 0,
    totalDurationMs: input.length ? cursor + FINALE_SETTLE_MS : 0,
  });
}

export function getFinaleFrame(schedule: FinaleSchedule, elapsedMs: number): FinaleFrame {
  if (elapsedMs >= schedule.totalDurationMs || !schedule.players.length) {
    return { stage: 'complete', group: null, settledPlayers: schedule.players, revealedCount: schedule.players.length };
  }
  if (elapsedMs < schedule.introMs) return { stage: 'opening', group: null, settledPlayers: [], revealedCount: 0 };
  if (elapsedMs >= schedule.revealsEndMs) {
    return { stage: 'settling', group: null, settledPlayers: schedule.players, revealedCount: schedule.players.length };
  }
  const group = schedule.groups.find(candidate => elapsedMs < candidate.endsAtMs)!;
  const settledPlayers = schedule.players.filter(player => schedule.groups.some(candidate => candidate.endsAtMs <= elapsedMs && candidate.score === player.score));
  return { stage: 'reveal', group, settledPlayers, revealedCount: settledPlayers.length + group.players.length };
}

/** Only a freshly crossed cue is playable. Late snapshots and resumed tabs never catch up old sounds. */
export function crossedFinaleCue(schedule: FinaleSchedule, beforeMs: number, afterMs: number): FinaleGroup | null {
  if (afterMs < beforeMs || afterMs - beforeMs > 250) return null;
  return schedule.groups.find(group => beforeMs < group.startsAtMs && afterMs >= group.startsAtMs && afterMs - group.startsAtMs <= 160) ?? null;
}

export function cueForGroup(roomKey: string, startsAt: number, group: FinaleGroup): FinaleCue {
  return {
    eventId: `${roomKey}:reveal:${group.index}`,
    kind: group.rank === 1 ? 'winner' : group.rank === 2 ? 'second' : group.rank === 3 ? 'third' : 'reveal',
    rank: group.rank,
    groupIndex: group.index,
    startsAt: startsAt + group.startsAtMs,
  };
}
