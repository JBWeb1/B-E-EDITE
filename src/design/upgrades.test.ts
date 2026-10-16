import { describe, expect, it } from 'vitest';
import { createDoc, createShape, createText } from './model';
import { elementAtTime, hasMotion, motionBase, motionLength, shiftKeys } from './motion';
import { adjustPixels, isNeutralPhoto, NEUTRAL_PHOTO, sharpenPixels } from './photo';
import { TEMPLATES } from './templates';

const doc = createDoc(1000, 500);

describe('design keyframes', () => {
  const box = { ...createShape(doc, 'rect'), x: 100, y: 100, width: 200, height: 100 };

  it('leaves elements without keyframes alone', () => {
    expect(elementAtTime(box, 1, doc)).toBe(box);
    expect(hasMotion(box)).toBe(false);
  });

  it('moves the centre between keyframes (fractions of the page)', () => {
    const el = { ...box, keys: { x: [{ t: 0, v: 0.2, ease: 'linear' as const }, { t: 2, v: 0.6, ease: 'linear' as const }] } };
    const mid = elementAtTime(el, 1, doc);
    expect(mid.x + mid.width / 2).toBeCloseTo(400);
    expect(mid.y).toBe(100);
    expect(motionLength([el])).toBe(2);
  });

  it('scales size and font size together', () => {
    const t = { ...createText(doc, { text: 'Hi', fontSize: 40 }), x: 0, y: 0, width: 200, height: 48, keys: { scale: [{ t: 0, v: 2, ease: 'linear' as const }] } };
    const big = elementAtTime(t, 0, doc);
    expect(big.width).toBe(400);
    expect(big.type === 'text' && big.fontSize).toBe(80);
    // Grows around its centre.
    expect(big.x + big.width / 2).toBeCloseTo(100);
  });

  it('describes the resting state as the keyframe base', () => {
    expect(motionBase(box, doc)).toEqual({ x: 0.2, y: 0.3, scale: 1, rotation: 0, opacity: 1 });
  });

  it('moves the whole path when the element is dragged', () => {
    const keys = { x: [{ t: 0, v: 0.2, ease: 'linear' as const }], opacity: [{ t: 0, v: 1, ease: 'linear' as const }] };
    const moved = shiftKeys(keys, 0.1, 0);
    expect(moved?.x?.[0].v).toBeCloseTo(0.3);
    expect(moved?.opacity).toBe(keys.opacity);
    expect(shiftKeys(undefined, 1, 1)).toBeUndefined();
  });
});

describe('photo tools', () => {
  const grey = (v: number, n = 4) => new Uint8ClampedArray(Array.from({ length: n }, () => [v, v, v, 255]).flat());

  it('exposure brightens by stops', () => {
    const d = grey(60);
    adjustPixels(d, 2, 2, { ...NEUTRAL_PHOTO, exposure: 1 });
    expect(d[0]).toBe(120);
    expect(d[3]).toBe(255);
  });

  it('warm temperature adds red and removes blue', () => {
    const d = grey(128);
    adjustPixels(d, 2, 2, { ...NEUTRAL_PHOTO, temperature: 100 });
    expect(d[0]).toBeGreaterThan(140);
    expect(d[2]).toBeLessThan(116);
  });

  it('shadows lift the darks but keep black and white', () => {
    const d = new Uint8ClampedArray([0, 0, 0, 255, 70, 70, 70, 255, 255, 255, 255, 255]);
    adjustPixels(d, 3, 1, { ...NEUTRAL_PHOTO, shadows: 100 });
    expect(d[0]).toBe(0);
    expect(d[4]).toBeGreaterThan(90);
    expect(d[8]).toBe(255);
  });

  it('vignette darkens the corners, not the centre', () => {
    const w = 21;
    const d = grey(200, w * w);
    adjustPixels(d, w, w, { ...NEUTRAL_PHOTO, vignette: 1 });
    expect(d[(10 * w + 10) * 4]).toBe(200);
    expect(d[0]).toBeLessThan(60);
  });

  it('sharpen increases contrast at edges', () => {
    const w = 4;
    const d = new Uint8ClampedArray(w * 3 * 4);
    for (let y = 0; y < 3; y++) for (let x = 0; x < w; x++) d.fill(x < 2 ? 50 : 200, (y * w + x) * 4, (y * w + x) * 4 + 3);
    sharpenPixels(d, w, 3, 1);
    expect(d[(w + 1) * 4]).toBeLessThan(50);
    expect(d[(w + 2) * 4]).toBeGreaterThan(200);
  });

  it('knows when nothing is changed', () => {
    expect(isNeutralPhoto(undefined)).toBe(true);
    expect(isNeutralPhoto({ ...NEUTRAL_PHOTO })).toBe(true);
    expect(isNeutralPhoto({ ...NEUTRAL_PHOTO, sharpen: 0.2 })).toBe(false);
  });
});

describe('design templates', () => {
  it('has templates in every category and all build', () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(15);
    for (const t of TEMPLATES) {
      const d = t.build();
      expect(d.elements.length, t.label).toBeGreaterThan(0);
      for (const el of d.elements) {
        expect(el.x + el.width, `${t.label}: ${el.name}`).toBeLessThanOrEqual(d.width + 400);
        expect(el.y + el.height, `${t.label}: ${el.name}`).toBeLessThanOrEqual(d.height + 400);
      }
    }
  });
});
