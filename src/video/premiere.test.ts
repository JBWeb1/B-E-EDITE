import { describe, expect, it } from 'vitest';
import { colorStats, histogram, jCut, lCut, matchColor, rollEdit, slideClip, slipClip, splitAtSource, vectorscope, waveform } from './premiere';
import { clipDuration, createClip, createProject, layoutClips } from './timeline';
import type { MediaAsset } from './types';

const v = (id: string, d = 20): MediaAsset => ({ id, kind: 'video', name: id, url: '', duration: d, width: 64, height: 36 });
const assets = [v('a'), v('b'), v('c')];
const three = () => [
  { ...createClip(assets[0]), in: 2, out: 6 },
  { ...createClip(assets[1]), in: 5, out: 9 },
  { ...createClip(assets[2]), in: 1, out: 5 },
];
const total = (cs: ReturnType<typeof three>) => cs.reduce((s, c) => s + clipDuration(c), 0);

describe('pro trimming', () => {
  it('roll moves the cut, keeping the total', () => {
    const c = rollEdit(three(), 1, 1.5, assets);
    expect([c[0].out, c[1].in]).toEqual([7.5, 6.5]);
    expect(total(c)).toBe(12);
    // Can't roll so far that clip b disappears.
    expect(rollEdit(three(), 1, 10, assets)[1].in).toBeCloseTo(9 - 0.1);
  });
  it('slip shows other footage in the same spot', () => {
    expect(slipClip(three()[1], 2, 20)).toMatchObject({ in: 7, out: 11 });
    expect(slipClip(three()[1], -9, 20)).toMatchObject({ in: 0, out: 4 });
  });
  it('slide moves a clip between its neighbours', () => {
    const c = slideClip(three(), 1, 1, assets);
    expect([c[0].out, c[1].in, c[1].out, c[2].in]).toEqual([7, 5, 9, 2]);
    expect(layoutClips(c)[1].start).toBe(5);
    expect(total(c)).toBe(12);
  });
});

describe('J and L cuts', () => {
  it('a J cut starts the next sound early and quiets the clip before', () => {
    const p = { ...createProject(), assets, clips: three() };
    const j = jCut(p, 1, 1);
    expect(j.audio[0]).toMatchObject({ assetId: 'b', start: 3, in: 4, out: 9 });
    expect(j.clips[1].volume).toBe(0);
    expect(j.clips[0].keys?.volume?.map((k) => k.v)).toEqual([1, 0]);
  });
  it('an L cut lets the sound run over the next picture', () => {
    const p = { ...createProject(), assets, clips: three() };
    const l = lCut(p, 0, 1.5, assets);
    expect(l.audio[0]).toMatchObject({ assetId: 'a', start: 0, in: 2, out: 7.5 });
    expect(l.clips[0].volume).toBe(0);
    expect(l.clips[1].keys?.volume?.[0].v).toBe(0);
  });
});

describe('scene edit detection', () => {
  it('splits a clip at its scene changes', () => {
    const cs = three();
    const c = splitAtSource(cs, cs[0].id, [3, 4.5, 9, 2.05]);
    expect(c.length).toBe(5);
    expect(c.slice(0, 3).map((x) => [x.in, x.out])).toEqual([[2, 3], [3, 4.5], [4.5, 6]]);
  });
});

describe('colour match and scopes', () => {
  const solid = (r: number, g: number, b: number, n = 100) => Uint8ClampedArray.from({ length: n * 4 }, (_, i) => [r, g, b, 255][i % 4]);
  it('makes a dark, cool shot look like a bright, warm one', () => {
    const m = matchColor(colorStats(solid(60, 70, 110)), colorStats(solid(200, 150, 110)));
    expect(m.filters.brightness).toBeGreaterThan(1.5);
    expect(m.grade).not.toBeNull();
    // Warm = towards red/orange on the wheel.
    expect(m.grade!.midtones.hue < 60 || m.grade!.midtones.hue > 330).toBe(true);
    expect(matchColor(colorStats(solid(100, 100, 100)), colorStats(solid(100, 100, 100))).grade).toBeNull();
  });
  it('measures pictures for the scopes', () => {
    const px = solid(255, 0, 0, 4);
    expect(histogram(px)[0][255]).toBe(4);
    const w = waveform(px, 2, 2, 2, 4);
    expect(w[0 * 4 + 0] + w[1 * 4 + 0]).toBe(4); // red is dark in luma
    const vs = vectorscope(px, 9);
    expect(vs.reduce((a, b) => a + b, 0)).toBe(4);
    expect(vs[4 * 9 + 4]).toBe(0); // red is far from the centre
  });
});
