/**
 * Vector paths (After Effects-style shape layers): points with bezier handles drawn
 * with the pen tool, trimmed to animate the line drawing itself on ("Trim Paths"),
 * and used to run text along a curve. Coordinates are in units of the frame height,
 * relative to the item's centre, so moving, scaling and turning the item works as for
 * any layer. Pure and unit-tested.
 */

export interface PathPoint {
  x: number;
  y: number;
  /** Bezier handles, relative to the point (in = towards the previous point). */
  ix?: number;
  iy?: number;
  ox?: number;
  oy?: number;
}

export interface VectorPath {
  points: PathPoint[];
  closed: boolean;
}

interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number): void;
  closePath(): void;
}

/** The segments of a path as cubic curves [p0, c1, c2, p1]. */
function segments(path: VectorPath): [number, number][][] {
  const pts = path.points;
  const out: [number, number][][] = [];
  const n = pts.length;
  const count = path.closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    out.push([
      [a.x, a.y],
      [a.x + (a.ox ?? 0), a.y + (a.oy ?? 0)],
      [b.x + (b.ix ?? 0), b.y + (b.iy ?? 0)],
      [b.x, b.y],
    ]);
  }
  return out;
}

/** Draw the path into a canvas path (or Path2D), scaled by `scale` (pixels per unit). */
export function tracePath(sink: PathSink, path: VectorPath, scale: number) {
  const pts = path.points;
  if (!pts.length) return;
  sink.moveTo(pts[0].x * scale, pts[0].y * scale);
  for (const [, c1, c2, p1] of segments(path)) sink.bezierCurveTo(c1[0] * scale, c1[1] * scale, c2[0] * scale, c2[1] * scale, p1[0] * scale, p1[1] * scale);
  if (path.closed) sink.closePath();
}

export interface Sample {
  x: number;
  y: number;
  /** Distance along the path from its start. */
  d: number;
}

const bez = (a: number, b: number, c: number, d: number, t: number) => {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
};

/** Points along the path, `steps` per segment, with the distance travelled so far. */
export function samplePath(path: VectorPath, steps = 32): Sample[] {
  const segs = segments(path);
  if (!segs.length) return path.points.length ? [{ x: path.points[0].x, y: path.points[0].y, d: 0 }] : [];
  const out: Sample[] = [{ x: segs[0][0][0], y: segs[0][0][1], d: 0 }];
  for (const s of segs) {
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      const x = bez(s[0][0], s[1][0], s[2][0], s[3][0], t);
      const y = bez(s[0][1], s[1][1], s[2][1], s[3][1], t);
      const prev = out[out.length - 1];
      out.push({ x, y, d: prev.d + Math.hypot(x - prev.x, y - prev.y) });
    }
  }
  return out;
}

export const pathLength = (samples: Sample[]) => samples[samples.length - 1]?.d ?? 0;

/** Position and direction (radians) at distance `d` along the sampled path. */
export function pointAt(samples: Sample[], d: number): { x: number; y: number; angle: number } {
  if (samples.length < 2) return { x: samples[0]?.x ?? 0, y: samples[0]?.y ?? 0, angle: 0 };
  const total = pathLength(samples);
  const target = Math.max(0, Math.min(total, d));
  let lo = 0;
  let hi = samples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].d < target) lo = mid;
    else hi = mid;
  }
  const a = samples[lo];
  const b = samples[hi];
  const f = b.d > a.d ? (target - a.d) / (b.d - a.d) : 0;
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, angle: Math.atan2(b.y - a.y, b.x - a.x) };
}

/**
 * Line dashes that show only the part of a line of length `len` between `start`
 * and `end` (0..1), for "Trim Paths". Returns null when the whole line shows.
 */
export function trimDash(len: number, start: number, end: number): { dash: [number, number]; offset: number } | null {
  let a = Math.max(0, Math.min(1, start));
  let b = Math.max(0, Math.min(1, end));
  if (a > b) [a, b] = [b, a];
  if (a <= 1e-4 && b >= 1 - 1e-4) return null;
  return { dash: [Math.max(1e-6, (b - a) * len), len * 2], offset: -a * len };
}

