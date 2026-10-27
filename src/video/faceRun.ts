/**
 * The browser side of the face tools: grab frames, find faces with the detector,
 * and paint blur / retouch / enhance onto a canvas (used by the video engine for
 * every frame and by the design editor for photos).
 */
import { aiProvider } from '../lib/aiService';
import { linkFaces, mixWeighted, padBox, sharpen, skinMask } from './faces';
import type { Box, Detection, FaceLook, FaceScan } from './faces';

/** Frames of a video (or a photo) as pixels, longest side `maxSide`. */
export async function grabFrames(url: string, kind: 'image' | 'video', times: number[], maxSide = 480, onProgress?: (f: number) => void, signal?: AbortSignal): Promise<ImageData[]> {
  const out: ImageData[] = [];
  let draw: (c: CanvasRenderingContext2D, w: number, h: number) => void;
  let w0: number;
  let h0: number;
  let seek = async (_t: number) => {};
  let close = () => {};
  if (kind === 'image') {
    const img = new Image();
    img.src = url;
    await img.decode();
    draw = (c, w, h) => c.drawImage(img, 0, 0, w, h);
    w0 = img.naturalWidth;
    h0 = img.naturalHeight;
  } else {
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.playsInline = true;
    v.src = url;
    await new Promise<void>((resolve, reject) => {
      v.onloadeddata = () => resolve();
      v.onerror = () => reject(new Error('Could not read the video'));
    });
    draw = (c, w, h) => c.drawImage(v, 0, 0, w, h);
    w0 = v.videoWidth;
    h0 = v.videoHeight;
    seek = (t) =>
      new Promise<void>((resolve) => {
        const target = Math.max(0, Math.min(t, (v.duration || t) - 0.001));
        if (Math.abs(v.currentTime - target) < 0.001 && v.readyState >= 2) return resolve();
        const done = () => (v.removeEventListener('seeked', done), clearTimeout(timer), resolve());
        const timer = setTimeout(done, 1500);
        v.addEventListener('seeked', done);
        v.currentTime = target;
      });
    close = () => (v.removeAttribute('src'), v.load());
  }
  const s = Math.min(1, maxSide / Math.max(w0, h0, 1));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w0 * s));
  c.height = Math.max(1, Math.round(h0 * s));
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  try {
    for (let i = 0; i < times.length; i++) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      await seek(times[i]);
      ctx.clearRect(0, 0, c.width, c.height);
      draw(ctx, c.width, c.height);
      out.push(ctx.getImageData(0, 0, c.width, c.height));
      onProgress?.((i + 1) / times.length);
    }
  } finally {
    close();
  }
  return out;
}

/** Find and follow every face in a clip (source seconds `from`..`to`). */
export async function scanFaces(asset: { url: string; kind: 'image' | 'video' }, from: number, to: number, onProgress?: (f: number, label: string) => void, signal?: AbortSignal): Promise<FaceScan> {
  const len = Math.max(0, to - from);
  const rate = asset.kind === 'image' ? 1 : Math.max(2, Math.min(10, Math.floor(600 / Math.max(len, 0.1))));
  const n = asset.kind === 'image' ? 1 : Math.max(1, Math.round(len * rate) + 1);
  const times = Array.from({ length: n }, (_, i) => from + i / rate);
  const frames = await grabFrames(asset.url, asset.kind, times, 480, (f) => onProgress?.(f * 0.4, 'Reading frames…'), signal);
  const ai = aiProvider();
  const found: Detection[][] = [];
  for (let i = 0; i < frames.length; i++) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    found.push(await ai.faces(frames[i]));
    onProgress?.(0.4 + ((i + 1) / frames.length) * 0.6, `Looking for faces (${i + 1} of ${frames.length})…`);
  }
  return { from, rate, tracks: linkFaces(found, { minLength: asset.kind === 'image' ? 1 : 3 }) };
}

const scratch = new Map<string, HTMLCanvasElement>();
function canvas(name: string, w: number, h: number) {
  let c = scratch.get(name);
  if (!c) scratch.set(name, (c = document.createElement('canvas')));
  if (c.width !== w || c.height !== h) {
    c.width = Math.max(1, w);
    c.height = Math.max(1, h);
  }
  return c;
}

/** Soft oval weight (1 in the middle, fading to 0 at the edge of the box). */
function ovalWeight(w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = (x + 0.5) / w - 0.5;
      const dy = (y + 0.5) / h - 0.5;
      const d = Math.sqrt(dx * dx + dy * dy) * 2;
      out[y * w + x] = d < 0.7 ? 1 : d > 1 ? 0 : 1 - (d - 0.7) / 0.3;
    }
  return out;
}

const isNeutral = (l: FaceLook) => l.smooth <= 0 && l.brighten <= 0 && l.enhance <= 0;

/**
 * Paint the face look onto `ctx`, whose picture fills 0..w × 0..h. `looks` are the
 * faces to retouch/enhance, `hide` the ones to blur, as fractions of that picture.
 */
