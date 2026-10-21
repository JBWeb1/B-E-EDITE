import { describe, expect, it } from 'vitest';
import { addColors, brandFontFor, EMPTY_BRAND } from '../lib/brand';
import { fontCssUrl, fontStack, WEB_FONTS, webFontIn } from '../lib/fonts';
import { createFrame, createIcon, curveLayout, fillFrame, groupElements, iconSrc, isOneGroup, ungroupElements, withGroups } from './extras';
import { createDoc, createShape } from './model';

describe('groups', () => {
  const doc = createDoc(1000, 1000);
  const a = createShape(doc, 'rect');
  const b = createShape(doc, 'ellipse');
  const c = createShape(doc, 'star');
  const d0 = { ...doc, elements: [a, b, c] };
  it('groups, expands and ungroups', () => {
    const d = groupElements(d0, [a.id, b.id]);
    expect(withGroups(d, [a.id])).toEqual([a.id, b.id]);
    expect(withGroups(d, [c.id])).toEqual([c.id]);
    expect(isOneGroup(d, [a.id, b.id])).toBe(true);
    expect(isOneGroup(d, [a.id, c.id])).toBe(false);
    const u = ungroupElements(d, [b.id]);
    expect(withGroups(u, [a.id])).toEqual([a.id]);
    expect(groupElements(d0, [a.id])).toBe(d0);
  });
});

describe('curved text', () => {
  const widths = Array(10).fill(20);
  it('is straight at 0', () => {
    const l = curveLayout(widths, 0, 40);
    expect(l.glyphs.every((g) => g.angle === 0 && g.y === 20)).toBe(true);
    expect(l.glyphs[0].x).toBe(-90);
  });
  it('arches up and dips down symmetrically', () => {
    const up = curveLayout(widths, 60, 40);
    const down = curveLayout(widths, -60, 40);
    // Arch: the ends are lower than the middle and lean outwards.
    expect(up.glyphs[0].y).toBeGreaterThan(up.glyphs[5].y);
    expect(up.glyphs[0].angle).toBeLessThan(0);
    expect(up.glyphs[9].angle).toBeGreaterThan(0);
    expect(up.glyphs[0].x).toBeCloseTo(-up.glyphs[9].x);
    // Dip: the middle is lower.
    expect(down.glyphs[5].y).toBeGreaterThan(down.glyphs[0].y);
    expect(up.height).toBeGreaterThan(40);
    expect(up.height).toBeCloseTo(down.height);
  });
});

describe('icons and frames', () => {
  it('makes coloured icons that remember their name', () => {
    const el = createIcon({ width: 1000, height: 500 }, 'heart', '#ff0000');
    expect(el.icon).toEqual({ name: 'heart', color: '#ff0000', stroke: 2 });
    expect(decodeURIComponent(el.src)).toContain('stroke="#ff0000"');
    expect(iconSrc('nope', '#000')).toBe(iconSrc('star', '#000'));
  });
  it('fills a frame with a photo cropped to cover it', () => {
    const f = createFrame({ width: 1000, height: 1000 }, 'heart');
    expect(f.frame).toBe('heart');
    const filled = fillFrame({ ...f, width: 300, height: 200 }, 'data:x', 1600, 900);
    expect(filled.crop).toEqual({ aspect: 1.5, zoom: 1, cx: 0.5, cy: 0.5 });
    expect(filled.naturalWidth).toBe(1600);
  });
});

describe('fonts and brand kit', () => {
  it('knows Google fonts and builds their addresses', () => {
    expect(WEB_FONTS.length).toBeGreaterThan(40);
    expect(fontStack('Playfair Display')).toBe('"Playfair Display", serif');
    expect(webFontIn('"Bebas Neue", sans-serif')?.bold).toBe(false);
    expect(webFontIn('Inter, system-ui, sans-serif')?.family).toBe('Inter');
    expect(webFontIn('Georgia, serif')).toBeUndefined();
    expect(fontCssUrl(webFontIn('"Bebas Neue"')!)).toBe('https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap');
    expect(fontCssUrl(webFontIn('Poppins')!, 'Poppins')).toContain(':wght@400;700&display=swap&text=Poppins');
  });
  it('keeps brand colours unique and picks heading or body fonts', () => {
    const b = addColors({ ...EMPTY_BRAND, colors: ['#111111'] }, ['#FF0000', '#111111', 'nope']);
    expect(b.colors).toEqual(['#ff0000', '#111111']);
    const kit = { ...b, heading: 'H', body: 'B' };
    const sizes = [20, 22, 80];
    expect(brandFontFor({ fontSize: 80, fontWeight: 'normal' }, sizes, kit)).toBe('H');
    expect(brandFontFor({ fontSize: 20, fontWeight: 'normal' }, sizes, kit)).toBe('B');
    expect(brandFontFor({ fontSize: 20, fontWeight: 'bold' }, sizes, kit)).toBe('H');
  });
});
