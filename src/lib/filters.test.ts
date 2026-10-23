import { describe, expect, it } from 'vitest';
import { cssFilter, filterByName, INSTAGRAM_FILTERS, NEUTRAL_FILTERS, sameFilters } from './filters';

describe('filters', () => {
  it('has the Instagram filters, each a real change', () => {
    expect(INSTAGRAM_FILTERS.length).toBeGreaterThanOrEqual(25);
    for (const f of INSTAGRAM_FILTERS) expect(cssFilter(f.filters)).not.toBe('none');
    expect(new Set(INSTAGRAM_FILTERS.map((f) => f.label)).size).toBe(INSTAGRAM_FILTERS.length);
  });
  it('writes vintage tone and colour shift into the CSS filter', () => {
    expect(cssFilter({ ...NEUTRAL_FILTERS, sepia: 0.3, hue: -10 })).toBe('sepia(0.3) hue-rotate(-10deg)');
  });
  it('finds filters by name loosely and compares old filters without the new fields', () => {
    expect(filterByName('xpro ii')?.label).toBe('X-Pro II');
    expect(filterByName('LOFI')?.label).toBe('Lo-Fi');
    expect(sameFilters({ brightness: 1, contrast: 1, saturation: 1, blur: 0, grayscale: 0 }, NEUTRAL_FILTERS)).toBe(true);
    expect(sameFilters(NEUTRAL_FILTERS, filterByName('Clarendon')!.filters)).toBe(false);
  });
});
