import { describe, expect, it } from 'vitest';
import { charsPerSecond, contrastRatio, findFlashes, hexLuminance, hookScore, luminance, overlap, SAFE_ZONES, slowStartLength, textBox } from './preflight';
import type { TextOverlay } from './types';

const text = (patch: Partial<TextOverlay>): TextOverlay =>
  ({ id: 't', text: 'Hello', start: 0, duration: 2, x: 0.5, y: 0.5, size: 0.08, color: '#ffffff', background: null, bold: true, animation: 'none', ...patch }) as TextOverlay;

describe('luminance and contrast', () => {
  it('matches WCAG for black and white', () => {
    expect(luminance(0, 0, 0)).toBe(0);
    expect(luminance(255, 255, 255)).toBeCloseTo(1);
    expect(contrastRatio(1, 0)).toBeCloseTo(21);
    expect(hexLuminance('#ffffff')).toBeCloseTo(1);
  });
});

describe('flash detection', () => {
  it('flags a strobe of 5 flashes a second', () => {
    const lum = Array.from({ length: 60 }, (_, i) => (Math.floor(i / 3) % 2 ? 0.9 : 0.05)); // 30 fps, flips every 0.1 s
    const ev = findFlashes(lum, 30);
    expect(ev.length).toBe(1);
    expect(ev[0].flashes).toBeGreaterThan(3);
  });

  it('ignores slow fades and a single flash', () => {
    const fade = Array.from({ length: 90 }, (_, i) => i / 90);
    expect(findFlashes(fade, 30)).toEqual([]);
    const once = Array.from({ length: 60 }, (_, i) => (i >= 20 && i < 24 ? 1 : 0.1));
    expect(findFlashes(once, 30)).toEqual([]);
  });

  it('ignores flicker between two bright states', () => {
    const bright = Array.from({ length: 60 }, (_, i) => (i % 2 ? 0.95 : 0.82));
    expect(findFlashes(bright, 30)).toEqual([]);
  });
});

describe('captions', () => {
  it('measures reading speed', () => {
    expect(charsPerSecond(text({ text: 'a'.repeat(50), duration: 2 }))).toBe(25);
  });
});

describe('safe zones', () => {
  const tiktok = SAFE_ZONES.find((z) => z.id === 'tiktok')!;
  it('finds text hidden under the TikTok caption area', () => {
    const box = textBox(text({ y: 0.9, size: 0.05 }), 1080, 1920);
    expect(Math.max(...tiktok.covered.map((c) => overlap(box, c)))).toBeGreaterThan(0.5);
  });
  it('leaves centred text alone', () => {
    const box = textBox(text({ y: 0.5 }), 1080, 1920);
    expect(Math.max(...tiktok.covered.map((c) => overlap(box, c)))).toBe(0);
  });
  it('measures overlap as a share of the first box', () => {
    expect(overlap({ x: 0, y: 0, w: 1, h: 1 }, { x: 0.5, y: 0, w: 1, h: 1 })).toBeCloseTo(0.5);
  });
});

describe('hook score', () => {
  const strong = { motion: 0.1, firstText: 0.2, openingLoudness: 0.8, firstCut: 2, firstFrameLuminance: 0.3, slowStart: 0, duration: 20, vertical: true };
  it('rewards a strong opening', () => {
    const r = hookScore(strong);
    expect(r.score).toBeGreaterThanOrEqual(95);
    expect(r.findings.every((f) => f.severity === 'ok')).toBe(true);
  });
  it('explains a weak opening with fixes', () => {
    const r = hookScore({ ...strong, motion: 0, firstText: null, openingLoudness: 0, firstCut: null, slowStart: 2 });
    expect(r.score).toBeLessThan(25);
    expect(r.findings.find((f) => f.id === 'hook-text')?.fix).toBe('add-hook-title');
    expect(r.findings.find((f) => f.id === 'hook-start')?.fix).toBe('trim-slow-start');
  });
  it('measures a slow start', () => {
    expect(slowStartLength([0, 0, 0, 0.2, 0.2], [0, 0, 0, 0.5, 0.5], 2)).toBe(1.5);
  });
});
