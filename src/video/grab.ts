import { toGray } from './tracker';
import type { GrayFrame } from './tracker';

/** Seek a video and wait until the frame at `t` can be drawn. */
function seekTo(v: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    if (Math.abs(v.currentTime - t) < 0.001 && v.readyState >= 2) return resolve();
    const done = () => {
      v.removeEventListener('seeked', done);
      clearTimeout(timer);
      resolve();
    };
    // Some browsers skip 'seeked' for tiny moves; don't wait forever.
    const timer = setTimeout(done, 1500);
    v.addEventListener('seeked', done);
    v.currentTime = t;
  });
}

/**
 * Small grey-level frames of a video at the given source times (for motion tracking).
 * `onProgress` gets 0..1. Stops early (returning what it has) if `signal` is aborted.
 */
export async function grabGrayFrames(
  url: string,
  times: number[],
  width: number,
  height: number,
  onProgress?: (f: number) => void,
  signal?: AbortSignal,
): Promise<GrayFrame[]> {
  const v = document.createElement('video');
  v.muted = true;
  v.preload = 'auto';
  v.playsInline = true;
  v.src = url;
  await new Promise<void>((resolve, reject) => {
    v.onloadeddata = () => resolve();
    v.onerror = () => reject(new Error('Could not read the video for tracking'));
  });
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const frames: GrayFrame[] = [];
  for (let i = 0; i < times.length; i++) {
    if (signal?.aborted) break;
    await seekTo(v, Math.max(0, Math.min(times[i], (v.duration || times[i]) - 0.001)));
    ctx.drawImage(v, 0, 0, width, height);
    frames.push(toGray(ctx.getImageData(0, 0, width, height).data, width, height));
    onProgress?.((i + 1) / times.length);
  }
  v.removeAttribute('src');
  v.load();
  return frames;
}
