/**
 * Editing by transcript, filler-word removal, music ducking and smart reframe.
 * Transcript lines are kept in source time (seconds in the media file), so they
 * stay correct however the clips are trimmed, split or moved.
 */
import { uid } from '../lib/id';
import type { Keyframe } from './anim';
import { cutClip } from './ai';
import type { Range, SpeechSegment, Word } from './ai';
import { layoutClips } from './timeline';
import type { Clip, TranscriptLine, VideoProject } from './types';

// ---------- Words to lines ----------

/** Lines from word timings: a new line after a pause, at the end of a sentence, or when it gets long. */
export function groupWords(words: Word[], pause = 0.7, maxWords = 14): SpeechSegment[] {
  const out: SpeechSegment[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (!cur.length) return;
    out.push({ start: cur[0].start, end: cur[cur.length - 1].end, text: cur.map((w) => w.text.trim()).join(' '), words: cur });
    cur = [];
  };
  for (const w of words) {
    if (!w.text.trim()) continue;
    const prev = cur[cur.length - 1];
    if (prev && (w.start - prev.end > pause || cur.length >= maxWords)) flush();
    cur.push(w);
    if (/[.!?]$/.test(w.text.trim()) && cur.length >= 3) flush();
  }
  flush();
  return out;
}

/** Transcript lines for one media file from the speech engine's results (offset = where the audio started). */
export function toTranscriptLines(assetId: string, segments: SpeechSegment[], offset = 0): TranscriptLine[] {
  return segments
    .filter((s) => s.text.trim() && s.end > s.start)
    .map((s) => ({
      id: uid('line'),
      assetId,
      start: s.start + offset,
      end: s.end + offset,
      text: s.text.trim(),
      words: s.words?.map((w) => ({ ...w, start: w.start + offset, end: w.end + offset })),
    }));
}

// ---------- Where lines are on the timeline ----------

export interface LineView {
  line: TranscriptLine;
  /** Project time of the line's start, or null when it has been cut. */
  at: number | null;
  /** How much of the line is still in the video, 0..1. */
  kept: number;
}

/** Project time of a source time in a media file (the first clip that shows it), or null. */
export function projectTimeOf(p: Pick<VideoProject, 'clips'>, assetId: string, source: number): number | null {
  for (const pc of layoutClips(p.clips)) {
    const c = pc.clip;
    if (c.assetId === assetId && source >= c.in - 1e-6 && source < c.out) return pc.start + (source - c.in) / c.speed;
  }
  return null;
}

/** Every transcript line in timeline order, with whether it is still in the video. */
export function transcriptView(p: Pick<VideoProject, 'clips' | 'transcript'>): LineView[] {
  const views = (p.transcript ?? []).map((line) => {
    let covered = 0;
    let at: number | null = null;
    for (const pc of layoutClips(p.clips)) {
      const c = pc.clip;
      if (c.assetId !== line.assetId) continue;
      const a = Math.max(c.in, line.start);
      const b = Math.min(c.out, line.end);
      if (b > a) {
        covered += b - a;
        const t = pc.start + (a - c.in) / c.speed;
        if (at === null || t < at) at = t;
      }
    }
    return { line, at, kept: Math.min(1, covered / Math.max(1e-6, line.end - line.start)) };
  });
  return views.sort((x, y) => (x.at ?? Infinity) - (y.at ?? Infinity) || x.line.start - y.line.start);
}

/** Remove source ranges of one media file from every clip that shows them. */
export function cutSourceRanges(clips: Clip[], assetId: string, ranges: Range[]): Clip[] {
  if (!ranges.length) return clips;
  return clips.flatMap((c) => (c.assetId === assetId ? cutClip(c, ranges.filter((r) => r.end > c.in && r.start < c.out)) : [c]));
}

/** Cut transcript lines out of the video. */
export function cutLines(p: VideoProject, ids: string[]): VideoProject {
  const pick = new Set(ids);
  let clips = p.clips;
  const byAsset = new Map<string, Range[]>();
  for (const l of p.transcript ?? []) if (pick.has(l.id)) byAsset.set(l.assetId, [...(byAsset.get(l.assetId) ?? []), { start: l.start, end: l.end }]);
  for (const [assetId, ranges] of byAsset) clips = cutSourceRanges(clips, assetId, ranges);
  return { ...p, clips };
}

// ---------- Filler words ----------

const FILLERS = ['um', 'umm', 'uh', 'uhh', 'erm', 'er', 'ah', 'ahh', 'hmm', 'mm', 'mhm', 'eh'];
const SOFT_FILLERS = ['like', 'you know', 'i mean', 'sort of', 'kind of', 'basically', 'actually', 'literally'];

const clean = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, '').trim();

/**
 * Filler words with their source times. `soft` also finds "like", "you know" and other
 * words that are only sometimes filler (worth a look before cutting).
 */
