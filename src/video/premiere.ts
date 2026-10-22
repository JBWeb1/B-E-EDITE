/**
 * Premiere Pro-style editing: roll, slip and slide edits, J and L cuts, splitting a
 * clip at its scene changes, colour match, and the colour scopes (waveform,
 * vectorscope, histogram). Pure and unit-tested.
 */
import type { Filters } from '../lib/filters';
import { NEUTRAL_FILTERS } from '../lib/filters';
import { uid } from '../lib/id';
import type { Keyframe } from './anim';
import type { ColorGrade } from './grade';
import { NEUTRAL_GRADE, NEUTRAL_WHEEL } from './grade';
import { clipDuration, layoutClips, MIN_CLIP_SECONDS, sourceLength } from './timeline';
import type { AudioClip, Clip, MediaAsset, VideoProject } from './types';

const lengthOf = (assets: MediaAsset[], clip: Clip) => {
  const a = assets.find((x) => x.id === clip.assetId);
  return a ? sourceLength(a) : clip.out;
};

/**
 * Roll edit: move the cut between clip `index - 1` and clip `index` by `dt` project
 * seconds. One clip gets longer, the other shorter; the total length stays the same.
 */
export function rollEdit(clips: Clip[], index: number, dt: number, assets: MediaAsset[]): Clip[] {
  const a = clips[index - 1];
  const b = clips[index];
  if (!a || !b) return clips;
  // How far the cut can move: neither clip may vanish or run past its footage.
  const lo = Math.max(-(clipDuration(a) - MIN_CLIP_SECONDS), -(b.in / b.speed));
  const hi = Math.min(clipDuration(b) - MIN_CLIP_SECONDS, (lengthOf(assets, a) - a.out) / a.speed);
  const d = Math.max(lo, Math.min(hi, dt));
  return clips.map((c, i) => (i === index - 1 ? { ...a, out: a.out + d * a.speed } : i === index ? { ...b, in: b.in + d * b.speed } : c));
}

/** Slip edit: show an earlier or later part of the clip's footage, same length, same place. */
export function slipClip(clip: Clip, dt: number, sourceLen: number): Clip {
  const len = clip.out - clip.in;
  const shift = Math.max(-clip.in, Math.min(sourceLen - clip.out, dt * clip.speed));
  return { ...clip, in: clip.in + shift, out: clip.in + shift + len };
}

/**
 * Slide edit: move clip `index` along the timeline by `dt` without changing it; the
 * clip before gets longer and the one after shorter (or the other way round).
 */
export function slideClip(clips: Clip[], index: number, dt: number, assets: MediaAsset[]): Clip[] {
  const prev = clips[index - 1];
  const next = clips[index + 1];
  if (!prev || !next) return clips;
  const lo = Math.max(-(clipDuration(prev) - MIN_CLIP_SECONDS), -(next.in / next.speed));
  const hi = Math.min(clipDuration(next) - MIN_CLIP_SECONDS, (lengthOf(assets, prev) - prev.out) / prev.speed);
  const d = Math.max(lo, Math.min(hi, dt));
  return clips.map((c, i) => (i === index - 1 ? { ...prev, out: prev.out + d * prev.speed } : i === index + 1 ? { ...next, in: next.in + d * next.speed } : c));
}

/** Volume keyframes that hold at 1 and dip to 0 over [from, to] seconds (or the reverse). */
const dip = (from: number, to: number, fadeOut: boolean): Keyframe[] =>
  fadeOut
    ? [{ t: Math.max(0, from - 0.08), v: 1, ease: 'linear' }, { t: Math.max(0, from), v: 0 }]
    : [{ t: 0, v: 0, ease: 'linear' }, { t: Math.max(0, to - 0.08), v: 0, ease: 'linear' }, { t: to, v: 1 }];

/**
 * J cut: the sound of clip `index` starts `lead` seconds before its picture (you hear
 * the next scene first). Its sound moves to the audio track, starting early; the
 * clip before goes quiet where they overlap.
 */
