/**
 * Audio-reactive animation and track mattes (After Effects style). Pure and
 * unit-tested; the engine reads the sound and composites the pictures.
 */
import { loudness } from './ai';
import type { AudioClip, Clip, MediaAsset } from './types';
import { layoutClips } from './timeline';

/** What a layer does with the music. */
export interface React {
  prop: 'scale' | 'opacity' | 'bounce' | 'shake' | 'glow';
  /** 0..1 strength. */
  amount: number;
}

export const REACT_PROPS: { value: React['prop']; label: string; hint: string }[] = [
  { value: 'scale', label: 'Pulse', hint: 'Grows with every beat' },
  { value: 'bounce', label: 'Bounce', hint: 'Jumps up on loud moments' },
  { value: 'opacity', label: 'Flicker', hint: 'Brighter when loud, fades when quiet' },
  { value: 'shake', label: 'Shake', hint: 'Wobbles with the bass' },
  { value: 'glow', label: 'Glow', hint: 'Lights up when loud' },
];

/** Values a second in a loudness envelope. */
export const ENV_RATE = 50;

/**
 * How loud the sound is over time, 0..1: scaled to the loud parts of the file, with a
 * fast attack and a gentle release so motion follows hits but doesn't jitter.
 */
export function envelope(samples: Float32Array, sampleRate: number, perSecond = ENV_RATE, release = 0.15): Float32Array {
  const raw = loudness(samples, sampleRate, perSecond);
  const sorted = [...raw].sort((a, b) => a - b);
  const top = sorted[Math.floor(sorted.length * 0.97)] || sorted[sorted.length - 1] || 1;
  const floor = sorted[Math.floor(sorted.length * 0.2)] ?? 0;
  const out = new Float32Array(raw.length);
  const fall = Math.exp(-1 / (release * perSecond));
  let v = 0;
  for (let i = 0; i < raw.length; i++) {
    const x = Math.max(0, Math.min(1, (raw[i] - floor) / Math.max(1e-6, top - floor)));
    v = x > v ? x : v * fall + x * (1 - fall);
    out[i] = v;
  }
  return out;
}

/**
 * Sound level at project second `t`: the loudest of the audio-track clips playing then
 * (the music), or the main clip's own sound when there is no music.
 */
export function levelAt(t: number, audio: AudioClip[], clips: Clip[], envs: Map<string, Float32Array>, perSecond = ENV_RATE): number {
  let level = 0;
  let any = false;
  for (const a of audio) {
    if (t < a.start || t >= a.start + a.out - a.in || a.volume <= 0) continue;
    const env = envs.get(a.assetId);
    if (!env) continue;
    any = true;
    level = Math.max(level, env[Math.floor((a.in + t - a.start) * perSecond)] ?? 0);
  }
  if (any) return level;
  for (const pc of layoutClips(clips)) {
    if (t < pc.start || t >= pc.end || pc.clip.volume <= 0) continue;
    const env = envs.get(pc.clip.assetId);
    if (env) level = Math.max(level, env[Math.floor((pc.clip.in + (t - pc.start) * pc.clip.speed) * perSecond)] ?? 0);
  }
  return level;
}

/** How a layer moves for a sound `level` (0..1): size, see-through, offset (frame fractions), turn (degrees), glow. */
export function reactAt(r: React | undefined | null, level: number, t: number): { scale: number; opacity: number; dx: number; dy: number; rotation: number; glow: number } {
  const out = { scale: 1, opacity: 1, dx: 0, dy: 0, rotation: 0, glow: 0 };
  if (!r || r.amount <= 0) return out;
  const k = Math.max(0, Math.min(1, r.amount)) * Math.max(0, Math.min(1, level));
  switch (r.prop) {
    case 'scale':
      out.scale = 1 + 0.35 * k;
      break;
    case 'bounce':
      out.dy = -0.08 * k;
      break;
    case 'opacity':
      out.opacity = 0.25 + 0.75 * Math.max(0, Math.min(1, level)) ** (0.5 + r.amount);
      break;
    case 'shake':
      out.dx = 0.02 * k * Math.sin(t * 61);
      out.dy = 0.02 * k * Math.sin(t * 47 + 1.3);
      out.rotation = 4 * k * Math.sin(t * 37);
      break;
    case 'glow':
      out.glow = k;
      break;
  }
  return out;
}

// ---------- Track mattes ----------

export type MatteMode = 'alpha' | 'alpha-inverted' | 'luma' | 'luma-inverted';

export const MATTE_MODES: { value: MatteMode; label: string; hint: string }[] = [
  { value: 'alpha', label: 'Inside', hint: 'Show the layer only inside the text or shape' },
  { value: 'alpha-inverted', label: 'Outside', hint: 'Cut the text or shape out of the layer' },
  { value: 'luma', label: 'Bright parts', hint: 'Show where the matte is bright' },
  { value: 'luma-inverted', label: 'Dark parts', hint: 'Show where the matte is dark' },
];

/** A matte layer: show this layer only through a text/shape item (hidden itself). */
export interface Matte {
  /** Id of the text or shape item used as the matte. */
  textId: string;
  mode: MatteMode;
}

/**
 * Turn the matte picture into a mask in its own alpha channel (in place): keep alpha
 * for 'alpha', invert it, or use brightness for the luma modes.
 */
export function matteToMask(rgba: Uint8ClampedArray, mode: MatteMode): void {
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3];
    let m: number;
    if (mode === 'alpha') m = a;
    else if (mode === 'alpha-inverted') m = 255 - a;
    else {
      const luma = (0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2]) * (a / 255);
      m = mode === 'luma' ? luma : 255 - luma;
    }
    rgba[i + 3] = m;
  }
}

/** Assets whose sound drives audio-reactive layers (music on the audio track, else the clips). */
export function reactSources(audio: AudioClip[], clips: Clip[], assets: MediaAsset[]): string[] {
  const ids = new Set(audio.map((a) => a.assetId));
  if (!ids.size) for (const c of clips) if (assets.find((a) => a.id === c.assetId)?.kind === 'video') ids.add(c.assetId);
  return [...ids];
}
