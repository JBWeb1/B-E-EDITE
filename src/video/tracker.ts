/**
 * Motion tracking: follow a point through video frames by matching a small
 * patch of pixels from one frame to the next, then turn the path into
 * position keyframes. The maths is pure (frames are grey-level arrays), so it
 * is unit-tested; grabbing frames from a video lives in the editor.
 */
import type { Keyframe } from './anim';

/** Grey-level image, one value 0..255 per pixel. */
export interface GrayFrame {
  w: number;
  h: number;
  data: Float32Array;
}

/** Grey-level copy of RGBA pixels (from getImageData). */
export function toGray(rgba: Uint8ClampedArray, w: number, h: number): GrayFrame {
  const data = new Float32Array(w * h);
  for (let i = 0, j = 0; j < data.length; i += 4, j++) data[j] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  return { w, h, data };
}

/** Average absolute difference between a patch of `a` at (ax, ay) and of `b` at (bx, by). */
function patchDiff(a: GrayFrame, ax: number, ay: number, b: GrayFrame, bx: number, by: number, r: number, cap: number): number {
  let sum = 0;
  let n = 0;
  for (let dy = -r; dy <= r; dy++) {
    const ya = ay + dy;
    const yb = by + dy;
    if (ya < 0 || ya >= a.h || yb < 0 || yb >= b.h) continue;
    for (let dx = -r; dx <= r; dx++) {
      const xa = ax + dx;
      const xb = bx + dx;
      if (xa < 0 || xa >= a.w || xb < 0 || xb >= b.w) continue;
      sum += Math.abs(a.data[ya * a.w + xa] - b.data[yb * b.w + xb]);
      n++;
    }
    // Stop early once this candidate is already worse than the best so far.
    if (n > 0 && sum / n > cap * 4) break;
  }
  return n > 0 ? sum / n : Infinity;
}

export interface TrackOptions {
  /** Half-size of the patch that is matched, in pixels. */
  patch?: number;
  /** How far the point may move between two frames, in pixels. */
  search?: number;
}

/** Where the patch around (x, y) in `prev` went in `next`. `score` is the average difference (0 = perfect). */
export function trackStep(prev: GrayFrame, next: GrayFrame, x: number, y: number, opts: TrackOptions = {}): { x: number; y: number; score: number } {
  const r = opts.patch ?? 8;
  const s = opts.search ?? 14;
  const cx = Math.round(x);
  const cy = Math.round(y);
  let best = { x: cx, y: cy, score: patchDiff(prev, cx, cy, next, cx, cy, r, Infinity) };
  // Coarse pass every 2 pixels, then refine around the winner.
  for (let dy = -s; dy <= s; dy += 2) {
    for (let dx = -s; dx <= s; dx += 2) {
      const score = patchDiff(prev, cx, cy, next, cx + dx, cy + dy, r, best.score);
      if (score < best.score) best = { x: cx + dx, y: cy + dy, score };
    }
  }
  const coarse = best;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const score = patchDiff(prev, cx, cy, next, coarse.x + dx, coarse.y + dy, r, best.score);
      if (score < best.score) best = { x: coarse.x + dx, y: coarse.y + dy, score };
    }
  }
  // Sub-pixel: fit through the best match and its neighbours. Without this,
  // slow movements (under a pixel or two a frame) get rounded away frame after frame.
  const at = (dx: number, dy: number) => patchDiff(prev, cx, cy, next, best.x + dx, best.y + dy, r, Infinity);
  const refine = (m: number, c: number, p: number) => {
    if (!Number.isFinite(m) || !Number.isFinite(p)) return 0;
    const hi = Math.max(m, p);
    // An exact whole-pixel match needs no refining.
    if (c <= 0.05 * Math.min(m, p) || hi - c < 1e-9) return 0;
    // Absolute differences rise in a V around the true position: fit a V, not a curve.
    return Math.max(-0.5, Math.min(0.5, (m - p) / (2 * (hi - c))));
  };
  const fx = refine(at(-1, 0), best.score, at(1, 0));
  const fy = refine(at(0, -1), best.score, at(0, 1));
  // Move the exact (not rounded) point by the matched displacement.
  const nx = x + (best.x - cx) + fx;
  const ny = y + (best.y - cy) + fy;
  return { x: Math.max(0, Math.min(next.w - 1, nx)), y: Math.max(0, Math.min(next.h - 1, ny)), score: best.score };
}

/** Follow a point through a list of frames. Returns one position per frame (the first is the start point). */
export function trackSequence(frames: GrayFrame[], x0: number, y0: number, opts: TrackOptions = {}): { x: number; y: number; score: number }[] {
  const out = [{ x: x0, y: y0, score: 0 }];
  for (let i = 1; i < frames.length; i++) {
    const p = out[i - 1];
    out.push(trackStep(frames[i - 1], frames[i], p.x, p.y, opts));
  }
  return out;
}

export interface TrackPoint {
  /** Seconds (local to the item that follows the track). */
  t: number;
  /** Position as fractions of the frame. */
  x: number;
  y: number;
}

/** Distance of point p from the line through a and b (in x/y only). */
function lineDistance(p: TrackPoint, a: TrackPoint, b: TrackPoint): number {
  const span = b.t - a.t;
  const k = span > 0 ? (p.t - a.t) / span : 0;
  return Math.hypot(p.x - (a.x + (b.x - a.x) * k), p.y - (a.y + (b.y - a.y) * k));
}

/** Drop points that lie (within `tolerance`) on a straight move between their neighbours. */
export function simplifyPath(points: TrackPoint[], tolerance = 0.003): TrackPoint[] {
  if (points.length <= 2) return points;
  let worst = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = lineDistance(points[i], points[0], points[points.length - 1]);
    if (d > worst) {
      worst = d;
      index = i;
    }
  }
  if (worst <= tolerance) return [points[0], points[points.length - 1]];
  const left = simplifyPath(points.slice(0, index + 1), tolerance);
  const right = simplifyPath(points.slice(index), tolerance);
  return [...left.slice(0, -1), ...right];
}

/**
 * Keyframes that make an item follow a tracked path. `offset` keeps the item where it
 * was relative to the tracked point when tracking started.
 */
export function pathToKeys(points: TrackPoint[], offset = { x: 0, y: 0 }, tolerance = 0.003): { x: Keyframe[]; y: Keyframe[] } {
  const simple = simplifyPath(points, tolerance);
  return {
    x: simple.map((p) => ({ t: p.t, v: p.x + offset.x, ease: 'linear' as const })),
    y: simple.map((p) => ({ t: p.t, v: p.y + offset.y, ease: 'linear' as const })),
  };
}
