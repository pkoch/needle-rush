import test from 'node:test';
import assert from 'node:assert/strict';
const { buildFinaleSchedule, getFinaleFrame, crossedFinaleCue, cueForGroup, ordinal } = await import(new URL('../lib/finale.ts', import.meta.url).href) as typeof import('../lib/finale');
const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Player ${i}`, score: n - i }));

test('agreed ceremony durations and every complete reveal slot remain bounded', () => {
  for (const [count, duration] of [[2, 6600], [3, 8000], [8, 12000], [16, 18400]]) {
    const schedule = buildFinaleSchedule(players(count));
    assert.equal(schedule.totalDurationMs, duration);
    assert.ok(schedule.groups.every(group => group.durationMs <= 2000));
    assert.ok(schedule.groups.every(group => group.enterMs + group.slotMs < group.durationMs));
    assert.equal(schedule.groups[0].rank, count);
    assert.equal(schedule.groups.at(-1)!.rank, 1);
  }
});

test('competition ranks, tied groups, negative scores, and API tie order are retained', () => {
  const schedule = buildFinaleSchedule([
    { id: 'b', name: 'First joined', score: 0 },
    { id: 'a', name: 'Second joined', score: 0 },
    { id: 'c', name: 'Negative', score: -3 },
    { id: 'd', name: 'Also negative', score: -3 },
    { id: 'e', name: 'Last', score: -8 },
  ]);
  assert.deepEqual(schedule.players.map(player => [player.id, player.rank]), [['b', 1], ['a', 1], ['c', 3], ['d', 3], ['e', 5]]);
  assert.deepEqual(schedule.groups.map(group => group.players.map(player => player.id)), [['e'], ['c', 'd'], ['b', 'a']]);
  assert.deepEqual(schedule.groups.map(group => group.score), [-8, -3, 0]);
});

test('all tied rooms have one equal reveal and exactly five seconds', () => {
  for (let count = 2; count <= 16; count++) {
    const schedule = buildFinaleSchedule(players(count).map(player => ({ ...player, score: -4 })));
    assert.equal(schedule.groups.length, 1);
    assert.equal(schedule.groups[0].players.length, count);
    assert.equal(schedule.totalDurationMs, 5000);
    assert.ok(schedule.players.every(player => player.rank === 1));
  }
});

test('schedule is copied and frozen against later poll mutations', () => {
  const source = players(3);
  const schedule = buildFinaleSchedule(source);
  source[0].score = -99;
  source[0].name = 'Changed';
  source.reverse();
  assert.equal(schedule.players[0].score, 3);
  assert.equal(schedule.players[0].name, 'Player 0');
  assert.ok(Object.isFrozen(schedule));
  assert.ok(Object.isFrozen(schedule.players));
  assert.ok(Object.isFrozen(schedule.players[0]));
  assert.ok(Object.isFrozen(schedule.groups[0].players));
});

test('absolute frame boundaries never disclose a future group', () => {
  const schedule = buildFinaleSchedule(players(8));
  assert.equal(getFinaleFrame(schedule, 1999).stage, 'opening');
  for (const group of schedule.groups) {
    const current = getFinaleFrame(schedule, group.startsAtMs);
    assert.equal(current.group?.index, group.index);
    assert.ok(current.settledPlayers.every(player => player.score < group.score));
    const next = getFinaleFrame(schedule, group.endsAtMs);
    assert.ok(group.players.every(player => next.settledPlayers.some(settled => settled.id === player.id)));
  }
  assert.equal(getFinaleFrame(schedule, schedule.revealsEndMs).stage, 'settling');
  assert.equal(getFinaleFrame(schedule, schedule.totalDurationMs - 1).stage, 'settling');
  assert.equal(getFinaleFrame(schedule, schedule.totalDurationMs).stage, 'complete');
  assert.equal(getFinaleFrame(schedule, schedule.totalDurationMs + 5000).settledPlayers.length, 8);
});

test('fresh crossed cues play once; jumps, late snapshots, and backwards clocks do not catch up', () => {
  const schedule = buildFinaleSchedule(players(3));
  const first = schedule.groups[0];
  assert.equal(crossedFinaleCue(schedule, 1990, 2008), first);
  assert.equal(crossedFinaleCue(schedule, 2008, 2024), null);
  assert.equal(crossedFinaleCue(schedule, 0, 2500), null);
  assert.equal(crossedFinaleCue(schedule, 1990, 2190), null);
  assert.equal(crossedFinaleCue(schedule, 2100, 1900), null);
  assert.deepEqual(cueForGroup('ROOM:round10', 10000, first), { eventId: 'ROOM:round10:reveal:0', kind: 'third', rank: 3, groupIndex: 0, startsAt: 12000 });
});

test('all score patterns preserve the minimum duration and complete player coverage', () => {
  for (let count = 2; count <= 16; count++) {
    for (let groups = 1; groups <= count; groups++) {
      const schedule = buildFinaleSchedule(players(count).map((player, i) => ({ ...player, score: i % groups - 5 })));
      assert.ok(schedule.totalDurationMs >= 5000);
      assert.equal(schedule.groups.flatMap(group => group.players).length, count);
      assert.equal(new Set(schedule.groups.flatMap(group => group.players.map(player => player.id))).size, count);
      assert.ok(schedule.groups.every(group => group.durationMs <= 2000));
      assert.ok(schedule.groups.every((group, i) => i === 0 || group.startsAtMs === schedule.groups[i - 1].endsAtMs));
    }
  }
});

test('empty results are complete and ordinal suffixes are correct', () => {
  assert.equal(getFinaleFrame(buildFinaleSchedule([]), 0).stage, 'complete');
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 16, 21].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '16th', '21st']);
});
