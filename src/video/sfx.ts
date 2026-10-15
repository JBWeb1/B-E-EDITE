/**
 * Built-in sound effects, synthesised in code (no audio files to download or
 * license). Each effect renders to mono samples at SAMPLE_RATE and can be
 * turned into a WAV file to drop on the audio track.
 */
export const SAMPLE_RATE = 44100;

export type SfxCategory = 'Transitions' | 'Impacts' | 'Interface' | 'Fun';

export interface SoundEffect {
  id: string;
  name: string;
  category: SfxCategory;
  /** Seconds. */
  duration: number;
  render: () => Float32Array;
}

// ---------- Building blocks ----------

/** Small deterministic random generator, so an effect sounds the same every time. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TAU = Math.PI * 2;

function buffer(seconds: number) {
  return new Float32Array(Math.max(1, Math.round(seconds * SAMPLE_RATE)));
}

/** Oscillator whose frequency may change over time (sweeps) without clicks. */
function tone(
  out: Float32Array,
  freq: (t: number) => number,
  amp: (t: number) => number,
  shape: 'sine' | 'square' | 'saw' | 'triangle' = 'sine',
  start = 0,
) {
  let phase = 0;
  const from = Math.round(start * SAMPLE_RATE);
  for (let i = from; i < out.length; i++) {
    const t = (i - from) / SAMPLE_RATE;
    phase += freq(t) / SAMPLE_RATE;
    const p = phase - Math.floor(phase);
    const v =
      shape === 'sine' ? Math.sin(TAU * p)
      : shape === 'square' ? (p < 0.5 ? 1 : -1)
      : shape === 'saw' ? 2 * p - 1
      : 1 - 4 * Math.abs(p - 0.5);
    out[i] += v * amp(t);
  }
}

/** White noise through a one-pole low-pass whose cutoff can move over time. */
function noise(out: Float32Array, cutoff: (t: number) => number, amp: (t: number) => number, seed = 1, start = 0) {
  const rand = rng(seed);
  let y = 0;
  const from = Math.round(start * SAMPLE_RATE);
  for (let i = from; i < out.length; i++) {
    const t = (i - from) / SAMPLE_RATE;
    const k = 1 - Math.exp((-TAU * cutoff(t)) / SAMPLE_RATE);
    y += k * (rand() * 2 - 1 - y);
    out[i] += y * amp(t);
  }
}

/** Exponential decay envelope that starts at 1. */
const decay = (rate: number) => (t: number) => Math.exp(-rate * t);
/** Rise then fall, peaking at `peak` seconds; zero outside [0, len]. */
const bell = (peak: number, len: number) => (t: number) =>
  t < 0 || t > len ? 0 : t < peak ? Math.sin(((t / peak) * Math.PI) / 2) : Math.cos((((t - peak) / (len - peak)) * Math.PI) / 2);
/** Gate an envelope so it is silent outside [0, len] (avoids clicks at the end). */
const until = (len: number, env: (t: number) => number) => (t: number) => (t > len ? 0 : env(t) * Math.min(1, (len - t) * 200));

/** Scale so the loudest sample is `peak`. */
function normalize(out: Float32Array, peak = 0.9) {
  let max = 0;
  for (const v of out) max = Math.max(max, Math.abs(v));
  if (max > 0) for (let i = 0; i < out.length; i++) out[i] = (out[i] / max) * peak;
  return out;
}

/** Short fade at both ends so effects never start or stop with a click. */
function fadeEdges(out: Float32Array, seconds = 0.004) {
  const n = Math.min(Math.round(seconds * SAMPLE_RATE), out.length >> 1);
  for (let i = 0; i < n; i++) {
    const g = i / n;
    out[i] *= g;
    out[out.length - 1 - i] *= g;
  }
  return out;
}

const finish = (out: Float32Array) => fadeEdges(normalize(out));

// ---------- The library ----------

function make(id: string, name: string, category: SfxCategory, duration: number, draw: (out: Float32Array) => void): SoundEffect {
  return {
    id,
    name,
    category,
    duration,
    render: () => {
      const out = buffer(duration);
      draw(out);
      return finish(out);
    },
  };
}

