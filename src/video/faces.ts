/**
 * Face tools: faces found in a clip are linked into tracks (the same person from frame
 * to frame), so they can be blurred for privacy, retouched, enhanced, followed by a
 * sticker or label, and kept in frame by smart reframe. Pure and unit-tested; the
 * detector and the drawing live in `faceRun.ts`.
 */
import type { Keyframe } from './anim';
import { sourceTimeAt } from './anim';
import { clipFrame, cropRect } from './layers';
import { clipDuration } from './timeline';
import type { Clip, MediaAsset } from './types';

/** A face box as fractions of the picture (0..1). */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Detection extends Box {
  score: number;
}

/** One person's face through a clip. `boxes[i]` is at source second `from + i / rate` (null: not seen). */
export interface FaceTrack {
  id: string;
  boxes: (Box | null)[];
}

export interface FaceScan {
  from: number;
  rate: number;
  tracks: FaceTrack[];
}

export interface FaceLook {
  /** Track ids to blur ("privacy"), and how. */
  blur: string[];
  mode: 'blur' | 'pixelate' | 'box';
  strength: number;
  /** 0..1 each: skin smoothing, a little more light on faces, sharper detail. */
  smooth: number;
  brighten: number;
  enhance: number;
}

export const NO_FACE_LOOK: FaceLook = { blur: [], mode: 'blur', strength: 0.6, smooth: 0, brighten: 0, enhance: 0 };

export function iou(a: Box, b: Box): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

const centreDist = (a: Box, b: Box) => Math.hypot(a.x + a.w / 2 - (b.x + b.w / 2), a.y + a.h / 2 - (b.y + b.h / 2)) / Math.max(a.w, b.w, 1e-6);

/**
 * Link per-frame detections into tracks: each face continues the track it overlaps
 * most (or is nearest to), a track survives a few missed frames, and very short
 * tracks (false alarms) are dropped. Small gaps are filled in.
 */
export function linkFaces(frames: Detection[][], opts: { minScore?: number; maxGap?: number; minLength?: number } = {}): FaceTrack[] {
  const minScore = opts.minScore ?? 0.5;
  const maxGap = opts.maxGap ?? 5;
  const minLength = opts.minLength ?? 3;
  const n = frames.length;
  const tracks: { boxes: (Box | null)[]; last: number; lastBox: Box }[] = [];
  frames.forEach((dets, i) => {
    const free = new Set(tracks.map((_, k) => k).filter((k) => i - tracks[k].last <= maxGap + 1));
    const sorted = dets.filter((d) => d.score >= minScore).sort((a, b) => b.score - a.score);
    for (const d of sorted) {
      let best = -1;
      let bestScore = 0;
      for (const k of free) {
        const t = tracks[k];
        const score = iou(t.lastBox, d) + (centreDist(t.lastBox, d) < 0.8 ? 0.3 : 0);
        if (score > bestScore) {
          bestScore = score;
          best = k;
        }
      }
      const box = { x: d.x, y: d.y, w: d.w, h: d.h };
      if (best >= 0 && bestScore > 0.15) {
        tracks[best].boxes[i] = box;
        tracks[best].last = i;
        tracks[best].lastBox = box;
        free.delete(best);
      } else {
        const boxes: (Box | null)[] = Array(n).fill(null);
        boxes[i] = box;
        tracks.push({ boxes, last: i, lastBox: box });
      }
    }
  });
  return tracks
    .filter((t) => t.boxes.filter(Boolean).length >= minLength)
    .map((t, k) => ({ id: `face${k + 1}`, boxes: smoothBoxes(fillGaps(t.boxes, maxGap)) }))
    .sort((a, b) => b.boxes.filter(Boolean).length - a.boxes.filter(Boolean).length)
    .map((t, k) => ({ ...t, id: `face${k + 1}` }));
}

/** Fill gaps of up to `maxGap` missing frames by drawing a straight line between the boxes. */
export function fillGaps(boxes: (Box | null)[], maxGap: number): (Box | null)[] {
  const out = [...boxes];
  let prev = -1;
  for (let i = 0; i < out.length; i++) {
    if (!out[i]) continue;
    if (prev >= 0 && i - prev > 1 && i - prev - 1 <= maxGap) {
      const a = out[prev]!;
      const b = out[i]!;
      for (let j = prev + 1; j < i; j++) {
        const f = (j - prev) / (i - prev);
        out[j] = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, w: a.w + (b.w - a.w) * f, h: a.h + (b.h - a.h) * f };
      }
    }
    prev = i;
  }
  return out;
}

/** Light smoothing over neighbouring frames, so boxes don't jitter. */
export function smoothBoxes(boxes: (Box | null)[]): (Box | null)[] {
  const r = (v: number) => Math.round(v * 10000) / 10000;
  return boxes.map((b, i) => {
    if (!b) return null;
    const near = [boxes[i - 1], b, b, boxes[i + 1]].filter((x): x is Box => !!x);
    const avg = (k: keyof Box) => near.reduce((s, x) => s + x[k], 0) / near.length;
    return { x: r(avg('x')), y: r(avg('y')), w: r(avg('w')), h: r(avg('h')) };
  });
}

