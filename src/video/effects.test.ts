import { describe, expect, it } from 'vitest';
import {
  createClip,
  createEffect,
  createProject,
  effectFrame,
  insertClipAt,
  layoutClips,
  normalizeProject,
  NO_EFFECT,
  projectDuration,
  trimAtPlayhead,
  EFFECTS,
} from './timeline';
import type { MediaAsset, VideoProject } from './types';

const asset = (duration: number, id = 'a'): MediaAsset => ({ id, kind: 'video', name: id, url: '', duration, width: 100, height: 100 }) as MediaAsset;

describe('effects', () => {
  it('createEffect uses sensible defaults and accepts overrides', () => {
    const e = createEffect('shake', 2);
    expect(e).toMatchObject({ type: 'shake', start: 2, duration: 3, intensity: 0.7 });
    expect(createEffect('flash', 0, { duration: 1 }).duration).toBe(1);
  });

  it('every effect type changes the frame while active and nothing outside it', () => {
    // Adjustment layers recolour the frame in the engine, not through effectFrame.
    for (const { type } of EFFECTS.filter((x) => x.type !== 'adjustment')) {
      const e = createEffect(type, 1, { intensity: 1 });
      expect(effectFrame([e], 0.5)).toEqual(NO_EFFECT);
      expect(effectFrame([e], 4)).toEqual(NO_EFFECT);
      expect(effectFrame([e], 1.37)).not.toEqual(NO_EFFECT);
    }
  });

  it('combines several effects and is deterministic', () => {
    const list = [createEffect('vignette', 0, { intensity: 0.5 }), createEffect('glow', 0, { intensity: 0.3 })];
    const f = effectFrame(list, 1);
    expect(f.vignette).toBe(0.5);
    expect(f.glow).toBe(0.3);
    expect(effectFrame([createEffect('shake', 0)], 0.42)).toEqual(effectFrame([createEffect('shake', 0)], 0.42));
  });

  it('flash fades out and intensity is clamped', () => {
    const e = createEffect('flash', 0, { intensity: 5 });
    expect(effectFrame([e], 0).flash).toBe(1);
    expect(effectFrame([e], 0.5).flash).toBeLessThan(0.1);
  });

  it('project duration covers effects; old projects get effects and tracks', () => {
    const p = { ...createProject(), effects: [createEffect('grain', 4)] };
    expect(projectDuration(p)).toBe(7);
    const old = { ...createProject() } as Partial<VideoProject>;
    delete old.effects;
    delete old.tracks;
    const n = normalizeProject(old as VideoProject);
    expect(n.effects).toEqual([]);
    expect(n.tracks).toEqual({});
  });
});

describe('editing helpers', () => {
  it('insertClipAt splits the clip under the playhead and puts the new one in between', () => {
    const a = createClip(asset(10, 'a'));
    const b = createClip(asset(2, 'b'));
    const out = insertClipAt([a], 4, b);
    expect(out.map((c) => c.assetId)).toEqual(['a', 'b', 'a']);
    const placed = layoutClips(out);
    expect(placed[1].start).toBeCloseTo(4);
    expect(placed[2].end).toBeCloseTo(12);
  });

  it('insertClipAt appends past the end', () => {
    const a = createClip(asset(3, 'a'));
    const b = createClip(asset(2, 'b'));
    expect(insertClipAt([a], 10, b).map((c) => c.assetId)).toEqual(['a', 'b']);
  });

  it('trimAtPlayhead removes the part before or after the playhead', () => {
    const a = createClip(asset(10));
    expect(trimAtPlayhead([a], 4, 'before')[0]).toMatchObject({ in: 4, out: 10 });
    expect(trimAtPlayhead([a], 4, 'after')[0]).toMatchObject({ in: 0, out: 4 });
    expect(trimAtPlayhead([a], 20, 'after')).toEqual([a]);
  });

  it('trimAtPlayhead respects clip speed', () => {
    const a = { ...createClip(asset(10)), speed: 2 };
    expect(trimAtPlayhead([a], 2, 'after')[0].out).toBeCloseTo(4);
  });
});
