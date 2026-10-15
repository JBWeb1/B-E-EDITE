import { describe, expect, it } from 'vitest';
import {
  clipDuration,
  createClip,
  createTextOverlay,
  dropIndex,
  fadeOpacity,
  layoutClips,
  locate,
  moveItem,
  projectDuration,
  createProject,
  splitClips,
  splitTexts,
  textAnimation,
  trimEnd,
  trimStart,
  cssFilter,
  NEUTRAL_FILTERS,
  assignLanes,
  computePeaks,
  maxTransition,
  transitionAt,
} from './timeline';
import type { MediaAsset } from './types';

const video = (id: string, duration: number): MediaAsset => ({ id, kind: 'video', name: id, url: '', duration });
const image: MediaAsset = { id: 'img', kind: 'image', name: 'img', url: '', duration: Infinity };

describe('main track layout', () => {
  const clips = [createClip(video('a', 4)), createClip(image), { ...createClip(video('b', 10)), speed: 2 }];

  it('places clips back to back, honouring speed and default image length', () => {
    expect(layoutClips(clips).map((p) => [p.start, p.end])).toEqual([[0, 4], [4, 7], [7, 12]]);
  });

  it('locates the clip and source time under the playhead', () => {
    expect(locate(clips, 5)?.clip.assetId).toBe('img');
    const hit = locate(clips, 8)!;
    expect(hit.clip.assetId).toBe('b');
    expect(hit.sourceTime).toBeCloseTo(2);
    expect(locate(clips, 12)).toBeNull();
  });

  it('computes project duration across tracks', () => {
    const p = { ...createProject(), clips, texts: [createTextOverlay(10, { duration: 5 })] };
    expect(projectDuration(p)).toBe(15);
  });
});

describe('splitClips', () => {
  it('splits a clip into two at the playhead', () => {
    const clips = [createClip(video('a', 4)), createClip(video('b', 6))];
    const out = splitClips(clips, 6);
    expect(out).toHaveLength(3);
    expect(out[1]).toMatchObject({ assetId: 'b', in: 0, out: 2 });
    expect(out[2]).toMatchObject({ assetId: 'b', in: 2, out: 6 });
    expect(out[2].id).not.toBe(out[1].id);
  });

  it('accounts for speed when splitting', () => {
    const out = splitClips([{ ...createClip(video('a', 10)), speed: 2 }], 1);
    expect(out[0].out).toBeCloseTo(2);
  });

  it('ignores splits on a clip boundary', () => {
    const clips = [createClip(video('a', 4)), createClip(video('b', 6))];
    expect(splitClips(clips, 4)).toBe(clips);
  });
});

describe('trimming', () => {
  const c = createClip(video('a', 10));
  it('clamps to the source and a minimum length', () => {
    expect(trimStart(c, -3).in).toBe(0);
    expect(trimStart(c, 20).in).toBeCloseTo(9.9);
    expect(trimEnd(c, 20, 10).out).toBe(10);
    expect(trimEnd(c, -1, 10).out).toBeCloseTo(0.1);
  });

  it('lets photos be stretched', () => {
    expect(clipDuration(trimEnd(createClip(image), 8, Infinity))).toBe(8);
  });
});

describe('reordering', () => {
  it('moves items and finds drop slots', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    const clips = [createClip(video('a', 4)), createClip(video('b', 4))];
    expect(dropIndex(clips, 1)).toBe(0);
    expect(dropIndex(clips, 3)).toBe(1);
    expect(dropIndex(clips, 7)).toBe(2);
  });
});

describe('effects', () => {
  it('fades in and out', () => {
    const c = { ...createClip(video('a', 10)), fadeIn: 2, fadeOut: 2 };
    expect(fadeOpacity(c, 0)).toBe(0);
    expect(fadeOpacity(c, 1)).toBeCloseTo(0.5);
    expect(fadeOpacity(c, 5)).toBe(1);
    expect(fadeOpacity(c, 9)).toBeCloseTo(0.5);
  });

  it('builds a CSS filter string', () => {
    expect(cssFilter(NEUTRAL_FILTERS)).toBe('none');
    expect(cssFilter({ ...NEUTRAL_FILTERS, grayscale: 1, blur: 2 })).toBe('blur(2px) grayscale(1)');
  });

  it('animates text entrances', () => {
    const o = createTextOverlay(0, { duration: 3, animation: 'fade' });
    expect(textAnimation(o, 0).alpha).toBe(0);
    expect(textAnimation(o, 1.5).alpha).toBe(1);
  });

  it('splits text overlays', () => {
    const out = splitTexts([createTextOverlay(2, { duration: 4 })], 3);
    expect(out.map((o) => [o.start, o.duration])).toEqual([[2, 1], [3, 3]]);
  });
});

describe('transitions', () => {
  const a = createClip(video('a', 4));
  const b = { ...createClip(video('b', 4)), transition: { type: 'fade' as const, duration: 1 } };
  const placed = layoutClips([a, b]);

  it('reports eased progress only inside the transition window', () => {
    expect(transitionAt(placed[1], 4)?.progress).toBe(0);
    expect(transitionAt(placed[1], 4.5)?.progress).toBeCloseTo(0.5);
    expect(transitionAt(placed[1], 5.2)).toBeNull();
  });

  it('ignores a transition on the first clip', () => {
    expect(transitionAt(layoutClips([b])[0], 0.5)).toBeNull();
  });

  it('caps the length at half the clip', () => {
    expect(maxTransition(createClip(video('x', 1)))).toBe(0.5);
    expect(maxTransition(createClip(video('x', 10)))).toBe(2);
  });

  it('drops the transition from the second half of a split', () => {
    const out = splitClips([a, b], 6);
    expect(out[1].transition).toBeDefined();
    expect(out[2].transition).toBeUndefined();
  });
});

describe('computePeaks', () => {
  it('buckets samples and normalises to the loudest', () => {
    const samples = new Float32Array([0.1, -0.2, 0.5, -1, 0.25, 0]);
    expect(computePeaks(samples, 6, 3)).toEqual([0.2, 1, 0.25]);
  });
});

describe('assignLanes', () => {
  it('stacks overlapping items and reuses free rows', () => {
    const items = [
      { s: 0, e: 4 },
      { s: 0, e: 2 },
      { s: 2, e: 5 },
      { s: 4, e: 6 },
    ];
    expect(assignLanes(items, (i) => i.s, (i) => i.e)).toEqual([0, 1, 1, 0]);
  });
});
