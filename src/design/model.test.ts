import { describe, expect, it } from 'vitest';
import {
  aabb,
  addElement,
  alignElements,
  boundsOf,
  distributeElements,
  duplicateElements,
  elementsInRect,
  gradientLine,
  moveElements,
  normalizeRect,
  removeElements,
  updateElement,
  createDoc,
  createShape,
  duplicateElement,
  elementAt,
  hitTest,
  moveLayer,
  resizeBox,
  resizeDoc,
  rotationFromPoint,
  snapPosition,
  wrapText,
} from './model';
import type { ShapeElement } from './types';

const doc = createDoc(1000, 1000);
const rect = (patch: Partial<ShapeElement> = {}): ShapeElement => ({
  ...createShape(doc, 'rect'),
  x: 100, y: 100, width: 200, height: 100, ...patch,
});

describe('hit testing', () => {
  it('hits inside an unrotated box', () => {
    expect(hitTest(rect(), { x: 150, y: 150 })).toBe(true);
    expect(hitTest(rect(), { x: 350, y: 150 })).toBe(false);
  });

  it('accounts for rotation', () => {
    const r = rect({ rotation: 90 }); // center (200,150); now 100 wide, 200 tall
    expect(hitTest(r, { x: 200, y: 240 })).toBe(true);
    expect(hitTest(r, { x: 290, y: 150 })).toBe(false);
  });

  it('returns the topmost element', () => {
    const a = rect({ id: 'a' });
    const b = rect({ id: 'b', x: 150 });
    const d = addElement(addElement(doc, a), b);
    expect(elementAt(d, { x: 200, y: 150 })?.id).toBe('b');
    expect(elementAt(d, { x: 120, y: 150 })?.id).toBe('a');
    expect(elementAt(d, { x: 900, y: 900 })).toBeNull();
  });
});

describe('resizeBox', () => {
  it('keeps the opposite corner fixed', () => {
    const b = resizeBox(rect(), 'se', { x: 50, y: 20 });
    expect(b).toMatchObject({ x: 100, y: 100, width: 250, height: 120 });
    const nw = resizeBox(rect(), 'nw', { x: 50, y: 20 });
    expect(nw).toMatchObject({ x: 150, y: 120, width: 150, height: 80 });
  });

  it('locks the aspect ratio on corners when asked', () => {
    const b = resizeBox(rect(), 'se', { x: 200, y: 0 }, true);
    expect(b.width / b.height).toBeCloseTo(2);
    expect(b.width).toBeCloseTo(400);
  });

  it('enforces a minimum size', () => {
    expect(resizeBox(rect(), 'e', { x: -500, y: 0 }).width).toBe(5);
  });

  it('resizes along the rotated axis', () => {
    // Rotated 90°: dragging the "e" handle downwards in world space grows width.
    const b = resizeBox(rect({ rotation: 90 }), 'e', { x: 0, y: 40 });
    expect(b.width).toBeCloseTo(240);
    expect(b.height).toBeCloseTo(100);
  });
});

describe('rotationFromPoint', () => {
  it('measures clockwise from straight up and snaps', () => {
    const r = rect();
    expect(rotationFromPoint(r, { x: 200, y: 0 })).toBeCloseTo(0);
    expect(rotationFromPoint(r, { x: 400, y: 150 })).toBeCloseTo(90);
    expect(rotationFromPoint(r, { x: 400, y: 160 }, true)).toBe(90);
  });
});

describe('layers', () => {
  const d = [rect({ id: 'a' }), rect({ id: 'b' }), rect({ id: 'c' })].reduce(addElement, doc);
  const ids = (x: typeof d) => x.elements.map((e) => e.id).join('');

  it('reorders', () => {
    expect(ids(moveLayer(d, 'a', 'up'))).toBe('bac');
    expect(ids(moveLayer(d, 'a', 'top'))).toBe('bca');
    expect(ids(moveLayer(d, 'c', 'bottom'))).toBe('cab');
    expect(ids(moveLayer(d, 'a', 'down'))).toBe('abc');
  });

  it('duplicates above the original', () => {
    const r = duplicateElement(d, 'a');
    expect(r.doc.elements[1].id).toBe(r.id);
    expect(r.doc.elements[1].x).toBe(120);
  });
});

