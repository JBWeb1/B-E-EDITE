/**
 * Animation maths shared by the editor and the engine: keyframes with easing
 * presets, wiggle, speed ramps / reverse, and layer transforms. All pure.
 */

export type Easing = 'linear' | 'smooth' | 'ease-in' | 'ease-out' | 'bounce' | 'elastic' | 'snap' | 'hold' | 'custom';

export const EASINGS: { value: Easing; label: string }[] = [
  { value: 'smooth', label: 'Smooth' },
  { value: 'linear', label: 'Linear' },
  { value: 'ease-in', label: 'Speed up' },
  { value: 'ease-out', label: 'Slow down' },
  { value: 'bounce', label: 'Bounce' },
  { value: 'elastic', label: 'Elastic' },
  { value: 'snap', label: 'Snap' },
  { value: 'hold', label: 'Hold (jump)' },
  { value: 'custom', label: 'Custom curve' },
];

/** A "speed up / slow down" curve shaped by two handles (like CSS cubic-bezier). */
export type Bezier = [number, number, number, number];

/** Default handles for a new custom curve (a gentle ease in and out). */
export const DEFAULT_BEZIER: Bezier = [0.42, 0, 0.58, 1];

/** y of a cubic-bezier easing curve at x (both 0..1), found with Newton steps and bisection. */
export function cubicBezier([x1, y1, x2, y2]: Bezier, x: number): number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const X = (t: number) => ((ax * t + bx) * t + cx) * t;
  const dX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  let t = x;
  for (let i = 0; i < 8; i++) {
    const err = X(t) - x;
    if (Math.abs(err) < 1e-6) break;
    const d = dX(t);
    if (Math.abs(d) < 1e-6) break;
    t -= err / d;
  }
  if (t < 0 || t > 1 || Math.abs(X(t) - x) > 1e-4) {
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 40; i++) {
      if (X(t) < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
  }
  return ((ay * t + by) * t + cy) * t;
}

/** Map progress 0..1 through an easing curve (`bez` shapes the 'custom' one). */
export function ease(e: Easing | undefined, x: number, bez?: Bezier): number {
  const t = Math.max(0, Math.min(1, x));
  switch (e ?? 'smooth') {
    case 'custom':
      return cubicBezier(bez ?? DEFAULT_BEZIER, t);
    case 'linear':
      return t;
    case 'ease-in':
      return t * t * t;
    case 'ease-out':
      return 1 - (1 - t) ** 3;
    case 'bounce': {
      // Overshoots a little and settles, like a ball landing.
      const n = 7.5625;
      const d = 2.75;
      if (t < 1 / d) return n * t * t;
      if (t < 2 / d) return n * (t - 1.5 / d) ** 2 + 0.75;
      if (t < 2.5 / d) return n * (t - 2.25 / d) ** 2 + 0.9375;
      return n * (t - 2.625 / d) ** 2 + 0.984375;
    }
    case 'elastic':
      return t === 0 || t === 1 ? t : 2 ** (-10 * t) * Math.sin(((t * 10 - 0.75) * 2 * Math.PI) / 3) + 1;
    case 'snap':
      // Most of the move happens at once, then it eases into place.
      return 1 - (1 - t) ** 6;
    case 'hold':
      return t < 1 ? 0 : 1;
    case 'smooth':
    default:
      return t * t * (3 - 2 * t);
  }
}

export interface Keyframe {
  /** Seconds from the start of the item. */
  t: number;
  v: number;
  /** Easing of the move from this keyframe to the next. */
  ease?: Easing;
  /** Handles of a 'custom' easing. */
  bez?: Bezier;
}

export type AnimProp = 'x' | 'y' | 'scale' | 'rotation' | 'opacity' | 'volume' | 'maskX' | 'maskY' | 'maskScale';
export type Keyframes = Partial<Record<AnimProp, Keyframe[]>>;

/** Keyframes closer than this (seconds) count as the same one. */
export const KEY_EPS = 1 / 60;

/** Value of an animated property at local time `t`; `base` when it has no keyframes. */
export function valueAt(keys: Keyframe[] | undefined, t: number, base: number): number {
  if (!keys || keys.length === 0) return base;
  if (t <= keys[0].t) return keys[0].v;
  const last = keys[keys.length - 1];
  if (t >= last.t) return last.v;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (t >= a.t && t <= b.t) {
      const span = b.t - a.t;
      const p = span <= 0 ? 1 : ease(a.ease, (t - a.t) / span, a.bez);
      return a.v + (b.v - a.v) * p;
    }
  }
  return last.v;
}

