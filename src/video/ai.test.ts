import { describe, expect, it } from 'vitest';
import { cutClip, findSilences, keepRanges, loudness, motionScore, pickHighlights, segmentsToCaptions, toProjectTime } from './ai';
import { floatToWav } from '../lib/aiService';
import type { Clip } from './types';

/** Tone where `on(t)` is true, silence elsewhere. */
function signal(seconds: number, rate: number, on: (t: number) => boolean) {
  const s = new Float32Array(seconds * rate);
  for (let i = 0; i < s.length; i++) s[i] = on(i / rate) ? 0.5 * Math.sin((2 * Math.PI * 220 * i) / rate) : 0.001 * Math.sin(i);
  return s;
}

const clip = (patch: Partial<Clip> = {}): Clip =>
  ({ id: 'c1', assetId: 'a', in: 0, out: 6, speed: 1, volume: 1, fadeIn: 0.3, fadeOut: 0.5, filters: {} as Clip['filters'], ...patch }) as Clip;

describe('silence removal', () => {
  const rate = 8000;
  const s = signal(6, rate, (t) => t < 1 || (t >= 2.5 && t < 3.5) || t >= 5);
  const env = loudness(s, rate, 50);

  it('measures loudness per slice', () => {
    expect(env).toHaveLength(300);
    expect(env[10]).toBeGreaterThan(0.3);
    expect(env[100]).toBeLessThan(0.01);
  });

  it('finds the pauses, leaving a little air next to speech', () => {
    const quiet = findSilences(env, 50, { pad: 0.1 });
    expect(quiet).toHaveLength(2);
    expect(quiet[0].start).toBeCloseTo(1.1, 1);
    expect(quiet[0].end).toBeCloseTo(2.4, 1);
    expect(quiet[1].start).toBeCloseTo(3.6, 1);
  });

  it('ignores pauses shorter than the minimum', () => {
    expect(findSilences(env, 50, { minSilence: 2 })).toHaveLength(0);
  });

  it('cuts a clip into the parts that are kept', () => {
    const pieces = cutClip(clip(), [{ start: 1.1, end: 2.4 }, { start: 3.6, end: 4.9 }]);
    expect(pieces.map((p) => [p.in, p.out])).toEqual([[0, 1.1], [2.4, 3.6], [4.9, 6]]);
    expect(pieces[0].id).toBe('c1');
    expect(new Set(pieces.map((p) => p.id)).size).toBe(3);
    expect(pieces[0].fadeIn).toBe(0.3);
    expect(pieces[0].fadeOut).toBe(0);
    expect(pieces[2].fadeOut).toBe(0.5);
  });

  it('keeps ranges outside the cuts within the clip', () => {
    expect(keepRanges(1, 5, [{ start: 0, end: 2 }, { start: 4, end: 9 }])).toEqual([{ start: 2, end: 4 }]);
  });
});

describe('auto shorts', () => {
  it('picks the liveliest windows in time order', () => {
    const score = Array.from({ length: 100 }, (_, i) => (i >= 20 && i < 35 ? 1 : i >= 70 && i < 85 ? 0.8 : 0.1));
    const picks = pickHighlights(score, 5, 6, 3);
    expect(picks).toHaveLength(2);
    expect(picks[0].start).toBeCloseTo(4);
    expect(picks[1].start).toBeCloseTo(14);
  });

  it('uses the whole video when it is already short', () => {
    expect(pickHighlights([1, 1, 1, 1, 1], 5, 30)).toEqual([{ start: 0, end: 1 }]);
  });

  it('scores movement between frames', () => {
    const f = (v: number) => ({ data: new Float32Array(4).fill(v) });
    const m = motionScore([f(0), f(0), f(255)]);
    expect(m).toEqual([0, 0, 1]);
  });
});

describe('speech to captions', () => {
  it('splits long segments into readable captions', () => {
    const caps = segmentsToCaptions([{ start: 0, end: 4, text: ' Hello there everyone, this is a much longer sentence that needs splitting into parts ' }], 30);
    expect(caps.length).toBeGreaterThan(2);
    expect(caps.every((c) => c.text.length <= 30)).toBe(true);
    expect(caps[0].start).toBe(0);
    expect(caps[caps.length - 1].end).toBeCloseTo(4);
  });

  it('moves captions from source time to the timeline (trim and speed)', () => {
    const out = toProjectTime([{ start: 1, end: 3, text: 'a' }, { start: 9, end: 10, text: 'gone' }], { in: 2, out: 6, speed: 2 }, 10);
    expect(out).toEqual([{ start: 10, end: 10.5, text: 'a' }]);
  });

  it('writes a mono WAV for speech services', () => {
    const wav = new DataView(floatToWav(new Float32Array([0, 1, -1]), 16000));
    expect(wav.getUint32(24, true)).toBe(16000);
    expect(wav.getInt16(46, true)).toBe(32767);
    expect(wav.byteLength).toBe(50);
  });
});
