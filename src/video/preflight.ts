/**
 * Pre-flight checks: will this video work before you post it?
 * - Hook score: how strongly the first seconds grab attention.
 * - Safe zones: is anything important hidden under TikTok / Reels / Shorts buttons?
 * - Accessibility: flashing that can trigger seizures, captions that are too fast,
 *   too small or hard to read, and missing captions.
 * All of it is pure maths on numbers measured from the video, so it is unit-tested.
 */
import type { TextOverlay } from './types';

export type Severity = 'ok' | 'tip' | 'warn' | 'danger';

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  /** Seconds in the video to jump to. */
  at?: number;
  /** A one-click fix the editor knows how to apply. */
  fix?: FixId;
}

export type FixId = 'add-hook-title' | 'trim-slow-start' | 'add-captions' | 'slow-captions' | 'bigger-captions' | 'caption-box' | 'move-into-safe-zone' | 'remove-flashes';

// ---------- Luminance ----------

/** Relative luminance (0..1) of an sRGB colour, as WCAG defines it. */
export function luminance(r: number, g: number, b: number): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two luminances (1..21). */
export const contrastRatio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

export function hexLuminance(hex: string): number {
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  if (!m) return 1;
  return luminance(parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16));
}

/** Average relative luminance of RGBA pixels. */
export function meanLuminance(rgba: Uint8ClampedArray): number {
  let sum = 0;
  const n = rgba.length / 4;
  for (let i = 0; i < rgba.length; i += 4) sum += luminance(rgba[i], rgba[i + 1], rgba[i + 2]);
  return n ? sum / n : 0;
}

// ---------- Flashing (WCAG 2.3.1 "three flashes") ----------

export interface FlashEvent {
  /** Start of the second with too many flashes. */
  start: number;
  end: number;
  flashes: number;
}

/**
 * Seconds with more than three flashes. A flash is a pair of opposite luminance
 * changes of at least 10% where the darker state is below 0.8 (WCAG's definition).
 * `lum` is the frame's average luminance sampled `fps` times a second.
 */
export function findFlashes(lum: number[], fps: number): FlashEvent[] {
  // Big swings between a peak and a trough (hysteresis of 0.1), alternating up and down.
  // A slow fade is a single swing, so it never counts as flashing.
  const changes: { t: number; dir: number }[] = [];
  let extreme = lum[0] ?? 0;
  let trend = 0;
  for (let i = 1; i < lum.length; i++) {
    const v = lum[i];
    if (trend > 0 && v > extreme) extreme = v;
    else if (trend < 0 && v < extreme) extreme = v;
    else if (Math.abs(v - extreme) >= 0.1 && Math.min(v, extreme) < 0.8) {
      trend = v > extreme ? 1 : -1;
      changes.push({ t: i / fps, dir: trend });
      extreme = v;
    }
  }
  const events: FlashEvent[] = [];
  for (let a = 0; a < changes.length; a++) {
    let b = a;
    while (b + 1 < changes.length && changes[b + 1].t - changes[a].t < 1) b++;
    const flashes = Math.floor((b - a + 1) / 2);
    if (flashes > 3) {
      const start = changes[a].t;
      const last = events[events.length - 1];
      if (last && start <= last.end) {
        last.end = Math.max(last.end, changes[b].t);
        last.flashes = Math.max(last.flashes, flashes);
      } else events.push({ start, end: changes[b].t, flashes });
    }
  }
  return events;
}

// ---------- Captions ----------

/** Text items that are captions or words (not shapes or decorative titles). */
export const isCaption = (t: TextOverlay) => !t.shape && !t.template && t.text.trim().length > 0;

/** Characters per second needed to read a caption. Word-by-word captions read as they go. */
export const charsPerSecond = (t: TextOverlay) => t.text.replace(/\s+/g, ' ').trim().length / Math.max(0.1, t.duration);

/** Comfortable reading speed (Netflix uses 17–20 characters per second). */
export const MAX_CPS = 20;
/** Smallest comfortable text height, as a fraction of the frame height. */
export const MIN_TEXT_SIZE = 0.035;

