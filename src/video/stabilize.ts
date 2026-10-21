/**
 * Video stabiliser: measure how the whole picture moves from frame to frame, keep the
 * smooth part of that path (the intended camera move) and cancel the jitter. The clip
 * is zoomed in slightly so the moving edges never show. Pure and unit-tested; the
 * frames come from `grabGrayFrames`.
 */
import type { GrayFrame } from './tracker';
import type { Stabilize } from './types';

/** How far (pixels) picture `b` has moved compared with `a`, found by trying every shift up to `range`. */
export function globalShift(a: GrayFrame, b: GrayFrame, range = 6): { x: number; y: number } {
  const { w, h } = a;
  const m = range + 1; // ignore the border, which shifts out of view
  const cost = (dx: number, dy: number) => {
    let sum = 0;
    let n = 0;
    for (let y = m; y < h - m; y += 1) {
      const ra = y * w;
      const rb = (y + dy) * w + dx;
      for (let x = m; x < w - m; x += 1) {
        sum += Math.abs(a.data[ra + x] - b.data[rb + x]);
        n++;
      }
    }
    return sum / Math.max(1, n);
  };
  let best = { x: 0, y: 0, c: Infinity };
  const table = new Map<string, number>();
  for (let dy = -range; dy <= range; dy++) {
    for (let dx = -range; dx <= range; dx++) {
      const c = cost(dx, dy);
      table.set(`${dx},${dy}`, c);
      if (c < best.c) best = { x: dx, y: dy, c };
    }
  }
  // Sub-pixel: fit a parabola through the best cost and its neighbours.
  const refine = (c0: number | undefined, c1: number, c2: number | undefined) => {
    if (c0 === undefined || c2 === undefined) return 0;
    const d = c0 - 2 * c1 + c2;
    return d > 1e-9 ? Math.max(-0.5, Math.min(0.5, (c0 - c2) / (2 * d))) : 0;
  };
  const at = (x: number, y: number) => table.get(`${x},${y}`);
  return {
    x: best.x + refine(at(best.x - 1, best.y), best.c, at(best.x + 1, best.y)),
    y: best.y + refine(at(best.x, best.y - 1), best.c, at(best.x, best.y + 1)),
  };
}

/** Moving average over ±radius samples (the ends use what is there). */
export function smoothPath(values: number[], radius: number): number[] {
  const r = Math.max(0, Math.round(radius));
  return values.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - r); j <= Math.min(values.length - 1, i + r); j++) {
      sum += values[j];
      n++;
    }
    return sum / n;
  });
}

/**
 * Corrections for a sequence of frames sampled `rate` times a second from source
 * second `from`. `strength` 0..1: how much of the shake to remove (1 = locked off).
 */
export function planStabilize(frames: GrayFrame[], rate: number, from: number, strength = 0.8): Stabilize {
  const xs = [0];
  const ys = [0];
  for (let i = 1; i < frames.length; i++) {
    const s = globalShift(frames[i - 1], frames[i]);
    xs.push(xs[i - 1] + s.x);
    ys.push(ys[i - 1] + s.y);
  }
  const w = frames[0]?.w ?? 1;
  const h = frames[0]?.h ?? 1;
  // Strong: average over up to 2 s, so only slow, deliberate moves are kept.
  const radius = Math.max(1, rate * (0.3 + 1.7 * strength));
  const sx = smoothPath(xs, radius);
  const sy = smoothPath(ys, radius);
  // Move the picture back by the jitter (as a fraction of the frame).
  let dx = xs.map((x, i) => (sx[i] - x) / w);
  let dy = ys.map((y, i) => (sy[i] - y) / h);
  const worst = Math.max(0, ...dx.map(Math.abs), ...dy.map(Math.abs));
  const MAX_ZOOM = 1.2;
  let zoom = 1 + 2 * worst + 0.01;
  if (zoom > MAX_ZOOM) {
    // Too shaky to hide fully: correct as much as the zoom allows.
    const k = (MAX_ZOOM - 1.01) / (2 * worst);
    dx = dx.map((v) => v * k);
    dy = dy.map((v) => v * k);
    zoom = MAX_ZOOM;
  }
  const round = (v: number) => Math.round(v * 1e5) / 1e5;
  return { from, rate, dx: dx.map(round), dy: dy.map(round), zoom: Math.round(zoom * 1000) / 1000, strength };
}

/** The correction at source time `t` (straight lines between samples). */
export function shakeAt(s: Stabilize, t: number): { dx: number; dy: number } {
  const n = s.dx.length;
  if (n === 0) return { dx: 0, dy: 0 };
  const x = Math.max(0, Math.min(n - 1, (t - s.from) * s.rate));
  const i = Math.min(n - 2, Math.floor(x));
  if (i < 0) return { dx: s.dx[0], dy: s.dy[0] };
  const f = x - i;
  return { dx: s.dx[i] + (s.dx[i + 1] - s.dx[i]) * f, dy: s.dy[i] + (s.dy[i + 1] - s.dy[i]) * f };
}

/**
 * The part of the source picture to show at source time `t`: zoomed in by `zoom` and
 * shifted against the shake. Never reaches outside `rect`.
 */
export function stabilizedRect(rect: { sx: number; sy: number; sw: number; sh: number }, s: Stabilize, t: number) {
  const { dx, dy } = shakeAt(s, t);
  const sw = rect.sw / s.zoom;
  const sh = rect.sh / s.zoom;
  const cx = rect.sx + rect.sw / 2 - dx * rect.sw;
  const cy = rect.sy + rect.sh / 2 - dy * rect.sh;
  const sx = Math.max(rect.sx, Math.min(rect.sx + rect.sw - sw, cx - sw / 2));
  const sy = Math.max(rect.sy, Math.min(rect.sy + rect.sh - sh, cy - sh / 2));
  return { sx, sy, sw, sh };
}
