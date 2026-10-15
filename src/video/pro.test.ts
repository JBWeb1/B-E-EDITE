import { describe, expect, it } from 'vitest';
import {
  applyPreset,
  ease,
  EASINGS,
  keyTimes,
  neighbourKey,
  presetKeys,
  rampRate,
  rampWarp,
  RAMPS,
  removeKey,
  setAllEasing,
  setKey,
  sliceKeys,
  sourceTimeAt,
  transformAt,
  valueAt,
  wiggle,
} from './anim';
import { audioPlan, denoiseFilters, encodeWavChannels, EXPORT_PRESETS, outputSize, presetFits, suggestedBitrate, watermarkBox } from './export';
import { gradeFilterMarkup, gradeId, hueDirection, isNeutral, lookTables, NEUTRAL_GRADE, wheelParams } from './grade';
import { despill, hexToRgb, keyAlpha, rgbToHex } from './keyer';
import { blendOp, blurSamples, clipFrame, cropRect, hitFrame, overlayFrame } from './layers';
import { hash01, particlesAt } from './particles';
import type { ParticleKind } from './particles';
import { currentWord, letterState, wordTiming, wrapWords } from './textfx';
import { createClip, createOverlay, createProject, freeTrack, locate, overlayTracks, splitClips, trimAtPlayhead } from './timeline';
import type { Clip, MediaAsset } from './types';

const video = (duration: number, id = 'v'): MediaAsset => ({ id, kind: 'video', name: id, url: '', duration, width: 1920, height: 1080 });

describe('easing', () => {
  it('every easing starts at 0 and ends at 1', () => {
    for (const { value } of EASINGS) {
      expect(ease(value, 0)).toBeCloseTo(0, 5);
      expect(ease(value, 1)).toBeCloseTo(1, 5);
    }
  });
  it('hold jumps at the end; smooth is halfway in the middle', () => {
    expect(ease('hold', 0.99)).toBe(0);
    expect(ease('smooth', 0.5)).toBeCloseTo(0.5);
    expect(ease('ease-in', 0.5)).toBeLessThan(0.5);
    expect(ease('ease-out', 0.5)).toBeGreaterThan(0.5);
  });
});

describe('keyframes', () => {
  it('interpolates between keyframes and holds outside them', () => {
    const keys = [
      { t: 1, v: 0, ease: 'linear' as const },
      { t: 3, v: 10 },
    ];
    expect(valueAt(keys, 0, 99)).toBe(0);
    expect(valueAt(keys, 2, 99)).toBeCloseTo(5);
    expect(valueAt(keys, 5, 99)).toBe(10);
    expect(valueAt(undefined, 2, 7)).toBe(7);
  });
  it('setKey replaces a keyframe at the same time and keeps order', () => {
    let k = setKey(undefined, 2, 1);
    k = setKey(k, 0.5, 3);
    k = setKey(k, 2.001, 5);
    expect(k.map((x) => x.t)).toEqual([0.5, 2.001]);
    expect(k[1].v).toBe(5);
    expect(removeKey(k, 0.5).length).toBe(1);
  });
  it('lists keyframe times across properties and finds neighbours', () => {
    const kf = { x: setKey(setKey(undefined, 0, 0), 2, 1), opacity: setKey(undefined, 1, 0.5) };
    expect(keyTimes(kf)).toEqual([0, 1, 2]);
    expect(neighbourKey(kf, 1, 1)).toBe(2);
    expect(neighbourKey(kf, 1, -1)).toBe(0);
    expect(neighbourKey(kf, 2, 1)).toBeNull();
  });
  it('setAllEasing changes every keyframe', () => {
    const kf = setAllEasing({ x: [{ t: 0, v: 0 }, { t: 1, v: 1 }] }, 'bounce');
    expect(kf.x!.every((k) => k.ease === 'bounce')).toBe(true);
  });
  it('sliceKeys keeps each half of a split animation looking the same', () => {
    const kf = { x: [{ t: 0, v: 0, ease: 'linear' as const }, { t: 4, v: 1 }] };
    const left = sliceKeys(kf, 0, 2)!;
    const right = sliceKeys(kf, 2, Infinity)!;
    expect(valueAt(left.x, 1, 0)).toBeCloseTo(0.25);
    expect(valueAt(right.x, 0, 0)).toBeCloseTo(0.5);
    expect(valueAt(right.x, 2, 0)).toBeCloseTo(1);
  });
});

