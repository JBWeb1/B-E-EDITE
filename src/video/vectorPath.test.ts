import { describe, expect, it } from 'vitest';
import { fromFrame, lettersOnPath, pathBounds, pathLength, PATH_PRESETS, pointAt, samplePath, tracePath, trimDash } from './vectorPath';

const line = { closed: false, points: [{ x: 0, y: 0 }, { x: 3, y: 4 }] };

describe('vector paths', () => {
  it('measures and walks along a path', () => {
    const s = samplePath(line);
    expect(pathLength(s)).toBeCloseTo(5);
    expect(pointAt(s, 2.5)).toMatchObject({ x: expect.closeTo(1.5), y: expect.closeTo(2), angle: expect.closeTo(Math.atan2(4, 3)) });
    const circle = PATH_PRESETS.find((p) => p.id === 'circle')!.make(2);
    expect(pathLength(samplePath(circle))).toBeCloseTo(2 * Math.PI, 1);
  });
  it('traces curves for drawing', () => {
    const calls: string[] = [];
    tracePath({ moveTo: () => calls.push('M'), lineTo: () => calls.push('L'), bezierCurveTo: () => calls.push('C'), closePath: () => calls.push('Z') }, PATH_PRESETS[3].make(1), 100);
    expect(calls.join('')).toBe('MCCCCZ');
  });
  it('trims the line to animate it drawing on', () => {
    expect(trimDash(100, 0, 1)).toBeNull();
    expect(trimDash(100, 0, 0.25)).toEqual({ dash: [25, 200], offset: -0 });
    expect(trimDash(100, 0.8, 0.3)).toEqual({ dash: [expect.closeTo(50), 200], offset: -30 });
  });
  it('centres pen points (frame fractions) on the item', () => {
    const r = fromFrame([{ x: 0.25, y: 0.5 }, { x: 0.75, y: 0.5, ix: -0.1, iy: -0.2 }], false, 1920, 1080);
    expect(r.cx).toBeCloseTo(0.5, 2);
    expect(r.path.points[0].x).toBeCloseTo(-(0.25 * 1920) / 1080, 3);
    expect(r.path.points[1].ix).toBeCloseTo((-0.1 * 1920) / 1080, 3);
    expect(pathBounds(r.path).w).toBeCloseTo((0.5 * 1920) / 1080, 1);
  });
  it('puts letters along the path, centred', () => {
    const s = samplePath({ closed: false, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] });
    const pos = lettersOnPath(s, [2, 2]);
    expect(pos.map((p) => p!.x)).toEqual([expect.closeTo(4), expect.closeTo(6)]);
    expect(lettersOnPath(s, [2, 2], 0.6)[1]).toBeNull(); // slid past the end
  });
});