describe('snapPosition', () => {
  it('snaps to the canvas center', () => {
    const s = snapPosition(doc, ['x'], { x: 397, y: 10, width: 200, height: 100 }, 8);
    expect(s.x).toBe(400);
    expect(s.guides).toContainEqual({ axis: 'x', pos: 500 });
  });

  it('does not snap beyond the threshold', () => {
    const s = snapPosition(doc, ['x'], { x: 380, y: 220, width: 200, height: 100 }, 8);
    expect(s).toMatchObject({ x: 380, y: 220, guides: [] });
  });
});

describe('wrapText', () => {
  const measure = (s: string) => s.length * 10;
  it('wraps on word boundaries and keeps newlines', () => {
    expect(wrapText('one two three', 75, measure)).toEqual(['one two', 'three']);
    expect(wrapText('a\n\nb', 100, measure)).toEqual(['a', '', 'b']);
  });
});

describe('resizeDoc', () => {
  it('scales and centers content into the new size', () => {
    const d = addElement(doc, rect({ x: 0, y: 0, width: 1000, height: 1000 }));
    const r = resizeDoc(d, 2000, 1000);
    expect(r.elements[0]).toMatchObject({ x: 500, y: 0, width: 1000, height: 1000 });
  });
});

describe('multi-select helpers', () => {
  const a = rect({ id: 'a', x: 100, y: 100, width: 100, height: 100 });
  const b = rect({ id: 'b', x: 400, y: 300, width: 100, height: 50 });
  const c = rect({ id: 'c', x: 900, y: 500, width: 50, height: 50 });
  const d = [a, b, c].reduce(addElement, doc);

  it('computes bounds including rotation', () => {
    expect(boundsOf([a, b])).toEqual({ x: 100, y: 100, width: 400, height: 250 });
    const rotated = aabb(rect({ x: 0, y: 0, width: 100, height: 100, rotation: 45 }));
    expect(rotated.width).toBeCloseTo(141.42, 1);
  });

  it('finds elements touching a marquee', () => {
    expect(elementsInRect(d, normalizeRect({ x: 450, y: 600 }, { x: 150, y: 150 }))).toEqual(['a', 'b']);
  });

  it('moves, removes and duplicates several elements, skipping locked ones', () => {
    const locked = updateElement(d, 'b', { locked: true });
    const moved = moveElements(locked, ['a', 'b'], 10, 5);
    expect(moved.elements.map((e) => [e.x, e.y])).toEqual([[110, 105], [400, 300], [900, 500]]);
    expect(removeElements(locked, ['a', 'b']).elements.map((e) => e.id)).toEqual(['b', 'c']);
    const dup = duplicateElements(d, ['a', 'c']);
    expect(dup.doc.elements).toHaveLength(5);
    expect(dup.ids).toHaveLength(2);
  });

  it('aligns a single element to the page and several to their bounds', () => {
    expect(alignElements(d, ['a'], 'right').elements[0].x).toBe(900);
    const left = alignElements(d, ['a', 'b', 'c'], 'left');
    expect(left.elements.map((e) => e.x)).toEqual([100, 100, 100]);
    const middle = alignElements(d, ['a', 'b'], 'vcenter');
    expect(middle.elements.map((e) => e.y + e.height / 2)).toEqual([225, 225, 525]);
  });

  it('distributes with equal gaps', () => {
    const out = distributeElements(d, ['a', 'b', 'c'], 'x');
    const [ea, eb, ec] = out.elements;
    expect(eb.x - (ea.x + ea.width)).toBeCloseTo(ec.x - (eb.x + eb.width), 0);
    expect(ea.x).toBe(100);
    expect(ec.x).toBe(900);
  });
});

describe('gradientLine', () => {
  it('spans the box along the angle', () => {
    expect(gradientLine(200, 100, 0)).toEqual([{ x: 0, y: 50 }, { x: 200, y: 50 }]);
    const [a, b] = gradientLine(200, 100, 90);
    expect(a.y).toBeCloseTo(0);
    expect(b.y).toBeCloseTo(100);
  });
});
