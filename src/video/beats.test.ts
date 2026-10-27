import { describe, expect, it } from 'vitest';
import { detectBeats, snapToBeat } from './beats';

/** A drum loop: a short click every beat (with a softer off-beat) over quiet noise. */
function loop(bpm: number, seconds: number, offset = 0, rate = 8000) {
  const s = new Float32Array(seconds * rate);
  let seed = 1;
  for (let i = 0; i < s.length; i++) s[i] = ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.02;
  const period = 60 / bpm;
  for (let k = 0; offset + (k * period) / 2 < seconds; k++) {
    const t = offset + (k * period) / 2;
    const strong = k % 2 === 0;
    const at = Math.round(t * rate);
    for (let j = 0; j < rate * 0.03 && at + j < s.length; j++) s[at + j] += (strong ? 0.8 : 0.3) * Math.exp(-j / (rate * 0.008)) * Math.sin(j * 0.6);
  }
  return s;
}

describe('beat detection', () => {
  it('finds the tempo and beat times of a 120 BPM loop', () => {
    const g = detectBeats(loop(120, 12, 0.25), 8000);
    expect(g.bpm).toBeGreaterThan(117);
    expect(g.bpm).toBeLessThan(123);
    // Beats line up with the clicks (every 0.5 s from 0.25 s).
    const near = g.beats.filter((b) => b > 1 && b < 11).every((b) => Math.abs(((b - 0.25) / 0.5) % 1) < 0.08 || Math.abs(((b - 0.25) / 0.5) % 1) > 0.92);
    expect(near).toBe(true);
    expect(g.confidence).toBeGreaterThan(0.2);
  });

  it('finds a faster tempo', () => {
    const g = detectBeats(loop(150, 12), 8000);
    expect(Math.abs(g.bpm - 150)).toBeLessThan(4);
  });

  it('finds tempos across the usual range', () => {
    // Half or double time is fine for cutting (cuts still land on beats); 1.5× would not be.
    for (const bpm of [90, 100, 128, 140, 170]) {
      const found = detectBeats(loop(bpm, 14), 8000).bpm;
      expect(Math.min(...[1, 2, 0.5].map((m) => Math.abs(found - bpm * m) / (bpm * m))), `${bpm} → ${found}`).toBeLessThan(0.04);
    }
  });

  it('has low confidence for noise', () => {
    const n = new Float32Array(8000 * 8);
    let seed = 7;
    for (let i = 0; i < n.length; i++) n[i] = ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.3;
    expect(detectBeats(n, 8000).confidence).toBeLessThan(0.3);
  });

  it('snaps times to the nearest beat', () => {
    expect(snapToBeat(1.1, [0, 0.5, 1, 1.5])).toBe(1);
    expect(snapToBeat(3, [])).toBe(3);
  });
});
