/**
 * Tiny WebAudio synth for scene cues (stamp, whoosh, drop, gavel, sparkle, ascend, tear).
 * Synthesised rather than sampled: no audio files to download, license or cache.
 */
export type SfxName = 'stamp' | 'whoosh' | 'drop' | 'gavel' | 'sparkle' | 'ascend' | 'tear';

export interface Sfx {
  play(name: string): void;
  /** Must be called from a user gesture once (browsers keep audio suspended until then). */
  unlock(): void;
}

export function createSfx(): Sfx {
  let ctx: AudioContext | null = null;
  const audio = () => {
    if (!ctx && typeof AudioContext !== 'undefined') ctx = new AudioContext();
    return ctx;
  };

  const tone = (c: AudioContext, at: number, freq: number, endFreq: number, dur: number, type: OscillatorType, gain: number) => {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), at + dur);
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(g).connect(c.destination);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  };

  const noise = (c: AudioContext, at: number, dur: number, from: number, to: number, gain: number, q = 1) => {
    const buffer = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buffer;
    const filter = c.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = q;
    filter.frequency.setValueAtTime(from, at);
    filter.frequency.exponentialRampToValueAtTime(to, at + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(filter).connect(g).connect(c.destination);
    src.start(at);
  };

  const sounds: Record<SfxName, (c: AudioContext, t: number) => void> = {
    stamp: (c, t) => {
      tone(c, t, 140, 45, 0.18, 'sine', 0.6);
      noise(c, t, 0.05, 2000, 600, 0.25);
    },
    whoosh: (c, t) => noise(c, t, 0.4, 300, 2400, 0.18, 0.8),
    drop: (c, t) => {
      tone(c, t, 880, 760, 0.12, 'triangle', 0.18);
      tone(c, t, 110, 60, 0.1, 'sine', 0.3);
    },
    gavel: (c, t) => {
      for (const d of [0, 0.22, 0.44]) {
        tone(c, t + d, 320, 180, 0.08, 'square', 0.12);
        noise(c, t + d, 0.04, 1500, 800, 0.15, 3);
      }
    },
    sparkle: (c, t) => [1320, 1760, 2640].forEach((f, i) => tone(c, t + i * 0.07, f, f, 0.25, 'sine', 0.08)),
    ascend: (c, t) => tone(c, t, 520, 1560, 0.6, 'sine', 0.09),
    tear: (c, t) => noise(c, t, 0.45, 800, 3500, 0.3, 2),
  };

  return {
    play(name) {
      const c = audio();
      const sound = sounds[name as SfxName];
      if (!c || !sound || c.state !== 'running') return;
      sound(c, c.currentTime + 0.01);
    },
    unlock() {
      void audio()?.resume();
    },
  };
}
