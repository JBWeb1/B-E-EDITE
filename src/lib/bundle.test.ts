import { describe, expect, it } from 'vitest';
import { packProject, unpackProject } from './bundle';
import { createClip, createProject } from '../video/timeline';
import type { MediaAsset, VideoProject } from '../video/types';

describe('project file', () => {
  it('packs a project with its media and reads it back', async () => {
    const media = new Blob(['video-bytes-here'], { type: 'video/webm' });
    const url = 'data:video/webm;base64,' + btoa('video-bytes-here');
    const a: MediaAsset = { id: 'a1', kind: 'video', name: 'clip.webm', url, duration: 3 };
    const p: VideoProject = { ...createProject(), name: 'Trip', assets: [a], clips: [createClip(a)] };
    const file = await packProject(p);
    const { project, files } = await unpackProject(file);
    expect(project.name).toBe('Trip');
    expect(project.assets[0].url).toBe('');
    expect(await files.get('a1')!.text()).toBe(await media.text());
    expect(files.get('a1')!.type).toBe('video/webm');
  });

  it('rejects other files', async () => {
    await expect(unpackProject(new Blob(['hello world, not a project']))).rejects.toThrow(/not a B-E Motion/);
  });
});
