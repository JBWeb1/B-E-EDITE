/**
 * The maths behind the AI tools: finding pauses, cutting them out, picking the
 * best moments for a Short and turning speech-to-text results into captions.
 * Everything here is pure (plain arrays in, plain data out) and unit-tested;
 * the speech, translation and voice models live in `lib/aiService.ts`.
 */
import { uid } from '../lib/id';
import type { Caption } from './timeline';
import type { Clip } from './types';

export interface Range {
  start: number;
  end: number;
}

/** Loudness envelope: RMS level of each 1/perSecond slice of the samples. */
export function loudness(samples: Float32Array, sampleRate: number, perSecond = 50): number[] {
  const size = Math.max(1, Math.floor(sampleRate / perSecond));
  const out: number[] = [];
  for (let i = 0; i < samples.length; i += size) {
    const end = Math.min(samples.length, i + size);
    let sum = 0;
    for (let j = i; j < end; j++) sum += samples[j] * samples[j];
    out.push(Math.sqrt(sum / (end - i)));
  }
  return out;
}

export interface SilenceOptions {
  /** A slice is quiet when it is below this fraction of the loud level (0.1 ≈ -20 dB). */
  threshold?: number;
  /** Only pauses at least this long (seconds) are removed. */
  minSilence?: number;
  /** Keep this much (seconds) of each pause next to speech, so cuts don't clip words. */
  pad?: number;
}

/** Quiet stretches (in seconds from the start of the samples) worth cutting out. */
export function findSilences(env: number[], perSecond: number, opts: SilenceOptions = {}): Range[] {
  const threshold = opts.threshold ?? 0.1;
  const minSilence = opts.minSilence ?? 0.6;
  const pad = opts.pad ?? 0.15;
  if (env.length === 0) return [];
  // "Loud" is the 95th percentile, so one bang doesn't make all speech look quiet.
  const sorted = [...env].sort((a, b) => a - b);
  const loud = sorted[Math.floor(sorted.length * 0.95)] || sorted[sorted.length - 1];
  if (loud < 1e-4) return [{ start: 0, end: env.length / perSecond }]; // all silent
  const limit = loud * threshold;
  const out: Range[] = [];
  let from = -1;
  const total = env.length / perSecond;
  for (let i = 0; i <= env.length; i++) {
    const quiet = i < env.length && env[i] < limit;
    if (quiet && from < 0) from = i;
    if (!quiet && from >= 0) {
      const s = from / perSecond;
      const e = i / perSecond;
      if (e - s >= minSilence) {
        // Pauses at the very start or end are cut fully; inside, leave a little air.
        const start = from === 0 ? 0 : s + pad;
        const end = i === env.length ? total : e - pad;
        if (end - start > 0.05) out.push({ start, end });
      }
      from = -1;
    }
  }
  return out;
}

/** Parts of [from, to] that are not inside any of `cuts`. */
export function keepRanges(from: number, to: number, cuts: Range[]): Range[] {
  const out: Range[] = [];
  let t = from;
  for (const c of [...cuts].sort((a, b) => a.start - b.start)) {
    if (c.end <= t || c.start >= to) continue;
    if (c.start > t) out.push({ start: t, end: c.start });
    t = Math.max(t, c.end);
  }
  if (to > t) out.push({ start: t, end: to });
  return out.filter((r) => r.end - r.start > 0.04);
}

/**
 * Split a clip into the pieces that remain once the silent `cuts` (in source seconds)
 * are removed. The first piece keeps the clip's id and transition.
 */
export function cutClip(clip: Clip, cuts: Range[]): Clip[] {
  const keep = keepRanges(clip.in, clip.out, cuts);
  if (keep.length === 0) return [];
  return keep.map((r, i) => ({
    ...clip,
    id: i === 0 ? clip.id : uid('clip'),
    in: r.start,
    out: r.end,
    transition: i === 0 ? clip.transition : undefined,
    // Fades only make sense at the real start and end of the clip.
    fadeIn: i === 0 ? clip.fadeIn : 0,
    fadeOut: i === keep.length - 1 ? clip.fadeOut : 0,
    // Animation timing no longer lines up once the clip is chopped.
    keys: i === 0 ? clip.keys : undefined,
  }));
}

