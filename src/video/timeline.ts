import { uid } from '../lib/id';
import { NEUTRAL_FILTERS } from '../lib/filters';
import type { AudioClip, Clip, MediaAsset, Motion, OverlayClip, TextOverlay, TransitionType, VideoProject } from './types';

export const DEFAULT_IMAGE_SECONDS = 3;
export const MIN_CLIP_SECONDS = 0.1;

export { cssFilter, FILTER_PRESETS, NEUTRAL_FILTERS } from '../lib/filters';

export const ASPECTS = [
  { label: '16:9 Landscape', width: 1280, height: 720 },
  { label: '9:16 Vertical', width: 720, height: 1280 },
  { label: '1:1 Square', width: 1080, height: 1080 },
  { label: '4:5 Portrait', width: 1080, height: 1350 },
];

export function createProject(width = 1280, height = 720): VideoProject {
  return { name: 'Untitled video', width, height, background: '#000000', fill: 'color', assets: [], clips: [], texts: [], audio: [], overlays: [] };
}

export function clipDuration(c: Clip): number {
  return (c.out - c.in) / c.speed;
}

export function sourceLength(asset: MediaAsset): number {
  return Number.isFinite(asset.duration) ? asset.duration : DEFAULT_IMAGE_SECONDS;
}

export function createClip(asset: MediaAsset): Clip {
  return {
    id: uid('clip'),
    assetId: asset.id,
    in: 0,
    out: sourceLength(asset),
    speed: 1,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
    filters: NEUTRAL_FILTERS,
  };
}

export function createAudioClip(asset: MediaAsset, start: number): AudioClip {
  return { id: uid('audio'), assetId: asset.id, start, in: 0, out: sourceLength(asset), volume: 1 };
}

export function createTextOverlay(start: number, patch: Partial<TextOverlay> = {}): TextOverlay {
  return {
    id: uid('text'),
    text: 'Your text',
    start,
    duration: 3,
    x: 0.5,
    y: 0.8,
    size: 0.08,
    color: '#ffffff',
    background: null,
    bold: true,
    animation: 'fade',
    ...patch,
  };
}

export interface PlacedClip {
  clip: Clip;
  index: number;
  start: number;
  end: number;
}

/** Timeline positions of the back-to-back main track clips. */
export function layoutClips(clips: Clip[]): PlacedClip[] {
  let t = 0;
  return clips.map((clip, index) => {
    const start = t;
    t += clipDuration(clip);
    return { clip, index, start, end: t };
  });
}

export function mainTrackDuration(clips: Clip[]): number {
  return clips.reduce((sum, c) => sum + clipDuration(c), 0);
}

export function projectDuration(p: VideoProject): number {
  return Math.max(
    mainTrackDuration(p.clips),
    ...p.texts.map((t) => t.start + t.duration),
    ...p.audio.map((a) => a.start + (a.out - a.in)),
    ...(p.overlays ?? []).map((o) => o.start + (o.out - o.in)),
    0,
  );
}

/** Main clip playing at time `t`, with the matching source time. */
export function locate(clips: Clip[], t: number): (PlacedClip & { sourceTime: number }) | null {
  for (const placed of layoutClips(clips)) {
    if (t >= placed.start && t < placed.end) {
      return { ...placed, sourceTime: placed.clip.in + (t - placed.start) * placed.clip.speed };
    }
  }
  return null;
}

/** Split the main clip under `t` into two. Returns the original list if `t` is on a boundary. */
export function splitClips(clips: Clip[], t: number): Clip[] {
  const hit = locate(clips, t);
  if (!hit) return clips;
  const { clip, index, sourceTime } = hit;
  if (sourceTime - clip.in < MIN_CLIP_SECONDS || clip.out - sourceTime < MIN_CLIP_SECONDS) return clips;
  const left: Clip = { ...clip, out: sourceTime, fadeOut: 0 };
  const right: Clip = { ...clip, id: uid('clip'), in: sourceTime, fadeIn: 0, transition: undefined };
  return [...clips.slice(0, index), left, right, ...clips.slice(index + 1)];
}

