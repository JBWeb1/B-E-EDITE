import { describe, expect, it } from 'vitest';
import { availableFormats, extensionFor, pickMimeType } from './export';
import { pathToKeys, simplifyPath, trackSequence, trackStep } from './tracker';
import type { GrayFrame } from './tracker';

/** A textured square on a dark, slightly noisy background. */
function frameWithSquare(w: number, h: number, x: number, y: number, size = 16): GrayFrame {
  const data = new Float32Array(w * h);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const inside = i >= x && i < x + size && j >= y && j < y + size;
      data[j * w + i] = inside ? 150 + ((i - x) * 7 + (j - y) * 13) % 100 : ((i * 31 + j * 17) % 11);
    }
  return { w, h, data };
}

describe('motion tracker', () => {
  it('finds where a patch moved', () => {
    const a = frameWithSquare(120, 80, 30, 20);
    const b = frameWithSquare(120, 80, 37, 24);
    const r = trackStep(a, b, 38, 28, { patch: 7, search: 12 });
    expect(r.x).toBe(45);
    expect(r.y).toBe(32);
    expect(r.score).toBeLessThan(1);
  });

  it('follows a square across many frames', () => {
    const frames = Array.from({ length: 12 }, (_, i) => frameWithSquare(160, 100, 10 + i * 9, 30 + i * 3));
    const path = trackSequence(frames, 18, 38, { patch: 7, search: 12 });
    expect(path).toHaveLength(12);
    expect(path[11].x).toBeCloseTo(18 + 11 * 9, 0);
    expect(path[11].y).toBeCloseTo(38 + 11 * 3, 0);
  });

  it('simplifies straight moves to their ends and keeps corners', () => {
    const line = Array.from({ length: 10 }, (_, i) => ({ t: i, x: i * 0.05, y: 0.2 }));
    expect(simplifyPath(line)).toHaveLength(2);
    const corner = [...line, ...Array.from({ length: 5 }, (_, i) => ({ t: 10 + i, x: 0.45, y: 0.2 + (i + 1) * 0.05 }))];
    const s = simplifyPath(corner);
    expect(s.length).toBe(3);
    expect(s[1].t).toBe(9);
  });

  it('turns a path into linear keyframes with an offset', () => {
    const keys = pathToKeys([{ t: 0, x: 0.2, y: 0.3 }, { t: 1, x: 0.6, y: 0.3 }], { x: 0.1, y: -0.1 });
    expect(keys.x[0].v).toBeCloseTo(0.3);
    expect(keys.x[1].v).toBeCloseTo(0.7);
    expect(keys.y[0].v).toBeCloseTo(0.2);
    expect(keys.x[0].ease).toBe('linear');
  });
});

describe('MP4 / WebM choice', () => {
  const chrome = (t: string) => ['video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'].includes(t);
  const firefox = (t: string) => t.startsWith('video/webm');
  it('prefers H.264 MP4 when the browser can make it', () => {
    expect(pickMimeType('mp4', chrome)).toBe('video/mp4;codecs=avc1,mp4a');
    expect(pickMimeType('webm', chrome)).toBe('video/webm;codecs=vp9,opus');
    expect(availableFormats(chrome)).toEqual(['mp4', 'webm']);
  });
  it('falls back to WebM where MP4 is not available', () => {
    expect(pickMimeType('mp4', firefox)).toBeNull();
    expect(availableFormats(firefox)).toEqual(['webm']);
  });
  it('names the file after the real type', () => {
    expect(extensionFor('video/mp4;codecs=avc1')).toBe('mp4');
    expect(extensionFor('video/webm;codecs=vp9')).toBe('webm');
  });
});