describe('layer transforms, wiggle and presets', () => {
  it('uses base values, then keyframes', () => {
    const tr = transformAt({ x: 0.2, keys: { scale: [{ t: 0, v: 1, ease: 'linear' }, { t: 2, v: 2 }] } }, 1);
    expect(tr.x).toBe(0.2);
    expect(tr.scale).toBeCloseTo(1.5);
    expect(tr.opacity).toBe(1);
  });
  it('wiggle is smooth, bounded and repeatable', () => {
    expect(wiggle(3, 1.234, 2)).toBe(wiggle(3, 1.234, 2));
    for (let t = 0; t < 5; t += 0.07) expect(Math.abs(wiggle(1, t, 3))).toBeLessThanOrEqual(1.0001);
    const tr = transformAt({ wiggle: { amount: 1, speed: 2 } }, 0.3, 5);
    expect(tr.x).not.toBe(0.5);
  });
  it('presets write keyframes that start and end where expected', () => {
    const t0 = { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 };
    const fade = presetKeys('fade-in', 3, t0);
    expect(valueAt(fade.opacity, 0, 1)).toBe(0);
    expect(valueAt(fade.opacity, 3, 0)).toBe(1);
    const slide = presetKeys('slide-left', 3, t0);
    expect(valueAt(slide.x, 0, 0)).toBeGreaterThan(1);
    expect(valueAt(slide.x, 3, 0)).toBe(0.5);
    const merged = applyPreset({ rotation: [{ t: 0, v: 10 }] }, fade);
    expect(Object.keys(merged).sort()).toEqual(['opacity', 'rotation']);
  });
});

describe('speed ramps and reverse', () => {
  it('every ramp starts at 0, ends at 1 and never runs backwards', () => {
    for (const { value } of RAMPS) {
      expect(rampWarp(value, 0)).toBeCloseTo(0);
      expect(rampWarp(value, 1)).toBeCloseTo(1);
      let prev = -1;
      for (let u = 0; u <= 1.0001; u += 0.01) {
        const w = rampWarp(value, u);
        expect(w).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = w;
        expect(rampRate(value, u)).toBeGreaterThan(0);
      }
    }
  });
  it('hero is slow in the middle, flash-in fast at the start', () => {
    expect(rampRate('hero', 0.5)).toBeLessThan(0.5);
    expect(rampRate('hero', 0)).toBeGreaterThan(1.5);
    expect(rampRate('flash-in', 0)).toBeGreaterThan(rampRate('flash-in', 1));
  });
  it('sourceTimeAt handles speed, ramps and reverse', () => {
    const c = { in: 2, out: 6, speed: 2 };
    expect(sourceTimeAt(c, 1)).toBeCloseTo(4);
    expect(sourceTimeAt({ ...c, reverse: true }, 0)).toBeCloseTo(6);
    expect(sourceTimeAt({ ...c, reverse: true }, 2)).toBeCloseTo(2);
    expect(sourceTimeAt({ ...c, ramp: 'hero' }, 1)).toBeCloseTo(4);
  });
  it('locate, split and Q/W follow a reversed clip', () => {
    const clip: Clip = { ...createClip(video(10)), reverse: true };
    expect(locate([clip], 2)!.sourceTime).toBeCloseTo(8);
    const [a, b] = splitClips([clip], 2);
    expect([a.in, a.out]).toEqual([8, 10]);
    expect([b.in, b.out]).toEqual([0, 8]);
    // Q removes what was already shown (the end of the source).
    expect(trimAtPlayhead([clip], 2, 'before')[0]).toMatchObject({ in: 0, out: 8 });
    expect(trimAtPlayhead([clip], 2, 'after')[0]).toMatchObject({ in: 8, out: 10 });
  });
  it('split keeps keyframes on both halves', () => {
    const clip: Clip = { ...createClip(video(10)), keys: { opacity: [{ t: 0, v: 0, ease: 'linear' }, { t: 10, v: 1 }] } };
    const [a, b] = splitClips([clip], 5);
    expect(valueAt(a.keys!.opacity, 5, 9)).toBeCloseTo(0.5);
    expect(valueAt(b.keys!.opacity, 0, 9)).toBeCloseTo(0.5);
  });
});