/** Split a text overlay at `t`. */
export function splitTexts(texts: TextOverlay[], t: number): TextOverlay[] {
  return texts.flatMap((o) => {
    if (t - o.start < MIN_CLIP_SECONDS || o.start + o.duration - t < MIN_CLIP_SECONDS) return [o];
    return [
      { ...o, duration: t - o.start },
      { ...o, id: uid('text'), start: t, duration: o.start + o.duration - t },
    ];
  });
}

/** Move a clip's source in-point, keeping at least the minimum duration. */
export function trimStart(clip: Clip, nextIn: number): Clip {
  const max = clip.out - MIN_CLIP_SECONDS * clip.speed;
  return { ...clip, in: Math.max(0, Math.min(nextIn, max)) };
}

/** Move a clip's source out-point, clamped to the source length. */
export function trimEnd(clip: Clip, nextOut: number, sourceLen: number): Clip {
  const min = clip.in + MIN_CLIP_SECONDS * clip.speed;
  return { ...clip, out: Math.min(sourceLen, Math.max(nextOut, min)) };
}

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item);
  return next;
}

/** Index a dragged clip should land at, given the drop time on the timeline. */
export function dropIndex(clips: Clip[], t: number): number {
  for (const placed of layoutClips(clips)) {
    if (t < (placed.start + placed.end) / 2) return placed.index;
  }
  return clips.length;
}

/** 0..1 opacity of a clip at local time `local` (seconds since the clip started) from its fades. */
export function fadeOpacity(clip: Clip, local: number): number {
  const d = clipDuration(clip);
  let a = 1;
  if (clip.fadeIn > 0) a = Math.min(a, local / clip.fadeIn);
  if (clip.fadeOut > 0) a = Math.min(a, (d - local) / clip.fadeOut);
  return Math.max(0, Math.min(1, a));
}

export function textsAt(texts: TextOverlay[], t: number): TextOverlay[] {
  return texts.filter((o) => t >= o.start && t < o.start + o.duration);
}

/** Opacity, scale and y-offset (fraction of frame) of a text overlay's entrance/exit animation. */
export function textAnimation(o: TextOverlay, t: number): { alpha: number; scale: number; dy: number } {
  const local = t - o.start;
  const remaining = o.start + o.duration - t;
  const d = Math.min(0.4, o.duration / 3);
  const inP = Math.min(1, local / d);
  const outP = Math.min(1, remaining / d);
  switch (o.animation) {
    case 'fade':
      return { alpha: Math.min(inP, outP), scale: 1, dy: 0 };
    case 'pop': {
      const ease = 1 - Math.pow(1 - inP, 3);
      return { alpha: Math.min(1, inP * 2, outP), scale: 0.5 + 0.5 * ease + Math.sin(inP * Math.PI) * 0.1, dy: 0 };
    }
    case 'slide':
      return { alpha: Math.min(inP, outP), scale: 1, dy: (1 - inP) * 0.08 };
    default:
      return { alpha: 1, scale: 1, dy: 0 };
  }
}

export const PEAKS_PER_SECOND = 20;

export const TRANSITIONS: { type: TransitionType; label: string }[] = [
  { type: 'fade', label: 'Crossfade' },
  { type: 'black', label: 'Dip to black' },
  { type: 'slide', label: 'Slide' },
  { type: 'zoom', label: 'Zoom' },
  { type: 'wipe', label: 'Wipe' },
];

/** Longest transition a clip allows (half its length, at most 2s). */
export function maxTransition(clip: Clip): number {
  return Math.max(0.1, Math.min(2, clipDuration(clip) / 2));
}