/** Add or replace the keyframe at `t`, keeping the list sorted. */
export function setKey(keys: Keyframe[] | undefined, t: number, v: number, easing?: Easing): Keyframe[] {
  const list = (keys ?? []).filter((k) => Math.abs(k.t - t) > KEY_EPS);
  const old = keys?.find((k) => Math.abs(k.t - t) <= KEY_EPS);
  list.push({ t: Math.max(0, t), v, ease: easing ?? old?.ease ?? 'smooth' });
  return list.sort((a, b) => a.t - b.t);
}

export function removeKey(keys: Keyframe[] | undefined, t: number): Keyframe[] {
  return (keys ?? []).filter((k) => Math.abs(k.t - t) > KEY_EPS);
}

export function keyAt(keys: Keyframe[] | undefined, t: number): Keyframe | undefined {
  return keys?.find((k) => Math.abs(k.t - t) <= KEY_EPS);
}

/** All keyframe times of an item (for the diamonds on the timeline), sorted and unique. */
export function keyTimes(kf: Keyframes | undefined): number[] {
  const times: number[] = [];
  for (const list of Object.values(kf ?? {})) {
    for (const k of list ?? []) if (!times.some((x) => Math.abs(x - k.t) <= KEY_EPS)) times.push(k.t);
  }
  return times.sort((a, b) => a - b);
}

export function hasKeys(kf: Keyframes | undefined): boolean {
  return Object.values(kf ?? {}).some((l) => (l?.length ?? 0) > 0);
}

/** Set the easing of every keyframe of an item. */
export function setAllEasing(kf: Keyframes | undefined, easing: Easing): Keyframes {
  const out: Keyframes = {};
  for (const [prop, list] of Object.entries(kf ?? {})) out[prop as AnimProp] = list?.map((k) => ({ ...k, ease: easing }));
  return out;
}

/**
 * Keep the keyframes of [from, to) (local times) and move them so `from` becomes 0.
 * Used when an item is split, so each half keeps its part of the animation.
 */
export function sliceKeys(kf: Keyframes | undefined, from: number, to: number, base: Partial<Record<AnimProp, number>> = {}): Keyframes | undefined {
  if (!kf) return kf;
  const out: Keyframes = {};
  for (const [p, list] of Object.entries(kf) as [AnimProp, Keyframe[] | undefined][]) {
    if (!list?.length) continue;
    const inside = list.filter((k) => k.t >= from - KEY_EPS && k.t < to - KEY_EPS).map((k) => ({ ...k, t: Math.max(0, k.t - from) }));
    // Pin the value at the cut so the half looks the same as before the split.
    const atStart = valueAt(list, from, base[p] ?? 0);
    if (!inside.some((k) => k.t <= KEY_EPS)) inside.unshift({ t: 0, v: atStart, ease: [...list].reverse().find((k) => k.t <= from)?.ease ?? 'smooth' });
    // Pin the value at the end too, so the part before a later keyframe keeps moving.
    if (Number.isFinite(to) && list.some((k) => k.t > to + KEY_EPS) && !inside.some((k) => Math.abs(k.t - (to - from)) <= KEY_EPS)) {
      inside.push({ t: to - from, v: valueAt(list, to, base[p] ?? 0), ease: 'smooth' });
    }
    out[p] = inside;
  }
  return out;
}

/** Previous / next keyframe time from `t` (for the ◀ ◆ ▶ buttons). */
export function neighbourKey(kf: Keyframes | undefined, t: number, dir: -1 | 1): number | null {
  const times = keyTimes(kf);
  if (dir < 0) {
    const before = times.filter((x) => x < t - KEY_EPS);
    return before.length ? before[before.length - 1] : null;
  }
  return times.find((x) => x > t + KEY_EPS) ?? null;
}

// ---------- Wiggle (camera shake / handheld) ----------

/** Smooth pseudo-random value in -1..1 for time `t`, `speed` wobbles per second. Same input, same output. */
export function wiggle(seed: number, t: number, speed: number): number {
  const s = seed * 12.9898;
  const f = Math.max(0.05, speed);
  return (
    0.55 * Math.sin(t * f * 2 * Math.PI + s) +
    0.3 * Math.sin(t * f * 2 * Math.PI * 2.31 + s * 1.7) +
    0.15 * Math.sin(t * f * 2 * Math.PI * 4.73 + s * 2.9)
  );
}

// ---------- Speed ramps & reverse ----------

export type Ramp = 'none' | 'montage' | 'hero' | 'bullet' | 'flash-in' | 'flash-out' | 'custom';

export const RAMPS: { value: Ramp; label: string; hint: string }[] = [
  { value: 'none', label: 'None', hint: 'Constant speed' },
  { value: 'montage', label: 'Montage', hint: 'Slow, fast, slow' },
  { value: 'hero', label: 'Hero', hint: 'Fast, slow-mo in the middle, fast' },
  { value: 'bullet', label: 'Bullet', hint: 'Big slow-mo moment in the middle' },
  { value: 'flash-in', label: 'Flash in', hint: 'Starts fast, ends slow' },
  { value: 'flash-out', label: 'Flash out', hint: 'Starts slow, ends fast' },
  { value: 'custom', label: 'Custom', hint: 'Draw your own speed curve' },
];

