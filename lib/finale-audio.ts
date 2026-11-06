import type { FinaleCue } from './finale';

/** Small, original Web Audio stings. No samples, music files, or autoplay unlocks. */
export const FINALE_AUDIO_MAX_LATENESS_MS = 200;
const MASTER_GAIN = 0.18;
const SILENCE = 0.0001;

type Note = {
  frequency: number;
  endFrequency?: number;
  at: number;
  duration: number;
  peak: number;
  type: OscillatorType;
};

type Voice = { oscillator: OscillatorNode; envelope: GainNode };
type Sound = { cancel: () => void };

const frequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

function notesFor(cue: FinaleCue): Note[] {
  const notes: Note[] = [
    { frequency: 140, endFrequency: 66, at: 0, duration: 0.11, peak: 0.28, type: 'sine' },
  ];
  const add = (midi: number, at: number, duration: number, peak = 0.12) => {
    notes.push({ frequency: frequency(midi), at, duration, peak, type: 'triangle' });
  };
  if (cue.kind === 'winner') {
    [72, 76, 79, 84, 88].forEach((midi, index) => add(midi, 0.025 + index * 0.07, 0.22, 0.11));
    [72, 76, 79].forEach(midi => add(midi, 0.42, 0.48, 0.07));
  } else if (cue.kind === 'second') {
    [79, 84, 88, 91].forEach((midi, index) => add(midi, 0.015 + index * 0.075, 0.2));
  } else if (cue.kind === 'third') {
    [76, 79, 84].forEach((midi, index) => add(midi, 0.015 + index * 0.07, 0.22));
  } else {
    // Lower placements climb gently through one octave; the medals rise above it.
    add(60 + Math.min(12, Math.max(0, cue.groupIndex)), 0.012, 0.19, 0.16);
  }
  return notes;
}

/** Schedule one self-contained sound, with an explicit cancellation handle. */
function scheduleSound(
  context: BaseAudioContext,
  cue: FinaleCue,
  startsAt: number,
  onComplete: () => void,
): Sound {
  const voices = new Set<Voice>();
  let master: GainNode | null = null;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    try { master?.disconnect(); } catch { /* Already disconnected or closed. */ }
    onComplete();
  };
  const cancel = () => {
    if (finished) return;
    for (const voice of voices) {
      voice.oscillator.onended = null;
      try { voice.oscillator.stop(); } catch { /* A scheduled node may already be stopped. */ }
      try { voice.oscillator.disconnect(); } catch { /* Context may have closed. */ }
      try { voice.envelope.disconnect(); } catch { /* Context may have closed. */ }
    }
    voices.clear();
    finish();
  };
  try {
    master = context.createGain();
    master.gain.setValueAtTime(MASTER_GAIN, startsAt);
    master.connect(context.destination);
    for (const note of notesFor(cue)) {
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      const voice = { oscillator, envelope };
      voices.add(voice);
      const start = startsAt + note.at;
      const attack = Math.min(0.009, note.duration * 0.1);
      oscillator.type = note.type;
      oscillator.frequency.setValueAtTime(note.frequency, start);
      if (note.endFrequency) oscillator.frequency.exponentialRampToValueAtTime(note.endFrequency, start + note.duration);
      envelope.gain.setValueAtTime(SILENCE, start);
      envelope.gain.linearRampToValueAtTime(note.peak, start + attack);
      envelope.gain.exponentialRampToValueAtTime(SILENCE, start + note.duration);
      oscillator.connect(envelope);
      envelope.connect(master);
      oscillator.onended = () => {
        try { oscillator.disconnect(); } catch { /* Context may have closed. */ }
        try { envelope.disconnect(); } catch { /* Context may have closed. */ }
        voices.delete(voice);
        if (voices.size === 0) finish();
      };
      oscillator.start(start);
      oscillator.stop(start + note.duration + 0.012);
    }
  } catch {
    // A suspended/closed/unsupported audio device must never interrupt the visual ceremony.
    cancel();
  }
  return { cancel };
}

/**
 * The caller owns the existing TV context and speaker lease. This controller never
 * creates or resumes a context. Losing ownership must call cancel immediately.
 */
export function createFinaleAudio(
  context: AudioContext,
  canPlay: () => boolean,
  getServerNow: () => number,
): { play: (cue: FinaleCue) => void; cancel: () => void } {
  const consumed = new Set<string>();
  const active = new Set<Sound>();
  const cancel = () => {
    for (const sound of active) sound.cancel();
    active.clear();
    // Retain consumed IDs: returning to an old snapshot must not replay its cue.
  };
  const onStateChange = () => {
    // Web Audio time can pause independently of wall time. Never let queued notes
    // reappear when a browser later resumes a suspended/interrupted context.
    if (context.state !== 'running') cancel();
    if (context.state === 'closed') context.removeEventListener('statechange', onStateChange);
  };
  if (context.state !== 'closed') context.addEventListener('statechange', onStateChange);
  return {
    play(cue) {
      if (consumed.has(cue.eventId)) return;
      const lateBy = getServerNow() - cue.startsAt;
      // Do not enqueue future stings. The shared presentation timeline calls when due.
      if (lateBy < 0) return;
      consumed.add(cue.eventId);
      if (!Number.isFinite(lateBy) || lateBy > FINALE_AUDIO_MAX_LATENESS_MS || context.state !== 'running') return;
      try { if (!canPlay()) return; } catch { return; }
      let sound: Sound | undefined;
      let completedSynchronously = false;
      sound = scheduleSound(context, cue, context.currentTime + 0.008, () => {
        completedSynchronously = true;
        if (sound) active.delete(sound);
      });
      if (!completedSynchronously) active.add(sound);
    },
    cancel,
  };
}

/** Render the same original cues into a caller-provided offline context for QA/video. */
export async function renderFinaleAudioPreview(
  context: OfflineAudioContext,
  cues: ReadonlyArray<{ cue: FinaleCue; at: number }>,
): Promise<AudioBuffer> {
  for (const { cue, at } of cues) {
    if (Number.isFinite(at) && at >= 0) scheduleSound(context, cue, at, () => {});
  }
  return context.startRendering();
}
