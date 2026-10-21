import { describe, expect, it } from 'vitest';
import { decodeRuns, frameCount, framePlan } from './fastExport';
import { createClip, createProject } from './timeline';
import type { MediaAsset, OverlayClip } from './types';

const video = (id: string, duration: number): MediaAsset => ({ id, kind: 'video', name: id, url: '', duration, width: 640, height: 360 });

describe('fast export planning', () => {
  it('counts frames', () => {
    expect(frameCount(2, 30)).toBe(60);
    expect(frameCount(0, 30)).toBe(1);
  });

  it('asks each video for the right source frames, in order', () => {
    const a = video('a', 10);
    const p = createProject();
    p.assets = [a, { ...video('img', Infinity), kind: 'image' }];
    p.clips = [{ ...createClip(a), in: 2, out: 3 }, { ...createClip(p.assets[1]), out: 1 }, { ...createClip(a), in: 5, out: 6, speed: 2 }];
    const plan = framePlan(p, 2.5, 10);
    expect(plan.length).toBe(25);
    expect(plan[0]).toEqual([{ key: 'asset:a', assetId: 'a', t: 2 }]);
    expect(plan[5][0].t).toBeCloseTo(2.5);
    expect(plan[12]).toEqual([]); // the photo needs no decoding
    expect(plan[22][0].t).toBeCloseTo(5.4); // double speed
    // Both uses of "a" go forwards, so one decoding pass is enough.
    expect(decodeRuns(plan).get('asset:a')!.length).toBe(1);
  });

  it('starts a new pass when the time goes backwards, and plans video layers', () => {
    const a = video('a', 10);
    const p = createProject();
    p.assets = [a];
    p.clips = [{ ...createClip(a), in: 5, out: 6 }, { ...createClip(a), in: 0, out: 1 }];
    const layer = { id: 'L', assetId: 'a', start: 0.5, in: 8, out: 9, reverse: true } as OverlayClip;
    p.overlays = [layer];
    const plan = framePlan(p, 2, 10);
    expect(decodeRuns(plan).get('asset:a')!.length).toBe(2);
    expect(plan[5].map((n) => n.key)).toEqual(['asset:a', 'overlay:L']);
    // A reversed layer plays backwards: a new pass for every frame.
    expect(plan[6][1].t).toBeCloseTo(8.9);
    expect(decodeRuns(plan).get('overlay:L')!.length).toBe(10);
  });
});
