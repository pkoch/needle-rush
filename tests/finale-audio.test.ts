import assert from 'node:assert/strict';
import test from 'node:test';
import type { FinaleCue } from '../lib/finale';

// A URL keeps the source import native-Node-compatible without changing app resolution.
const { createFinaleAudio, FINALE_AUDIO_MAX_LATENESS_MS, renderFinaleAudioPreview }:
  typeof import('../lib/finale-audio') = await import(new URL('../lib/finale-audio.ts', import.meta.url).href);

type Event = { method: string; value: number; time: number };
class Param {
  events: Event[] = [];
  setValueAtTime(value: number, time: number) { this.events.push({ method: 'set', value, time }); }
  linearRampToValueAtTime(value: number, time: number) { this.events.push({ method: 'linear', value, time }); }
  exponentialRampToValueAtTime(value: number, time: number) { this.events.push({ method: 'exponential', value, time }); }
}
class Gain {
  gain = new Param();
  connections: unknown[] = [];
  disconnected = false;
  connect(target: unknown) { this.connections.push(target); }
  disconnect() { this.disconnected = true; }
}
class Oscillator {
  type = 'sine';
  frequency = new Param();
  starts: number[] = [];
  stops: Array<number | undefined> = [];
  connections: unknown[] = [];
  disconnected = false;
  onended: (() => void) | null = null;
  connect(target: unknown) { this.connections.push(target); }
  disconnect() { this.disconnected = true; }
  start(time: number) { this.starts.push(time); }
  stop(time?: number) { this.stops.push(time); }
}
class FakeContext extends EventTarget {
  state = 'running';
  currentTime = 12;
  destination = {};
  gains: Gain[] = [];
  oscillators: Oscillator[] = [];
  resumeCalls = 0;
  failOscillatorAt = Infinity;
  createGain() { const gain = new Gain(); this.gains.push(gain); return gain; }
  createOscillator() {
    if (this.oscillators.length === this.failOscillatorAt) throw Error('Audio device unavailable');
    const oscillator = new Oscillator(); this.oscillators.push(oscillator); return oscillator;
  }
  resume() { this.resumeCalls++; }
  setState(state: string) { this.state = state; this.dispatchEvent(new Event('statechange')); }
  asAudio() { return this as unknown as AudioContext; }
}
const cue = (overrides: Partial<FinaleCue> = {}): FinaleCue => ({
  eventId: 'room:round:group-0', kind: 'reveal', rank: 16, groupIndex: 0, startsAt: 1000, ...overrides,
});

test('one due group cue plays once across repeated snapshots', () => {
  const context = new FakeContext();
  const audio = createFinaleAudio(context.asAudio(), () => true, () => 1000);
  audio.play(cue());
  assert.equal(context.oscillators.length, 2);
  const firstCount = context.oscillators.length;
  for (let repeat = 0; repeat < 10; repeat++) audio.play(cue());
  assert.equal(context.oscillators.length, firstCount);
  assert.equal(context.resumeCalls, 0);
  assert.ok(context.oscillators.every(node => node.starts[0] >= context.currentTime));
});

test('phones, a lost lease, and suspended/closed contexts never unlock or play audio', () => {
  for (const state of ['running', 'suspended', 'closed']) {
    const context = new FakeContext(); context.state = state;
    const audio = createFinaleAudio(context.asAudio(), () => false, () => 1000);
    audio.play(cue());
    assert.equal(context.oscillators.length, 0);
    assert.equal(context.resumeCalls, 0);
  }
  for (const state of ['suspended', 'closed']) {
    const context = new FakeContext(); context.state = state;
    createFinaleAudio(context.asAudio(), () => true, () => 1000).play(cue());
    assert.equal(context.oscillators.length, 0);
  }
});

test('missed cues are consumed, and enabling audio later does not replay them', () => {
  const context = new FakeContext();
  let ownsSpeakers = false, now = 1000;
  const audio = createFinaleAudio(context.asAudio(), () => ownsSpeakers, () => now);
  audio.play(cue());
  ownsSpeakers = true;
  audio.play(cue());
  assert.equal(context.oscillators.length, 0);
  now = 1000 + FINALE_AUDIO_MAX_LATENESS_MS + 1;
  audio.play(cue({ eventId: 'late' }));
  now = 1000;
  audio.play(cue({ eventId: 'late' }));
  assert.equal(context.oscillators.length, 0);
  audio.play(cue({ eventId: 'fresh' }));
  assert.equal(context.oscillators.length, 2);
});

