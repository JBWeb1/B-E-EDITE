import { describe, expect, it } from 'vitest';
import { SOUND_EFFECTS } from './sfx';
import { templateDuration, VIDEO_TEMPLATES } from './videoTemplates';

describe('video templates', () => {
  it('have unique ids and at least one scene', () => {
    expect(new Set(VIDEO_TEMPLATES.map((t) => t.id)).size).toBe(VIDEO_TEMPLATES.length);
    for (const t of VIDEO_TEMPLATES) expect(t.scenes.length).toBeGreaterThan(0);
  });

  it('only use built-in sounds', () => {
    const ids = new Set(SOUND_EFFECTS.map((s) => s.id));
    for (const t of VIDEO_TEMPLATES) for (const s of t.sounds) expect(ids.has(s.id), `${t.id}: ${s.id}`).toBe(true);
  });

  it('keep titles, effects and sounds inside the video', () => {
    for (const t of VIDEO_TEMPLATES) {
      const end = templateDuration(t) + 1e-6;
      for (const x of t.texts) expect(x.start + (x.patch.duration ?? 3), `${t.id}: ${x.patch.text}`).toBeLessThanOrEqual(end);
      for (const e of t.effects) expect(e.start + e.duration).toBeLessThanOrEqual(end);
      for (const s of t.sounds) expect(s.at).toBeLessThan(end);
    }
  });

  it('leave room for transitions between scenes', () => {
    for (const t of VIDEO_TEMPLATES) for (const s of t.scenes) expect(s.duration).toBeGreaterThanOrEqual(1.5);
  });
});
