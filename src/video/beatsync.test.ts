import { describe, expect, it } from 'vitest';
import { curveSpeeds, rampRate, rampWarp, sourceTimeAt } from './anim';
import { beatTimes, createAudioClip, createClip, createProject, fitClipsToBeats, layoutClips, snapCandidates, toggleMarker } from './timeline';
import type { MediaAsset } from './types';

const video = (id: string, duration: number): MediaAsset => ({ id, kind: 'video', name: id, url: '', duration, width: 640, height: 360 });
const song: MediaAsset = { id: 's', kind: 'audio', name: 'song', url: '', duration: 60 };

describe('custom speed curve', () => {
  const curve = [1, 1, 4, 4, 1, 1];
  it('keeps the clip length and never runs backwards', () => {
    expect(rampWarp('custom', 0, curve)).toBe(0);
    expect(rampWarp('custom', 1, curve)).toBeCloseTo(1);
    let last = 0;
    for (let u = 0; u <= 1; u += 0.05) {
      const w = rampWarp('custom', u, curve);
      expect(w).toBeGreaterThanOrEqual(last - 1e-9);
      last = w;
    }
  });
  it('is fast where the curve is high', () => {
    expect(rampRate('custom', 0.5, curve)).toBeGreaterThan(rampRate('custom', 0.05, curve) * 3);
    const s = curveSpeeds(curve);
    expect(s[2]).toBeCloseTo(4 * s[0]);
    // A flat curve plays at normal speed.
    expect(curveSpeeds([2, 2, 2])).toEqual([1, 1, 1]);
    expect(sourceTimeAt({ in: 0, out: 10, speed: 1, ramp: 'custom', curve: [3, 3, 3] }, 5)).toBeCloseTo(5);
  });
});

describe('beats and markers', () => {
  it('puts the song beats on the timeline and snaps to them', () => {
    const p = createProject();
    p.assets = [song];
    p.audio = [{ ...createAudioClip(song, 2), in: 1, out: 5, beats: [0.5, 1, 1.5, 2, 4.5, 6] }];
    p.markers = [7.25];
    expect(beatTimes(p)).toEqual([2, 2.5, 3, 5.5]); // the beat at 6 s is past the end of the clip
    const c = snapCandidates(p, 0);
    expect(c).toContain(5.5);
    expect(c).toContain(7.25);
  });
  it('adds and removes markers', () => {
    expect(toggleMarker(undefined, 3)).toEqual([3]);
    expect(toggleMarker([1, 3], 2)).toEqual([1, 2, 3]);
    expect(toggleMarker([1, 3], 3.02)).toEqual([1]);
  });
  it('fits every cut to a beat', () => {
    const a = video('a', 20);
    const p = createProject();
    p.assets = [a, song];
    p.clips = [{ ...createClip(a), in: 0, out: 1.3 }, { ...createClip(a), in: 5, out: 6.6 }, { ...createClip(a), in: 19, out: 20 }];
    const beats = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4];
    const fitted = layoutClips(fitClipsToBeats(p, beats));
    expect(fitted.map((c) => c.end)).toEqual([1.5, 3, 4]);
    // The last clip had only 1 s of video left, so it can't be stretched past it.
    expect(fitted[2].clip.out).toBe(20);
  });
});