describe('video tracks', () => {
  it('puts overlapping layers on the next free track', () => {
    const a = { ...createOverlay(video(5, 'a'), 0), track: 2 };
    const b = { ...createOverlay(video(5, 'b'), 3), track: 3 };
    expect(freeTrack([a], 2, 4)).toBe(3);
    expect(freeTrack([a], 6, 8)).toBe(2);
    expect(freeTrack([a, b], 3.5, 4)).toBe(4);
    expect(overlayTracks([b, a, { ...a, id: 'c' }])).toEqual([2, 3]);
  });
});

describe('colour grading', () => {
  it('a neutral grade changes nothing', () => {
    expect(isNeutral(NEUTRAL_GRADE)).toBe(true);
    expect(isNeutral(undefined)).toBe(true);
    for (const c of wheelParams(NEUTRAL_GRADE)) expect(c).toEqual({ amplitude: 1, exponent: 1, offset: 0 });
  });
  it('hue directions sum to zero (tints without changing brightness)', () => {
    for (const h of [0, 45, 120, 200, 300]) {
      const [r, g, b] = hueDirection(h);
      expect(r + g + b).toBeCloseTo(0);
    }
  });
  it('warm highlights raise red and lower blue', () => {
    const g = { ...NEUTRAL_GRADE, highlights: { hue: 0, amount: 1, luma: 0 } };
    const [r, , b] = wheelParams(g);
    expect(r.amplitude).toBeGreaterThan(1);
    expect(b.amplitude).toBeLessThan(1);
  });
  it('look strength blends with "no change"', () => {
    expect(lookTables('noir', 0)).toMatchObject({ r: [0, 0.25, 0.5, 0.75, 1], saturate: 1 });
    expect(lookTables('noir', 1).saturate).toBe(0);
  });
  it('filter markup has a stable id and the right parts', () => {
    const g = { ...NEUTRAL_GRADE, look: 'teal-orange' as const, midtones: { hue: 200, amount: 0.4, luma: 0.1 } };
    const m = gradeFilterMarkup(g);
    expect(m).toContain(`id="${gradeId(g)}"`);
    expect(m).toContain('type="table"');
    expect(m).toContain('type="gamma"');
    expect(gradeId(g)).toBe(gradeId({ ...g }));
    expect(gradeId(g)).not.toBe(gradeId(NEUTRAL_GRADE));
  });
});

describe('green screen', () => {
  const green = hexToRgb('#00b140');
  it('removes the key colour, keeps skin tones and white', () => {
    expect(keyAlpha(green[0], green[1], green[2], green, 0.28, 0.1)).toBe(0);
    expect(keyAlpha(0.85, 0.65, 0.55, green, 0.28, 0.1)).toBe(1);
    expect(keyAlpha(1, 1, 1, green, 0.28, 0.1)).toBe(1);
  });
  it('keys darker shades of the same green (shadows on the screen)', () => {
    expect(keyAlpha(0, green[1] * 0.6, green[2] * 0.6, green, 0.28, 0.1)).toBeLessThan(0.5);
  });
  it('despill pulls green down to the other channels', () => {
    const [r, g, b] = despill(0.5, 0.8, 0.4, green, 1);
    expect(g).toBeCloseTo(0.5);
    expect([r, b]).toEqual([0.5, 0.4]);
    expect(despill(0.5, 0.8, 0.4, green, 0)).toEqual([0.5, 0.8, 0.4]);
  });
  it('hex helpers round-trip', () => {
    expect(rgbToHex(0, 177, 64)).toBe('#00b140');
    expect(hexToRgb('#ff0000')).toEqual([1, 0, 0]);
  });
});

