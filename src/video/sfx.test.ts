import { describe, expect, it } from 'vitest';
import { encodeWav, SAMPLE_RATE, SFX_CATEGORIES, SOUND_EFFECTS } from './sfx';

describe('sound effects', () => {
  it('has unique ids and known categories', () => {
    const ids = SOUND_EFFECTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SOUND_EFFECTS) expect(SFX_CATEGORIES).toContain(s.category);
    expect(SOUND_EFFECTS.length).toBeGreaterThanOrEqual(15);
  });

  for (const fx of SOUND_EFFECTS) {
    it(`${fx.name} renders clean, audible, click-free audio`, () => {
      const s = fx.render();
      expect(s.length).toBe(Math.round(fx.duration * SAMPLE_RATE));
      let peak = 0;
      for (const v of s) {
        expect(Number.isFinite(v)).toBe(true);
        peak = Math.max(peak, Math.abs(v));
      }
      expect(peak).toBeGreaterThan(0.5); // normalised, so clearly audible
      expect(peak).toBeLessThanOrEqual(0.9001); // never clips
      expect(Math.abs(s[0])).toBeLessThan(0.01); // faded in…
      expect(Math.abs(s[s.length - 1])).toBeLessThan(0.01); // …and out
    });
  }

  it('renders the same sound every time', () => {
    const fx = SOUND_EFFECTS.find((s) => s.id === 'applause')!;
    expect(fx.render()).toEqual(fx.render());
  });
});

describe('encodeWav', () => {
  it('writes a valid 16-bit mono PCM header and samples', () => {
    const wav = new DataView(encodeWav(new Float32Array([0, 1, -1, 0.5]), 8000));
    const str = (at: number, n: number) => String.fromCharCode(...Array.from({ length: n }, (_, i) => wav.getUint8(at + i)));
    expect(str(0, 4)).toBe('RIFF');
    expect(str(8, 4)).toBe('WAVE');
    expect(wav.getUint32(4, true)).toBe(36 + 8);
    expect(wav.getUint16(22, true)).toBe(1);
    expect(wav.getUint32(24, true)).toBe(8000);
    expect(wav.getUint16(34, true)).toBe(16);
    expect(wav.getUint32(40, true)).toBe(8);
    expect([0, 1, 2, 3].map((i) => wav.getInt16(44 + i * 2, true))).toEqual([0, 32767, -32768, 16383]);
  });
});
