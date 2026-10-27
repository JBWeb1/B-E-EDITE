import { describe, expect, it } from 'vitest';
import { applyRecipe, captionItems, describeRecipe, detectParts, extractRecipe, footageLength } from './recipes';
import { createAudioClip, createClip, createEffect, createProject, createTextOverlay } from './timeline';
import type { MediaAsset, VideoProject } from './types';

const video = (id: string, duration: number): MediaAsset => ({ id, kind: 'video', name: id, url: 'blob:' + id, duration, width: 1280, height: 720 });
const song: MediaAsset = { id: 'song', kind: 'audio', name: 'Song.mp3', url: 'blob:song', duration: 120 };
const whoosh: MediaAsset = { id: 'sfx-whoosh', kind: 'audio', name: 'Whoosh', url: 'blob:w', duration: 0.8, sfxId: 'whoosh' };

function source(): VideoProject {
  const a = video('a', 10);
  const b = video('b', 10);
  const p = createProject(720, 1280);
  return {
    ...p,
    fill: 'blur',
    assets: [a, b, song, whoosh],
    clips: [
      { ...createClip(a), filters: { brightness: 1.1, contrast: 1.2, saturation: 1.3, blur: 0, grayscale: 0 } },
      { ...createClip(b), transition: { type: 'zoom', duration: 0.6 } },
    ],
    texts: [
      createTextOverlay(0.2, { text: 'MY VLOG', y: 0.3, animator: 'rise' }),
      createTextOverlay(17, { text: 'SUBSCRIBE', template: 'subscribe' }),
      createTextOverlay(4, { text: 'first caption', y: 0.8, words: 'highlight', accent: '#ff0000' }),
      createTextOverlay(7, { text: 'second caption', y: 0.8, words: 'highlight', accent: '#ff0000' }),
    ],
    audio: [{ ...createAudioClip(song, 0), fadeOut: 2 }, createAudioClip(whoosh, 0.1)],
    effects: [createEffect('light-leak', 0), createEffect('vignette', 16)],
    watermark: { text: '@me', position: 'top-right', opacity: 0.8, size: 0.2 },
  };
}

describe('edit recipes', () => {
  it('finds captions by their repeated position', () => {
    expect(captionItems(source().texts).map((t) => t.text)).toEqual(['first caption', 'second caption']);
  });

  it('detects what can be saved', () => {
    const parts = detectParts(source());
    expect(Object.keys(parts).sort()).toEqual(['captions', 'effects', 'intro', 'look', 'music', 'outro', 'shape', 'transitions', 'watermark']);
    expect(parts.music).toBe('Song.mp3');
    expect(footageLength(source())).toBe(20);
  });

  it('replays a recipe on a different video', () => {
    const r = extractRecipe(source(), ['shape', 'intro', 'outro', 'captions', 'look', 'music', 'effects', 'transitions', 'watermark'], 'My style');
    expect(r.assets.map((a) => a.id).sort()).toEqual(['sfx-whoosh', 'song']);
    expect(describeRecipe(r).length).toBeGreaterThan(5);
    const c = video('c', 30);
    const d = video('d', 30);
    const target: VideoProject = {
      ...createProject(1280, 720),
      assets: [c, d],
      clips: [createClip(c), createClip(d)],
      texts: [createTextOverlay(2, { text: 'one', y: 0.9 }), createTextOverlay(5, { text: 'two', y: 0.9 })],
    };
    const out = applyRecipe(target, r, r.assets.map((a) => ({ ...a, url: 'blob:new-' + a.id })));
    expect([out.width, out.height, out.fill]).toEqual([720, 1280, 'blur']);
    expect(out.texts.find((t) => t.text === 'MY VLOG')?.start).toBeCloseTo(0.2);
    // The outro keeps its distance from the end: 3 s before the end of a 60 s video.
    expect(out.texts.find((t) => t.text === 'SUBSCRIBE')?.start).toBeCloseTo(57);
    expect(out.texts.find((t) => t.text === 'one')?.words).toBe('highlight');
    expect(out.texts.find((t) => t.text === 'one')?.accent).toBe('#ff0000');
    expect(out.clips.every((x) => x.filters.saturation === 1.3)).toBe(true);
    expect(out.clips[1].transition?.type).toBe('zoom');
    const music = out.audio.find((a) => a.assetId === 'song')!;
    expect(music.start).toBe(0);
    expect(music.out - music.in).toBe(60);
    expect(music.fadeOut).toBe(2);
    expect(out.effects.map((e) => [e.type, e.start])).toEqual([['light-leak', 0], ['vignette', 56]]);
    expect(out.watermark?.text).toBe('@me');
    expect(out.assets.find((a) => a.id === 'song')?.url).toBe('blob:new-song');
    // Fresh ids, so applying twice never clashes.
    expect(new Set(out.texts.map((t) => t.id)).size).toBe(out.texts.length);
  });

  it('only applies the chosen parts', () => {
    const r = extractRecipe(source(), ['look'], 'Look only');
    const c = video('c', 5);
    const target: VideoProject = { ...createProject(), assets: [c], clips: [createClip(c)] };
    const out = applyRecipe(target, r, []);
    expect(out.width).toBe(1280);
    expect(out.texts).toHaveLength(0);
    expect(out.clips[0].filters.contrast).toBe(1.2);
  });
});