export const SOUND_EFFECTS: SoundEffect[] = [
  make('whoosh', 'Whoosh', 'Transitions', 0.8, (o) => noise(o, (t) => 300 + 2700 * Math.sin((t / 0.8) * Math.PI), bell(0.35, 0.8), 7)),
  make('swoosh', 'Fast swoosh', 'Transitions', 0.4, (o) => noise(o, (t) => 600 + 6000 * (t / 0.4), bell(0.12, 0.4), 11)),
  make('riser', 'Riser', 'Transitions', 1.6, (o) => {
    tone(o, (t) => 180 + 900 * (t / 1.6) ** 2, (t) => 0.35 * (t / 1.6) ** 1.5, 'saw');
    noise(o, (t) => 500 + 5000 * (t / 1.6), (t) => 0.6 * (t / 1.6) ** 2, 3);
  }),
  make('glitch', 'Glitch', 'Transitions', 0.5, (o) => {
    const rand = rng(42);
    for (let k = 0; k < 9; k++) {
      const start = rand() * 0.42;
      const f = 150 + rand() * 1800;
      tone(o, () => f, until(0.035 + rand() * 0.03, () => 0.5), 'square', start);
    }
  }),
  make('boom', 'Boom', 'Impacts', 1.5, (o) => {
    tone(o, (t) => 40 + 90 * Math.exp(-6 * t), decay(2.8));
    noise(o, () => 900, decay(30), 5);
  }),
  make('kick', 'Drum hit', 'Impacts', 0.45, (o) => {
    tone(o, (t) => 50 + 110 * Math.exp(-30 * t), decay(9));
    noise(o, () => 4000, decay(120), 9);
  }),
  make('heartbeat', 'Heartbeat', 'Impacts', 0.9, (o) => {
    for (const [at, gain] of [[0, 1], [0.26, 0.75]] as const) tone(o, (t) => 45 + 40 * Math.exp(-20 * t), (t) => gain * decay(14)(t), 'sine', at);
  }),
  make('pop', 'Pop', 'Interface', 0.14, (o) => tone(o, (t) => 180 + 500 * Math.exp(-40 * t), decay(30))),
  make('click', 'Click', 'Interface', 0.06, (o) => {
    // Starts a few ms in, so the edge fade-in doesn't swallow the transient.
    tone(o, () => 2200, decay(120), 'sine', 0.006);
    noise(o, () => 6000, decay(400), 2, 0.006);
  }),
  make('ding', 'Ding', 'Interface', 1.3, (o) => {
    tone(o, () => 1320, decay(3.5));
    tone(o, () => 2640, (t) => 0.3 * decay(6)(t));
  }),
  make('notify', 'Notification', 'Interface', 0.55, (o) => {
    tone(o, () => 880, until(0.2, decay(10)), 'sine', 0);
    tone(o, () => 1175, decay(7), 'sine', 0.16);
  }),
  make('success', 'Success', 'Interface', 0.95, (o) => {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(o, () => f, decay(i === 3 ? 4 : 10), 'triangle', i * 0.11));
  }),
  make('error', 'Error', 'Interface', 0.5, (o) => {
    tone(o, () => 110, until(0.17, () => 0.6), 'square', 0);
    tone(o, () => 98, until(0.2, () => 0.6), 'square', 0.24);
  }),
  make('shutter', 'Camera shutter', 'Interface', 0.25, (o) => {
    noise(o, () => 3500, decay(90), 4, 0);
    noise(o, () => 2500, decay(70), 6, 0.08);
  }),
  make('typing', 'Typing', 'Interface', 0.8, (o) => {
    const rand = rng(17);
    for (let k = 0; k < 7; k++) noise(o, () => 3000 + rand() * 2000, decay(250), 20 + k, k * 0.1 + rand() * 0.04);
  }),
  make('coin', 'Coin', 'Fun', 0.5, (o) => {
    tone(o, () => 988, until(0.08, () => 0.5), 'square', 0);
    tone(o, () => 1319, (t) => 0.5 * decay(6)(t), 'square', 0.08);
  }),
  make('laser', 'Laser', 'Fun', 0.35, (o) => tone(o, (t) => 200 + 1600 * Math.exp(-9 * t), decay(6), 'square')),
  make('boing', 'Boing', 'Fun', 0.7, (o) => tone(o, (t) => 220 + 160 * Math.sin(t * 38) * Math.exp(-4 * t) + 120 * t, decay(4.5), 'triangle')),
  make('applause', 'Applause', 'Fun', 2.2, (o) => {
    const rand = rng(99);
    for (let k = 0; k < 90; k++) noise(o, () => 2500 + rand() * 2500, decay(60 + rand() * 60), 100 + k, rand() * 2.0);
    noise(o, () => 1500, bell(0.4, 2.2), 77);
  }),
];

export const SFX_CATEGORIES: SfxCategory[] = ['Transitions', 'Impacts', 'Interface', 'Fun'];

/** 16-bit PCM mono WAV file for the given samples. */
export function encodeWav(samples: Float32Array, sampleRate = SAMPLE_RATE): ArrayBuffer {
  const bytes = samples.length * 2;
  const buf = new ArrayBuffer(44 + bytes);
  const v = new DataView(buf);
  const text = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  v.setUint32(4, 36 + bytes, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true); // fmt chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  text(36, 'data');
  v.setUint32(40, bytes, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

const fileCache = new Map<string, File>();

/** The effect as a WAV file (rendered once, then reused). */
export function soundEffectFile(fx: SoundEffect): File {
  let file = fileCache.get(fx.id);
  if (!file) {
    file = new File([encodeWav(fx.render())], `${fx.name}.wav`, { type: 'audio/wav' });
    fileCache.set(fx.id, file);
  }
  return file;
}