/** Total seconds inside `ranges`. */
export const totalLength = (ranges: Range[]) => ranges.reduce((s, r) => s + (r.end - r.start), 0);

/**
 * The most exciting moments: windows of `length` seconds with the highest average
 * score (loudness and/or movement, one value per 1/perSecond), not overlapping,
 * until `total` seconds are picked. Returned in time order.
 */
export function pickHighlights(score: number[], perSecond: number, total: number, length = 3): Range[] {
  const n = Math.max(1, Math.round(length * perSecond));
  const duration = score.length / perSecond;
  if (duration <= total) return [{ start: 0, end: duration }];
  const prefix = [0];
  for (const v of score) prefix.push(prefix[prefix.length - 1] + v);
  const windows: { i: number; v: number }[] = [];
  for (let i = 0; i + n <= score.length; i++) windows.push({ i, v: (prefix[i + n] - prefix[i]) / n });
  windows.sort((a, b) => b.v - a.v || a.i - b.i);
  const picked: Range[] = [];
  let sum = 0;
  for (const w of windows) {
    if (sum >= total - 1e-6) break;
    const start = w.i / perSecond;
    const len = Math.min(length, total - sum);
    const end = start + len;
    // Keep a short gap between moments so they read as separate shots.
    if (picked.some((p) => start < p.end + 0.5 && end > p.start - 0.5)) continue;
    picked.push({ start, end });
    sum += len;
  }
  return picked.sort((a, b) => a.start - b.start);
}

/** How much the picture changes between frames (0..1 per step), from grey frames. */
export function motionScore(frames: { data: Float32Array }[]): number[] {
  const out = [0];
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1].data;
    const b = frames[i].data;
    let sum = 0;
    for (let j = 0; j < a.length; j++) sum += Math.abs(a[j] - b[j]);
    out.push(sum / Math.max(1, a.length) / 255);
  }
  return out;
}

/** Scale values to 0..1. */
export function normalise(values: number[]): number[] {
  const max = Math.max(...values, 1e-9);
  return values.map((v) => v / max);
}

export interface SpeechSegment {
  start: number;
  end: number;
  text: string;
}

/**
 * Captions from speech-to-text segments, split so each one is short enough to read
 * (`maxChars`); long segments are divided by words, timed by their length.
 */
export function segmentsToCaptions(segments: SpeechSegment[], maxChars = 42): Caption[] {
  const out: Caption[] = [];
  for (const seg of segments) {
    const text = seg.text.replace(/\s+/g, ' ').trim();
    if (!text || !(seg.end > seg.start)) continue;
    const words = text.split(' ');
    const lines: string[] = [];
    let line = '';
    for (const w of words) {
      if (line && (line + ' ' + w).length > maxChars) {
        lines.push(line);
        line = w;
      } else line = line ? line + ' ' + w : w;
    }
    if (line) lines.push(line);
    const totalChars = lines.reduce((s, l) => s + l.length, 0);
    let t = seg.start;
    for (const l of lines) {
      const d = ((seg.end - seg.start) * l.length) / totalChars;
      out.push({ start: t, end: t + d, text: l });
      t += d;
    }
  }
  return out;
}

/** Move captions found in a clip's source time to project time. */
export function toProjectTime(captions: Caption[], clip: Pick<Clip, 'in' | 'out' | 'speed'>, clipStart: number): Caption[] {
  return captions
    .filter((c) => c.end > clip.in && c.start < clip.out)
    .map((c) => ({
      text: c.text,
      start: clipStart + (Math.max(c.start, clip.in) - clip.in) / clip.speed,
      end: clipStart + (Math.min(c.end, clip.out) - clip.in) / clip.speed,
    }));
}

/** Languages offered for captions, translation and voice-overs. */
export const LANGUAGES: { code: string; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'it', label: 'Italian' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'nl', label: 'Dutch' },
  { code: 'pl', label: 'Polish' },
  { code: 'tr', label: 'Turkish' },
  { code: 'ru', label: 'Russian' },
  { code: 'uk', label: 'Ukrainian' },
  { code: 'ar', label: 'Arabic' },
  { code: 'hi', label: 'Hindi' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'zh', label: 'Chinese' },
];
