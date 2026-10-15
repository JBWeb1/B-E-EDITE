import { uid } from '../lib/id';
import type { AudioClip, Clip, ClipFilters, MediaAsset, TextOverlay, VideoProject } from './types';

export const DEFAULT_IMAGE_SECONDS = 3;
export const MIN_CLIP_SECONDS = 0.1;

export const NEUTRAL_FILTERS: ClipFilters = { brightness: 1, contrast: 1, saturation: 1, blur: 0, grayscale: 0 };

export const FILTER_PRESETS: { label: string; filters: ClipFilters }[] = [
  { label: 'Original', filters: NEUTRAL_FILTERS },
  { label: 'Vivid', filters: { ...NEUTRAL_FILTERS, contrast: 1.15, saturation: 1.5 } },
  { label: 'Warm', filters: { ...NEUTRAL_FILTERS, brightness: 1.05, saturation: 1.2, contrast: 1.05 } },
  { label: 'Mono', filters: { ...NEUTRAL_FILTERS, grayscale: 1, contrast: 1.1 } },
  { label: 'Fade', filters: { ...NEUTRAL_FILTERS, contrast: 0.8, saturation: 0.7, brightness: 1.1 } },
  { label: 'Dream', filters: { ...NEUTRAL_FILTERS, blur: 1.5, brightness: 1.1, saturation: 1.2 } },
];

export const ASPECTS = [
  { label: '16:9 Landscape', width: 1280, height: 720 },
  { label: '9:16 Vertical', width: 720, height: 1280 },
  { label: '1:1 Square', width: 1080, height: 1080 },
  { label: '4:5 Portrait', width: 1080, height: 1350 },
];

export function createProject(width = 1280, height = 720): VideoProject {
  return { name: 'Untitled video', width, height, background: '#000000', assets: [], clips: [], texts: [], audio: [] };
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
  const right: Clip = { ...clip, id: uid('clip'), in: sourceTime, fadeIn: 0 };
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

export function cssFilter(f: ClipFilters): string {
  const parts = [
    f.brightness !== 1 && `brightness(${f.brightness})`,
    f.contrast !== 1 && `contrast(${f.contrast})`,
    f.saturation !== 1 && `saturate(${f.saturation})`,
    f.blur > 0 && `blur(${f.blur}px)`,
    f.grayscale > 0 && `grayscale(${f.grayscale})`,
  ].filter(Boolean);
  return parts.length ? parts.join(' ') : 'none';
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