export function paintFaces(ctx: CanvasRenderingContext2D, w: number, h: number, looks: Box[], hide: Box[], look: FaceLook) {
  if (!isNeutral(look)) {
    for (const face of looks) {
      const b = padBox(face, 0.15);
      const x = Math.max(0, Math.floor(b.x * w));
      const y = Math.max(0, Math.floor(b.y * h));
      const bw = Math.min(w - x, Math.ceil(b.w * w));
      const bh = Math.min(h - y, Math.ceil(b.h * h));
      if (bw < 4 || bh < 4) continue;
      const img = ctx.getImageData(x, y, bw, bh);
      const oval = ovalWeight(bw, bh);
      const skin = skinMask(img.data);
      for (let i = 0; i < skin.length; i++) skin[i] *= oval[i];
      if (look.smooth > 0) {
        // Smooth skin: a blurred copy mixed in only where there is skin.
        const src = canvas('face-src', bw, bh);
        src.getContext('2d')!.putImageData(img, 0, 0);
        const c = canvas('face-soft', bw, bh);
        const g = c.getContext('2d', { willReadFrequently: true })!;
        g.clearRect(0, 0, bw, bh);
        g.filter = `blur(${Math.max(1, bw * 0.02 * (0.5 + look.smooth))}px)`;
        g.drawImage(src, 0, 0);
        g.filter = 'none';
        mixWeighted(img.data, g.getImageData(0, 0, bw, bh).data, skin, look.smooth * 0.85);
      }
      if (look.brighten > 0) {
        for (let i = 0; i < oval.length; i++) {
          const k = look.brighten * 0.22 * oval[i];
          for (let c = 0; c < 3; c++) img.data[i * 4 + c] += (255 - img.data[i * 4 + c]) * k;
        }
      }
      if (look.enhance > 0) {
        const sharp = sharpen(img.data, bw, bh, look.enhance);
        mixWeighted(img.data, sharp, oval, 1);
      }
      ctx.putImageData(img, x, y);
    }
  }
  for (const face of hide) {
    const b = padBox(face, 0.2);
    const x = b.x * w;
    const y = b.y * h;
    const bw = b.w * w;
    const bh = b.h * h;
    if (bw < 2 || bh < 2) continue;
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(x + bw / 2, y + bh / 2, bw / 2, bh / 2, 0, 0, Math.PI * 2);
    ctx.clip();
    if (look.mode === 'box') {
      ctx.fillStyle = '#111';
      ctx.fillRect(x, y, bw, bh);
    } else {
      const copy = canvas('face-hide', Math.ceil(bw), Math.ceil(bh));
      const g = copy.getContext('2d')!;
      g.clearRect(0, 0, copy.width, copy.height);
      g.drawImage(ctx.canvas, x, y, bw, bh, 0, 0, copy.width, copy.height);
      if (look.mode === 'pixelate') {
        // Big blocks: fewer the stronger it is.
        const blocks = Math.max(3, Math.round(14 - look.strength * 10));
        const tiny = canvas('face-tiny', blocks, Math.max(2, Math.round((blocks * bh) / bw)));
        const tg = tiny.getContext('2d')!;
        tg.imageSmoothingEnabled = true;
        tg.drawImage(copy, 0, 0, tiny.width, tiny.height);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(tiny, x, y, bw, bh);
        ctx.imageSmoothingEnabled = true;
      } else {
        ctx.filter = `blur(${Math.max(4, bw * (0.06 + look.strength * 0.14))}px)`;
        // Draw a bit larger so the blur doesn't fade into the sharp edges.
        ctx.drawImage(copy, x - bw * 0.1, y - bh * 0.1, bw * 1.2, bh * 1.2);
        ctx.drawImage(copy, x - bw * 0.1, y - bh * 0.1, bw * 1.2, bh * 1.2);
        ctx.filter = 'none';
      }
    }
    ctx.restore();
  }
}

/** Retouch, enhance or blur the faces in a photo; returns a PNG data URL (or null if no face was found). */
export async function faceLookPhoto(src: string, look: FaceLook, hideAll: boolean): Promise<{ src: string; width: number; height: number; faces: number } | null> {
  const img = new Image();
  img.src = src;
  await img.decode();
  const s = Math.min(1, 2048 / Math.max(img.naturalWidth, img.naturalHeight));
  const W = Math.max(1, Math.round(img.naturalWidth * s));
  const H = Math.max(1, Math.round(img.naturalHeight * s));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, W, H);
  const k = Math.min(1, 640 / Math.max(W, H));
  const small = document.createElement('canvas');
  small.width = Math.max(1, Math.round(W * k));
  small.height = Math.max(1, Math.round(H * k));
  small.getContext('2d')!.drawImage(c, 0, 0, small.width, small.height);
  const faces = (await aiProvider().faces(small.getContext('2d')!.getImageData(0, 0, small.width, small.height))).filter((f) => f.score >= 0.5);
  if (!faces.length) return null;
  paintFaces(ctx, W, H, hideAll ? [] : faces, hideAll ? faces : [], look);
  return { src: c.toDataURL('image/png'), width: W, height: H, faces: faces.length };
}