describe('particles', () => {
  const kinds: ParticleKind[] = ['confetti', 'snow', 'sparkles', 'hearts', 'dust', 'bubbles'];
  it('are deterministic and stay near the frame', () => {
    for (const k of kinds) {
      const a = particlesAt(k, 2.5, 0.7, 1);
      expect(a).toEqual(particlesAt(k, 2.5, 0.7, 1));
      expect(a.length).toBeGreaterThan(5);
      for (const p of a) {
        expect(p.y).toBeGreaterThan(-0.2);
        expect(p.y).toBeLessThan(1.25);
        expect(p.alpha).toBeGreaterThanOrEqual(0);
        expect(p.alpha).toBeLessThanOrEqual(1);
      }
    }
  });
  it('more strength means more particles; they move over time', () => {
    expect(particlesAt('snow', 1, 1).length).toBeGreaterThan(particlesAt('snow', 1, 0.2).length);
    expect(particlesAt('confetti', 1)[0].y).not.toBe(particlesAt('confetti', 1.5)[0].y);
    expect(hash01(3, 4)).toBe(hash01(3, 4));
  });
});

describe('text animation timing', () => {
  it('word timing covers the whole caption in order', () => {
    const w = wordTiming('hello big wide world', 4);
    expect(w.map((x) => x.word)).toEqual(['hello', 'big', 'wide', 'world']);
    expect(w[0].start).toBe(0);
    expect(w[3].end).toBeCloseTo(4);
    for (let i = 1; i < w.length; i++) expect(w[i].start).toBeCloseTo(w[i - 1].end);
    expect(currentWord(w, 0)).toBe(0);
    expect(currentWord(w, 3.99)).toBe(3);
    expect(currentWord(w, 10)).toBe(3);
  });
  it('wraps words into lines by width', () => {
    const lines = wrapWords(['aa', 'bb', 'cc', 'dd'], 5, (s) => s.length);
    expect(lines).toEqual([[0, 1], [2, 3]]);
  });
  it('typewriter reveals letters over time, others settle to normal', () => {
    const visibleAt = (t: number) => Array.from({ length: 10 }, (_, i) => letterState('typewriter', i, 10, t, 3).visible).filter(Boolean).length;
    expect(visibleAt(0)).toBe(0);
    expect(visibleAt(0.3)).toBeGreaterThan(0);
    expect(visibleAt(3)).toBe(10);
    for (const a of ['bounce', 'rise', 'zoom', 'fade-letters', 'spin'] as const) {
      const s = letterState(a, 3, 10, 2.9, 3);
      expect(s.alpha).toBeCloseTo(1);
      expect(Math.abs(s.dy)).toBeLessThan(0.01);
    }
  });
});