test('future cues are not queued; a due call can play them at the right moment', () => {
  const context = new FakeContext(); let now = 999;
  const audio = createFinaleAudio(context.asAudio(), () => true, () => now);
  audio.play(cue());
  assert.equal(context.oscillators.length, 0);
  now = 1000;
  audio.play(cue());
  assert.equal(context.oscillators.length, 2);
});

test('cancel stops and disconnects every active and future-scheduled voice, safely twice', () => {
  const context = new FakeContext();
  const audio = createFinaleAudio(context.asAudio(), () => true, () => 1000);
  audio.play(cue({ kind: 'winner', rank: 1 }));
  assert.equal(context.oscillators.length, 9);
  assert.ok(context.oscillators.some(node => node.starts[0] > context.currentTime + 0.4));
  audio.cancel(); audio.cancel();
  assert.ok(context.oscillators.every(node => node.stops.includes(undefined) && node.disconnected && node.onended === null));
  assert.ok(context.gains.every(node => node.disconnected));
  audio.play(cue({ kind: 'winner', rank: 1 }));
  assert.equal(context.oscillators.length, 9, 'a canceled event must remain consumed');
  audio.play(cue({ eventId: 'new-game:group-0' }));
  assert.equal(context.oscillators.length, 11, 'new ceremonies can reuse the controller');
});

test('all cues have finite envelopes, conservative peak bounds, and finish within one second', () => {
  for (const kind of ['reveal', 'third', 'second', 'winner'] as const) {
    const context = new FakeContext();
    createFinaleAudio(context.asAudio(), () => true, () => 1000).play(cue({ kind }));
    const master = context.gains[0].gain.events[0].value;
    const worstCasePeaks = context.gains.slice(1).reduce((sum, gain) => sum + Math.max(...gain.gain.events.map(event => event.value)), 0);
    assert.ok(master * worstCasePeaks < 0.2, `${kind} conservative sum of all voice peaks stays below 0.2`);
    for (const node of context.oscillators) {
      assert.ok(node.starts.length === 1 && node.stops.length === 1);
      assert.ok(node.stops[0]! - context.currentTime < 1);
      assert.ok(node.frequency.events.every(event => Number.isFinite(event.value) && event.value > 0));
    }
    for (const gain of context.gains.slice(1)) {
      assert.ok(gain.gain.events.every(event => Number.isFinite(event.value) && event.value > 0));
      assert.equal(gain.gain.events.at(-1)?.value, 0.0001);
    }
  }
});

test('ended voices clean themselves up and do not remain active', () => {
  const context = new FakeContext();
  const audio = createFinaleAudio(context.asAudio(), () => true, () => 1000);
  audio.play(cue());
  for (const node of context.oscillators) node.onended?.();
  assert.ok(context.gains.every(node => node.disconnected));
  const stopCounts = context.oscillators.map(node => node.stops.length);
  audio.cancel();
  assert.deepEqual(context.oscillators.map(node => node.stops.length), stopCounts);
});

test('an audio device error cannot throw into the visual ceremony or leak scheduled notes', () => {
  const context = new FakeContext(); context.failOscillatorAt = 1;
  const audio = createFinaleAudio(context.asAudio(), () => true, () => 1000);
  assert.doesNotThrow(() => audio.play(cue({ kind: 'winner' })));
  assert.ok(context.oscillators.every(node => node.disconnected && node.stops.includes(undefined)));
  assert.ok(context.gains.every(node => node.disconnected));
});

test('preview uses the same cues in a provided offline context, with explicit offsets', async () => {
  const context = new FakeContext(); context.state = 'suspended';
  const expectedBuffer = { duration: 2 };
  const offline = Object.assign(context, { startRendering: async () => expectedBuffer });
  const rendered = await renderFinaleAudioPreview(offline as unknown as OfflineAudioContext, [{ cue: cue(), at: 0.5 }]);
  assert.equal(rendered, expectedBuffer);
  assert.equal(context.oscillators[0].starts[0], 0.5);
  assert.equal(context.resumeCalls, 0);
});


test('suspending the context cancels queued notes instead of replaying them on resume', () => {
  const context = new FakeContext();
  const audio = createFinaleAudio(context.asAudio(), () => true, () => 1000);
  audio.play(cue({ kind: 'winner', rank: 1 }));
  context.setState('suspended');
  assert.ok(context.oscillators.every(node => node.stops.includes(undefined) && node.disconnected));
  context.setState('running');
  audio.play(cue({ kind: 'winner', rank: 1 }));
  assert.equal(context.oscillators.length, 9, 'resuming does not replay the interrupted cue');
  audio.play(cue({ eventId: 'fresh-after-resume' }));
  assert.equal(context.oscillators.length, 11);
  context.setState('closed');
  assert.ok(context.oscillators.every(node => node.disconnected));
  audio.cancel();
});
