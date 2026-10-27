import { describe, expect, it } from 'vitest';
import { envelope, levelAt, matteToMask, reactAt, reactSources } from './react';
import { createAudioClip, createClip } from './timeline';
import type { MediaAsset } from './types';

const song: MediaAsset = { id: 's', kind: 'audio', name: 's', url: '', duration: 10 };
const vid: MediaAsset = { id: 'v', kind: 'video', name: 'v', url: '', duration: 10 };

describe('audio-reactive', () => {
  it('follows hits quickly and lets go gently', () => {
    const rate = 8000;
    const samples = new Float32Array(rate * 2);
    for (let i = rate / 2; i < rate / 2 + rate / 10; i++) samples[i] = Math.sin(i / 3); // one 0.1 s hit at 0.5 s
    const env = envelope(samples, rate);
    expect(env[24]).toBeLessThan(0.05);
    expect(env[27]).toBeGreaterThan(0.9);
    expect(env[33]).toBeGreaterThan(0.2); // still fading out after the hit
    expect(env[60]).toBeLessThan(0.05);
  });
  it('reads the music at the right moment, or the clips when there is none', () => {
    const envs = new Map([['s', Float32Array.from({ length: 500 }, (_, i) => i / 500)], ['v', Float32Array.from({ length: 500 }, () => 0.3)]]);
    const audio = [{ ...createAudioClip(song, 2), in: 1 }];
    expect(levelAt(3, audio, [], envs)).toBeCloseTo(2 / 10, 1); // 1 s into the clip at source 2 s
    expect(levelAt(1, audio, [], envs)).toBe(0);
    expect(levelAt(1, [], [createClip(vid)], envs)).toBeCloseTo(0.3);
    expect(reactSources([], [createClip(vid)], [vid])).toEqual(['v']);
  });
  it('turns the level into motion', () => {
    expect(reactAt({ prop: 'scale', amount: 1 }, 1, 0).scale).toBeCloseTo(1.35);
    expect(reactAt({ prop: 'bounce', amount: 0.5 }, 1, 0).dy).toBeCloseTo(-0.04);
    expect(reactAt({ prop: 'opacity', amount: 0.5 }, 0, 0).opacity).toBeCloseTo(0.25);
    expect(reactAt(undefined, 1, 0)).toMatchObject({ scale: 1, opacity: 1 });
  });
});

describe('track mattes', () => {
  it('builds masks from alpha or brightness', () => {
    const px = () => new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 0]);
    const a = px();
    matteToMask(a, 'alpha');
    expect([a[3], a[7], a[11]]).toEqual([255, 255, 0]);
    const inv = px();
    matteToMask(inv, 'alpha-inverted');
    expect([inv[3], inv[11]]).toEqual([0, 255]);
    const l = px();
    matteToMask(l, 'luma');
    expect([l[3], l[7]]).toEqual([255, 0]);
  });
});
