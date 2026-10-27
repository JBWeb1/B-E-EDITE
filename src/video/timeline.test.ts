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
  activeAt,
  assignLanes,
  audioFade,
  estimateSizeMB,
  computePeaks,
  createOverlay,
  motionTransform,
  normalizeProject,
  parseSubtitles,
  scriptToCaptions,
  snapCandidates,
  snapTime,
  toSrt,
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

describe('snapping', () => {
  it('snaps to the closest candidate within the threshold', () => {
    expect(snapTime(4.93, [0, 5, 10], 0.1)).toEqual({ value: 5, snapped: 5 });
    expect(snapTime(4.5, [0, 5, 10], 0.1)).toEqual({ value: 4.5, snapped: null });
  });

  it('offers clip edges, the playhead and other items but not the dragged one', () => {
    const p = {
      ...createProject(),
      clips: [createClip(video('a', 4))],
      texts: [createTextOverlay(1, { id: 'me', duration: 1 }), createTextOverlay(6, { id: 'other', duration: 2 })],
    };
    const c = snapCandidates(p, 2.5, 'me');
    expect(c).toEqual(expect.arrayContaining([0, 2.5, 4, 6, 8]));
    expect(c).not.toContain(1);
  });
});

describe('overlays and motion', () => {
  it('counts overlays in the duration and finds the active ones', () => {
    const o = { ...createOverlay(video('pip', 10), 2), out: 3 };
    const p = { ...createProject(), overlays: [o] };
    expect(projectDuration(p)).toBe(5);
    expect(activeAt([o], 1)).toEqual([]);
    expect(activeAt([o], 4.9)).toEqual([o]);
  });

  it('fills in fields missing from older saved projects', () => {
    const old = { ...createProject() } as Partial<ReturnType<typeof createProject>>;
    delete old.overlays;
    delete old.fill;
    expect(normalizeProject(old as ReturnType<typeof createProject>)).toMatchObject({ overlays: [], fill: 'color' });
  });

  it('zooms and pans over the clip', () => {
    expect(motionTransform('zoom-in', 0).scale).toBe(1);
    expect(motionTransform('zoom-in', 1).scale).toBeCloseTo(1.2);
    expect(motionTransform('pan-left', 0).dx).toBeCloseTo(0.08);
    expect(motionTransform('pan-left', 1).dx).toBeCloseTo(-0.08);
    expect(motionTransform(undefined, 0.5)).toEqual({ scale: 1, dx: 0 });
  });
});

describe('captions', () => {
  const srt = `1
00:00:01,000 --> 00:00:02,500
Hello there

2
00:00:03,000 --> 00:00:04,000
<i>Second</i> line
over two rows
`;

  it('parses SubRip and WebVTT', () => {
    expect(parseSubtitles(srt)).toEqual([
      { start: 1, end: 2.5, text: 'Hello there' },
      { start: 3, end: 4, text: 'Second line\nover two rows' },
    ]);
    const vtt = 'WEBVTT\n\n00:00:00.500 --> 00:00:01.000\nHi\n';
    expect(parseSubtitles(vtt)).toEqual([{ start: 0.5, end: 1, text: 'Hi' }]);
  });

  it('round-trips through toSrt', () => {
    const texts = parseSubtitles(srt).map((c) => createTextOverlay(c.start, { text: c.text, duration: c.end - c.start }));
    expect(parseSubtitles(toSrt(texts))).toEqual(parseSubtitles(srt));
    expect(toSrt(texts)).toContain('00:00:01,000 --> 00:00:02,500');
  });

  it('spreads a script over the video, one caption per line or sentence', () => {
    const lines = scriptToCaptions('First line\nSecond, longer line here', 10);
    expect(lines.map((c) => c.text)).toEqual(['First line', 'Second, longer line here']);
    expect(lines[0].start).toBe(0);
    expect(lines[1].end).toBeCloseTo(10);
    expect(lines[0].end).toBeLessThan(lines[1].end - lines[1].start);
    expect(scriptToCaptions('One. Two! Three?', 6).map((c) => c.text)).toEqual(['One.', 'Two!', 'Three?']);
  });
});

describe('audio fades and export size', () => {
  it('ramps volume in and out', () => {
    const a = { in: 0, out: 10, fadeIn: 2, fadeOut: 4 };
    expect(audioFade(a, 0)).toBe(0);
    expect(audioFade(a, 1)).toBeCloseTo(0.5);
    expect(audioFade(a, 5)).toBe(1);
    expect(audioFade(a, 8)).toBeCloseTo(0.5);
    expect(audioFade({ in: 0, out: 10 }, 0)).toBe(1);
  });

  it('estimates file size from bitrate and length', () => {
    expect(estimateSizeMB(10, { fps: 30, bitrate: 8_000_000 }, 0)).toBe(10);
  });
});
