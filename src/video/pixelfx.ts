/**
 * Adobe-style video effects that work on the pixels of the finished frame: distortions
 * (twirl, spherize, ripple, kaleidoscope), stylize (posterize, emboss, find edges,
 * solarize, cartoon) and colour (invert, tint, tritone, threshold, leave colour,
 * sharpen). Pure functions on RGBA arrays, so they are unit-tested without a canvas.
 *
 * Every function writes `dst` from `src` (same size, never the same array), mixing the
 * effect in by `k` (0 = untouched, 1 = full effect). `t` is seconds into the effect.
 */

export type PixelFx =
  | 'sharpen'
  | 'twirl'
  | 'bulge'
  | 'ripple'
  | 'kaleidoscope'
  | 'posterize'
  | 'emboss'
  | 'find-edges'
  | 'solarize'
  | 'cartoon'
  | 'invert'
  | 'tint'
  | 'tritone'
  | 'threshold'
  | 'leave-color';

export const PIXEL_FX: PixelFx[] = ['sharpen', 'twirl', 'bulge', 'ripple', 'kaleidoscope', 'posterize', 'emboss', 'find-edges', 'solarize', 'cartoon', 'invert', 'tint', 'tritone', 'threshold', 'leave-color'];

const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;
const mix = (a: number, b: number, k: number) => a + (b - a) * k;

/** Per-pixel colour change: `fn` gets r, g, b (0..255) and returns the new colour. */
function perPixel(src: Uint8ClampedArray, dst: Uint8ClampedArray, k: number, fn: (r: number, g: number, b: number, out: number[]) => void) {
  const out = [0, 0, 0];
  for (let i = 0; i < src.length; i += 4) {
    const r = src[i];
    const g = src[i + 1];
    const b = src[i + 2];
    fn(r, g, b, out);
    dst[i] = mix(r, out[0], k);
    dst[i + 1] = mix(g, out[1], k);
    dst[i + 2] = mix(b, out[2], k);
    dst[i + 3] = src[i + 3];
  }
}

/** Move pixels: `map` gives, for an output pixel, where to read it from (source x, y). */
function remap(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, map: (x: number, y: number, out: number[]) => void) {
  const s = new Uint32Array(src.buffer, src.byteOffset, w * h);
  const d = new Uint32Array(dst.buffer, dst.byteOffset, w * h);
  const p = [0, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      map(x, y, p);
      const sx = Math.min(w - 1, Math.max(0, Math.round(p[0])));
      const sy = Math.min(h - 1, Math.max(0, Math.round(p[1])));
      d[y * w + x] = s[sy * w + sx];
    }
  }
}

/** 3×3 neighbourhood helper: calls `fn` with the 9 lumas around each pixel (edges clamp). */
function lumaGrid(src: Uint8ClampedArray, w: number, h: number): Float32Array {
  const L = new Float32Array(w * h);
  for (let i = 0, j = 0; j < L.length; i += 4, j++) L[j] = luma(src[i], src[i + 1], src[i + 2]);
  return L;
}

const hex = (c: string): [number, number, number] => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const TINT_DARK = hex('#13235b');
const TINT_LIGHT = hex('#ffd36b');
const TRI = [hex('#1e1b4b'), hex('#db2777'), hex('#fde68a')];

