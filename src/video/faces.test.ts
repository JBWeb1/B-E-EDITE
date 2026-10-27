import { describe, expect, it } from 'vitest';
import { boxAt, faceFocus, fillGaps, followKeys, iou, linkFaces, mixWeighted, padBox, sharpen, skinMask } from './faces';
import { createClip } from './timeline';
import type { MediaAsset } from './types';

const det = (x: number, y: number, w = 0.2, score = 0.9) => ({ x, y, w, h: w, score });

describe('face tracks', () => {
  it('measures overlap', () => {
    expect(iou({ x: 0, y: 0, w: 1, h: 1 }, { x: 0, y: 0, w: 1, h: 1 })).toBe(1);
    expect(iou({ x: 0, y: 0, w: 0.5, h: 1 }, { x: 0.5, y: 0, w: 0.5, h: 1 })).toBe(0);
  });
  it('follows two people across frames, through a missed frame', () => {
    const frames = Array.from({ length: 10 }, (_, i) => [det(0.1 + i * 0.01, 0.3), ...(i === 4 ? [] : [det(0.7 - i * 0.01, 0.3, 0.15)])]);
    frames[2].push(det(0.45, 0.8, 0.05, 0.3)); // weak false alarm
    const tracks = linkFaces(frames);
    expect(tracks.length).toBe(2);
    expect(tracks.every((t) => t.boxes.every(Boolean))).toBe(true); // the gap at frame 4 is filled
    expect(tracks[0].boxes[9]!.x).toBeCloseTo(0.19, 1);
    expect(fillGaps([{ x: 0, y: 0, w: 1, h: 1 }, null, { x: 1, y: 0, w: 1, h: 1 }], 2)[1]!.x).toBeCloseTo(0.5);
  });
  it('finds a face box between samples', () => {
    const scan = { from: 2, rate: 10 };
    const track = { id: 'f', boxes: [{ x: 0, y: 0, w: 0.1, h: 0.1 }, { x: 0.2, y: 0, w: 0.1, h: 0.1 }, null] };
    expect(boxAt(scan, track, 2.05)!.x).toBeCloseTo(0.1);
    expect(boxAt(scan, track, 2.28)).toBeNull();
    expect(boxAt(scan, track, 5)).toBeNull();
    expect(padBox({ x: 0, y: 0.5, w: 0.2, h: 0.2 })).toEqual({ x: 0, y: 0.45, w: 0.25, h: 0.3 });
  });
  it('keeps the biggest face in frame', () => {
    expect(faceFocus([det(0.1, 0.1, 0.1), det(0.6, 0.2, 0.3)])).toBeCloseTo(0.75);
    expect(faceFocus([])).toBeNull();
  });
  it('makes a sticker follow a face on the timeline', () => {
    const a: MediaAsset = { id: 'a', kind: 'video', name: 'a', url: '', duration: 10, width: 1280, height: 720 };
    const clip = { ...createClip(a), in: 2, out: 6 };
    const scan = { from: 2, rate: 10, tracks: [] };
    const track = { id: 'f', boxes: Array.from({ length: 41 }, (_, i) => ({ x: 0.1 + i * 0.01, y: 0.2, w: 0.1, h: 0.2 })) };
    const k = followKeys(clip, 1, a, { width: 1280, height: 720 }, scan, track, 1.5, 2)!;
    expect(k.x[0]).toMatchObject({ t: 0, v: expect.closeTo(0.2, 2) });
    expect(k.y[0].v).toBeCloseTo(0.3, 3);
    expect(k.x[k.x.length - 1].v).toBeGreaterThan(k.x[0].v);
    expect(k.size).toBeCloseTo(0.2, 2);
    const below = followKeys(clip, 1, a, { width: 1280, height: 720 }, scan, track, 1.5, 2, 'below')!;
    expect(below.y[0].v).toBeCloseTo(0.45, 3);
  });
});

describe('face pixels', () => {
  it('recognises skin and not sky or grass', () => {
    const m = skinMask(new Uint8ClampedArray([224, 172, 145, 255, 120, 75, 55, 255, 70, 130, 230, 255, 60, 170, 60, 255]));
    expect(m[0]).toBeGreaterThan(0.6);
    expect(m[1]).toBeGreaterThan(0.6);
    expect(m[2]).toBe(0);
    expect(m[3]).toBe(0);
  });
  it('mixes and sharpens', () => {
    const a = new Uint8ClampedArray([100, 100, 100, 255]);
    mixWeighted(a, new Uint8ClampedArray([200, 200, 200, 255]), new Float32Array([1]), 0.5);
    expect(a[0]).toBe(150);
    const px = new Uint8ClampedArray(3 * 3 * 4).fill(100);
    px[4 * 4] = 160; // bright centre pixel
    expect(sharpen(px, 3, 3, 1)[16]).toBeGreaterThan(160);
  });
});
