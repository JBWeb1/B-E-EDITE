import { describe, expect, it } from 'vitest';
import { applyPixelFx, PIXEL_FX } from './pixelfx';
import { createEffect, EFFECTS, effectFrame, isAdobeEffect } from './timeline';

const W = 160;
const H = 120;
/** A test picture: a red left half, a blue-grey gradient right half. */
function picture() {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (x < W / 2) d.set([220, 30, 30, 255], i);
      else d.set([40 + x, 60 + y, 160, 255], i);
    }
  return d;
}

describe('Adobe-style pixel effects', () => {
  it('every pixel effect changes the picture, and strength 0 leaves it alone', () => {
    for (const fx of PIXEL_FX) {
      const src = picture();
      const out = new Uint8ClampedArray(src.length);
      applyPixelFx(fx, src, out, W, H, 1, 1.3);
      expect(out.some((v, i) => Math.abs(v - src[i]) > 2), fx).toBe(true);
      if (fx !== 'posterize') {
        const none = new Uint8ClampedArray(src.length);
        applyPixelFx(fx, src, none, W, H, 0, 1.3);
        expect(Array.from(none), fx).toEqual(Array.from(src));
      }
    }
  });
  it('invert, threshold and leave colour do what they say', () => {
    const src = picture();
    const out = new Uint8ClampedArray(src.length);
    applyPixelFx('invert', src, out, W, H, 1);
    expect(Array.from(out.slice(0, 4))).toEqual([35, 225, 225, 255]);
    applyPixelFx('threshold', src, out, W, H, 1);
    expect([0, 255]).toContain(out[0]);
    applyPixelFx('leave-color', src, out, W, H, 1);
    expect(Array.from(out.slice(0, 3))).toEqual([220, 30, 30]); // red stays
    const right = ((H - 1) * W + W - 1) * 4;
    expect(out[right]).toBe(out[right + 1]); // the blue side goes grey
  });
});

describe('Adobe-style effects on the timeline', () => {
  it('are listed in the Adobe groups and reach the engine only while active', () => {
    const adobe = EFFECTS.filter((e) => isAdobeEffect(e.type));
    expect(adobe.length).toBeGreaterThanOrEqual(25);
    const e = createEffect('kaleidoscope', 2, { intensity: 0.8, duration: 3 });
    expect(effectFrame([e], 1).adobe).toEqual([]);
    expect(effectFrame([e], 3).adobe).toEqual([{ type: 'kaleidoscope', k: 0.8, local: 1, speed: 1 }]);
    // The shared "no effect" frame is never changed by a busy frame.
    expect(effectFrame([], 0).adobe).toEqual([]);
  });
});
