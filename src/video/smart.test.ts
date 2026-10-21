import { describe, expect, it } from 'vitest';
import { applyMaskAlpha, blendMasks, maskIndexAt, maskSize, packMasks, refineMask, resizeMask, smoothSequence, unpackMasks } from './cutout';
import { loudnessBoost, studioSettings } from './export';
import { globalShift, planStabilize, shakeAt, smoothPath, stabilizedRect } from './stabilize';
import type { GrayFrame } from './tracker';

/** A grey test picture with some texture, moved by (ox, oy) pixels. */
function picture(ox: number, oy: number, w = 64, h = 36): GrayFrame {
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const u = x - ox;
      const v = y - oy;
      data[y * w + x] = 128 + 60 * Math.sin(u * 0.45) * Math.cos(v * 0.6) + 40 * Math.sin((u + v) * 0.21);
    }
  return { w, h, data };
}

describe('smart cut-out masks', () => {
  it('sharpens soft edges but keeps a ramp', () => {
    const r = refineMask(new Uint8Array([0, 40, 128, 220, 255]));
    expect(r[0]).toBe(0);
    expect(r[1]).toBe(0);
    expect(r[2]).toBeGreaterThan(100);
    expect(r[2]).toBeLessThan(160);
    expect(r[3]).toBe(255);
  });
  it('smooths over time without lag', () => {
    const [a, b, c] = smoothSequence([new Uint8Array([0]), new Uint8Array([255]), new Uint8Array([0])]);
    expect([a[0], b[0], c[0]]).toEqual([64, 128, 64]);
  });
  it('resizes, packs and finds the masks to blend', () => {
    const big = resizeMask(new Uint8Array([0, 255, 0, 255]), 2, 2, 4, 4);
    expect(big.length).toBe(16);
    expect(big[0]).toBe(0);
    expect(big[3]).toBe(255);
    const frames = [new Uint8Array([1, 2]), new Uint8Array([3, 4])];
    expect(unpackMasks(packMasks(frames), 2, 1).map((f) => [...f])).toEqual([[1, 2], [3, 4]]);
    expect(maskIndexAt({ from: 2, fps: 10, count: 5 }, 2.25)).toEqual({ a: 2, b: 3, f: expect.closeTo(0.5) });
    expect(maskIndexAt({ from: 2, fps: 10, count: 5 }, 9)).toEqual({ a: 4, b: 4, f: 0 });
    expect([...blendMasks(new Uint8Array([0, 100]), new Uint8Array([200, 100]), 0.25, new Uint8Array(2))]).toEqual([50, 100]);
    expect(maskSize(1920, 1080)).toEqual({ w: 256, h: 144 });
  });
  it('makes the background see-through', () => {
    const px = new Uint8ClampedArray([10, 10, 10, 255, 20, 20, 20, 255]);
    applyMaskAlpha(px, new Uint8Array([0, 255]));
    expect([px[3], px[7]]).toEqual([0, 255]);
  });
});

describe('stabiliser', () => {
  it('measures how the picture moved', () => {
    const s = globalShift(picture(0, 0), picture(2, -1));
    expect(s.x).toBeCloseTo(2, 0);
    expect(s.y).toBeCloseTo(-1, 0);
  });
  it('cancels the shake and keeps the slow pan', () => {
    // A slow pan to the right plus jitter.
    const jitter = [0, 2, -2, 1, -1, 2, -2, 0, 1, -1, 2, -2, 0, 1, -1, 2];
    const frames = jitter.map((j, i) => picture(Math.round(i * 0.5) + j, 0));
    const s = planStabilize(frames, 10, 3, 1);
    expect(s.dx.length).toBe(frames.length);
    expect(s.zoom).toBeGreaterThan(1);
    expect(s.zoom).toBeLessThanOrEqual(1.2);
    // Where the picture ends up after the correction: far less jumpy than before.
    const raw = jitter.map((j, i) => Math.round(i * 0.5) + j);
    const steady = raw.map((x, i) => x + s.dx[i] * 64);
    const jumpiness = (xs: number[]) => xs.slice(2).reduce((sum, x, i) => sum + Math.abs(x - 2 * xs[i + 1] + xs[i]), 0);
    expect(jumpiness(steady)).toBeLessThan(jumpiness(raw) * 0.25);
    expect(shakeAt(s, 3.1).dx).toBeCloseTo(s.dx[1]);
  });
  it('shows a zoomed window that never leaves the picture', () => {
    const s = { from: 0, rate: 1, dx: [0.5, -0.5], dy: [0, 0], zoom: 1.1, strength: 1 };
    for (const t of [0, 1]) {
      const r = stabilizedRect({ sx: 0, sy: 0, sw: 100, sh: 50 }, s, t);
      expect(r.sw).toBeCloseTo(100 / 1.1);
      expect(r.sx).toBeGreaterThanOrEqual(0);
      expect(r.sx + r.sw).toBeLessThanOrEqual(100 + 1e-9);
    }
    expect(smoothPath([0, 10, 0], 1)).toEqual([5, 10 / 3, 5]);
  });
});

describe('studio sound', () => {
  it('raises a quiet voice and lowers a loud one', () => {
    const tone = (amp: number) => Float32Array.from({ length: 16000 }, (_, i) => amp * Math.sin(i / 5));
    expect(loudnessBoost(tone(0.01), 16000)).toBeGreaterThan(6);
    expect(loudnessBoost(tone(0.9), 16000)).toBeLessThan(0);
    expect(loudnessBoost(new Float32Array(16000), 16000)).toBe(0);
  });
  it('is neutral when off', () => {
    expect(studioSettings(false)).toMatchObject({ presence: 0, ratio: 1, makeup: 0 });
    expect(studioSettings(true, 3).makeup).toBe(7);
  });
});
