import { describe, expect, it } from 'vitest';
import { borderColor, removePlainBackground } from './bgremove';

/** w×h RGBA image filled with `bg`, with a `fg` square from (x0,y0) to (x1,y1) exclusive. */
function image(w: number, h: number, bg: number[], fg: number[], [x0, y0, x1, y1]: number[]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = x >= x0 && x < x1 && y >= y0 && y < y1 ? fg : bg;
      data.set([...c, 255], (y * w + x) * 4);
    }
  }
  return data;
}
const alpha = (d: Uint8ClampedArray, w: number, x: number, y: number) => d[(y * w + x) * 4 + 3];

describe('removePlainBackground', () => {
  it('clears the plain background and keeps the subject', () => {
    const d = image(10, 10, [250, 250, 250], [200, 30, 30], [3, 3, 7, 7]);
    const removed = removePlainBackground(d, 10, 10, 15);
    expect(removed).toBe(100 - 16);
    expect(alpha(d, 10, 0, 0)).toBe(0);
    expect(alpha(d, 10, 5, 5)).toBe(255);
  });

  it('keeps background-colored areas that are enclosed by the subject', () => {
    // A white hole inside a red ring is not connected to the edge.
    const d = image(9, 9, [255, 255, 255], [200, 0, 0], [2, 2, 7, 7]);
    d.set([255, 255, 255, 255], (4 * 9 + 4) * 4);
    removePlainBackground(d, 9, 9, 10);
    expect(alpha(d, 9, 4, 4)).toBe(255);
  });

  it('softens subject pixels next to the background', () => {
    const d = image(10, 10, [255, 255, 255], [180, 180, 180], [3, 3, 7, 7]);
    removePlainBackground(d, 10, 10, 15);
    const edge = alpha(d, 10, 3, 5);
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(255);
    expect(alpha(d, 10, 5, 5)).toBe(255);
  });

  it('removes nothing at zero tolerance unless colors match exactly', () => {
    const d = image(4, 4, [10, 10, 10], [10, 10, 10], [0, 0, 0, 0]);
    expect(removePlainBackground(d, 4, 4, 0)).toBe(16);
    const e = image(4, 4, [10, 10, 10], [12, 10, 10], [1, 1, 3, 3]);
    expect(removePlainBackground(e, 4, 4, 0)).toBe(12);
  });
});

describe('borderColor', () => {
  it('ignores a few odd edge pixels', () => {
    const d = image(5, 5, [0, 200, 0], [0, 0, 0], [0, 0, 0, 0]);
    d.set([255, 0, 0, 255], 0);
    expect(borderColor(d, 5, 5)).toEqual([0, 200, 0]);
  });
});
