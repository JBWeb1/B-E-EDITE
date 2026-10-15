import { describe, expect, it } from 'vitest';
import { alpha, DEFAULT_TEMPLATE, isCustomized, LOOK_TEMPLATES, lookAttributes, lookFromTemplate, lookStyle, luminance, mix, parseLook } from './look';

describe('editor look', () => {
  it('templates have unique ids and valid colours', () => {
    expect(new Set(LOOK_TEMPLATES.map((t) => t.id)).size).toBe(LOOK_TEMPLATES.length);
    for (const t of LOOK_TEMPLATES) {
      for (const [key, value] of Object.entries(t.palette)) {
        if (key !== 'light') expect(value, `${t.id}.${key}`).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
    expect(LOOK_TEMPLATES.some((t) => t.id === DEFAULT_TEMPLATE)).toBe(true);
  });

  it('parseLook falls back to the default for missing or broken data', () => {
    expect(parseLook(null)).toEqual(lookFromTemplate(DEFAULT_TEMPLATE));
    expect(parseLook('not json')).toEqual(lookFromTemplate(DEFAULT_TEMPLATE));
    expect(parseLook('{"template":"nope"}').template).toBe(DEFAULT_TEMPLATE);
  });

  it('parseLook keeps valid choices and drops invalid ones', () => {
    const look = parseLook(JSON.stringify({ template: 'premiere', library: 'right', timeline: 'huge', accent: '#ff0000', density: 'compact' }));
    expect(look).toMatchObject({ template: 'premiere', library: 'right', timeline: 'large', accent: '#ff0000', density: 'compact', corners: 'square' });
    expect(parseLook(JSON.stringify({ accent: 'red' })).accent).toBeNull();
  });

  it('knows when a look was tweaked', () => {
    const base = lookFromTemplate('finalcut');
    expect(isCustomized(base)).toBe(false);
    expect(isCustomized({ ...base, library: 'right' })).toBe(true);
    expect(isCustomized({ ...base, accent: '#123456' })).toBe(true);
  });

  it('builds CSS variables, using the custom accent when set', () => {
    const style = lookStyle({ ...lookFromTemplate('resolve'), accent: '#22c55e' }) as Record<string, string>;
    expect(style['--accent']).toBe('#22c55e');
    expect(style['--bg']).toBe('#16161a');
    expect(style['--playhead']).toBe('#e64b3d');
    expect(style['--panel-radius']).toBe('2px');
    expect(style.colorScheme).toBe('dark');
    expect((lookStyle(lookFromTemplate('canva')) as Record<string, string>).colorScheme).toBe('light');
  });

  it('picks readable text on the accent', () => {
    const on = (accent: string) => (lookStyle({ ...lookFromTemplate('capcut'), accent }) as Record<string, string>)['--on-accent'];
    expect(on('#f2c94c')).toBe('#111111');
    expect(on('#2d2d8b')).toBe('#ffffff');
  });

  it('exposes layout options as data attributes', () => {
    expect(lookAttributes({ ...lookFromTemplate('canva'), library: 'right' })).toEqual({ 'data-library': 'right', 'data-timeline': 'medium', 'data-density': 'comfortable', 'data-light': 'true' });
    expect(lookAttributes(lookFromTemplate('capcut'))['data-light']).toBeUndefined();
  });

  it('colour helpers', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(alpha('#ff0000', 0.5)).toBe('rgba(255, 0, 0, 0.5)');
    expect(luminance('#ffffff')).toBeCloseTo(1);
    expect(luminance('#000000')).toBe(0);
  });
});