describe('export', () => {
  it('output size keeps the shape and uses even numbers', () => {
    expect(outputSize({ width: 1280, height: 720 }, 2160)).toEqual({ width: 3840, height: 2160 });
    expect(outputSize({ width: 720, height: 1280 }, 1080)).toEqual({ width: 1080, height: 1920 });
    expect(outputSize({ width: 1080, height: 1350 }, 1080)).toEqual({ width: 1080, height: 1350 });
    const odd = outputSize({ width: 1000, height: 333 }, 721);
    expect(odd.width % 2 + odd.height % 2).toBe(0);
  });
  it('presets fit matching shapes only', () => {
    const tiktok = EXPORT_PRESETS.find((p) => p.id === 'tiktok')!;
    expect(presetFits(tiktok, { width: 720, height: 1280 })).toBe(true);
    expect(presetFits(tiktok, { width: 1280, height: 720 })).toBe(false);
  });
  it('bitrate grows with size and frame rate', () => {
    expect(suggestedBitrate(3840, 2160, 30)).toBeGreaterThan(suggestedBitrate(1920, 1080, 30));
    expect(suggestedBitrate(1920, 1080, 60)).toBeGreaterThan(suggestedBitrate(1920, 1080, 30));
  });
  it('places the watermark inside the frame', () => {
    const br = watermarkBox('bottom-right', 100, 20, 1000, 500);
    expect(br.x + 100).toBeLessThan(1000);
    expect(br.y + 20).toBeLessThan(500);
    expect(watermarkBox('center', 100, 20, 1000, 500)).toEqual({ x: 450, y: 240 });
  });
  it('audio plan includes clip sound, music and volume keyframes; skips muted tracks', () => {
    const p = createProject();
    const v = video(4);
    const music: MediaAsset = { id: 'm', kind: 'audio', name: 'm', url: '', duration: 10 };
    p.assets = [v, music];
    p.clips = [{ ...createClip(v), keys: { volume: [{ t: 0, v: 0, ease: 'linear' }, { t: 4, v: 1 }] } }];
    p.audio = [{ id: 'a', assetId: 'm', start: 1, in: 0, out: 3, volume: 0.5 }];
    const plan = audioPlan(p);
    expect(plan.length).toBe(2);
    expect(plan[0].gain[0][1]).toBe(0);
    expect(plan[0].gain[plan[0].gain.length - 1][1]).toBeCloseTo(1);
    expect(plan[1]).toMatchObject({ at: 1, offset: 0, duration: 3 });
    expect(audioPlan({ ...p, tracks: { mainMuted: true, audioMuted: true } })).toEqual([]);
  });
  it('noise reduction gets stronger with each level', () => {
    expect(denoiseFilters(0).highpass).toBeLessThan(denoiseFilters(3).highpass);
    expect(denoiseFilters(3).lowpass).toBeLessThan(denoiseFilters(1).lowpass);
  });
  it('writes a valid stereo WAV header', () => {
    const buf = encodeWavChannels([new Float32Array([0, 1]), new Float32Array([0, -1])], 44100);
    const v = new DataView(buf);
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(40, true)).toBe(8);
    // Interleaved: frame 0 (L, R) at 44 and 46, frame 1 (L, R) at 48 and 50.
    expect(v.getInt16(48, true)).toBe(32767);
    expect(v.getInt16(50, true)).toBe(-32768);
  });
});

describe('layer geometry', () => {
  it('crops the source', () => {
    expect(cropRect(100, 50, { left: 0.1, right: 0.1, top: 0, bottom: 0.2 })).toEqual({ sx: 10, sy: 0, sw: 80, sh: 40 });
  });
  it('fits clips into the frame and applies their transform', () => {
    const c = createClip(video(4));
    const f = clipFrame(c, { width: 1920, height: 1080 }, 1280, 720, 0, 0);
    expect(f).toMatchObject({ cx: 640, cy: 360, w: 1280, h: 720 });
    const moved = clipFrame({ ...c, x: 0.25, scale: 0.5, rotation: 30 }, { width: 1920, height: 1080 }, 1280, 720, 0, 0);
    expect(moved).toMatchObject({ cx: 320, w: 640, rotation: 30 });
  });
  it('hit-tests rotated layers', () => {
    const o = { ...createOverlay(video(4), 0), x: 0.5, y: 0.5, scale: 0.5, rotation: 90 };
    const f = overlayFrame(o, { width: 1920, height: 1080 }, 1000, 1000, 0);
    // 500 wide × 281 tall, turned on its side: tall and narrow.
    expect(hitFrame(f, 500, 260)).toBe(true);
    expect(hitFrame(f, 300, 500)).toBe(false);
  });
  it('maps blend modes and motion blur sample times', () => {
    expect(blendOp('add')).toBe('lighter');
    expect(blendOp(undefined)).toBe('source-over');
    const s = blurSamples(1, 30, 4);
    expect(s[0]).toBe(1);
    expect(s[3]).toBeCloseTo(1 - 1 / 60);
  });
});
