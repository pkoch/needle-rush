/** A short, original stereo chime that works without a downloaded audio asset. */
export function createSpeakerCheckBuffer(context: AudioContext): AudioBuffer {
  const rate = context.sampleRate;
  const buffer = context.createBuffer(2, Math.ceil(rate * 2.4), rate);
  const left = buffer.getChannelData(0), right = buffer.getChannelData(1);
  const notes = [523.25, 659.25, 783.99, 1046.5];

  for (let note = 0; note < notes.length; note++) {
    const start = Math.round((0.05 + note * 0.35) * rate);
    const pan = note / (notes.length - 1);
    const leftGain = Math.cos(pan * Math.PI / 2);
    const rightGain = Math.sin(pan * Math.PI / 2);
    for (let frame = 0; frame < rate * 1.1 && start + frame < buffer.length; frame++) {
      const time = frame / rate;
      const attack = Math.min(1, time / 0.008);
      const release = Math.min(1, (1.1 - time) / 0.12);
      const envelope = attack * release * Math.exp(-5.5 * time);
      const phase = 2 * Math.PI * notes[note] * time;
      const sample = 0.24 * envelope * (Math.sin(phase) + 0.18 * Math.sin(phase * 2));
      left[start + frame] += sample * leftGain;
      right[start + frame] += sample * rightGain;
    }
  }
  return buffer;
}
