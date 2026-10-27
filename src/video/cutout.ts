/**
 * Smart cut-out (AI background removal) for photos and videos. A person-matting model
 * gives a mask per frame; masks are cleaned up, smoothed over time (no flicker), packed
 * small and stored with the project. While playing, the two nearest masks are blended.
 * The mask maths is pure and unit-tested; `runCutout` does the browser work.
 */
import { aiProvider } from '../lib/aiService';
import { uid } from '../lib/id';
import type { Cutout } from './types';

/** Mask frames per second for video cut-outs. */
export const CUTOUT_FPS = 15;
/** Longest side of a stored mask (pixels); the picture's own edge stays sharp. */
export const MASK_SIZE = 256;
export const cutoutKey = (id: string) => `cutout-${id}`;

/** Push soft matte values towards 0 or 255 (crisper edges), keeping a smooth ramp in between. */
export function refineMask(mask: Uint8Array, lo = 0.2, hi = 0.8): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) {
    const x = Math.max(0, Math.min(1, (mask[i] / 255 - lo) / (hi - lo)));
    out[i] = Math.round(x * x * (3 - 2 * x) * 255);
  }
  return out;
}

/** Light blur over time (¼ previous, ½ this, ¼ next) so the edge doesn't shimmer. */
export function smoothSequence(frames: Uint8Array[]): Uint8Array[] {
  return frames.map((f, i) => {
    const a = frames[i - 1] ?? f;
    const b = frames[i + 1] ?? f;
    const out = new Uint8Array(f.length);
    for (let j = 0; j < f.length; j++) out[j] = (a[j] + 2 * f[j] + b[j] + 2) >> 2;
    return out;
  });
}