/** Does the text have its own outline, box or glow (readable on any picture)? */
export const hasBacking = (t: TextOverlay) => !!(t.background || t.stroke || t.glow);

// ---------- Safe zones ----------

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Platform = 'tiktok' | 'reels' | 'shorts' | 'youtube';

/** Parts of the screen covered by each app's buttons and captions (fractions of the frame). */
export const SAFE_ZONES: { id: Platform; label: string; vertical: boolean; covered: (Box & { label: string })[] }[] = [
  {
    id: 'tiktok',
    label: 'TikTok',
    vertical: true,
    covered: [
      { x: 0.86, y: 0.36, w: 0.14, h: 0.5, label: 'Like, comment, share' },
      { x: 0, y: 0.78, w: 0.84, h: 0.22, label: 'Name & caption' },
      { x: 0, y: 0, w: 1, h: 0.09, label: 'Following / For You' },
    ],
  },
  {
    id: 'reels',
    label: 'Instagram Reels',
    vertical: true,
    covered: [
      { x: 0.86, y: 0.46, w: 0.14, h: 0.44, label: 'Like, comment, share' },
      { x: 0, y: 0.8, w: 0.84, h: 0.2, label: 'Name & caption' },
      { x: 0, y: 0, w: 1, h: 0.08, label: 'Reels header' },
    ],
  },
  {
    id: 'shorts',
    label: 'YouTube Shorts',
    vertical: true,
    covered: [
      { x: 0.85, y: 0.4, w: 0.15, h: 0.48, label: 'Like, dislike, comment' },
      { x: 0, y: 0.82, w: 0.84, h: 0.18, label: 'Title & channel' },
      { x: 0, y: 0, w: 1, h: 0.07, label: 'Search bar' },
    ],
  },
  {
    id: 'youtube',
    label: 'YouTube (16:9)',
    vertical: false,
    covered: [
      { x: 0, y: 0.9, w: 1, h: 0.1, label: 'Player controls' },
      { x: 0.8, y: 0.82, w: 0.2, h: 0.18, label: 'End-screen / card area' },
    ],
  },
];

/** How much of `a` lies inside `b` (0..1 of a's area). */
export function overlap(a: Box, b: Box): number {
  const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return a.w * a.h > 0 ? (w * h) / (a.w * a.h) : 0;
}

/** Approximate box of a text item on screen (fractions of the frame). */
export function textBox(t: TextOverlay, frameW: number, frameH: number): Box {
  const lines = t.text.split('\n');
  const longest = Math.max(1, ...lines.map((l) => l.length));
  const scale = t.scale ?? 1;
  const h = Math.min(1, t.size * scale * 1.25 * lines.length);
  if (t.shape) {
    const size = t.size * scale;
    const aspect = t.aspect ?? 1;
    return { x: t.x - (size * aspect * frameH) / frameW / 2, y: t.y - size / 2, w: (size * aspect * frameH) / frameW, h: size };
  }
  const w = Math.min(1, (longest * t.size * scale * 0.56 * frameH) / frameW);
  // Lower-third titles hang from their x; others are centred.
  const left = t.template?.startsWith('lower-third') ? t.x : t.x - w / 2;
  return { x: left, y: t.y - h / 2, w, h };
}

// ---------- Hook score ----------

export interface HookInput {
  /** Average picture change between frames in the first 3 s (0..1, ~0.02 is calm, 0.08+ lively). */
  motion: number;
  /** When the first text appears (seconds), or null. */
  firstText: number | null;
  /** Loudness in the first 2 s, 0..1 relative to the loudest part of the video. */
  openingLoudness: number;
  /** When the first cut to a new shot happens, or null. */
  firstCut: number | null;
  /** Brightness of the first frame (0..1 luminance). */
  firstFrameLuminance: number;
  /** Seconds of near silence and stillness at the very start. */
  slowStart: number;
  duration: number;
  vertical: boolean;
}

export interface HookResult {
  score: number;
  findings: Finding[];
}

