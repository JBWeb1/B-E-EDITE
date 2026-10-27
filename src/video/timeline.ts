import { uid } from '../lib/id';
import { NEUTRAL_FILTERS } from '../lib/filters';
import { sliceKeys, sourceTimeAt } from './anim';
import type { ParticleKind } from './particles';
import type { AudioClip, Clip, EffectItem, EffectType, MediaAsset, Motion, OverlayClip, TextOverlay, TransitionType, VideoProject } from './types';

export const DEFAULT_IMAGE_SECONDS = 3;
export const MIN_CLIP_SECONDS = 0.1;

export { cssFilter, FILTER_PRESETS, INSTAGRAM_FILTERS, NEUTRAL_FILTERS } from '../lib/filters';
export { textAnimation } from './textfx';

export const ASPECTS = [
  { label: '16:9 Landscape', width: 1280, height: 720 },
  { label: '9:16 Vertical', width: 720, height: 1280 },
  { label: '1:1 Square', width: 1080, height: 1080 },
  { label: '4:5 Portrait', width: 1080, height: 1350 },
];

export function createProject(width = 1280, height = 720): VideoProject {
  return { name: 'Untitled video', width, height, background: '#000000', fill: 'color', assets: [], clips: [], texts: [], audio: [], overlays: [], effects: [], tracks: {} };
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
    ...(p.effects ?? []).map((e) => e.start + e.duration),
    0,
  );
}

/** Main clip playing at time `t`, with the matching source time. */
export function locate(clips: Clip[], t: number): (PlacedClip & { sourceTime: number }) | null {
  for (const placed of layoutClips(clips)) {
    if (t >= placed.start && t < placed.end) {
      return { ...placed, sourceTime: sourceTimeAt(placed.clip, t - placed.start) };
    }
  }
  return null;
}

/** Split the main clip under `t` into two. Returns the original list if `t` is on a boundary. */
export function splitClips(clips: Clip[], t: number): Clip[] {
  const hit = locate(clips, t);
  if (!hit) return clips;
  const { clip, index, sourceTime, start } = hit;
  if (sourceTime - clip.in < MIN_CLIP_SECONDS || clip.out - sourceTime < MIN_CLIP_SECONDS) return clips;
  // A reversed clip plays from `out` down to `in`, so its first half is the end of the source.
  const first = clip.reverse ? { in: sourceTime } : { out: sourceTime };
  const second = clip.reverse ? { out: sourceTime } : { in: sourceTime };
  const cut = t - start;
  const left: Clip = { ...clip, ...first, fadeOut: 0, keys: sliceKeys(clip.keys, 0, cut) };
  const right: Clip = { ...clip, ...second, id: uid('clip'), fadeIn: 0, transition: undefined, keys: sliceKeys(clip.keys, cut, Infinity) };
  return [...clips.slice(0, index), left, right, ...clips.slice(index + 1)];
}