/** Apply one pixel effect. */
export function applyPixelFx(type: PixelFx, src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, k: number, t = 0) {
  k = Math.max(0, Math.min(1, k));
  const cx = w / 2;
  const cy = h / 2;
  const R = Math.min(w, h) * 0.48;
  switch (type) {
    case 'invert':
      return perPixel(src, dst, k, (r, g, b, o) => ((o[0] = 255 - r), (o[1] = 255 - g), (o[2] = 255 - b)));
    case 'solarize':
      return perPixel(src, dst, k, (r, g, b, o) => ((o[0] = r > 127 ? 255 - r : r), (o[1] = g > 127 ? 255 - g : g), (o[2] = b > 127 ? 255 - b : b)));
    case 'threshold':
      return perPixel(src, dst, k, (r, g, b, o) => {
        const v = luma(r, g, b) > 127 ? 255 : 0;
        o[0] = o[1] = o[2] = v;
      });
    case 'posterize': {
      // Fewer colour levels the stronger it is: 8 at the lightest, 2 at full.
      const levels = Math.max(2, Math.round(8 - 6 * k));
      const step = 255 / (levels - 1);
      const q = (v: number) => Math.round(v / step) * step;
      return perPixel(src, dst, 1, (r, g, b, o) => ((o[0] = q(r)), (o[1] = q(g)), (o[2] = q(b))));
    }
    case 'tint':
      return perPixel(src, dst, k, (r, g, b, o) => {
        const l = luma(r, g, b) / 255;
        for (let c = 0; c < 3; c++) o[c] = mix(TINT_DARK[c], TINT_LIGHT[c], l);
      });
    case 'tritone':
      return perPixel(src, dst, k, (r, g, b, o) => {
        const l = luma(r, g, b) / 255;
        const [a, m, z] = TRI;
        for (let c = 0; c < 3; c++) o[c] = l < 0.5 ? mix(a[c], m[c], l * 2) : mix(m[c], z[c], (l - 0.5) * 2);
      });
    case 'leave-color':
      // Keep the reds (lipstick, roses, a red coat); everything else goes grey.
      return perPixel(src, dst, k, (r, g, b, o) => {
        const mx = Math.max(r, g, b);
        const mn = Math.min(r, g, b);
        const sat = mx ? (mx - mn) / mx : 0;
        let hue = 0;
        if (mx !== mn) {
          if (mx === r) hue = ((g - b) / (mx - mn)) * 60;
          else if (mx === g) hue = (2 + (b - r) / (mx - mn)) * 60;
          else hue = (4 + (r - g) / (mx - mn)) * 60;
        }
        if (hue < 0) hue += 360;
        const dist = Math.min(Math.abs(hue), 360 - hue);
        const keep = sat > 0.25 ? Math.max(0, 1 - Math.max(0, dist - 20) / 15) : 0;
        const l = luma(r, g, b);
        o[0] = mix(l, r, keep);
        o[1] = mix(l, g, keep);
        o[2] = mix(l, b, keep);
      });
    case 'sharpen': {
      const a = 1.6 * k;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const up = (Math.max(0, y - 1) * w + x) * 4;
          const dn = (Math.min(h - 1, y + 1) * w + x) * 4;
          const lf = (y * w + Math.max(0, x - 1)) * 4;
          const rt = (y * w + Math.min(w - 1, x + 1)) * 4;
          for (let c = 0; c < 3; c++) dst[i + c] = src[i + c] * (1 + 4 * a) - a * (src[up + c] + src[dn + c] + src[lf + c] + src[rt + c]);
          dst[i + 3] = src[i + 3];
        }
      }
      return;
    }
    case 'emboss':
    case 'find-edges':
    case 'cartoon': {
      const L = lumaGrid(src, w, h);
      const at = (x: number, y: number) => L[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
      const levels = 5;
      const step = 255 / (levels - 1);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const gx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
          const gy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
          let r: number;
          let g: number;
          let b: number;
          if (type === 'emboss') {
            r = g = b = Math.max(0, Math.min(255, 128 + (gx + gy) * 0.5));
          } else if (type === 'find-edges') {
            // Dark lines on white, tinted by the colour underneath (like Find Edges).
            const e = Math.min(1, Math.hypot(gx, gy) / 255);
            r = 255 - e * (255 - src[i] * 0.6);
            g = 255 - e * (255 - src[i + 1] * 0.6);
            b = 255 - e * (255 - src[i + 2] * 0.6);
          } else {
            // Cartoon: flat colour areas with dark outlines.
            const edge = Math.hypot(gx, gy) > 140;
            r = edge ? 20 : Math.round(src[i] / step) * step;
            g = edge ? 20 : Math.round(src[i + 1] / step) * step;
            b = edge ? 25 : Math.round(src[i + 2] / step) * step;
          }
          dst[i] = mix(src[i], r, k);
          dst[i + 1] = mix(src[i + 1], g, k);
          dst[i + 2] = mix(src[i + 2], b, k);
          dst[i + 3] = src[i + 3];
        }
      }
      return;
    }
    case 'twirl': {
      const turn = k * 3.5 * Math.sin(t * 0.8 + 1);
      return remap(src, dst, w, h, (x, y, p) => {
        const dx = x - cx;
        const dy = y - cy;
        const r = Math.hypot(dx, dy);
        if (r >= R) return ((p[0] = x), (p[1] = y));
        const a = Math.atan2(dy, dx) + turn * (1 - r / R) ** 2;
        p[0] = cx + r * Math.cos(a);
        p[1] = cy + r * Math.sin(a);
      });
    }
    case 'bulge': {
      // Spherize: magnifies the middle like a lens.
      const power = 1 + 0.9 * k;
      return remap(src, dst, w, h, (x, y, p) => {
        const dx = x - cx;
        const dy = y - cy;
        const r = Math.hypot(dx, dy);
        if (r >= R || r === 0) return ((p[0] = x), (p[1] = y));
        const f = (r / R) ** (power - 1);
        p[0] = cx + dx * f;
        p[1] = cy + dy * f;
      });
    }
    case 'ripple': {
      const amp = Math.min(w, h) * 0.012 * k;
      const wave = (Math.PI * 2) / (Math.min(w, h) * 0.08);
      return remap(src, dst, w, h, (x, y, p) => {
        const dx = x - cx;
        const dy = y - cy;
        const r = Math.hypot(dx, dy) || 1;
        const o = amp * Math.sin(r * wave - t * 6);
        p[0] = x + (dx / r) * o;
        p[1] = y + (dy / r) * o;
      });
    }
    case 'kaleidoscope': {
      // Six mirrored slices turning slowly around the middle.
      const seg = Math.PI / 3;
      const spin = t * 0.25;
      return remap(src, dst, w, h, (x, y, p) => {
        const dx = x - cx;
        const dy = y - cy;
        const r = Math.hypot(dx, dy);
        let a = Math.atan2(dy, dx) + spin;
        a = ((a % (2 * seg)) + 2 * seg) % (2 * seg);
        if (a > seg) a = 2 * seg - a;
        const sx = cx + r * Math.cos(a) * 0.9;
        const sy = cy + r * Math.sin(a) * 0.9;
        p[0] = mix(x, sx, k);
        p[1] = mix(y, sy, k);
      });
    }
  }
}
