import { describe, expect, it } from 'vitest';
import { cutFillers, cutLines, duckKeys, findFillers, focusX, groupWords, projectTimeOf, reframe, smooth, toTranscriptLines, transcriptView } from './transcript';
import { createClip, createProject } from './timeline';
import type { MediaAsset, VideoProject } from './types';

const asset: MediaAsset = { id: 'a', kind: 'video', name: 'talk', url: '', duration: 20, width: 1920, height: 1080 };
const words = (list: [string, number, number][]) => list.map(([text, start, end]) => ({ text, start, end }));

function project(): VideoProject {
  const segs = groupWords(
    words([
      ['Hi', 0, 0.3], ['um', 0.4, 0.7], ['welcome', 0.8, 1.2], ['back.', 1.2, 1.6],
      ['Today', 3, 3.3], ['we', 3.3, 3.4], ['uh', 3.5, 3.8], ['cook', 3.9, 4.2], ['pasta.', 4.2, 4.8],
      ['Like', 6, 6.2], ['you', 6.3, 6.4], ['know', 6.4, 6.6], ['it', 6.7, 6.8], ['is', 6.8, 6.9], ['easy.', 6.9, 7.4],
    ]),
  );
  return { ...createProject(), assets: [asset], clips: [{ ...createClip(asset), out: 10 }], transcript: toTranscriptLines('a', segs) };
}

describe('edit by transcript', () => {
  it('groups words into lines at pauses and sentence ends', () => {
    const p = project();
    expect(p.transcript!.map((l) => l.text)).toEqual(['Hi um welcome back.', 'Today we uh cook pasta.', 'Like you know it is easy.']);
    expect(p.transcript![1].start).toBe(3);
  });

  it('shows where each line is on the timeline', () => {
    const v = transcriptView(project());
    expect(v.map((x) => x.at)).toEqual([0, 3, 6]);
    expect(v.every((x) => x.kept === 1)).toBe(true);
  });

  it('cutting a line removes it from the video', () => {
    const p = project();
    const cut = cutLines(p, [p.transcript![1].id]);
    expect(cut.clips.map((c) => [c.in, c.out])).toEqual([[0, 3], [4.8, 10]]);
    const v = transcriptView(cut);
    expect(v.find((x) => x.line.text.startsWith('Today'))!.kept).toBe(0);
    expect(v.find((x) => x.line.text.startsWith('Like'))!.at).toBeCloseTo(4.2);
    expect(projectTimeOf(cut, 'a', 6)).toBeCloseTo(4.2);
  });

  it('finds filler words, and "like / you know" only when asked', () => {
    const p = project();
    expect(findFillers(p.transcript!).map((f) => f.text)).toEqual(['um', 'uh']);
    expect(findFillers(p.transcript!, true).map((f) => f.text)).toEqual(['um', 'uh', 'Like', 'you know']);
    const cut = cutFillers(p, findFillers(p.transcript!));
    expect(cut.clips.length).toBe(3);
    expect(cut.clips.reduce((s, c) => s + c.out - c.in, 0)).toBeCloseTo(10 - 0.36 - 0.36, 5);
  });
});

describe('music ducking', () => {
  it('lowers music during speech and brings it back after', () => {
    const keys = duckKeys([{ start: 2, end: 4 }, { start: 4.3, end: 5 }, { start: 8, end: 9 }], 12, 0.2, 0.3);
    const at = (t: number) => {
      let v = keys[0].v;
      for (const k of keys) if (k.t <= t) v = k.v;
      return v;
    };
    expect(at(0.5)).toBe(1);
    expect(at(3)).toBe(0.2);
    expect(at(4.15)).toBe(0.2); // short pause: stays down
    expect(at(6.5)).toBe(1);
    expect(at(8.5)).toBe(0.2);
    expect(at(11)).toBe(1);
    for (let i = 1; i < keys.length; i++) expect(keys[i].t).toBeGreaterThan(keys[i - 1].t);
  });
});

describe('smart reframe', () => {
  it('finds where the action is', () => {
    const w = 40;
    const h = 20;
    const data = new Float32Array(w * h).fill(50);
    for (let y = 5; y < 15; y++) for (let x = 28; x < 34; x++) data[y * w + x] = 220; // subject on the right
    expect(focusX({ w, h, data })).toBeGreaterThan(0.6);
  });

  it('fills a vertical frame and keeps the subject centred, without showing edges', () => {
    const r = reframe(16 / 9, 9 / 16, 0.75);
    expect(r.scale).toBeCloseTo((16 / 9) / (9 / 16));
    expect(r.x).toBeLessThan(0.5);
    // Never so far that the frame shows past the picture's edge.
    expect(Math.abs(r.x - 0.5)).toBeLessThanOrEqual((r.scale - 1) / 2 + 1e-9);
    expect(reframe(16 / 9, 9 / 16, 5).x).toBeCloseTo(0.5 - (r.scale - 1) / 2);
    expect(reframe(9 / 16, 9 / 16, 0.9)).toEqual({ scale: 1, x: 0.5 });
  });

  it('smooths a jittery camera path', () => {
    expect(smooth([0, 1, 0, 1, 0], 1)[2]).toBeCloseTo(2 / 3);
  });
});
