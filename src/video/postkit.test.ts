import { describe, expect, it } from 'vitest';
import { chapters, chaptersText, frameScore, hashtags, kitDesign, pickBest, postCaption, postTitle } from './postkit';
import { createClip, createProject, createTextOverlay } from './timeline';
import type { MediaAsset, VideoProject } from './types';

const video = (id: string, duration: number): MediaAsset => ({ id, kind: 'video', name: id, url: '', duration, width: 1280, height: 720 });

function project(): VideoProject {
  const a = video('a', 20);
  const b = video('b', 20);
  const c = video('c', 20);
  return {
    ...createProject(1280, 720),
    name: 'Trip',
    assets: [a, b, c],
    clips: [createClip(a), createClip(b), createClip(c)],
    texts: [
      createTextOverlay(0.3, { text: 'Lisbon in 3 days', y: 0.3, animator: 'rise' }),
      createTextOverlay(2, { text: 'Lisbon has the best pastries.', y: 0.85 }),
      createTextOverlay(5, { text: 'The pastries in Lisbon are amazing', y: 0.85 }),
      createTextOverlay(21, { text: 'CHAPTER 2\nThe food', template: 'chapter' }),
    ],
  };
}

describe('post kit', () => {
  it('prefers sharp, colourful, well-exposed frames', () => {
    const w = 16;
    const flat = new Uint8ClampedArray(w * w * 4).fill(20);
    const rich = new Uint8ClampedArray(w * w * 4);
    for (let i = 0; i < w * w; i++) rich.set(i % 2 ? [230, 60, 40, 255] : [40, 120, 230, 255], i * 4);
    expect(frameScore(rich, w, w)).toBeGreaterThan(frameScore(flat, w, w) + 0.3);
  });

  it('picks the best frames spread out', () => {
    expect(pickBest([0.1, 0.9, 0.85, 0.2, 0.8, 0.3, 0.7], 3, 2)).toEqual([1, 4, 6]);
  });

  it('writes a title, caption and hashtags', () => {
    const p = project();
    expect(postTitle(p)).toBe('Lisbon in 3 days');
    const caption = postCaption(p, 'traveller');
    expect(caption).toContain('Lisbon in 3 days');
    expect(caption).toContain('@traveller');
    expect(hashtags('Lisbon pastries Lisbon the best', false)).toEqual(['#lisbon', '#pastries', '#best', '#youtube', '#video']);
    expect(hashtags('x', true)).toContain('#shorts');
  });

  it('makes YouTube chapters that follow the rules', () => {
    const list = chapters(project());
    expect(list[0].t).toBe(0);
    expect(list.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < list.length; i++) expect(list[i].t - list[i - 1].t).toBeGreaterThanOrEqual(10);
    expect(chaptersText([{ t: 0, title: 'Intro' }, { t: 75.6, title: 'Food' }])).toBe('0:00 Intro\n1:15 Food');
  });

  it('lays out a thumbnail with the frame filling the page', () => {
    const d = kitDesign('thumbnail', { src: 'data:', width: 1920, height: 1080 }, 'Big news', '@me');
    expect([d.width, d.height]).toEqual([1280, 720]);
    const photo = d.elements[0];
    expect([photo.x, photo.y, photo.width, photo.height]).toEqual([0, 0, 1280, 720]);
    const title = d.elements.find((e) => e.type === 'text' && e.text === 'BIG NEWS');
    expect(title).toBeTruthy();
    for (const e of d.elements) expect(e.x + e.width).toBeLessThanOrEqual(1280);
  });
});
