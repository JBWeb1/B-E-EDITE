import { describe, expect, it } from 'vitest';
import { nudgeCorner, orderCorners, project, quadAt, squareToQuad, steadyCorners, triangleTransform } from './cornerPin';
import type { Quad } from './cornerPin';

const q: Quad = [[10, 20], [110, 30], [100, 120], [5, 100]];

describe('corner pin', () => {
  it('maps the square onto the four corners', () => {
    const H = squareToQuad(q);
    [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([s, t], i) => {
      const [x, y] = project(H, s, t);
      expect(x).toBeCloseTo(q[i][0], 6);
      expect(y).toBeCloseTo(q[i][1], 6);
    });
    // A plain rectangle stays a rectangle: the middle is the middle.
    const R = squareToQuad([[0, 0], [200, 0], [200, 100], [0, 100]]);
    expect(project(R, 0.5, 0.5)).toEqual([expect.closeTo(100), expect.closeTo(50)]);
  });
  it('finds the transform between two triangles', () => {
    const [a, b, c, d, e, f] = triangleTransform([[0, 0], [10, 0], [0, 10]], [[5, 5], [25, 5], [5, 15]]);
    const map = (x: number, y: number) => [a * x + c * y + e, b * x + d * y + f];
    expect(map(10, 0)).toEqual([expect.closeTo(25), expect.closeTo(5)]);
    expect(map(0, 10)).toEqual([expect.closeTo(5), expect.closeTo(15)]);
    expect(map(5, 5)).toEqual([expect.closeTo(15), expect.closeTo(10)]);
  });
  it('orders clicked corners and follows them over time', () => {
    expect(orderCorners([[100, 120], [5, 100], [110, 30], [10, 20]])).toEqual(q);
    const pin = { from: 1, rate: 2, quads: [q, q.map(([x, y]) => [x + 10, y]) as Quad] };
    expect(quadAt(pin, 1.25)[0]).toEqual([15, 20]);
    expect(quadAt(pin, 9)[0]).toEqual([20, 20]);
    expect(nudgeCorner(pin, 2, 1, -1).quads[1][2]).toEqual([111, 119]);
  });
});

describe('steady corners', () => {
  it('pulls a corner that slipped back with the others', () => {
    const q0: Quad = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const moved = q0.map(([x, y]) => [x + 5, y + 2]) as Quad;
    const slipped = [...moved] as Quad;
    slipped[2] = [15, 16]; // 4 too low
    const out = steadyCorners([q0, slipped]);
    expect(out[1][2]).toEqual([15, 12]);
    expect(out[1][0]).toEqual([5, 2]);
    expect(steadyCorners([q0, moved])[1]).toEqual(moved);
  });
});