/** 0–100 score for the first seconds, with the reasons and fixes. */
export function hookScore(h: HookInput): HookResult {
  const findings: Finding[] = [];
  let score = 0;
  const add = (points: number, f: Finding) => {
    score += points;
    findings.push(f);
  };
  // Movement (25)
  const m = Math.min(1, h.motion / 0.08);
  add(25 * m, m > 0.6
    ? { id: 'hook-motion', severity: 'ok', title: 'Lively opening', detail: 'There is plenty of movement in the first 3 seconds.' }
    : { id: 'hook-motion', severity: 'tip', title: 'The opening is quite still', detail: 'Start on your most active shot, or add a zoom (Motion) or a one-click animation to the first clip.', at: 0 });
  // Text on screen early (20)
  const textPts = h.firstText === null ? 0 : h.firstText <= 1 ? 20 : h.firstText <= 3 ? 12 : 4;
  add(textPts, textPts >= 20
    ? { id: 'hook-text', severity: 'ok', title: 'A title appears straight away', detail: 'Viewers watching on mute know what this is about.' }
    : { id: 'hook-text', severity: 'warn', title: h.firstText === null ? 'No text in the opening' : `First text only at ${h.firstText.toFixed(1)}s`, detail: 'Most people scroll with the sound off. Put a short hook title on screen in the first second.', at: 0, fix: 'add-hook-title' });
  // Sound (20)
  const s = Math.min(1, h.openingLoudness / 0.5);
  add(20 * s, s > 0.6
    ? { id: 'hook-sound', severity: 'ok', title: 'Sound from the start', detail: 'Music or speech starts right away.' }
    : { id: 'hook-sound', severity: 'tip', title: 'Quiet opening', detail: 'Start the music or the first words immediately, or add a whoosh sound effect at 0:00.', at: 0 });
  // Pace (20)
  const cutPts = h.firstCut === null ? (h.duration <= 4 ? 14 : 6) : h.firstCut <= 3 ? 20 : h.firstCut <= 5 ? 12 : 6;
  add(cutPts, cutPts >= 14
    ? { id: 'hook-pace', severity: 'ok', title: 'Good pace', detail: h.firstCut === null ? 'Short and to the point.' : `First cut at ${h.firstCut.toFixed(1)}s.` }
    : { id: 'hook-pace', severity: 'tip', title: h.firstCut === null ? 'One long shot' : `First cut only at ${h.firstCut.toFixed(1)}s`, detail: 'Change shot within the first 3 seconds to hold attention (press S to split).' });
  // No slow / dark start (15)
  const dark = h.firstFrameLuminance < 0.03;
  const slow = h.slowStart >= 0.6;
  add(dark || slow ? 0 : 15, dark || slow
    ? { id: 'hook-start', severity: 'warn', title: slow ? `Slow start (${h.slowStart.toFixed(1)}s of nothing)` : 'Starts on a black frame', detail: 'The first frame is what people see while scrolling. Trim the dead time at the start.', at: 0, fix: slow ? 'trim-slow-start' : undefined }
    : { id: 'hook-start', severity: 'ok', title: 'Strong first frame', detail: 'The video starts on something to look at.' });
  if (h.vertical && h.duration > 60) {
    findings.push({ id: 'hook-length', severity: 'tip', title: `${Math.round(h.duration)}s is long for a Short`, detail: 'Vertical videos under 60 seconds get the most reach. Try AI → Auto Shorts.' });
  }
  return { score: Math.round(score), findings };
}

/** Seconds at the start where the picture is still and the sound is quiet. */
export function slowStartLength(motion: number[], loud: number[], perSecond: number): number {
  let i = 0;
  while (i < motion.length && motion[i] < 0.01 && (loud[i] ?? 0) < 0.08) i++;
  return i / perSecond;
}

/** Summary label for a score. */
export const scoreLabel = (s: number) => (s >= 80 ? 'Great hook' : s >= 60 ? 'Good' : s >= 40 ? 'Could be stronger' : 'Weak hook');
