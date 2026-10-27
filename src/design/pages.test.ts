import { describe, expect, it } from 'vitest';
import { animateAll, animationAt, animationOrder, entranceLength, ENTRANCE, STAGGER } from './animate';
import { addElement, createDoc, createShape } from './model';
import { duplicatePage, insertPage, movePage, normalizeFile, pageView, removePage, toFile, withPage } from './pages';

const base = () => {
  let doc = createDoc(1000, 500, 'Deck');
  doc = addElement(doc, { ...createShape(doc, 'rect'), id: 'r', x: 0, y: 0, width: 1000, height: 500 });
  return toFile(doc);
};

describe('pages', () => {
  it('wraps older single-page designs and leaves files alone', () => {
    const file = base();
    expect(file.pages).toHaveLength(1);
    expect(normalizeFile(file)).toBe(file);
    expect(normalizeFile(createDoc(10, 10)).pages).toHaveLength(1);
  });

  it('edits one page through a page view', () => {
    let file = insertPage(base(), 1);
    const view = pageView(file, 1);
    expect(view.elements).toEqual([]);
    file = withPage(file, 1, { ...view, background: '#000000' });
    expect(file.pages[1].background).toBe('#000000');
    expect(file.pages[0].elements).toHaveLength(1);
  });

  it('resizes every page when one page view changes size (magic resize)', () => {
    let file = duplicatePage(base(), 0);
    const view = pageView(file, 0);
    file = withPage(file, 0, { ...view, width: 500, height: 250, elements: view.elements.map((e) => ({ ...e, width: 500, height: 250 })) });
    expect(file.width).toBe(500);
    expect(file.pages[1].elements[0]).toMatchObject({ width: 500, height: 250 });
  });

  it('duplicates with fresh element ids, removes and reorders', () => {
    let file = duplicatePage(base(), 0);
    expect(file.pages).toHaveLength(2);
    expect(file.pages[1].elements[0].id).not.toBe(file.pages[0].elements[0].id);
    file = insertPage(file, 0);
    const ids = file.pages.map((p) => p.id);
    expect(movePage(file, 0, 2).pages.map((p) => p.id)).toEqual([ids[1], ids[2], ids[0]]);
    expect(removePage(file, 0).pages).toHaveLength(2);
    expect(removePage(base(), 0).pages).toHaveLength(1); // never removes the last page
  });
});

describe('animations', () => {
  it('starts hidden, staggers elements and ends at rest', () => {
    expect(animationAt('fade', 0, 0).alpha).toBe(0);
    expect(animationAt('fade', 0, ENTRANCE).alpha).toBe(1);
    expect(animationAt('fade', 1, ENTRANCE / 2).alpha).toBeLessThan(animationAt('fade', 0, ENTRANCE / 2).alpha);
    expect(animationAt('rise', 0, 0).dy).toBeGreaterThan(0);
    expect(animationAt('wipe', 0, 0).reveal).toBe(0);
    expect(animationAt('none', 0, 0)).toMatchObject({ alpha: 1, scale: 1, reveal: 1 });
  });

  it('orders only animated elements and measures the page entrance', () => {
    const page = animateAll(pageView(insertPage(base(), 1), 0), 'pop');
    expect(animationOrder(page.elements)).toEqual([0]);
    expect(entranceLength(page)).toBe(ENTRANCE);
    const two = { elements: [...page.elements, { ...page.elements[0], id: 'x' }] };
    expect(entranceLength(two)).toBeCloseTo(STAGGER + ENTRANCE);
    expect(entranceLength(animateAll(page, 'none'))).toBe(0);
  });
});