/** Scale a one-byte-per-pixel mask to a new size (bilinear). */
export function resizeMask(mask: Uint8Array, w: number, h: number, W: number, H: number): Uint8Array {
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const fy = Math.max(0, Math.min(h - 1, ((y + 0.5) * h) / H - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(h - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = Math.max(0, Math.min(w - 1, ((x + 0.5) * w) / W - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(w - 1, x0 + 1);
      const tx = fx - x0;
      const top = mask[y0 * w + x0] * (1 - tx) + mask[y0 * w + x1] * tx;
      const bottom = mask[y1 * w + x0] * (1 - tx) + mask[y1 * w + x1] * tx;
      out[y * W + x] = Math.round(top * (1 - ty) + bottom * ty);
    }
  }
  return out;
}

/** Size of a mask for a picture of w×h (longest side MASK_SIZE, never bigger than the picture). */
export function maskSize(w: number, h: number): { w: number; h: number } {
  const s = Math.min(1, MASK_SIZE / Math.max(w, h, 1));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

/** Which two stored masks to blend for source time `t`, and how much of the second. */
export function maskIndexAt(c: Pick<Cutout, 'from' | 'fps' | 'count'>, t: number): { a: number; b: number; f: number } {
  if (c.count <= 1) return { a: 0, b: 0, f: 0 };
  const x = Math.max(0, Math.min(c.count - 1, (t - c.from) * c.fps));
  const a = Math.floor(x);
  const b = Math.min(c.count - 1, a + 1);
  return { a, b, f: x - a };
}

/** Mix two masks: (1 - f)·a + f·b, into `out`. */
export function blendMasks(a: Uint8Array, b: Uint8Array, f: number, out: Uint8Array): Uint8Array {
  if (f <= 0 || a === b) out.set(a);
  else for (let i = 0; i < out.length; i++) out[i] = a[i] + (b[i] - a[i]) * f;
  return out;
}

/** Keep only the person: multiply each pixel's alpha by the mask (same size). */
export function applyMaskAlpha(rgba: Uint8ClampedArray, mask: Uint8Array): void {
  for (let i = 0; i < mask.length; i++) rgba[i * 4 + 3] = (rgba[i * 4 + 3] * mask[i]) / 255;
}

/** All mask frames in one byte array (they are simply laid end to end). */
export function packMasks(frames: Uint8Array[]): Uint8Array {
  const size = frames[0]?.length ?? 0;
  const out = new Uint8Array(size * frames.length);
  frames.forEach((f, i) => out.set(f, i * size));
  return out;
}

export function unpackMasks(data: Uint8Array, w: number, h: number): Uint8Array[] {
  const size = w * h;
  const out: Uint8Array[] = [];
  for (let at = 0; at + size <= data.length; at += size) out.push(data.subarray(at, at + size));
  return out;
}

/** Masks compress very well (mostly fully in or out); gzip them when the browser can. */
export async function compress(data: Uint8Array): Promise<Blob> {
  if (typeof CompressionStream === 'undefined') return new Blob([data]);
  return new Response(new Blob([data]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
}

export async function decompress(blob: Blob, gzipped: boolean): Promise<Uint8Array> {
  if (!gzipped) return new Uint8Array(await blob.arrayBuffer());
  return new Uint8Array(await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
}

async function loadFrame(url: string, kind: 'image' | 'video'): Promise<{ draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void; seek: (t: number) => Promise<void>; w: number; h: number; close: () => void }> {
  if (kind === 'image') {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { draw: (c, w, h) => c.drawImage(img, 0, 0, w, h), seek: async () => {}, w: img.naturalWidth, h: img.naturalHeight, close: () => {} };
  }
  const v = document.createElement('video');
  v.muted = true;
  v.preload = 'auto';
  v.playsInline = true;
  v.src = url;
  await new Promise<void>((resolve, reject) => {
    v.onloadeddata = () => resolve();
    v.onerror = () => reject(new Error('Could not read the video'));
  });
  const seek = (t: number) =>
    new Promise<void>((resolve) => {
      const target = Math.max(0, Math.min(t, (v.duration || t) - 0.001));
      if (Math.abs(v.currentTime - target) < 0.001 && v.readyState >= 2) return resolve();
      const done = () => (v.removeEventListener('seeked', done), clearTimeout(timer), resolve());
      const timer = setTimeout(done, 1500);
      v.addEventListener('seeked', done);
      v.currentTime = target;
    });
  return { draw: (c, w, h) => c.drawImage(v, 0, 0, w, h), seek, w: v.videoWidth, h: v.videoHeight, close: () => (v.removeAttribute('src'), v.load()) };
}

/**
 * Cut the person out of a photo, or out of a video between `from` and `to` (source
 * seconds). Stores the masks and returns the `Cutout` to put on the clip.
 */
export async function runCutout(
  asset: { url: string; kind: 'image' | 'video' },
  from: number,
  to: number,
  store: (key: string, blob: Blob) => Promise<void>,
  onProgress?: (f: number, label: string) => void,
  signal?: AbortSignal,
): Promise<{ cutout: Cutout; data: Uint8Array }> {
  const ai = aiProvider();
  const media = await loadFrame(asset.url, asset.kind);
  try {
    // The model sees the picture at up to 512 px; masks are kept at MASK_SIZE.
    const s = Math.min(1, 512 / Math.max(media.w, media.h, 1));
    const W = Math.max(1, Math.round(media.w * s));
    const H = Math.max(1, Math.round(media.h * s));
    const size = maskSize(media.w, media.h);
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const count = asset.kind === 'image' ? 1 : Math.max(1, Math.round((to - from) * CUTOUT_FPS) + 1);
    const frames: Uint8Array[] = [];
    for (let i = 0; i < count; i++) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      await media.seek(from + i / CUTOUT_FPS);
      ctx.clearRect(0, 0, W, H);
      media.draw(ctx, W, H);
      const mask = await ai.segment(ctx.getImageData(0, 0, W, H), (f) => i === 0 && onProgress?.(f * 0.3, 'Getting the cut-out model ready…'));
      frames.push(refineMask(resizeMask(mask, W, H, size.w, size.h)));
      onProgress?.(0.3 + ((i + 1) / count) * 0.68, count > 1 ? `Cutting out frame ${i + 1} of ${count}…` : 'Cutting out…');
    }
    const data = packMasks(count > 2 ? smoothSequence(frames) : frames);
    const id = uid('cut');
    const gzip = typeof CompressionStream !== 'undefined';
    await store(cutoutKey(id), await compress(data));
    onProgress?.(1, 'Done');
    return { cutout: { id, from, fps: CUTOUT_FPS, count, w: size.w, h: size.h, gzip }, data };
  } finally {
    media.close();
  }
}

/** Cut the person out of a photo: a PNG data URL with a transparent background. */
export async function smartRemoveBackground(src: string, maxSide = 2048, onProgress?: (f: number) => void): Promise<{ src: string; width: number; height: number }> {
  const img = new Image();
  img.src = src;
  await img.decode();
  const s = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const W = Math.max(1, Math.round(img.naturalWidth * s));
  const H = Math.max(1, Math.round(img.naturalHeight * s));
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const ctx = out.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, W, H);
  // The model works at up to 512 px; its mask is scaled back up to the photo.
  const m = Math.min(1, 512 / Math.max(W, H));
  const mw = Math.max(1, Math.round(W * m));
  const mh = Math.max(1, Math.round(H * m));
  const small = document.createElement('canvas');
  small.width = mw;
  small.height = mh;
  const sctx = small.getContext('2d', { willReadFrequently: true })!;
  sctx.drawImage(out, 0, 0, mw, mh);
  const mask = await aiProvider().segment(sctx.getImageData(0, 0, mw, mh), onProgress);
  const full = refineMask(resizeMask(mask, mw, mh, W, H));
  const pixels = ctx.getImageData(0, 0, W, H);
  applyMaskAlpha(pixels.data, full);
  ctx.putImageData(pixels, 0, 0);
  return { src: out.toDataURL('image/png'), width: W, height: H };
}