/** Bounding box of the path (from its samples), in path units. */
export function pathBounds(path: VectorPath): { x: number; y: number; w: number; h: number } {
  const s = samplePath(path, 12);
  if (!s.length) return { x: 0, y: 0, w: 0, h: 0 };
  const xs = s.map((p) => p.x);
  const ys = s.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/**
 * Turn pen-tool points (fractions of the frame) into a path centred on its middle,
 * in frame-height units. Returns the centre (fractions of the frame) too.
 */
export function fromFrame(points: PathPoint[], closed: boolean, W: number, H: number): { path: VectorPath; cx: number; cy: number } {
  const k = W / H;
  const raw: VectorPath = { closed, points: points.map((p) => ({ ...p, x: p.x * k, y: p.y, ix: p.ix !== undefined ? p.ix * k : undefined, ox: p.ox !== undefined ? p.ox * k : undefined })) };
  const b = pathBounds(raw);
  const mx = b.x + b.w / 2;
  const my = b.y + b.h / 2;
  const r = (v: number) => Math.round(v * 10000) / 10000;
  const opt = (v: number | undefined) => (v === undefined ? undefined : r(v));
  return {
    path: { closed, points: raw.points.map((p) => ({ x: r(p.x - mx), y: r(p.y - my), ix: opt(p.ix), iy: opt(p.iy), ox: opt(p.ox), oy: opt(p.oy) })) },
    cx: mx / k,
    cy: my,
  };
}

/** Ready-made paths for text and lines, `w` wide (frame-height units). */
export const PATH_PRESETS: { id: string; label: string; make: (w: number) => VectorPath }[] = [
  {
    id: 'arc',
    label: 'Arch',
    make: (w) => ({ closed: false, points: [{ x: -w / 2, y: w * 0.18, ox: w * 0.18, oy: -w * 0.3 }, { x: w / 2, y: w * 0.18, ix: -w * 0.18, iy: -w * 0.3 }] }),
  },
  {
    id: 'dip',
    label: 'Dip',
    make: (w) => ({ closed: false, points: [{ x: -w / 2, y: -w * 0.18, ox: w * 0.18, oy: w * 0.3 }, { x: w / 2, y: -w * 0.18, ix: -w * 0.18, iy: w * 0.3 }] }),
  },
  {
    id: 'wave',
    label: 'Wave',
    make: (w) => ({
      closed: false,
      points: [
        { x: -w / 2, y: 0, ox: w * 0.12, oy: -w * 0.16 },
        { x: 0, y: 0, ix: -w * 0.12, iy: w * 0.16, ox: w * 0.12, oy: -w * 0.16 },
        { x: w / 2, y: 0, ix: -w * 0.12, iy: w * 0.16 },
      ],
    }),
  },
  {
    id: 'circle',
    label: 'Circle',
    make: (w) => {
      const r = w / 2;
      const c = r * 0.5523; // handle length for a circle drawn with four curves
      return {
        closed: true,
        points: [
          { x: 0, y: r, ix: c, iy: 0, ox: -c, oy: 0 },
          { x: -r, y: 0, ix: 0, iy: c, ox: 0, oy: -c },
          { x: 0, y: -r, ix: -c, iy: 0, ox: c, oy: 0 },
          { x: r, y: 0, ix: 0, iy: -c, ox: 0, oy: c },
        ],
      };
    },
  },
  { id: 'line', label: 'Line', make: (w) => ({ closed: false, points: [{ x: -w / 2, y: 0 }, { x: w / 2, y: 0 }] }) },
];

/**
 * Where each letter of a text goes on a path: centred along it, starting `shift`
 * (0..1 of the length) further on. Letters past the end are left out.
 */
export function lettersOnPath(samples: Sample[], widths: number[], shift = 0): ({ x: number; y: number; angle: number } | null)[] {
  const len = pathLength(samples);
  const total = widths.reduce((a, b) => a + b, 0);
  let d = Math.max(0, (len - total) / 2) + shift * len;
  return widths.map((w) => {
    const mid = d + w / 2;
    d += w;
    if (mid > len + 1e-6 || mid < -1e-6) return null;
    return pointAt(samples, mid);
  });
}
