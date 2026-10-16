import { describe, expect, it } from 'vitest';
import { buildAutoEdit, defaultOptions, findShots, parsePrompt, planAutoEdit } from './autoedit';
import type { ClipAnalysis } from './autoedit';
import { createProject } from './timeline';
import type { MediaAsset } from './types';

const R = 4;
/** A clip described by functions of time. */
function clip(id: string, seconds: number, f: { motion?: (t: number) => number; quality?: (t: number) => number; loud?: (t: number) => number; shots?: number[] } = {}): ClipAnalysis {
  const n = seconds * R;
  const arr = (fn: (t: number) => number) => Array.from({ length: n }, (_, i) => fn(i / R));
  return { assetId: id, name: id, kind: 'video', duration: seconds, rate: R, motion: arr(f.motion ?? (() => 0.05)), quality: arr(f.quality ?? (() => 0.7)), loud: arr(f.loud ?? (() => 0.3)), shots: f.shots ?? [] };
}
const beatsAt = (bpm: number, seconds: number) => Array.from({ length: Math.floor((seconds * bpm) / 60) }, (_, i) => (i * 60) / bpm);

describe('auto edit: understanding a request', () => {
  it('reads style, length, shape, colour, pace and title', () => {
    const { options, understood } = parsePrompt('Make a 30 second energetic travel video for TikTok with warm colours called "Lisbon 2026"');
    expect(options.style).toBe('travel');
    expect(options.length).toBe(30);
    expect(options.shape).toBe('9:16');
    expect(options.look).toBe('golden-hour');
    expect(options.pace).toBeGreaterThan(1);
    expect(options.title).toBe('Lisbon 2026');
    expect(understood.length).toBeGreaterThanOrEqual(5);
  });
  it('knows minutes, YouTube and talking videos', () => {
    const { options } = parsePrompt('a 2 min youtube tutorial with captions');
    expect([options.style, options.length, options.shape, options.captions]).toEqual(['tutorial', 120, '16:9', true]);
  });
});

describe('auto edit: picking moments', () => {
  it('finds shot changes', () => {
    const m = Array.from({ length: 40 }, (_, i) => (i === 20 ? 0.5 : 0.03));
    expect(findShots(m, 4)).toEqual([5]);
  });

  it('cuts on the beat, fills the length and skips blurry parts', () => {
    const a = clip('a', 30, { quality: (t) => (t < 10 ? 0.1 : 0.8), motion: (t) => (t > 20 ? 0.2 : 0.05) });
    const b = clip('b', 30, { shots: [12] });
    const beats = beatsAt(120, 60);
    const plan = planAutoEdit([a, b], { ...defaultOptions('hype'), length: 12 }, beats, 3);
    expect(plan.length).toBeGreaterThan(11);
    expect(plan.length).toBeLessThan(12.6);
    expect(plan.beat).toBeCloseTo(0.5);
    for (const s of plan.segments) {
      // Every cut is a whole number of beats (except possibly the last one).
      if (s !== plan.segments[plan.segments.length - 1]) expect(Math.abs((s.out - s.in) / 0.5 - Math.round((s.out - s.in) / 0.5))).toBeLessThan(1e-6);
      if (s.assetId === 'a') expect(s.in).toBeGreaterThanOrEqual(10); // never the blurry start
      if (s.assetId === 'b') expect(s.in >= 12 - 1e-9 || s.out <= 12 + 1e-9).toBe(true); // never across the shot change
    }
    expect(plan.segments[0].reason).toMatch(/^Hook/);
    expect(new Set(plan.segments.map((s) => s.assetId)).size).toBe(2);
  });

  it('gives a different edit when asked to try again', () => {
    const clips = [clip('a', 40, { motion: (t) => 0.05 + 0.04 * Math.sin(t) }), clip('b', 40, { motion: (t) => 0.05 + 0.04 * Math.cos(t) })];
    const one = planAutoEdit(clips, { ...defaultOptions('travel'), length: 15 }, [], 1);
    const two = planAutoEdit(clips, { ...defaultOptions('travel'), length: 15 }, [], 2);
    expect(JSON.stringify(one.segments)).not.toBe(JSON.stringify(two.segments));
  });

  it('keeps speech and cuts pauses for talking videos', () => {
    const talk = clip('talk', 20, { loud: (t) => (t % 5 < 3 ? 0.8 : 0.01) });
    const plan = planAutoEdit([talk], defaultOptions('tutorial'));
    expect(plan.segments.length).toBe(4);
    expect(plan.length).toBeGreaterThan(11);
    expect(plan.length).toBeLessThan(14);
    expect(plan.notes.join(' ')).toMatch(/pauses/);
  });
});

describe('auto edit: building the video', () => {
  it('builds a styled timeline with music cut to length', () => {
    const assets: MediaAsset[] = [
      { id: 'a', kind: 'video', name: 'a', url: '', duration: 30, width: 1920, height: 1080 },
      { id: 'song', kind: 'audio', name: 'song', url: '', duration: 180 },
    ];
    const plan = planAutoEdit([clip('a', 30)], { ...defaultOptions('cinematic'), length: 20, musicAssetId: 'song', title: 'My film' }, beatsAt(100, 180), 1);
    const { project } = buildAutoEdit(createProject(), plan, assets);
    expect([project.width, project.height]).toEqual([1280, 720]);
    expect(project.clips.length).toBe(plan.segments.length);
    expect(project.clips.slice(1).every((c) => c.transition?.type === 'fade')).toBe(true);
    expect(project.clips[0].grade?.look).toBe('cinematic');
    expect(project.texts[0].text).toBe('My film');
    expect(project.effects.map((e) => e.type)).toEqual(['letterbox', 'grain']);
    const music = project.audio[0];
    expect(music.assetId).toBe('song');
    expect(music.out - music.in).toBeLessThanOrEqual(plan.length + 0.01);
  });

  it('frames a landscape clip in a vertical video with a blurred fill', () => {
    const assets: MediaAsset[] = [{ id: 'a', kind: 'video', name: 'a', url: '', duration: 30, width: 1920, height: 1080 }];
    const plan = planAutoEdit([clip('a', 30)], { ...defaultOptions('hype'), length: 8 }, [], 1);
    const { project } = buildAutoEdit(createProject(), plan, assets);
    expect([project.width, project.height, project.fill]).toEqual([720, 1280, 'blur']);
    expect(project.clips[0].keys?.scale?.[0].v).toBeCloseTo(1.1);
  });
});
