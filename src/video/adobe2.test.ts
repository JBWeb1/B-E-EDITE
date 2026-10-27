import { describe, expect, it } from 'vitest';
import { loopTime, setKey, setLoop, valueAt } from './anim';
import type { Keyframe } from './anim';
import { CURVE_PRESETS, curveAt, curveTables, gradeFilterMarkup, gradeId, isNeutral, NEUTRAL_CURVES, NEUTRAL_GRADE } from './grade';
import { layerQuad, move3d } from './layer3d';

describe('RGB curves', () => {
  it('a straight curve changes nothing; points are passed through smoothly and stay in range', () => {
    expect(curveAt(NEUTRAL_CURVES.master, 0.37)).toBeCloseTo(0.37);
    const s = CURVE_PRESETS[0].curves.master;
    expect(curveAt(s, 0.25)).toBeCloseTo(0.18);
    expect(curveAt(s, 0.1)).toBeLessThan(0.1);
    expect(curveAt(s, 0.9)).toBeGreaterThan(0.9);
    for (let x = 0; x <= 1; x += 0.05) expect(curveAt(s, x)).toBeGreaterThanOrEqual(curveAt(s, Math.max(0, x - 0.05)) - 1e-9);
  });
  it('builds tables (channel, then master) and makes the grade filter use them', () => {
    const t = curveTables({ ...NEUTRAL_CURVES, b: [[0, 0.2], [1, 1]] }, 5);
    expect(t.r).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(t.b[0]).toBeCloseTo(0.2);
    expect(isNeutral({ ...NEUTRAL_GRADE, curves: NEUTRAL_CURVES })).toBe(true);
    const g = { ...NEUTRAL_GRADE, curves: CURVE_PRESETS[0].curves };
    expect(isNeutral(g)).toBe(false);
    expect(gradeFilterMarkup(g)).toContain('tableValues');
    expect(gradeId(g)).not.toBe(gradeId(NEUTRAL_GRADE));
  });
});

describe('looping keyframes', () => {
  const keys: Keyframe[] = [{ t: 1, v: 0, ease: 'linear' }, { t: 3, v: 10 }];
  it('repeats or goes back and forth after the last keyframe', () => {
    expect(valueAt(keys, 4, 0)).toBe(10);
    const cyc = setLoop({ x: keys }, 'cycle')!.x!;
    expect(valueAt(cyc, 4, 0)).toBeCloseTo(5);
    expect(valueAt(cyc, 2, 0)).toBeCloseTo(5);
    const pp = setLoop({ x: keys }, 'pingpong')!.x!;
    expect(valueAt(pp, 4, 0)).toBeCloseTo(5);
    expect(valueAt(pp, 4.5, 0)).toBeCloseTo(2.5);
    expect(loopTime(pp, 6)).toBeCloseTo(2);
  });
  it('keeps looping when a keyframe is added after the last one', () => {
    const cyc = setLoop({ x: keys }, 'cycle')!.x!;
    const more = setKey(cyc, 5, 0);
    expect(more[more.length - 1]).toMatchObject({ t: 5, loop: 'cycle' });
    expect(more.filter((k) => k.loop).length).toBe(1);
  });
});

describe('3D layers', () => {
  it('a flat layer is just its rectangle', () => {
    const q = layerQuad(100, 50, 80, 40, 0, 0, 0, 1000);
    expect(q.map((p) => p.map((v) => Math.round(v)))).toEqual([[60, 30], [140, 30], [140, 70], [60, 70]]);
  });
  it('turning it narrows it, and the near side looks bigger', () => {
    const q = layerQuad(0, 0, 100, 100, 0, 60, 0, 400);
    const width = q[1][0] - q[0][0];
    expect(width).toBeLessThan(80);
    const left = q[3][1] - q[0][1];
    const right = q[2][1] - q[1][1];
    expect(Math.abs(left - right)).toBeGreaterThan(5);
    const flip = move3d('Card flip', 2).rotY ?? [];
    expect(flip[flip.length - 1].v).toBe(180);
  });
});