export function jCut(p: VideoProject, index: number, lead: number): VideoProject {
  const placed = layoutClips(p.clips);
  const b = placed[index];
  const a = placed[index - 1];
  if (!a || !b) return p;
  const d = Math.max(0.1, Math.min(lead, b.clip.in / b.clip.speed, clipDuration(a.clip) - MIN_CLIP_SECONDS));
  const sound: AudioClip = { id: uid('audio'), assetId: b.clip.assetId, start: b.start - d, in: b.clip.in - d * b.clip.speed, out: b.clip.out, volume: b.clip.volume || 1 };
  const lenA = clipDuration(a.clip);
  return {
    ...p,
    audio: [...p.audio, sound],
    clips: p.clips.map((c, i) =>
      i === index ? { ...c, volume: 0 } : i === index - 1 ? { ...c, keys: { ...c.keys, volume: dip(lenA - d, lenA, true) } } : c,
    ),
  };
}

/**
 * L cut: the sound of clip `index` carries on `tail` seconds over the next picture.
 * Its sound moves to the audio track, running long; the next clip starts quiet.
 */
export function lCut(p: VideoProject, index: number, tail: number, assets: MediaAsset[]): VideoProject {
  const placed = layoutClips(p.clips);
  const a = placed[index];
  const b = placed[index + 1];
  if (!a || !b) return p;
  const room = (lengthOf(assets, a.clip) - a.clip.out) / a.clip.speed;
  const d = Math.max(0.1, Math.min(tail, room, clipDuration(b.clip) - MIN_CLIP_SECONDS));
  const sound: AudioClip = { id: uid('audio'), assetId: a.clip.assetId, start: a.start, in: a.clip.in, out: a.clip.out + d * a.clip.speed, volume: a.clip.volume || 1 };
  return {
    ...p,
    audio: [...p.audio, sound],
    clips: p.clips.map((c, i) => (i === index ? { ...c, volume: 0 } : i === index + 1 ? { ...c, keys: { ...c.keys, volume: dip(0, d, false) } } : c)),
  };
}

/** Split one clip at the given source seconds (scene changes), keeping everything else. */
export function splitAtSource(clips: Clip[], clipId: string, times: number[]): Clip[] {
  const i = clips.findIndex((c) => c.id === clipId);
  if (i < 0) return clips;
  const c = clips[i];
  const cuts = [...new Set(times.map((t) => Math.round(t * 1000) / 1000))]
    .filter((t) => t > c.in + MIN_CLIP_SECONDS && t < c.out - MIN_CLIP_SECONDS)
    .sort((x, y) => x - y);
  if (!cuts.length) return clips;
  const edges = [c.in, ...cuts, c.out];
  const pieces = edges.slice(0, -1).map((from, k) => ({
    ...c,
    id: k === 0 ? c.id : uid('clip'),
    in: from,
    out: edges[k + 1],
    transition: k === 0 ? c.transition : undefined,
    fadeIn: k === 0 ? c.fadeIn : 0,
    fadeOut: k === edges.length - 2 ? c.fadeOut : 0,
    keys: k === 0 ? c.keys : undefined,
  }));
  return [...clips.slice(0, i), ...pieces, ...clips.slice(i + 1)];
}

// ---------- Colour match ----------

export interface ColorStats {
  mean: [number, number, number];
  /** Brightness (0..255) average and spread, and how colourful it is on average. */
  luma: number;
  lumaSd: number;
  chroma: number;
}

