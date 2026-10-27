import { describe, expect, it } from 'vitest';
import { changes, describeChange, restoreVersion, saveVersion } from './versions';
import { createClip, createEffect, createProject, createTextOverlay } from './timeline';
import type { MediaAsset, VideoProject } from './types';

const a: MediaAsset = { id: 'a', kind: 'video', name: 'beach.mp4', url: '', duration: 10 };
const base = (): VideoProject => ({ ...createProject(), assets: [a], clips: [createClip(a)] });

describe('visual history', () => {
  it('names a single step', () => {
    const p = base();
    const t = createTextOverlay(0, { text: 'Hello world' });
    const q = { ...p, texts: [t] };
    expect(describeChange(p, q)).toBe('Added text “Hello world”');
    const r = { ...q, texts: [{ ...t, text: 'Bye' }] };
    expect(describeChange(q, r)).toBe('Rewrote “Bye”');
    const s = { ...p, clips: [{ ...p.clips[0], out: 5 }] };
    expect(describeChange(p, s)).toBe('Trimmed the clip beach.mp4');
    expect(describeChange(undefined, p)).toBe('Start');
  });

  it('lists every difference between two versions', () => {
    const p = base();
    const q: VideoProject = { ...p, width: 720, height: 1280, effects: [createEffect('confetti', 0)], texts: [createTextOverlay(0), createTextOverlay(1)], clips: [] };
    expect(changes(p, q)).toEqual(['Changed the size to 720×1280', 'Deleted clip beach.mp4', 'Added 2 texts', 'Added effect confetti']);
    expect(describeChange(p, q)).toBe('Changed the size to 720×1280 (+3 more)');
  });

  it('saves and restores named versions', () => {
    const p = base();
    const v1 = saveVersion(p, 'First cut', 1000);
    expect(v1.versions?.[0].name).toBe('First cut');
    expect(v1.versions?.[0].project).not.toHaveProperty('versions');
    const edited = { ...v1, clips: [] };
    const back = restoreVersion(edited, edited.versions![0]);
    expect(back.clips).toHaveLength(1);
    expect(back.versions).toBe(edited.versions);
  });
});
