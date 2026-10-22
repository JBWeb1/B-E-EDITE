/**
 * Screen replacement (corner pin): a layer is drawn onto four corners in the frame
 * (a phone, TV, laptop or sign), with perspective, following the corners as they are
 * tracked through the shot. Canvas 2D has no perspective drawing, so the picture is
 * cut into small triangles, each drawn with its own affine transform. Pure and tested.
 */

export type Pt = [number, number];
/** Top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Pt, Pt, Pt, Pt];

export interface CornerPin {
  /** Layer-local second of the first sample, and samples per second. */
  from: number;
  rate: number;
  /** The four corners (fractions of the frame) at each sample. */
  quads: Quad[];
}

/** The corners at layer-local time `t` (straight lines between samples). */
export function quadAt(pin: CornerPin, t: number): Quad {
  const n = pin.quads.length;
  if (n === 1) return pin.quads[0];
  const x = Math.max(0, Math.min(n - 1, (t - pin.from) * pin.rate));
  const i = Math.min(n - 2, Math.floor(x));
  const f = x - i;
  const a = pin.quads[i];
  const b = pin.quads[i + 1];
  return a.map((p, k) => [p[0] + (b[k][0] - p[0]) * f, p[1] + (b[k][1] - p[1]) * f]) as Quad;
}

/** Solve a small linear system (Gaussian elimination with pivoting). */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / d;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / (row[i] || 1e-12));
}

/** The perspective transform (3×3, row-major, h33 = 1) taking the unit square's corners to `q`. */
export function squareToQuad(q: Quad): number[] {
  const src: Pt[] = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = q[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  return [...solve(A, b), 1];
}

/** Where point (s, t) of the unit square lands. */
export function project(H: number[], s: number, t: number): Pt {
  const w = H[6] * s + H[7] * t + H[8];
  return [(H[0] * s + H[1] * t + H[2]) / w, (H[3] * s + H[4] * t + H[5]) / w];
}

/**
 * The canvas transform (a, b, c, d, e, f) that maps triangle `s` (source pixels) onto
 * triangle `d` (destination pixels).
 */
export function triangleTransform(s: [Pt, Pt, Pt], d: [Pt, Pt, Pt]): [number, number, number, number, number, number] {
  const [[x0, y0], [x1, y1], [x2, y2]] = s;
  const [[u0, v0], [u1, v1], [u2, v2]] = d;
  const det = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0) || 1e-12;
  const a = ((u1 - u0) * (y2 - y0) - (u2 - u0) * (y1 - y0)) / det;
  const c = ((u2 - u0) * (x1 - x0) - (u1 - u0) * (x2 - x0)) / det;
  const b = ((v1 - v0) * (y2 - y0) - (v2 - v0) * (y1 - y0)) / det;
  const dd = ((v2 - v0) * (x1 - x0) - (v1 - v0) * (x2 - x0)) / det;
  return [a, b, c, dd, u0 - a * x0 - c * y0, v0 - b * x0 - dd * y0];
}

/**
 * Draw `image` (its `src` rectangle) onto the quad `q` (destination pixels) with
 * perspective, using an n×n grid of triangle pairs. Each triangle is grown a hair so
 * no seams show between them.
 */
export function drawQuad(ctx: CanvasRenderingContext2D, image: CanvasImageSource, src: { sx: number; sy: number; sw: number; sh: number }, q: Quad, n = 10) {
  const H = squareToQuad(q);
  const grow = (tri: [Pt, Pt, Pt]): [Pt, Pt, Pt] => {
    const cx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3;
    const cy = (tri[0][1] + tri[1][1] + tri[2][1]) / 3;
    return tri.map(([x, y]) => {
      const dx = x - cx;
      const dy = y - cy;
      const len = Math.hypot(dx, dy) || 1;
      return [x + (dx / len) * 0.6, y + (dy / len) * 0.6];
    }) as [Pt, Pt, Pt];
  };
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const s0 = i / n;
      const s1 = (i + 1) / n;
      const t0 = j / n;
      const t1 = (j + 1) / n;
      const P = (s: number, t: number) => project(H, s, t);
      const S = (s: number, t: number): Pt => [src.sx + s * src.sw, src.sy + t * src.sh];
      for (const [a, b, c] of [
        [[s0, t0], [s1, t0], [s1, t1]],
        [[s0, t0], [s1, t1], [s0, t1]],
      ] as [number, number][][]) {
        const dst = grow([P(...a), P(...b), P(...c)]);
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(...dst[0]);
        ctx.lineTo(...dst[1]);
        ctx.lineTo(...dst[2]);
        ctx.closePath();
        ctx.clip();
        const m = triangleTransform([S(...a), S(...b), S(...c)], [P(...a), P(...b), P(...c)]);
        ctx.transform(...m);
        ctx.drawImage(image, 0, 0);
        ctx.restore();
      }
    }
  }
}

/** Put the clicked corners in order: top-left, top-right, bottom-right, bottom-left. */
export function orderCorners(points: Pt[]): Quad {
  const cx = points.reduce((s, p) => s + p[0], 0) / points.length;
  const cy = points.reduce((s, p) => s + p[1], 0) / points.length;
  const byAngle = [...points].sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
  // Start from the corner closest to the top-left.
  const start = byAngle.reduce((best, p, i) => (p[0] + p[1] < byAngle[best][0] + byAngle[best][1] ? i : best), 0);
  const ordered = [...byAngle.slice(start), ...byAngle.slice(0, start)];
  return ordered as Quad;
}

/** Move one corner of every sample by the same amount (fine-tuning a tracked pin). */
export function nudgeCorner(pin: CornerPin, corner: number, dx: number, dy: number): CornerPin {
  return { ...pin, quads: pin.quads.map((q) => q.map((p, k) => (k === corner ? [p[0] + dx, p[1] + dy] : p)) as Quad) };
}

/**
 * Keep four tracked corners together: a corner whose movement (from the first
 * sample) strays from the others' typical movement by more than `limit` (fraction
 * of the quad size) is moved back to follow the others. This stops one corner
 * sliding onto a look-alike detail (a repeating pattern, a reflection).
 */
export function steadyCorners(quads: Quad[], limit = 0.25): Quad[] {
  if (!quads.length) return quads;
  const first = quads[0];
  const size = Math.max(1e-6, Math.hypot(first[2][0] - first[0][0], first[2][1] - first[0][1]));
  const median = (v: number[]) => {
    const s = [...v].sort((a, b) => a - b);
    return (s[1] + s[2]) / 2;
  };
  return quads.map((q) => {
    const dx = q.map((p, k) => p[0] - first[k][0]);
    const dy = q.map((p, k) => p[1] - first[k][1]);
    const mx = median(dx);
    const my = median(dy);
    return q.map((p, k) => (Math.hypot(dx[k] - mx, dy[k] - my) > limit * size ? [first[k][0] + mx, first[k][1] + my] : p)) as Quad;
  });
}
