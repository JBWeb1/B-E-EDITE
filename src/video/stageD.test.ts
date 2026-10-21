import { describe, expect, it } from 'vitest';
import { cubicBezier, ease, valueAt } from './anim';
import { dubLines } from './aiTools';
import { graphRange, moveKey } from './GraphEditor';
import { createClip } from './timeline';
import type { MediaAsset } from './types';

describe('custom easing curves', () => {
  it('matches CSS cubic-bezier', () => {
    expect(cubicBezier([0, 0, 1, 1], 0.3)).toBeCloseTo(0.3, 3);
    // ease-in-out is symmetric around the middle.
    expect(cubicBezier([0.42, 0, 0.58, 1], 0.5)).toBeCloseTo(0.5, 3);
    expect(cubicBezier([0.42, 0, 0.58, 1], 0.25)).toBeLessThan(0.25);
    // An overshoot curve goes past the target.
    expect(Math.max(...[0.6, 0.7, 0.8].map((x) => cubicBezier([0.3, 1.6, 0.6, 1.2], x)))).toBeGreaterThan(1);
    expect(ease('custom', 0.5, [0.42, 0, 0.58, 1])).toBeCloseTo(0.5, 3);
  });
  it('is used between keyframes', () => {
    const keys = [{ t: 0, v: 0, ease: 'custom' as const, bez: [0.9, 0, 1, 0.1] as [number, number, number, number] }, { t: 1, v: 100 }];
    expect(valueAt(keys, 0.5, 0)).toBeLessThan(10); // a late, sudden move
  });
});

describe('graph editor helpers', () => {
  it('keeps keyframes in order when dragged', () => {
    const keys = [{ t: 0, v: 0 }, { t: 1, v: 1 }, { t: 2, v: 0 }];
    expect(moveKey(keys, 1, 5, 2)[1]).toMatchObject({ t: expect.closeTo(2 - 1 / 60, 3), v: 2 });
    expect(moveKey(keys, 1, -3, 0.5)[1].t).toBeCloseTo(1 / 60, 3);
    expect(graphRange([{ t: 0, v: 3 }, { t: 1, v: 3 }])).toEqual([2.3, 3.7].map((v) => expect.closeTo(v, 5)));
  });
});

describe('AI dubbing', () => {
  it('dubs what is left in the edit, in project time', () => {
    const a: MediaAsset = { id: 'a', kind: 'video', name: 'a', url: '', duration: 20 };
    const clips = [{ ...createClip(a), in: 5, out: 10 }];
    const transcript = [
      { id: '1', assetId: 'a', start: 1, end: 3, text: 'cut away' },
      { id: '2', assetId: 'a', start: 6, end: 8, text: ' hello there ' },
      { id: '3', assetId: 'a', start: 9, end: 11, text: 'half in' },
    ];
    expect(dubLines({ clips, transcript })).toEqual([
      { at: 1, length: 2, text: 'hello there' },
      { at: 4, length: 1, text: 'half in' },
    ]);
  });
});