/** If time `t` is inside the transition into a placed clip, its type and eased 0..1 progress. */
export function transitionAt(placed: PlacedClip, t: number): { type: TransitionType; progress: number } | null {
  const tr = placed.clip.transition;
  if (!tr || placed.index === 0 || tr.duration <= 0) return null;
  const local = t - placed.start;
  if (local < 0 || local >= tr.duration) return null;
  const x = local / tr.duration;
  return { type: tr.type, progress: x * x * (3 - 2 * x) };
}

/** Reduce raw samples to `perSecond` loudness values in 0..1 (normalised to the loudest). */
export function computePeaks(samples: Float32Array, sampleRate: number, perSecond = PEAKS_PER_SECOND): number[] {
  const bucket = Math.max(1, Math.floor(sampleRate / perSecond));
  const peaks: number[] = [];
  for (let i = 0; i < samples.length; i += bucket) {
    let max = 0;
    const end = Math.min(samples.length, i + bucket);
    for (let j = i; j < end; j++) {
      const v = Math.abs(samples[j]);
      if (v > max) max = v;
    }
    peaks.push(max);
  }
  const loudest = Math.max(...peaks, 1e-6);
  return peaks.map((p) => Math.round((p / loudest) * 100) / 100);
}

/** Give each item a row so overlapping items don't cover each other (first free row wins). */
export function assignLanes<T>(items: T[], start: (item: T) => number, end: (item: T) => number): number[] {
  const order = items.map((_, i) => i).sort((a, b) => start(items[a]) - start(items[b]));
  const laneEnds: number[] = [];
  const lanes = new Array<number>(items.length);
  for (const i of order) {
    const s = start(items[i]);
    let lane = laneEnds.findIndex((e) => e <= s + 1e-6);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = end(items[i]);
    lanes[i] = lane;
  }
  return lanes;
}

/** Fill in fields added after a project was saved, so older projects keep working. */
export function normalizeProject(p: VideoProject): VideoProject {
  return { ...p, fill: p.fill ?? 'color', overlays: p.overlays ?? [] };
}

export function createOverlay(asset: MediaAsset, start: number): OverlayClip {
  return {
    id: uid('overlay'),
    assetId: asset.id,
    start,
    in: 0,
    out: sourceLength(asset),
    x: 0.75,
    y: 0.28,
    scale: 0.35,
    opacity: 1,
    volume: 1,
    rounded: 0.08,
  };
}

/** Items on a free-floating track (audio, overlays) that are playing at time `t`. */
export function activeAt<T extends { start: number; in: number; out: number }>(items: T[], t: number): T[] {
  return items.filter((i) => t >= i.start && t < i.start + (i.out - i.in));
}

export const MOTIONS: { value: Motion; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'zoom-in', label: 'Zoom in' },
  { value: 'zoom-out', label: 'Zoom out' },
  { value: 'pan-left', label: 'Pan left' },
  { value: 'pan-right', label: 'Pan right' },
];

/** Scale and horizontal shift (fraction of frame width) for a clip's motion at progress 0..1. */
export function motionTransform(motion: Motion | undefined, progress: number): { scale: number; dx: number } {
  const p = Math.max(0, Math.min(1, progress));
  switch (motion) {
    case 'zoom-in':
      return { scale: 1 + 0.2 * p, dx: 0 };
    case 'zoom-out':
      return { scale: 1.2 - 0.2 * p, dx: 0 };
    case 'pan-left':
      return { scale: 1.2, dx: 0.08 - 0.16 * p };
    case 'pan-right':
      return { scale: 1.2, dx: -0.08 + 0.16 * p };
    default:
      return { scale: 1, dx: 0 };
  }
}

/** Snap `value` to the nearest candidate within `threshold`, else return it unchanged. */
export function snapTime(value: number, candidates: number[], threshold: number): { value: number; snapped: number | null } {
  let best: number | null = null;
  for (const c of candidates) {
    if (Math.abs(c - value) <= threshold && (best === null || Math.abs(c - value) < Math.abs(best - value))) best = c;
  }
  return { value: best ?? value, snapped: best };
}