export function findFillers(lines: TranscriptLine[], soft = false): { assetId: string; start: number; end: number; text: string }[] {
  const out: { assetId: string; start: number; end: number; text: string }[] = [];
  for (const l of lines) {
    const words = l.words ?? [];
    for (let i = 0; i < words.length; i++) {
      const w = clean(words[i].text);
      if (FILLERS.includes(w)) {
        out.push({ assetId: l.assetId, start: words[i].start, end: words[i].end, text: words[i].text.trim() });
        continue;
      }
      if (!soft) continue;
      const two = i + 1 < words.length ? `${w} ${clean(words[i + 1].text)}` : '';
      if (two && SOFT_FILLERS.includes(two)) {
        out.push({ assetId: l.assetId, start: words[i].start, end: words[i + 1].end, text: `${words[i].text.trim()} ${words[i + 1].text.trim()}` });
        i++;
      } else if (SOFT_FILLERS.includes(w)) out.push({ assetId: l.assetId, start: words[i].start, end: words[i].end, text: words[i].text.trim() });
    }
  }
  return out;
}

/** Cut filler words out of the video (with a hair of padding so the cut is clean). */
export function cutFillers(p: VideoProject, fillers: { assetId: string; start: number; end: number }[]): VideoProject {
  const byAsset = new Map<string, Range[]>();
  for (const f of fillers) byAsset.set(f.assetId, [...(byAsset.get(f.assetId) ?? []), { start: Math.max(0, f.start - 0.03), end: f.end + 0.03 }]);
  let clips = p.clips;
  for (const [assetId, ranges] of byAsset) clips = cutSourceRanges(clips, assetId, ranges);
  return { ...p, clips };
}

// ---------- Music ducking ----------

/** Merge ranges that touch or are closer than `gap` seconds. */
export function mergeRanges(ranges: Range[], gap = 0.6): Range[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start - last.end <= gap) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

/**
 * Volume keyframes (relative to the clip's volume) that lower music while people talk.
 * `speech` and the result are in the music clip's own time.
 */
export function duckKeys(speech: Range[], length: number, low = 0.25, ramp = 0.3): Keyframe[] {
  const keys: Keyframe[] = [];
  const add = (t: number, v: number) => {
    const last = keys[keys.length - 1];
    if (last && t <= last.t + 1e-3) last.v = v;
    else keys.push({ t, v, ease: 'smooth' });
  };
  // Pauses shorter than a ramp up and down are not worth bringing the music back for.
  for (const r of mergeRanges(speech, 2 * ramp + 0.1)) {
    const s = Math.max(0, r.start);
    const e = Math.min(length, r.end);
    if (e <= s) continue;
    if (s - ramp > 0) add(s - ramp, 1);
    add(s, low);
    add(e, low);
    if (e + ramp <= length) add(e + ramp, 1);
  }
  if (keys.length && keys[0].t > 0) keys.unshift({ t: 0, v: 1, ease: 'smooth' });
  return keys;
}

// ---------- Smart reframe ----------

/** Where the interest is across a grey frame (0 = left, 1 = right): movement and detail, weighted by column. */
export function focusX(frame: { w: number; h: number; data: Float32Array }, prev?: { data: Float32Array }): number {
  const { w, h, data } = frame;
  let sum = 0;
  let weight = 0;
  for (let x = 1; x < w - 1; x++) {
    let col = 0;
    for (let y = 1; y < h - 1; y++) {
      const i = y * w + x;
      const edge = Math.abs(data[i + 1] - data[i - 1]) + Math.abs(data[i + w] - data[i - w]);
      const move = prev ? Math.abs(data[i] - prev.data[i]) * 3 : 0;
      col += edge + move;
    }
    sum += col * (x / (w - 1));
    weight += col;
  }
  return weight > 0 ? sum / weight : 0.5;
}

/** Smooth a series with a moving average over `n` samples either side (a steady virtual camera). */
export function smooth(values: number[], n = 2): number[] {
  return values.map((_, i) => {
    let s = 0;
    let k = 0;
    for (let j = Math.max(0, i - n); j <= Math.min(values.length - 1, i + n); j++) {
      s += values[j];
      k++;
    }
    return s / k;
  });
}

/**
 * Fill a narrower frame with a wider video (e.g. 16:9 into 9:16) and centre the interest.
 * Returns the clip's scale and x (centre, fraction of the frame) for interest at `fx`.
 */
export function reframe(sourceAspect: number, frameAspect: number, fx: number): { scale: number; x: number } {
  if (sourceAspect <= frameAspect + 1e-3) return { scale: 1, x: 0.5 };
  const scale = sourceAspect / frameAspect;
  const reach = (scale - 1) / 2;
  return { scale, x: Math.max(0.5 - reach, Math.min(0.5 + reach, 0.5 - (fx - 0.5) * scale)) };
}