/** Points of a new custom curve (speed at evenly spaced moments of the clip). */
export const DEFAULT_CURVE = [1, 1, 1, 1, 1, 1];

/** Custom curve speed at progress u, before normalising (straight lines between the points). */
function curveRaw(curve: number[], u: number): number {
  if (curve.length < 2) return 1;
  const x = Math.max(0, Math.min(1, u)) * (curve.length - 1);
  const i = Math.min(curve.length - 2, Math.floor(x));
  return curve[i] + (curve[i + 1] - curve[i]) * (x - i);
}

/** Area under the raw curve from 0 to u (exact, segment by segment). */
function curveArea(curve: number[], u: number): number {
  const n = curve.length - 1;
  const x = Math.max(0, Math.min(1, u)) * n;
  let area = 0;
  for (let i = 0; i < n && i < x; i++) {
    const end = Math.min(x, i + 1);
    const a = curve[i];
    const b = curveRaw(curve, end / n);
    area += ((a + b) / 2) * (end - i);
  }
  return area / n;
}

/** The speed the clip really plays at each curve point (the curve keeps the clip's length, so speeds average 1). */
export function curveSpeeds(curve: number[]): number[] {
  const mean = curveArea(curve, 1) || 1;
  return curve.map((v) => v / mean);
}

const RAMP_DEPTH: Record<Ramp, number> = { none: 0, montage: 0.6, hero: 0.6, bullet: 0.85, 'flash-in': 0.8, 'flash-out': 0.8, custom: 0 };

/**
 * How far through the source a ramped clip is, for output progress u (both 0..1).
 * Every curve starts at 0, ends at 1 and never runs backwards, so the clip keeps its length.
 */
export function rampWarp(ramp: Ramp | undefined, u: number, curve?: number[]): number {
  const x = Math.max(0, Math.min(1, u));
  if (ramp === 'custom' && curve && curve.length > 1) return curveArea(curve, x) / (curveArea(curve, 1) || 1);
  const a = RAMP_DEPTH[ramp ?? 'none'] ?? 0;
  switch (ramp) {
    case 'hero':
    case 'bullet':
      // Speed 1 + a·cos(2πu): fast at both ends, slowest in the middle.
      return x + (a * Math.sin(2 * Math.PI * x)) / (2 * Math.PI);
    case 'montage':
      return x - (a * Math.sin(2 * Math.PI * x)) / (2 * Math.PI);
    case 'flash-in':
      // Speed 1 + a(1 - 2u): fast first, slow at the end.
      return x + a * x * (1 - x);
    case 'flash-out':
      return x - a * x * (1 - x);
    default:
      return x;
  }
}

/** Relative playback speed of a ramp at output progress u (the slope of rampWarp). */
export function rampRate(ramp: Ramp | undefined, u: number, curve?: number[]): number {
  const x = Math.max(0, Math.min(1, u));
  if (ramp === 'custom' && curve && curve.length > 1) return curveRaw(curve, x) / (curveArea(curve, 1) || 1);
  const a = RAMP_DEPTH[ramp ?? 'none'] ?? 0;
  switch (ramp) {
    case 'hero':
    case 'bullet':
      return 1 + a * Math.cos(2 * Math.PI * x);
    case 'montage':
      return 1 - a * Math.cos(2 * Math.PI * x);
    case 'flash-in':
      return 1 + a * (1 - 2 * x);
    case 'flash-out':
      return 1 - a * (1 - 2 * x);
    default:
      return 1;
  }
}

/** Source time for `local` seconds into a clip, honouring speed, ramp and reverse. */
export function sourceTimeAt(
  clip: { in: number; out: number; speed: number; ramp?: Ramp; curve?: number[]; reverse?: boolean },
  local: number,
): number {
  const len = clip.out - clip.in;
  const outLen = len / clip.speed;
  const u = outLen > 0 ? local / outLen : 0;
  const w = rampWarp(clip.ramp, u, clip.curve) * len;
  return clip.reverse ? clip.out - w : clip.in + w;
}

// ---------- Layer transforms ----------

export interface Transform {
  /** Centre, 0..1 of the frame. */
  x: number;
  y: number;
  /** Size multiplier (1 = normal). */
  scale: number;
  /** Degrees, clockwise. */
  rotation: number;
  /** 0..1. */
  opacity: number;
}

export interface AnimatedLayer {
  x?: number;
  y?: number;
  scale?: number;
  rotation?: number;
  opacity?: number;
  keys?: Keyframes;
  wiggle?: { amount: number; speed: number } | null;
}