/** Where a tracked face is at source second `t` (between samples), or null if it isn't there. */
export function boxAt(scan: Pick<FaceScan, 'from' | 'rate'>, track: FaceTrack, t: number): Box | null {
  const x = (t - scan.from) * scan.rate;
  if (x < -0.5 || x > track.boxes.length - 0.5) return null;
  const i = Math.max(0, Math.min(track.boxes.length - 1, Math.floor(x)));
  const a = track.boxes[i];
  const b = track.boxes[Math.min(track.boxes.length - 1, i + 1)];
  if (!a) return x - i > 0.5 && b ? b : null;
  if (!b) return a;
  const f = Math.max(0, Math.min(1, x - i));
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, w: a.w + (b.w - a.w) * f, h: a.h + (b.h - a.h) * f };
}

/** Grow a face box a little (hair, chin and ears), staying inside the picture. */
export function padBox(b: Box, pad = 0.25): Box {
  const x = Math.max(0, b.x - b.w * pad);
  const y = Math.max(0, b.y - b.h * pad);
  return { x, y, w: Math.min(1, b.x + b.w * (1 + pad)) - x, h: Math.min(1, b.y + b.h * (1 + pad)) - y };
}

/** Horizontal centre (0..1) to keep in frame for smart reframe: the biggest face, if any. */
export function faceFocus(dets: Detection[]): number | null {
  const good = dets.filter((d) => d.score >= 0.5);
  if (!good.length) return null;
  const big = good.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a));
  return big.x + big.w / 2;
}

/**
 * Keyframes that make a sticker or label follow a face on a main-track clip.
 * `place` is where the item goes relative to the face: 'on' (over it) or 'below'.
 * Times are local to the item, which starts at project second `itemStart`.
 */
export function followKeys(
  clip: Clip,
  clipStart: number,
  asset: MediaAsset,
  frame: { width: number; height: number },
  scan: FaceScan,
  track: FaceTrack,
  itemStart: number,
  itemLength: number,
  place: 'on' | 'below' = 'on',
): { x: Keyframe[]; y: Keyframe[]; size: number } | null {
  const W = frame.width;
  const H = frame.height;
  const len = clipDuration(clip);
  const src = cropRect(asset.width ?? W, asset.height ?? H, clip.crop);
  const sw = asset.width ?? W;
  const sh = asset.height ?? H;
  const x: Keyframe[] = [];
  const y: Keyframe[] = [];
  let size = 0;
  const end = Math.min(itemStart + itemLength, clipStart + len);
  for (let t = Math.max(itemStart, clipStart); t <= end + 1e-6; t += 1 / scan.rate) {
    const local = t - clipStart;
    const b = boxAt(scan, track, sourceTimeAt(clip, local));
    if (!b) continue;
    const f = clipFrame(clip, asset, W, H, local, len > 0 ? local / len : 0);
    // Face centre (or just under the chin) in the source picture, then in the frame.
    const fx = (b.x + b.w / 2) * sw;
    const fy = (place === 'on' ? b.y + b.h / 2 : b.y + b.h * 1.25) * sh;
    let u = (fx - src.sx) / src.sw;
    const v = (fy - src.sy) / src.sh;
    if (clip.mirror) u = 1 - u;
    const r = (n: number) => Math.round(n * 10000) / 10000;
    x.push({ t: r(t - itemStart), v: r((f.cx - f.w / 2 + u * f.w) / W), ease: 'linear' });
    y.push({ t: r(t - itemStart), v: r((f.cy - f.h / 2 + v * f.h) / H), ease: 'linear' });
    size = Math.max(size, (b.h * sh * (f.h / src.sh)) / H);
  }
  return x.length ? { x, y, size } : null;
}

// ---------- Pixels ----------

/** How skin-like each pixel is (0..1), from its colour (a simple, lighting-tolerant rule). */
export function skinMask(rgba: Uint8ClampedArray): Float32Array {
  const out = new Float32Array(rgba.length / 4);
  for (let i = 0; i < out.length; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    // YCbCr skin range (works for light and dark skin).
    const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
    const inCb = 1 - Math.min(1, Math.max(0, Math.abs(cb - 108) - 22) / 12);
    const inCr = 1 - Math.min(1, Math.max(0, Math.abs(cr - 153) - 20) / 12);
    out[i] = Math.max(0, inCb) * Math.max(0, inCr);
  }
  return out;
}

/** Mix `soft` into `sharp` where the weight says (both RGBA, same size), in place on `sharp`. */
export function mixWeighted(sharp: Uint8ClampedArray, soft: Uint8ClampedArray, weight: Float32Array, amount: number): void {
  for (let i = 0; i < weight.length; i++) {
    const w = Math.max(0, Math.min(1, weight[i] * amount));
    if (w <= 0) continue;
    for (let c = 0; c < 3; c++) sharp[i * 4 + c] = sharp[i * 4 + c] + (soft[i * 4 + c] - sharp[i * 4 + c]) * w;
  }
}

/** Unsharp mask: push each pixel away from its 3×3 neighbourhood average (`amount` 0..1+). */
export function sharpen(rgba: Uint8ClampedArray, w: number, h: number, amount: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba);
  if (amount <= 0) return out;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += rgba[i + (dy * w + dx) * 4 + c];
        out[i + c] = rgba[i + c] + (rgba[i + c] - sum / 9) * amount * 1.5;
      }
    }
  }
  return out;
}