/** Colour statistics of a picture (RGBA pixels). */
export function colorStats(rgba: Uint8ClampedArray): ColorStats {
  let n = 0;
  const sum = [0, 0, 0];
  let ly = 0;
  let ly2 = 0;
  let ch = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i];
    const g = rgba[i + 1];
    const b = rgba[i + 2];
    sum[0] += r;
    sum[1] += g;
    sum[2] += b;
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    ly += y;
    ly2 += y * y;
    ch += Math.max(r, g, b) - Math.min(r, g, b);
    n++;
  }
  n = Math.max(1, n);
  const luma = ly / n;
  return { mean: [sum[0] / n, sum[1] / n, sum[2] / n], luma, lumaSd: Math.sqrt(Math.max(0, ly2 / n - luma * luma)), chroma: ch / n };
}

/**
 * Filters and a grade that make a picture with `target` stats look like `reference`:
 * same brightness, contrast and colourfulness, and the same colour cast.
 */
export function matchColor(target: ColorStats, reference: ColorStats): { filters: Filters; grade: ColorGrade | null } {
  const clamp = (v: number, lo: number, hi: number) => Math.round(Math.max(lo, Math.min(hi, v)) * 100) / 100;
  const filters: Filters = {
    ...NEUTRAL_FILTERS,
    brightness: clamp(reference.luma / Math.max(8, target.luma), 0.5, 2),
    contrast: clamp(reference.lumaSd / Math.max(4, target.lumaSd), 0.5, 2),
    saturation: clamp(reference.chroma / Math.max(4, target.chroma), 0, 2.5),
  };
  // Colour cast: the difference between the two pictures' average colours (brightness removed).
  const norm = (m: number[], l: number) => m.map((v) => v / Math.max(1, l));
  const ref = norm(reference.mean, reference.luma);
  const tgt = norm(target.mean, target.luma);
  const d = ref.map((v, i) => v - tgt[i]);
  const amount = Math.min(1, Math.hypot(d[0] - (d[1] + d[2]) / 2, (d[1] - d[2]) * 0.866) * 1.6);
  if (amount < 0.03) return { filters, grade: null };
  let hue = (Math.atan2(Math.sqrt(3) * (d[1] - d[2]), 2 * d[0] - d[1] - d[2]) * 180) / Math.PI;
  if (hue < 0) hue += 360;
  return { filters, grade: { ...NEUTRAL_GRADE, midtones: { ...NEUTRAL_WHEEL, hue: Math.round(hue), amount: Math.round(amount * 100) / 100 } } };
}

// ---------- Scopes ----------

/** Red, green and blue histograms (256 bins each). */
export function histogram(rgba: Uint8ClampedArray): [Uint32Array, Uint32Array, Uint32Array] {
  const h: [Uint32Array, Uint32Array, Uint32Array] = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  for (let i = 0; i < rgba.length; i += 4) {
    h[0][rgba[i]]++;
    h[1][rgba[i + 1]]++;
    h[2][rgba[i + 2]]++;
  }
  return h;
}

/** Luma waveform: for each of `cols` columns, how many pixels sit at each of `levels` brightness levels. */
export function waveform(rgba: Uint8ClampedArray, w: number, h: number, cols = 128, levels = 64): Uint16Array {
  const out = new Uint16Array(cols * levels);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const l = 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
      const c = Math.min(cols - 1, Math.floor((x / w) * cols));
      const v = Math.min(levels - 1, Math.floor((l / 256) * levels));
      out[c * levels + v]++;
    }
  }
  return out;
}

/** Vectorscope: a `size`×`size` grid of how many pixels have each hue/saturation (Cb, Cr). */
export function vectorscope(rgba: Uint8ClampedArray, size = 96): Uint16Array {
  const out = new Uint16Array(size * size);
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i];
    const g = rgba[i + 1];
    const b = rgba[i + 2];
    const cb = -0.1146 * r - 0.3854 * g + 0.5 * b;
    const cr = 0.5 * r - 0.4542 * g - 0.0458 * b;
    const x = Math.max(0, Math.min(size - 1, Math.round(size / 2 + (cb / 128) * (size / 2))));
    const y = Math.max(0, Math.min(size - 1, Math.round(size / 2 - (cr / 128) * (size / 2))));
    out[y * size + x]++;
  }
  return out;
}
