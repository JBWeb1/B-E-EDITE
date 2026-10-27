/**
 * Photo editing for design images: exposure, white balance, highlights/shadows,
 * sharpen and vignette. Works on pixels (so it looks the same in the editor, the
 * exports and every browser); results are cached because it is not free.
 */

export interface PhotoAdjust {
  /** Stops of light, -2..2. */
  exposure: number;
  /** Cool (-100) to warm (100). */
  temperature: number;
  /** Green (-100) to magenta (100). */
  tint: number;
  /** -100 (recover) to 100 (brighten) for the bright parts. */
  highlights: number;
  /** -100 (deepen) to 100 (lift) for the dark parts. */
  shadows: number;
  /** 0..1 */
  sharpen: number;
  /** 0..1 darkening towards the corners. */
  vignette: number;
}

export const NEUTRAL_PHOTO: PhotoAdjust = { exposure: 0, temperature: 0, tint: 0, highlights: 0, shadows: 0, sharpen: 0, vignette: 0 };

export const PHOTO_PRESETS: { label: string; photo: Partial<PhotoAdjust> }[] = [
  { label: 'Auto enhance', photo: { exposure: 0.15, shadows: 30, highlights: -20, sharpen: 0.3 } },
  { label: 'Golden hour', photo: { temperature: 45, exposure: 0.1, shadows: 15, vignette: 0.25 } },
  { label: 'Cool blue', photo: { temperature: -40, tint: -5, highlights: -10 } },
  { label: 'Portrait', photo: { temperature: 12, shadows: 20, sharpen: 0.2, vignette: 0.35 } },
  { label: 'Crisp', photo: { sharpen: 0.7, highlights: -25, shadows: 25 } },
  { label: 'Moody', photo: { exposure: -0.25, highlights: -40, shadows: -25, vignette: 0.6, temperature: -10 } },
];

export const isNeutralPhoto = (p: PhotoAdjust | undefined) => !p || (Object.keys(NEUTRAL_PHOTO) as (keyof PhotoAdjust)[]).every((k) => Math.abs((p[k] ?? 0) - NEUTRAL_PHOTO[k]) < 1e-9);

/** Adjust RGBA pixels in place. */
export function adjustPixels(data: Uint8ClampedArray, w: number, h: number, p: PhotoAdjust) {
  const gain = Math.pow(2, p.exposure);
  const warm = p.temperature / 100;
  const tint = p.tint / 100;
  const rMul = gain * (1 + 0.18 * warm) * (1 + 0.06 * tint);
  const gMul = gain * (1 - 0.12 * tint);
  const bMul = gain * (1 - 0.18 * warm) * (1 + 0.06 * tint);
  const hi = p.highlights / 100;
  const sh = p.shadows / 100;
  // Tone curve as a lookup table: shadows lift/deepen the dark end, highlights the bright end.
  const curve = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    // Bumps that peak in the darks (x ≈ 1/3) and the brights (x ≈ 2/3) and vanish at black and white.
    const darks = 4 * x * (1 - x) * (1 - x);
    const brights = 4 * x * x * (1 - x);
    curve[i] = Math.max(0, Math.min(1, x + 0.4 * sh * darks + 0.4 * hi * brights));
  }
  const cx = w / 2;
  const cy = h / 2;
  const maxD = Math.hypot(cx, cy);
  const vig = p.vignette;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let v = 1;
      if (vig > 0) {
        const d = Math.hypot(x - cx, y - cy) / maxD;
        v = 1 - vig * Math.max(0, (d - 0.35) / 0.65) ** 1.6;
      }
      for (let c = 0; c < 3; c++) {
        const m = c === 0 ? rMul : c === 1 ? gMul : bMul;
        const lin = Math.min(255, Math.max(0, data[i + c] * m));
        data[i + c] = curve[Math.round(lin)] * 255 * v;
      }
    }
  }
}

/** Unsharp mask: add back the difference from a 3×3 blur, `amount` 0..1. */
export function sharpenPixels(data: Uint8ClampedArray, w: number, h: number, amount: number) {
  if (amount <= 0 || w < 3 || h < 3) return;
  const src = new Uint8ClampedArray(data);
  const k = amount * 1.5;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += src[i + (dy * w + dx) * 4 + c];
        data[i + c] = src[i + c] + k * (src[i + c] - sum / 9);
      }
    }
  }
}

const cache = new Map<string, HTMLCanvasElement>();

/**
 * The visible part (`sx, sy, sw, sh`) of an image with the photo adjustments applied,
 * at most `maxSide` pixels on its long side. Cached.
 */
export function adjustedImage(img: HTMLImageElement, src: string, sx: number, sy: number, sw: number, sh: number, p: PhotoAdjust, maxSide = 1600): HTMLCanvasElement {
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  const key = `${src.length}:${src.slice(-48)}|${sx},${sy},${sw},${sh}|${w}x${h}|${JSON.stringify(p)}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  adjustPixels(data.data, w, h, { ...NEUTRAL_PHOTO, ...p });
  sharpenPixels(data.data, w, h, p.sharpen);
  ctx.putImageData(data, 0, 0);
  cache.set(key, c);
  while (cache.size > 24) cache.delete(cache.keys().next().value!);
  return c;
}
