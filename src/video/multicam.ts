/**
 * Multicam editing: line up several cameras by their sound, then cut between them,
 * either live (press 1, 2, 3… while it plays) or automatically (show whoever is
 * talking). Pure and unit-tested; the dialog reads the sound and plays the angles.
 */
import { uid } from '../lib/id';
import type { AudioClip, Clip, MediaAsset } from './types';
import { createClip } from './timeline';

export interface Angle {
  assetId: string;
  /** Source time in this file = time in the first (reference) camera + offset. */
  offset: number;
}

export interface Cut {
  /** Seconds on the reference camera's clock. */
  t: number;
  angle: number;
}

/** Rising loudness only: claps, words and beats line up better than plain volume. */
function onsets(env: number[]): Float64Array {
  const out = new Float64Array(env.length);
  for (let i = 1; i < env.length; i++) out[i] = Math.max(0, env[i] - env[i - 1]);
  let mean = 0;
  for (const v of out) mean += v;
  mean /= Math.max(1, out.length);
  let sd = 0;
  for (const v of out) sd += (v - mean) ** 2;
  sd = Math.sqrt(sd / Math.max(1, out.length)) || 1;
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - mean) / sd;
  return out;
}

/**
 * How far `other` is shifted from `ref` (seconds), from their loudness envelopes
 * (`rate` values a second): an event at ref time t is at other time t + offset.
 * Also returns how clear the match is (0..1).
 */
export function syncOffset(ref: number[], other: number[], rate: number, maxLag = 30): { offset: number; confidence: number } {
  const a = onsets(ref);
  const b = onsets(other);
  const max = Math.min(Math.round(maxLag * rate), Math.max(a.length, b.length));
  let best = 0;
  let bestScore = -Infinity;
  const scores: number[] = [];
  for (let lag = -max; lag <= max; lag++) {
    let sum = 0;
    let n = 0;
    for (let i = Math.max(0, -lag); i < a.length && i + lag < b.length; i++) {
      sum += a[i] * b[i + lag];
      n++;
    }
    const score = n > rate ? sum / n : -Infinity;
    scores.push(score);
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  const finite = scores.filter(Number.isFinite).sort((x, y) => y - x);
  const second = finite.find((s, i) => i > 0 && s < bestScore) ?? 0;
  const confidence = bestScore > 0 ? Math.max(0, Math.min(1, (bestScore - Math.max(0, second)) / bestScore + 0.2 * Math.min(1, bestScore))) : 0;
  return { offset: Math.round((best / rate) * 1000) / 1000, confidence: Math.round(confidence * 100) / 100 };
}

/**
 * Cut to whoever is loudest (each person with their own mic or camera), holding each
 * shot at least `minShot` seconds. `envs` are loudness per angle, already on the
 * reference clock, `rate` values a second.
 */
export function autoSwitch(envs: number[][], rate: number, minShot = 2.5): Cut[] {
  const n = Math.min(...envs.map((e) => e.length));
  if (!envs.length || !Number.isFinite(n) || n === 0) return [{ t: 0, angle: 0 }];
  // Each angle's level, smoothed over about a second and scaled to its own loudness.
  const win = Math.max(1, Math.round(rate * 0.6));
  const levels = envs.map((e) => {
    const sorted = [...e.slice(0, n)].sort((x, y) => x - y);
    const top = sorted[Math.floor(sorted.length * 0.95)] || 1;
    const out = new Float64Array(n);
    let sum = 0;
    for (let i = 0; i < n + win; i++) {
      if (i < n) sum += e[i] / top;
      if (i - 2 * win >= 0) sum -= e[i - 2 * win] / top;
      const at = i - win;
      if (at >= 0 && at < n) out[at] = sum;
    }
    return out;
  });
  const cuts: Cut[] = [];
  let current = -1;
  let since = -Infinity;
  for (let i = 0; i < n; i++) {
    let best = 0;
    for (let k = 1; k < levels.length; k++) if (levels[k][i] > levels[best][i]) best = k;
    const t = i / rate;
    // Switch only to a clearly louder angle, and only after the shot has been on long enough.
    if (best !== current && (current < 0 || (t - since >= minShot && levels[best][i] > levels[current][i] * 1.25))) {
      cuts.push({ t: Math.round(t * 100) / 100, angle: best });
      current = best;
      since = t;
    }
  }
  return cuts;
}

/** Clean a list of live cuts: sorted, starting at 0, quick double presses merged, no repeats of the same angle. */
export function tidyCuts(cuts: Cut[], minGap = 0.2): Cut[] {
  const sorted = [...cuts].sort((a, b) => a.t - b.t);
  const out: Cut[] = [];
  for (const c of sorted) {
    const last = out[out.length - 1];
    if (last && c.t - last.t < minGap) out[out.length - 1] = { t: last.t, angle: c.angle };
    else out.push(c);
  }
  // Until the first cut, the first camera is on.
  if (!out.length || out[0].t > 0) out.unshift({ t: 0, angle: 0 });
  return out.filter((c, i) => i === 0 || c.angle !== out[i - 1].angle);
}

/**
 * The finished multicam edit: main-track clips that switch angles at each cut
 * (their own sound off) and the reference camera's sound underneath on the audio
 * track, so the sound never jumps. Angles that don't cover a moment fall back to
 * the reference camera.
 */
export function buildMulticam(assets: MediaAsset[], angles: Angle[], cuts: Cut[], length: number): { clips: Clip[]; audio: AudioClip[] } {
  const list = tidyCuts(cuts);
  const clips: Clip[] = [];
  const covers = (k: number, from: number, to: number) => {
    const a = assets.find((x) => x.id === angles[k]?.assetId);
    return !!a && from + angles[k].offset >= -1e-3 && to + angles[k].offset <= a.duration + 1e-3;
  };
  for (let i = 0; i < list.length; i++) {
    const from = list[i].t;
    const to = Math.min(length, list[i + 1]?.t ?? length);
    if (to - from < 0.05) continue;
    const k = covers(list[i].angle, from, to) ? list[i].angle : 0;
    const asset = assets.find((x) => x.id === angles[k].assetId)!;
    const off = angles[k].offset;
    const last = clips[clips.length - 1];
    if (last && last.assetId === asset.id && Math.abs(last.out - (from + off)) < 1e-3) {
      last.out = to + off; // same camera again (after a fallback): one longer clip
      continue;
    }
    clips.push({ ...createClip(asset), in: Math.max(0, from + off), out: to + off, volume: 0 });
  }
  const ref = assets.find((x) => x.id === angles[0].assetId)!;
  const audio: AudioClip[] = [{ id: uid('audio'), assetId: ref.id, start: 0, in: Math.max(0, angles[0].offset), out: Math.min(ref.duration, length + angles[0].offset), volume: 1 }];
  return { clips, audio };
}

/** Loudness of angle k on the reference clock (its own envelope shifted by its offset). */
export function alignEnvelope(env: number[], offset: number, rate: number, length: number): number[] {
  const shift = Math.round(offset * rate);
  return Array.from({ length: Math.round(length * rate) }, (_, i) => env[i + shift] ?? 0);
}