/** Times worth snapping to: start, playhead, clip edges and every item edge except the excluded one. */
export function snapCandidates(p: VideoProject, playhead: number, excludeId?: string): number[] {
  const out = [0, playhead];
  for (const placed of layoutClips(p.clips)) out.push(placed.start, placed.end);
  for (const o of p.texts) if (o.id !== excludeId) out.push(o.start, o.start + o.duration);
  for (const a of [...p.audio, ...p.overlays]) if (a.id !== excludeId) out.push(a.start, a.start + a.out - a.in);
  return out;
}

export interface Caption {
  start: number;
  end: number;
  text: string;
}

function parseSrtTime(s: string): number {
  const m = s.trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  if (!m) return NaN;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0').slice(0, 3)) / 1000;
}

/** Parse SubRip (.srt) or WebVTT (.vtt) subtitles. Malformed blocks are skipped. */
export function parseSubtitles(text: string): Caption[] {
  const blocks = text.replace(/\r/g, '').replace(/^WEBVTT.*\n/, '').split(/\n\s*\n/);
  const out: Caption[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    const timeIdx = lines.findIndex((l) => l.includes('-->'));
    if (timeIdx < 0) continue;
    const [a, b] = lines[timeIdx].split('-->');
    const start = parseSrtTime(a);
    const end = parseSrtTime(b);
    const body = lines.slice(timeIdx + 1).join('\n').replace(/<[^>]+>/g, '').trim();
    if (Number.isFinite(start) && Number.isFinite(end) && end > start && body) out.push({ start, end, text: body });
  }
  return out;
}

function srtTime(t: number): string {
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`;
}

/** Write text overlays as a SubRip (.srt) file, in time order. */
export function toSrt(texts: TextOverlay[]): string {
  return [...texts]
    .sort((a, b) => a.start - b.start)
    .map((o, i) => `${i + 1}\n${srtTime(o.start)} --> ${srtTime(o.start + o.duration)}\n${o.text}\n`)
    .join('\n');
}

/**
 * Turn a typed script into captions spread over `duration` seconds. Each line (or
 * sentence, when there are no line breaks) becomes one caption, timed by its length.
 */
export function scriptToCaptions(script: string, duration: number, start = 0): Caption[] {
  let parts = script.split('\n').map((l) => l.trim()).filter(Boolean);
  if (parts.length === 1) parts = parts[0].split(/(?<=[.!?])\s+/).map((l) => l.trim()).filter(Boolean);
  if (parts.length === 0 || duration <= 0) return [];
  const weight = (s: string) => Math.max(8, s.length);
  const total = parts.reduce((sum, p) => sum + weight(p), 0);
  const out: Caption[] = [];
  let t = start;
  for (const text of parts) {
    const d = (weight(text) / total) * duration;
    out.push({ start: t, end: t + d, text });
    t += d;
  }
  return out;
}

/** 0..1 volume multiplier for an audio clip's fades, `local` seconds after it starts. */
export function audioFade(a: { in: number; out: number; fadeIn?: number; fadeOut?: number }, local: number): number {
  const len = a.out - a.in;
  let g = 1;
  if (a.fadeIn && a.fadeIn > 0) g = Math.min(g, local / a.fadeIn);
  if (a.fadeOut && a.fadeOut > 0) g = Math.min(g, (len - local) / a.fadeOut);
  return Math.max(0, Math.min(1, g));
}

export interface ExportOptions {
  fps: 30 | 60;
  /** Video bits per second. */
  bitrate: number;
}

export const EXPORT_QUALITIES = [
  { label: 'Small file', bitrate: 3_000_000 },
  { label: 'Standard', bitrate: 8_000_000 },
  { label: 'High quality', bitrate: 16_000_000 },
];

/** Rough size of an export, in megabytes, for showing before the user starts. */
export function estimateSizeMB(seconds: number, opts: ExportOptions, audioBitrate = 128_000): number {
  return ((opts.bitrate + audioBitrate) * seconds) / 8 / 1_000_000;
}