/** Where a layer is at local time `t`: base values, then keyframes, then wiggle. */
export function transformAt(layer: AnimatedLayer, t: number, seed = 1, defaults: Partial<Transform> = {}): Transform {
  const k = layer.keys;
  const base: Transform = {
    x: layer.x ?? defaults.x ?? 0.5,
    y: layer.y ?? defaults.y ?? 0.5,
    scale: layer.scale ?? defaults.scale ?? 1,
    rotation: layer.rotation ?? defaults.rotation ?? 0,
    opacity: layer.opacity ?? defaults.opacity ?? 1,
  };
  const out: Transform = {
    x: valueAt(k?.x, t, base.x),
    y: valueAt(k?.y, t, base.y),
    scale: valueAt(k?.scale, t, base.scale),
    rotation: valueAt(k?.rotation, t, base.rotation),
    opacity: Math.max(0, Math.min(1, valueAt(k?.opacity, t, base.opacity))),
  };
  const w = layer.wiggle;
  if (w && w.amount > 0) {
    out.x += 0.03 * w.amount * wiggle(seed, t, w.speed);
    out.y += 0.03 * w.amount * wiggle(seed + 7, t, w.speed);
    out.rotation += 2 * w.amount * wiggle(seed + 13, t, w.speed);
  }
  return out;
}

/** One-click animations that write keyframes for you. */
export type AnimPreset = 'fade-in' | 'fade-out' | 'zoom-in' | 'zoom-out' | 'slide-left' | 'slide-right' | 'slide-up' | 'pop' | 'spin' | 'drift';

export const ANIM_PRESETS: { value: AnimPreset; label: string }[] = [
  { value: 'fade-in', label: 'Fade in' },
  { value: 'fade-out', label: 'Fade out' },
  { value: 'zoom-in', label: 'Zoom in' },
  { value: 'zoom-out', label: 'Zoom out' },
  { value: 'slide-left', label: 'Slide in ←' },
  { value: 'slide-right', label: 'Slide in →' },
  { value: 'slide-up', label: 'Rise up' },
  { value: 'pop', label: 'Pop in' },
  { value: 'spin', label: 'Spin in' },
  { value: 'drift', label: 'Slow drift' },
];

/** Keyframes for a preset on an item `length` seconds long, starting from transform `t0`. */
export function presetKeys(preset: AnimPreset, length: number, t0: Transform): Keyframes {
  const d = Math.min(0.6, length / 2);
  const end = Math.max(d, length);
  switch (preset) {
    case 'fade-in':
      return { opacity: [{ t: 0, v: 0, ease: 'smooth' }, { t: d, v: t0.opacity }] };
    case 'fade-out':
      return { opacity: [{ t: end - d, v: t0.opacity, ease: 'smooth' }, { t: end, v: 0 }] };
    case 'zoom-in':
      return { scale: [{ t: 0, v: t0.scale, ease: 'linear' }, { t: end, v: t0.scale * 1.25 }] };
    case 'zoom-out':
      return { scale: [{ t: 0, v: t0.scale * 1.25, ease: 'linear' }, { t: end, v: t0.scale }] };
    case 'slide-left':
      return { x: [{ t: 0, v: t0.x + 1, ease: 'ease-out' }, { t: d, v: t0.x }] };
    case 'slide-right':
      return { x: [{ t: 0, v: t0.x - 1, ease: 'ease-out' }, { t: d, v: t0.x }] };
    case 'slide-up':
      return {
        y: [{ t: 0, v: t0.y + 0.15, ease: 'ease-out' }, { t: d, v: t0.y }],
        opacity: [{ t: 0, v: 0, ease: 'smooth' }, { t: d, v: t0.opacity }],
      };
    case 'pop':
      return { scale: [{ t: 0, v: 0, ease: 'elastic' }, { t: d * 1.5, v: t0.scale }] };
    case 'spin':
      return {
        rotation: [{ t: 0, v: t0.rotation - 180, ease: 'ease-out' }, { t: d, v: t0.rotation }],
        scale: [{ t: 0, v: 0, ease: 'ease-out' }, { t: d, v: t0.scale }],
      };
    case 'drift':
      return {
        x: [{ t: 0, v: t0.x - 0.03, ease: 'linear' }, { t: end, v: t0.x + 0.03 }],
        scale: [{ t: 0, v: t0.scale, ease: 'linear' }, { t: end, v: t0.scale * 1.08 }],
      };
  }
}

/** Merge preset keyframes into existing ones (preset wins for the properties it animates). */
export function applyPreset(existing: Keyframes | undefined, preset: Keyframes): Keyframes {
  return { ...(existing ?? {}), ...preset };
}
