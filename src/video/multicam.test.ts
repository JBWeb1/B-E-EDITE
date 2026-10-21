import { describe, expect, it } from 'vitest';
import { alignEnvelope, autoSwitch, buildMulticam, syncOffset, tidyCuts } from './multicam';
import type { MediaAsset } from './types';

const R = 100;
/** A loudness envelope with bursts (claps/words) at the given seconds. */
function bursts(times: number[], seconds: number, shift = 0, noise = 0.02): number[] {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: seconds * R }, (_, i) => {
    const t = i / R - shift;
    return noise * rnd() + times.reduce((s, b) => s + (t >= b && t < b + 0.15 ? 1 - (t - b) / 0.15 : 0), 0);
  });
}
const video = (id: string, duration: number): MediaAsset => ({ id, kind: 'video', name: id, url: '', duration, width: 1280, height: 720 });

describe('multicam', () => {
  const events = [1.2, 2.9, 3.4, 5.8, 7.1, 9.6, 11.3, 12.05, 14.7];
  it('finds how far apart two cameras started', () => {
    const ref = bursts(events, 18);
    // The second camera started 1.75 s later, so everything happens 1.75 s earlier in its file.
    const late = bursts(events, 18, -1.75);
    const r = syncOffset(ref, late, R, 5);
    expect(r.offset).toBeCloseTo(-1.75, 1);
    expect(r.confidence).toBeGreaterThan(0.3);
    expect(syncOffset(ref, bursts(events, 18, 0.5), R, 5).offset).toBeCloseTo(0.5, 1);
  });
  it('cuts to whoever is talking and holds each shot', () => {
    const a = Array.from({ length: 10 * R }, (_, i) => (i < 4 * R ? 1 : 0.05));
    const b = Array.from({ length: 10 * R }, (_, i) => (i >= 4 * R ? 1 : 0.05));
    const cuts = autoSwitch([a, b], R, 2);
    expect(cuts[0]).toEqual({ t: 0, angle: 0 });
    expect(cuts.length).toBe(2);
    expect(cuts[1].angle).toBe(1);
    expect(cuts[1].t).toBeGreaterThan(3.3);
    expect(cuts[1].t).toBeLessThan(4.7);
  });
  it('tidies live cuts', () => {
    // A quick second press replaces the first; pressing the camera that is already on does nothing.
    expect(tidyCuts([{ t: 2, angle: 1 }, { t: 2.1, angle: 2 }, { t: 5, angle: 2 }])).toEqual([{ t: 0, angle: 0 }, { t: 2, angle: 2 }]);
    expect(tidyCuts([{ t: 0, angle: 0 }, { t: 3, angle: 1 }])).toEqual([{ t: 0, angle: 0 }, { t: 3, angle: 1 }]);
  });
  it('builds clips that switch angles over one steady soundtrack', () => {
    const assets = [video('a', 20), video('b', 12)];
    const angles = [{ assetId: 'a', offset: 0 }, { assetId: 'b', offset: -2 }];
    const { clips, audio } = buildMulticam(assets, angles, [{ t: 0, angle: 0 }, { t: 4, angle: 1 }, { t: 10, angle: 0 }], 16);
    expect(clips.map((c) => [c.assetId, c.in, c.out, c.volume])).toEqual([
      ['a', 0, 4, 0],
      ['b', 2, 8, 0],
      ['a', 10, 16, 0],
    ]);
    expect(audio).toMatchObject([{ assetId: 'a', start: 0, in: 0, out: 16, volume: 1 }]);
    // Camera b doesn't reach 14-16 s: that part falls back to camera a.
    const late = buildMulticam(assets, angles, [{ t: 0, angle: 0 }, { t: 12, angle: 1 }], 16).clips;
    expect(late.map((c) => [c.assetId, c.in, c.out])).toEqual([['a', 0, 16]]);
    expect(alignEnvelope([1, 2, 3, 4], 0.02, 100, 0.02)).toEqual([3, 4]);
  });
});