/** Split a text overlay at `t`. */
export function splitTexts(texts: TextOverlay[], t: number): TextOverlay[] {
  return texts.flatMap((o) => {
    if (t - o.start < MIN_CLIP_SECONDS || o.start + o.duration - t < MIN_CLIP_SECONDS) return [o];
    return [
      { ...o, duration: t - o.start, keys: sliceKeys(o.keys, 0, t - o.start) },
      { ...o, id: uid('text'), start: t, duration: o.start + o.duration - t, keys: sliceKeys(o.keys, t - o.start, Infinity) },
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
  return { ...p, fill: p.fill ?? 'color', overlays: p.overlays ?? [], effects: p.effects ?? [], tracks: p.tracks ?? {} };
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

/** The video track an overlay sits on (2 = just above the main track). */
export const trackOf = (o: OverlayClip) => Math.max(2, o.track ?? 2);

/** Track numbers in use, lowest first (always includes 2 when there are overlays). */
export function overlayTracks(overlays: OverlayClip[]): number[] {
  return [...new Set(overlays.map(trackOf))].sort((a, b) => a - b);
}

/** Lowest video track (2 and up) with room for an item from `start` to `end`. */
export function freeTrack(overlays: OverlayClip[], start: number, end: number, ignoreId?: string): number {
  for (let track = 2; ; track++) {
    const busy = overlays.some((o) => o.id !== ignoreId && trackOf(o) === track && start < o.start + o.out - o.in - 1e-6 && end > o.start + 1e-6);
    if (!busy) return track;
  }
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
  for (const e of p.effects ?? []) if (e.id !== excludeId) out.push(e.start, e.start + e.duration);
  out.push(...beatTimes(p), ...(p.markers ?? []));
  return out;
}

/** Every beat of the songs on the audio track, in project seconds, sorted. */
export function beatTimes(p: VideoProject): number[] {
  const out: number[] = [];
  for (const a of p.audio) {
    for (const b of a.beats ?? []) if (b >= a.in - 1e-6 && b <= a.out + 1e-6) out.push(Math.round((a.start + b - a.in) * 1000) / 1000);
  }
  return [...new Set(out)].sort((x, y) => x - y);
}

/** Add a marker at `t`, or remove the one already within `near` seconds of it. */
export function toggleMarker(markers: number[] | undefined, t: number, near = 0.05): number[] {
  const list = markers ?? [];
  const hit = list.findIndex((m) => Math.abs(m - t) <= near);
  if (hit >= 0) return list.filter((_, i) => i !== hit);
  return [...list, Math.round(t * 1000) / 1000].sort((a, b) => a - b);
}

/**
 * Trim or stretch each main-track clip so every cut lands on a beat (CapCut's "beat
 * sync"). A clip that can't reach the next beat (its video is too short) ends on an
 * earlier one; photos stretch freely.
 */
export function fitClipsToBeats(p: VideoProject, beats: number[]): Clip[] {
  if (beats.length < 2) return p.clips;
  const clips: Clip[] = [];
  let start = 0;
  for (const clip of p.clips) {
    const asset = p.assets.find((a) => a.id === clip.assetId);
    const max = asset ? sourceLength(asset) : clip.out;
    const photo = asset?.kind === 'image';
    const end = start + clipDuration(clip);
    // The latest end the clip's source allows, in project time.
    const reach = photo ? Infinity : start + (max - clip.in) / clip.speed;
    const options = beats.filter((b) => b > start + MIN_CLIP_SECONDS && b <= reach + 1e-6);
    if (!options.length) {
      clips.push(clip);
      start = end;
      continue;
    }
    const target = options.reduce((best, b) => (Math.abs(b - end) < Math.abs(best - end) ? b : best), options[0]);
    const out = clip.in + (target - start) * clip.speed;
    clips.push({ ...clip, out: Math.min(photo ? Infinity : max, out) });
    start = target;
  }
  return clips;
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

// ---------- Effects ----------

export type EffectGroup = 'Motion' | 'Look' | 'Light' | 'Particles' | 'Blur & Sharpen' | 'Distort' | 'Stylize' | 'Colour' | 'Generate' | 'Time';

export const EFFECTS: { type: EffectType; label: string; hint: string; group: EffectGroup }[] = [
  { type: 'shake', label: 'Shake', hint: 'Camera shake (set its speed)', group: 'Motion' },
  { type: 'zoom-pulse', label: 'Zoom pulse', hint: 'Beat-style punch-in', group: 'Motion' },
  { type: 'glitch', label: 'Glitch', hint: 'Digital glitch jumps', group: 'Motion' },
  { type: 'flash', label: 'Flash', hint: 'White flash at the start', group: 'Light' },
  { type: 'glow', label: 'Dreamy glow', hint: 'Soft bloom', group: 'Light' },
  { type: 'light-leak', label: 'Light leak', hint: 'Warm film light sweeping across', group: 'Light' },
  { type: 'lens-flare', label: 'Lens flare', hint: 'Sun flare that drifts', group: 'Light' },
  { type: 'light-rays', label: 'Light rays', hint: 'God rays streaming from the bright parts', group: 'Light' },
  { type: 'turbulence', label: 'Turbulent warp', hint: 'Wavy heat-haze / underwater distortion', group: 'Motion' },
  { type: 'echo', label: 'Echo trails', hint: 'Ghostly trails behind anything that moves', group: 'Motion' },
  { type: 'fractal-noise', label: 'Fractal fog', hint: 'Drifting smoke and fog', group: 'Look' },
  { type: 'adjustment', label: 'Adjustment layer', hint: 'Colour and filters for every layer under it', group: 'Look' },
  { type: 'vignette', label: 'Vignette', hint: 'Darker edges', group: 'Look' },
  { type: 'grain', label: 'Film grain', hint: 'Old film texture', group: 'Look' },
  { type: 'vhs', label: 'VHS', hint: 'Retro tape lines', group: 'Look' },
  { type: 'chromatic', label: 'Chromatic', hint: 'Red/blue colour fringes', group: 'Look' },
  { type: 'blur', label: 'Blur', hint: 'Soft focus', group: 'Look' },
  { type: 'letterbox', label: 'Cinema bars', hint: 'Black bars, movie look', group: 'Look' },
  { type: 'directional-blur', label: 'Directional blur', hint: 'Motion blur streaking sideways', group: 'Blur & Sharpen' },
  { type: 'zoom-blur', label: 'Radial blur (zoom)', hint: 'Streaks rushing out from the middle', group: 'Blur & Sharpen' },
  { type: 'sharpen', label: 'Sharpen', hint: 'Crisper details', group: 'Blur & Sharpen' },
  { type: 'mirror', label: 'Mirror', hint: 'Left half reflected onto the right', group: 'Distort' },
  { type: 'kaleidoscope', label: 'Kaleidoscope', hint: 'Six mirrored slices turning slowly', group: 'Distort' },
  { type: 'twirl', label: 'Twirl', hint: 'Swirl the middle of the picture', group: 'Distort' },
  { type: 'bulge', label: 'Spherize', hint: 'Lens bulge that magnifies the middle', group: 'Distort' },
  { type: 'ripple', label: 'Ripple', hint: 'Water ripples spreading from the middle', group: 'Distort' },
  { type: 'offset', label: 'Offset', hint: 'The picture slides and wraps around', group: 'Distort' },
  { type: 'replicate', label: 'Replicate', hint: 'A grid of copies of the picture', group: 'Distort' },
  { type: 'mosaic', label: 'Mosaic', hint: 'Big square pixels', group: 'Stylize' },
  { type: 'posterize', label: 'Posterize', hint: 'Fewer colours, poster look', group: 'Stylize' },
  { type: 'emboss', label: 'Emboss', hint: 'Raised, stamped-metal look', group: 'Stylize' },
  { type: 'find-edges', label: 'Find edges', hint: 'Drawn outlines on white', group: 'Stylize' },
  { type: 'cartoon', label: 'Cartoon', hint: 'Flat colours with dark outlines', group: 'Stylize' },
  { type: 'halftone', label: 'Colour halftone', hint: 'Comic-book printed dots', group: 'Stylize' },
  { type: 'solarize', label: 'Solarize', hint: 'Bright parts flip to negative', group: 'Stylize' },
  { type: 'strobe', label: 'Strobe light', hint: 'Flashing white strobe (set its speed)', group: 'Stylize' },
  { type: 'invert', label: 'Invert', hint: 'Photo negative', group: 'Colour' },
  { type: 'tint', label: 'Tint', hint: 'Two-colour duotone, navy to gold', group: 'Colour' },
  { type: 'tritone', label: 'Tritone', hint: 'Shadows, midtones and highlights in three colours', group: 'Colour' },
  { type: 'threshold', label: 'Threshold', hint: 'Pure black and white', group: 'Colour' },
  { type: 'leave-color', label: 'Leave colour', hint: 'Keeps the reds, everything else goes grey', group: 'Colour' },
  { type: 'four-color-gradient', label: 'Four-colour gradient', hint: 'Soft colour wash over the picture', group: 'Generate' },
  { type: 'grid', label: 'Grid', hint: 'Grid lines over the picture', group: 'Generate' },
  { type: 'venetian-blinds', label: 'Venetian blinds', hint: 'Sliding stripes', group: 'Generate' },
  { type: 'posterize-time', label: 'Posterize time', hint: 'Choppy, low frame rate (stop-motion feel)', group: 'Time' },
  { type: 'confetti', label: 'Confetti', hint: 'Party confetti falling', group: 'Particles' },
  { type: 'sparkles', label: 'Sparkles', hint: 'Twinkling stars', group: 'Particles' },
  { type: 'snow', label: 'Snow', hint: 'Gentle snowfall', group: 'Particles' },
  { type: 'hearts', label: 'Hearts', hint: 'Floating hearts', group: 'Particles' },
  { type: 'bubbles', label: 'Bubbles', hint: 'Rising bubbles', group: 'Particles' },
  { type: 'dust', label: 'Dust', hint: 'Floating dust in the light', group: 'Particles' },
];

export const EFFECT_GROUPS: EffectGroup[] = ['Motion', 'Light', 'Look', 'Blur & Sharpen', 'Distort', 'Stylize', 'Colour', 'Generate', 'Time', 'Particles'];

/** The Adobe-style effects (drawn by the engine from `EffectFrame.adobe`). */
export const ADOBE_GROUPS: EffectGroup[] = ['Blur & Sharpen', 'Distort', 'Stylize', 'Colour', 'Generate', 'Time'];
export const isAdobeEffect = (t: EffectType) => ADOBE_GROUPS.includes(EFFECTS.find((e) => e.type === t)?.group as EffectGroup);

const PARTICLE_TYPES: EffectType[] = ['confetti', 'snow', 'sparkles', 'hearts', 'dust', 'bubbles'];
export const isParticleEffect = (t: EffectType) => PARTICLE_TYPES.includes(t);

export function createEffect(type: EffectType, start: number, patch: Partial<EffectItem> = {}): EffectItem {
  return { id: uid('fx'), type, start, duration: 3, intensity: 0.7, ...patch };
}

export interface EffectFrame {
  /** Offset as a fraction of the frame size. */
  dx: number;
  dy: number;
  scale: number;
  /** 0..1 white overlay. */
  flash: number;
  vignette: number;
  grain: number;
  scanlines: number;
  glow: number;
  /** Height of each black bar as a fraction of the frame height. */
  bars: number;
  /** Blur radius as a fraction of the frame width. */
  blur: number;
  /** Colour fringe offset as a fraction of the frame width. */
  chromatic: number;
  /** 0..1, the glitch's slices this frame (0 = none). */
  glitch: number;
  /** Seed so glitch slices change every few frames. */
  glitchSeed: number;
  /** 0..1 strength and 0..1 position of a light leak sweeping across. */
  leak: number;
  leakPos: number;
  /** 0..1 strength and position (fractions) of a lens flare. */
  flare: number;
  flareX: number;
  flareY: number;
  /** Light rays: strength and where they stream from (fractions). */
  rays: number;
  raysX: number;
  raysY: number;
  /** Turbulent warp strength and its moving phase. */
  turb: number;
  turbPhase: number;
  /** Echo trails strength. */
  echo: number;
  /** Fractal fog strength and drift. */
  fog: number;
  fogPhase: number;
  particles: { kind: ParticleKind; local: number; intensity: number; speed: number }[];
  /** Adobe-style effects to draw, in timeline order. */
  adobe: { type: EffectType; k: number; local: number; speed: number }[];
}

export const NO_EFFECT: EffectFrame = {
  dx: 0,
  dy: 0,
  scale: 1,
  flash: 0,
  vignette: 0,
  grain: 0,
  scanlines: 0,
  glow: 0,
  bars: 0,
  blur: 0,
  chromatic: 0,
  glitch: 0,
  glitchSeed: 0,
  leak: 0,
  leakPos: 0,
  flare: 0,
  flareX: 0,
  flareY: 0,
  rays: 0,
  raysX: 0.5,
  raysY: 0.2,
  turb: 0,
  turbPhase: 0,
  echo: 0,
  fog: 0,
  fogPhase: 0,
  particles: [],
  adobe: [],
};

/** How every effect active at time `t` changes the frame (effects add up). */
export function effectFrame(effects: EffectItem[], t: number): EffectFrame {
  const f: EffectFrame = { ...NO_EFFECT, particles: [], adobe: [] };
  for (const e of effects) {
    const local = t - e.start;
    if (local < 0 || local >= e.duration) continue;
    const k = Math.max(0, Math.min(1, e.intensity));
    const speed = e.speed ?? 1;
    if (isParticleEffect(e.type)) {
      f.particles.push({ kind: e.type as ParticleKind, local, intensity: k, speed });
      continue;
    }
    if (isAdobeEffect(e.type)) {
      f.adobe.push({ type: e.type, k, local, speed });
      continue;
    }
    switch (e.type) {
      case 'shake': {
        // Smooth pseudo-random wobble from summed sines (same result for the same time).
        const s = local * speed;
        f.dx += k * 0.02 * (Math.sin(s * 47) + 0.6 * Math.sin(s * 83 + 1.3));
        f.dy += k * 0.02 * (Math.sin(s * 53 + 0.7) + 0.6 * Math.sin(s * 71 + 2.1));
        break;
      }
      case 'blur':
        f.blur = Math.max(f.blur, k * 0.012);
        break;
      case 'chromatic':
        f.chromatic = Math.max(f.chromatic, k * 0.008 * (0.7 + 0.3 * Math.sin(local * 5 * speed)));
        break;
      case 'glitch': {
        // Bursts: mostly calm, with sharp glitchy moments; slices change 15 times a second.
        const step = Math.floor(local * 15 * speed);
        const r = Math.abs(Math.sin(step * 12.9898 + 4.1) * 43758.5453) % 1;
        const burst = local < 0.3 || r > 0.62;
        if (burst) {
          f.glitch = Math.max(f.glitch, k);
          f.glitchSeed = step + 1;
          f.chromatic = Math.max(f.chromatic, k * 0.01);
          f.dx += k * 0.01 * (r - 0.5);
        }
        break;
      }
      case 'light-leak': {
        const p = (local * 0.25 * speed) % 1;
        f.leak = Math.max(f.leak, k * Math.min(1, local / 0.5, (e.duration - local) / 0.5));
        f.leakPos = p;
        break;
      }
      case 'lens-flare': {
        f.flare = Math.max(f.flare, k * Math.min(1, local / 0.4, (e.duration - local) / 0.4));
        const u = e.duration > 0 ? local / e.duration : 0;
        f.flareX = 0.15 + 0.7 * u;
        f.flareY = 0.22 + 0.06 * Math.sin(u * Math.PI);
        break;
      }
      case 'light-rays': {
        f.rays = Math.max(f.rays, k * Math.min(1, local / 0.4, (e.duration - local) / 0.4));
        f.raysX = 0.5 + 0.25 * Math.sin(local * 0.4 * speed);
        f.raysY = 0.18;
        break;
      }
      case 'turbulence':
        f.turb = Math.max(f.turb, k);
        f.turbPhase = local * speed;
        break;
      case 'echo':
        f.echo = Math.max(f.echo, k);
        break;
      case 'fractal-noise':
        f.fog = Math.max(f.fog, k * Math.min(1, local / 0.5));
        f.fogPhase = local * speed;
        break;
      case 'zoom-pulse': {
        const beat = (local % 0.5) / 0.5; // a punch every half second
        f.scale *= 1 + k * 0.12 * Math.exp(-beat * 6);
        break;
      }
      case 'flash':
        f.flash = Math.max(f.flash, k * Math.exp(-local * 6));
        break;
      case 'vignette':
        f.vignette = Math.max(f.vignette, k);
        break;
      case 'grain':
        f.grain = Math.max(f.grain, k);
        break;
      case 'vhs':
        f.scanlines = Math.max(f.scanlines, k);
        f.grain = Math.max(f.grain, k * 0.4);
        f.dx += k * 0.004 * Math.sin(local * 30);
        break;
      case 'glow':
        f.glow = Math.max(f.glow, k);
        break;
      case 'letterbox': {
        // Bars slide in over the first 0.4s.
        f.bars = Math.max(f.bars, k * 0.14 * Math.min(1, local / 0.4));
        break;
      }
    }
  }
  return f;
}

// ---------- Editing helpers ----------

/** Insert a clip into the main track at time `t`, splitting the clip there if needed. */
export function insertClipAt(clips: Clip[], t: number, clip: Clip): Clip[] {
  const split = splitClips(clips, t);
  const at = layoutClips(split).findIndex((p) => p.start >= t - 1e-6);
  const index = at < 0 ? split.length : at;
  return [...split.slice(0, index), clip, ...split.slice(index)];
}

/**
 * CapCut's Q / W: cut away the part of the main clip under the playhead that is
 * before (Q) or after (W) it. Returns the clips unchanged if nothing is under it.
 */
export function trimAtPlayhead(clips: Clip[], t: number, side: 'before' | 'after'): Clip[] {
  const hit = locate(clips, t);
  if (!hit) return clips;
  // On a reversed clip, "before the playhead" is the later part of the source.
  const cutStart = (side === 'before') !== !!hit.clip.reverse;
  const next = cutStart ? trimStart(hit.clip, hit.sourceTime) : trimEnd(hit.clip, hit.sourceTime, Infinity);
  return clips.map((c) => (c.id === hit.clip.id ? next : c));
}
