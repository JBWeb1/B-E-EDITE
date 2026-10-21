/**
 * Auto edit: turns raw clips into a finished video. It measures every clip
 * (sharpness, light, movement, sound, speech, shot changes), keeps the best moments,
 * cuts them on the beat of the music, and dresses the result in a style (pace,
 * order, transitions, colour, titles, effects). Everything here is pure, so the
 * choices are unit-tested and explainable; the dialog does the measuring.
 */
import { findSilences } from './ai';
import { NEUTRAL_GRADE } from './grade';
import type { LookId } from './grade';
import { createTextOverlay, createEffect } from './timeline';
import type { AudioClip, Clip, EffectType, MediaAsset, Motion, TextOverlay, TitleTemplate, TransitionType, VideoProject } from './types';
import type { Range } from './ai';
import { duckKeys, reframe } from './transcript';
import { uid } from '../lib/id';
import { NEUTRAL_FILTERS } from '../lib/filters';

// ---------- Styles ----------

export type StyleId = 'hype' | 'cinematic' | 'vlog' | 'travel' | 'tutorial' | 'promo' | 'longform';
export type Shape = '9:16' | '16:9' | '1:1';

export interface StyleDef {
  id: StyleId;
  label: string;
  emoji: string;
  blurb: string;
  /** Beats per cut with music, and seconds per cut without. */
  cutBeats: [number, number];
  cutSeconds: [number, number];
  /** What makes a moment good in this style. */
  weights: { motion: number; loud: number; quality: number };
  /** Keep whole spoken parts (talking videos) instead of picking moments. */
  speech: boolean;
  order: 'story' | 'energy';
  transitions: { types: TransitionType[]; every: number; duration: number } | null;
  look: LookId;
  lookAmount: number;
  shape: Shape;
  /** Default length in seconds. */
  length: number;
  zoomOnBeat: boolean;
  music: 'loud' | 'quiet' | 'none';
  title: { template?: TitleTemplate; animator?: TextOverlay['animator']; text: string; y: number; size: number };
  outro?: { template?: TitleTemplate; text: string };
  effects: { type: EffectType; at: 'start' | 'drop' | 'all'; duration?: number; intensity: number }[];
  sfx?: { id: string; on: 'transitions' | 'start' };
}

const W = (motion: number, loud: number, quality: number) => ({ motion, loud, quality });

export const STYLES: StyleDef[] = [
  {
    id: 'hype',
    label: 'Hype / TikTok',
    emoji: '⚡',
    blurb: 'Fast cuts on every beat, punchy zooms, best shot first',
    cutBeats: [1, 2],
    cutSeconds: [0.6, 1.2],
    weights: W(0.55, 0.15, 0.3),
    speech: false,
    order: 'energy',
    transitions: { types: ['zoom'], every: 4, duration: 0.2 },
    look: 'teal-orange',
    lookAmount: 0.7,
    shape: '9:16',
    length: 20,
    zoomOnBeat: true,
    music: 'loud',
    title: { animator: 'glitch', text: 'WATCH THIS', y: 0.4, size: 0.11 },
    effects: [{ type: 'flash', at: 'drop', duration: 0.3, intensity: 0.6 }],
  },
  {
    id: 'cinematic',
    label: 'Cinematic',
    emoji: '🎬',
    blurb: 'Long, beautiful shots, slow fades, film look and widescreen bars',
    cutBeats: [4, 8],
    cutSeconds: [3, 5],
    weights: W(0.25, 0.05, 0.7),
    speech: false,
    order: 'story',
    transitions: { types: ['fade'], every: 1, duration: 0.7 },
    look: 'cinematic',
    lookAmount: 0.85,
    shape: '16:9',
    length: 45,
    zoomOnBeat: false,
    music: 'loud',
    title: { template: 'title-reveal', text: 'A SHORT FILM', y: 0.5, size: 0.1 },
    effects: [
      { type: 'letterbox', at: 'all', intensity: 0.6 },
      { type: 'grain', at: 'all', intensity: 0.25 },
    ],
  },
  {
    id: 'vlog',
    label: 'Vlog',
    emoji: '🎒',
    blurb: 'Keeps what you say, cuts the pauses, warm look, music in the background',
    cutBeats: [2, 4],
    cutSeconds: [2, 4],
    weights: W(0.3, 0.4, 0.3),
    speech: true,
    order: 'story',
    transitions: null,
    look: 'warm-film',
    lookAmount: 0.6,
    shape: '9:16',
    length: 90,
    zoomOnBeat: false,
    music: 'quiet',
    title: { template: 'social', text: '@yourname', y: 0.85, size: 0.06 },
    effects: [],
  },
  {
    id: 'travel',
    label: 'Travel montage',
    emoji: '✈️',
    blurb: 'Golden colours, sliding transitions with whooshes, a location title',
    cutBeats: [2, 4],
    cutSeconds: [1.5, 2.5],
    weights: W(0.35, 0.05, 0.6),
    speech: false,
    order: 'story',
    transitions: { types: ['slide', 'wipe', 'zoom'], every: 2, duration: 0.35 },
    look: 'golden-hour',
    lookAmount: 0.75,
    shape: '9:16',
    length: 30,
    zoomOnBeat: false,
    music: 'loud',
    title: { template: 'location', text: 'Somewhere beautiful', y: 0.78, size: 0.055 },
    effects: [{ type: 'light-leak', at: 'start', duration: 2.5, intensity: 0.6 }],
    sfx: { id: 'whoosh', on: 'transitions' },
  },
  {
    id: 'tutorial',
    label: 'Talking / tutorial',
    emoji: '🎙️',
    blurb: 'Tight jump cuts with punch-in zooms, no dead air, clear captions',
    cutBeats: [2, 4],
    cutSeconds: [3, 6],
    weights: W(0.1, 0.6, 0.3),
    speech: true,
    order: 'story',
    transitions: null,
    look: 'none',
    lookAmount: 0,
    shape: '16:9',
    length: 180,
    zoomOnBeat: false,
    music: 'none',
    title: { template: 'chapter', text: 'HOW TO\nGet started', y: 0.5, size: 0.1 },
    effects: [],
  },
  {
    id: 'promo',
    label: 'Product promo',
    emoji: '🛍️',
    blurb: 'Sharpest shots, bold title, sparkles and a call to action at the end',
    cutBeats: [1, 2],
    cutSeconds: [0.8, 1.5],
    weights: W(0.3, 0.05, 0.65),
    speech: false,
    order: 'energy',
    transitions: { types: ['zoom', 'slide'], every: 3, duration: 0.25 },
    look: 'teal-orange',
    lookAmount: 0.5,
    shape: '1:1',
    length: 15,
    zoomOnBeat: true,
    music: 'loud',
    title: { template: 'title-reveal', text: 'NEW DROP', y: 0.5, size: 0.13 },
    outro: { text: 'SHOP NOW' },
    effects: [{ type: 'sparkles', at: 'start', duration: 3, intensity: 0.7 }],
    sfx: { id: 'whoosh', on: 'start' },
  },
  {
    id: 'longform',
    label: 'Long-form (YouTube, podcast)',
    emoji: '📺',
    blurb: 'Keeps every word of a long video, trims dead air, adds a teaser, chapters and quiet music',
    cutBeats: [4, 8],
    cutSeconds: [4, 8],
    weights: W(0.2, 0.6, 0.2),
    speech: true,
    order: 'story',
    transitions: null,
    look: 'none',
    lookAmount: 0,
    shape: '16:9',
    length: 7200,
    zoomOnBeat: false,
    music: 'quiet',
    title: { template: 'title-reveal', text: 'EPISODE 1', y: 0.5, size: 0.11 },
    effects: [],
  },
];

export const styleById = (id: StyleId) => STYLES.find((s) => s.id === id)!;

export const SHAPES: Record<Shape, { width: number; height: number; label: string }> = {
  '9:16': { width: 720, height: 1280, label: 'Vertical (TikTok, Reels, Shorts)' },
  '16:9': { width: 1280, height: 720, label: 'Landscape (YouTube)' },
  '1:1': { width: 1080, height: 1080, label: 'Square (Instagram post)' },
};

// ---------- Options & prompts ----------

export interface AutoEditOptions {
  style: StyleId;
  /** Seconds; 0 = the style's default (or as long as the good material allows). */
  length: number;
  shape: Shape;
  musicAssetId: string | null;
  title: string;
  look: LookId | null;
  captions: boolean;
  /** 1 = the style's pace, below 1 slower cuts, above 1 faster. */
  pace: number;
  /** Long videos: open with a short teaser of the best moment. */
  coldOpen: boolean;
  /** Long videos: chapter title cards (and YouTube chapters). */
  chapters: boolean;
  /** Lower the music while people talk. */
  duck: boolean;
  /** When the video is narrower than the footage, follow the action instead of shrinking it. */
  reframe: boolean;
}

export const defaultOptions = (style: StyleId = 'hype'): AutoEditOptions => ({
  style,
  length: 0,
  shape: styleById(style).shape,
  musicAssetId: null,
  title: '',
  look: null,
  captions: styleById(style).speech,
  pace: 1,
  coldOpen: style === 'longform',
  chapters: style === 'longform',
  duck: true,
  reframe: true,
});

const has = (text: string, words: string[]) => words.some((w) => new RegExp(`\\b${w}\\b`, 'i').test(text));

/** Understand a plain-English request ("a 30 second energetic travel video with warm colours"). */
export function parsePrompt(text: string, base: AutoEditOptions = defaultOptions()): { options: AutoEditOptions; understood: string[] } {
  const o = { ...base };
  const understood: string[] = [];
  // What the video is about wins over how it should feel ("an energetic travel video" is travel).
  const styleWords: [StyleId, string[]][] = [
    ['longform', ['long-form', 'long form', 'longform', 'podcast', 'episode', 'full video', 'lecture', 'webinar', 'interview', 'stream']],
    ['travel', ['travel', 'trip', 'holiday', 'vacation', 'journey', 'beach', 'adventure']],
    ['tutorial', ['tutorial', 'how to', 'talking', 'lesson', 'explainer', 'review']],
    ['vlog', ['vlog', 'day in (my|the) life', 'diary', 'storytime']],
    ['promo', ['promo', 'product', 'sale', 'ad', 'advert', 'advertisement', 'launch', 'shop']],
    ['cinematic', ['cinematic', 'movie', 'film', 'epic', 'wedding', 'trailer']],
    ['hype', ['hype', 'energetic', 'tiktok', 'edit', 'fast-paced', 'sports?', 'gaming', 'montage', 'party']],
  ];

  for (const [id, words] of styleWords)
    if (has(text, words)) {
      o.style = id;
      o.shape = styleById(id).shape;
      o.captions = styleById(id).speech;
      o.coldOpen = id === 'longform';
      o.chapters = id === 'longform';
      understood.push(`${styleById(id).label} style`);
      break;
    }
  const len = text.match(/(\d+(?:\.\d+)?)\s*(s|sec|secs|seconds?|m|min|mins|minutes?)\b/i);
  if (len) {
    o.length = Math.round(parseFloat(len[1]) * (/^m/i.test(len[2]) ? 60 : 1));
    understood.push(`${o.length} seconds long`);
  }
  if (has(text, ['vertical', 'tiktok', 'reels?', 'shorts', 'story', 'portrait'])) o.shape = '9:16';
  else if (has(text, ['square', 'instagram post', 'feed'])) o.shape = '1:1';
  else if (has(text, ['youtube', 'landscape', 'wide', 'widescreen', 'horizontal'])) o.shape = '16:9';
  if (o.shape !== base.shape || /vertical|square|landscape|youtube|tiktok|reel|short/i.test(text)) understood.push(SHAPES[o.shape].label);
  const looks: [LookId, string[]][] = [
    ['golden-hour', ['warm', 'golden', 'sunset', 'summer']],
    ['cold', ['cool', 'cold', 'blue', 'winter', 'icy']],
    ['noir', ['black and white', 'b&w', 'noir', 'monochrome']],
    ['vintage', ['vintage', 'retro', '90s', 'old']],
    ['moody', ['moody', 'dark', 'dramatic']],
    ['cyberpunk', ['neon', 'cyberpunk', 'night']],
    ['faded', ['faded', 'soft', 'pastel']],
  ];
  for (const [id, words] of looks)
    if (has(text, words)) {
      o.look = id;
      understood.push(`${id.replace('-', ' ')} colours`);
      break;
    }
  if (has(text, ['fast', 'quick', 'snappy', 'energetic'])) {
    o.pace = 1.4;
    understood.push('faster cuts');
  } else if (has(text, ['slow', 'calm', 'relaxed', 'chill', 'peaceful'])) {
    o.pace = 0.7;
    understood.push('calmer, longer shots');
  }
  if (has(text, ['chapters?'])) {
    o.chapters = true;
    understood.push('chapters');
  }
  if (has(text, ['teaser', 'cold open', 'hook'])) {
    o.coldOpen = true;
    understood.push('teaser at the start');
  }
  if (has(text, ['captions?', 'subtitles?'])) {
    o.captions = true;
    understood.push('captions');
  }
  if (has(text, ['no music', 'without music'])) {
    o.musicAssetId = null;
    understood.push('no music');
  }
  const quoted = text.match(/["“'']([^"”'']{2,60})["”'']/);
  if (quoted) {
    o.title = quoted[1];
    understood.push(`title “${quoted[1]}”`);
  }
  return { options: o, understood };
}

// ---------- Measuring clips ----------

export interface ClipAnalysis {
  assetId: string;
  name: string;
  kind: 'video' | 'image';
  duration: number;
  /** Samples per second of the arrays below. */
  rate: number;
  motion: number[];
  /** Sharpness and good exposure, 0..1. */
  quality: number[];
  /** Loudness 0..1 (relative to the loudest clip). */
  loud: number[];
  /** Times (s) where the shot changes inside the clip. */
  shots: number[];
  /** Where the action is across the frame (0 = left, 1 = right), per sample. */
  focus?: number[];
  /** Loudness at a finer rate for finding pauses (long clips are watched sparsely). */
  audio?: number[];
  audioRate?: number;
}

/** Sharpness and exposure of a small grey frame, 0..1. */
export function grayQuality(f: { w: number; h: number; data: Float32Array }): number {
  let sum = 0;
  let lap2 = 0;
  let n = 0;
  for (let i = 0; i < f.data.length; i++) sum += f.data[i];
  const mean = sum / f.data.length / 255;
  for (let y = 1; y < f.h - 1; y++)
    for (let x = 1; x < f.w - 1; x++) {
      const i = y * f.w + x;
      const v = 4 * f.data[i] - f.data[i - 1] - f.data[i + 1] - f.data[i - f.w] - f.data[i + f.w];
      lap2 += v * v;
      n++;
    }
  const sharp = Math.min(1, Math.sqrt(n ? lap2 / n : 0) / 40);
  const exposure = 1 - Math.min(1, Math.abs(mean - 0.48) * 2.4);
  return 0.6 * sharp + 0.4 * exposure;
}

/** Shot changes: sudden jumps in picture change, well above the clip's normal movement. */
export function findShots(motion: number[], rate: number): number[] {
  if (motion.length < 3) return [];
  const mean = motion.reduce((a, b) => a + b, 0) / motion.length;
  const sd = Math.sqrt(motion.reduce((a, b) => a + (b - mean) ** 2, 0) / motion.length);
  const out: number[] = [];
  for (let i = 1; i < motion.length; i++) if (motion[i] > Math.max(0.12, mean + 3 * sd) && motion[i] > 2 * (motion[i - 1] ?? 0)) out.push(i / rate);
  return out;
}

// ---------- Planning ----------

export interface Segment {
  assetId: string;
  in: number;
  out: number;
  /** Why it was chosen (shown to the user). */
  reason: string;
  energy: number;
  photo?: boolean;
  /** Where the action is (0..1 across), for smart reframe. */
  focus?: number;
  /** A teaser of a later moment, shown first. */
  teaser?: boolean;
}

export interface Plan {
  options: AutoEditOptions;
  style: StyleDef;
  segments: Segment[];
  length: number;
  /** Seconds between beats, when cutting to music. */
  beat: number | null;
  /** Where the music starts playing from (seconds into the song). */
  musicIn: number;
  /** The song's beats (seconds into the song), kept on the music clips as beat markers. */
  musicBeats?: number[];
  notes: string[];
  /** Chapter starts (seconds on the timeline) for long videos. */
  chapters: { t: number; title: string }[];
}

/** Small seeded random numbers, so "Try another" gives a different but repeatable edit. */
function rng(seed: number) {
  let s = (seed * 9301 + 49297) % 233280 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

const avg = (a: number[], from: number, to: number) => {
  let s = 0;
  let n = 0;
  for (let i = Math.max(0, from); i < Math.min(a.length, to); i++) {
    s += a[i];
    n++;
  }
  return n ? s / n : 0;
};

const PHOTO_SECONDS = 2.5;

/**
 * Choose the moments and their order. `beats` are beat times of the chosen song
 * (empty without music).
 */
export function planAutoEdit(clips: ClipAnalysis[], options: AutoEditOptions, beats: number[] = [], seed = 1): Plan {
  const style = styleById(options.style);
  const rand = rng(seed);
  const notes: string[] = [];
  // Talking styles cut at the pauses, not on the beat.
  const beat = !style.speech && beats.length > 4 ? (beats[beats.length - 1] - beats[0]) / (beats.length - 1) : null;
  const usable = clips.reduce((s, c) => s + (c.kind === 'image' ? PHOTO_SECONDS : c.duration), 0);
  let target = options.length || Math.min(style.length, style.speech ? usable : usable * 0.6);
  target = Math.max(3, Math.min(target, usable));
  const segments: Segment[] = [];
  const pace = Math.max(0.4, Math.min(2.5, options.pace));

  /** Length of the pause that was cut before each segment (for finding chapters). */
  const breaks = new Map<Segment, number>();
  if (style.speech) {
    // Talking videos: keep every spoken part, in order, without the pauses.
    for (const c of clips) {
      if (c.kind === 'image') {
        segments.push({ assetId: c.assetId, in: 0, out: PHOTO_SECONDS, reason: 'Photo', energy: 0.3, photo: true });
        continue;
      }
      const loud = c.audio ?? c.loud;
      const lr = c.audio ? c.audioRate ?? c.rate : c.rate;
      const silences = findSilences(loud, lr, { threshold: 0.12, minSilence: 0.6 / pace, pad: 0.12 });
      let t = 0;
      let gapBefore = Infinity; // a new clip counts as a natural break
      for (const s of [...silences, { start: c.duration, end: c.duration }]) {
        if (s.start - t > 0.4) {
          const q = avg(c.quality, Math.floor(t * c.rate), Math.ceil(s.start * c.rate));
          const energy = avg(loud, Math.floor(t * lr), Math.ceil(s.start * lr)) + 0.5 * avg(c.motion, Math.floor(t * c.rate), Math.ceil(s.start * c.rate));
          segments.push({ assetId: c.assetId, in: t, out: Math.min(c.duration, s.start), reason: q < 0.25 ? 'Speech (picture is dark or blurry)' : 'Speech', energy, focus: c.focus ? avg(c.focus, Math.floor(t * c.rate), Math.ceil(s.start * c.rate)) || undefined : undefined });
          breaks.set(segments[segments.length - 1], gapBefore);
        }
        gapBefore = s.end - s.start;
        t = s.end;
      }
      const cut = silences.reduce((a, s) => a + (Math.min(s.end, c.duration) - s.start), 0);
      if (cut > 0.5) notes.push(`Cut ${cut.toFixed(1)} s of pauses from ${c.name}.`);
    }
    // Too long: drop the weakest parts (keep the order).
    let total = segments.reduce((a, s) => a + s.out - s.in, 0);
    if (total > target) {
      const ranked = [...segments].sort((a, b) => a.energy - b.energy);
      for (const s of ranked) {
        if (total <= target) break;
        total -= s.out - s.in;
        segments.splice(segments.indexOf(s), 1);
      }
      notes.push('Left out the quietest parts to fit the length.');
    }
  } else {
    // Moments: fill slots of beat-length cuts with the best unused windows.
    const prefix = (a: number[]) => {
      const p = [0];
      for (const v of a) p.push(p[p.length - 1] + v);
      return p;
    };
    const sums = clips.map((c) => ({ motion: prefix(c.motion), loud: prefix(c.loud), quality: prefix(c.quality) }));
    const maxMotion = Math.max(1e-6, ...clips.flatMap((c) => c.motion));
    const used = clips.map(() => [] as { from: number; to: number }[]);
    const picks = clips.map(() => 0);
    let total = 0;
    let guard = 0;
    while (total < target - 0.2 && guard++ < 400) {
      const beatsPer = style.cutBeats[0] + Math.floor(rand() * (style.cutBeats[1] - style.cutBeats[0] + 1));
      let len = beat ? (beatsPer * beat) / pace : (style.cutSeconds[0] + rand() * (style.cutSeconds[1] - style.cutSeconds[0])) / pace;
      if (beat) while (len < 0.45) len += beat; // never a flicker
      len = Math.min(len, target - total + 0.01);
      if (len < 0.4) break;
      type Pick = { c: number; from: number; score: number; m: number; q: number; l: number };
      const findBest = (len: number): Pick | null => {
      let best: Pick | null = null;
      clips.forEach((c, ci) => {
        if (c.kind === 'image') {
          if (picks[ci] > 0) return;
          const score = 0.6 * style.weights.quality + 0.1 + rand() * 0.15;
          if (!best || score > best.score) best = { c: ci, from: 0, score, m: 0, q: 0.6, l: 0 };
          return;
        }
        if (c.duration < len) return;
        const step = Math.max(1, Math.round(c.rate / 4));
        const n = Math.round(len * c.rate);
        for (let i = 0; i + n <= c.motion.length; i += step) {
          const from = i / c.rate;
          const to = from + len;
          if (used[ci].some((u) => from < u.to + 0.1 && to > u.from - 0.1)) continue;
          // Don't cut across a shot change.
          if (c.shots.some((s) => s > from + 0.15 && s < to - 0.15)) continue;
          const m = (sums[ci].motion[i + n] - sums[ci].motion[i]) / n / maxMotion;
          const l = (sums[ci].loud[i + n] - sums[ci].loud[i]) / n;
          const q = (sums[ci].quality[i + n] - sums[ci].quality[i]) / n;
          if (q < 0.22) continue; // too dark or blurry
          let score = style.weights.motion * m + style.weights.loud * l + style.weights.quality * q;
          score *= 1 - Math.min(0.5, 0.12 * picks[ci]); // variety: spread across clips
          score *= 0.9 + 0.2 * rand(); // "Try another" changes the picks a little
          if (!best || score > best.score) best = { c: ci, from, score, m, q, l };
        }
      });
      return best;
      };
      // No room for this length: try a single beat (or a shorter cut) before giving up.
      let found = findBest(len);
      if (!found) {
        len = Math.min(len, beat ? Math.max(beat, 0.45) : style.cutSeconds[0] / pace);
        found = findBest(len);
      }
      if (!found) {
        notes.push(`Used all the good footage (${total.toFixed(1)} s). Add more clips for a longer video.`);
        break;
      }
      const b = found;
      const c = clips[b.c];
      const photo = c.kind === 'image';
      const segLen = photo ? Math.min(len, PHOTO_SECONDS * 1.6) : len;
      used[b.c].push({ from: b.from, to: b.from + segLen });
      picks[b.c]++;
      const reason = photo ? 'Photo' : b.m > 0.6 ? 'Most action' : b.q > 0.7 ? 'Sharp, well-lit shot' : b.l > 0.6 ? 'Loud moment' : 'Good shot';
      const fi = Math.floor(b.from * c.rate);
      segments.push({ assetId: c.assetId, in: b.from, out: b.from + segLen, reason, energy: b.score, photo, focus: c.focus ? avg(c.focus, fi, fi + Math.max(1, Math.round(segLen * c.rate))) : undefined });
      total += segLen;
    }
    if (style.order === 'story') {
      const order = new Map(clips.map((c, i) => [c.assetId, i]));
      segments.sort((a, b) => order.get(a.assetId)! - order.get(b.assetId)! || a.in - b.in);
    } else if (segments.length > 2) {
      // Hook first (the strongest moment), then build up to a big finish.
      const sorted = [...segments].sort((a, b) => b.energy - a.energy);
      const [hook, finale, ...rest] = sorted;
      rest.sort((a, b) => a.energy - b.energy);
      segments.splice(0, segments.length, { ...hook, reason: `Hook: ${hook.reason.toLowerCase()}` }, ...rest, { ...finale, reason: `Finale: ${finale.reason.toLowerCase()}` });
      notes.push('Opened with the strongest moment to stop the scroll, then built up to a big finish.');
    }
    const skipped = clips.filter((_, i) => picks[i] === 0).map((c) => c.name);
    if (skipped.length) notes.push(`Left out ${skipped.join(', ')}: nothing sharp or lively enough.`);
  }
  // Clips play back to back (transitions blend at the cut without shortening the video).
  // Long videos: open with a teaser of the liveliest moment from later on.
  const body = segments.reduce((a, s) => a + s.out - s.in, 0);
  if (options.coldOpen && style.speech && body >= 45 && segments.length > 3) {
    let t = 0;
    let best: Segment | null = null;
    for (const s of segments) {
      const mid = t + (s.out - s.in) / 2;
      if (mid > body * 0.15 && mid < body * 0.92 && s.out - s.in >= 2 && !s.photo && (!best || s.energy > best.energy)) best = s;
      t += s.out - s.in;
    }
    if (best) {
      const len = Math.min(7, best.out - best.in);
      segments.unshift({ ...best, out: best.in + len, teaser: true, reason: 'Teaser: the liveliest moment, shown first' });
      notes.push('Opened with a short teaser of the liveliest moment, so viewers stay to see it.');
    }
  }
  const length = segments.reduce((a, s) => a + s.out - s.in, 0);
  // Chapters at the longest pauses (or clip changes), spread out evenly.
  const chapters: { t: number; title: string }[] = [];
  if (options.chapters && style.speech && length >= 90) {
    const minGap = Math.max(30, length / 10);
    let t = 0;
    const candidates: { t: number; gap: number }[] = [];
    for (const s of segments) {
      if (!s.teaser && t > 0) candidates.push({ t, gap: breaks.get(s) ?? 0 });
      t += s.out - s.in;
    }
    const start = segments[0]?.teaser ? segments[0].out - segments[0].in : 0;
    chapters.push({ t: start, title: 'Intro' });
    for (const c of candidates.filter((c) => c.gap >= 1.2 || c.gap === Infinity).sort((a, b) => b.gap - a.gap)) {
      if (chapters.length >= 10) break;
      if (length - c.t < 20 || chapters.some((x) => Math.abs(x.t - c.t) < minGap)) continue;
      chapters.push({ t: c.t, title: '' });
    }
    chapters.sort((a, b) => a.t - b.t).forEach((c, i) => (c.title ||= `Part ${i}`));
    if (chapters.length > 1) notes.push(`Split into ${chapters.length} chapters at the natural breaks (they become YouTube chapters in Post kit).`);
    else chapters.length = 0;
  }
  if (beat) notes.push(`Cut on the beat of the music (${Math.round(60 / beat)} BPM).`);
  else if (style.music !== 'none' && !options.musicAssetId) notes.push('Add a song to cut on the beat.');
  return { options, style, segments, length, beat, musicIn: beats[0] ?? 0, musicBeats: beats, notes, chapters };
}

// ---------- Building the project ----------

export interface Built {
  project: VideoProject;
  /** Sound effects to add (the dialog creates their audio files). */
  sfx: { id: string; at: number }[];
}

/** Turn a plan into the timeline (replacing what was there). */
export function buildAutoEdit(p: VideoProject, plan: Plan, assets: MediaAsset[]): Built {
  const { style, options } = plan;
  const shape = SHAPES[options.shape];
  const look = options.look ?? style.look;
  const grade = look === 'none' ? undefined : { ...NEUTRAL_GRADE, look, lookAmount: style.lookAmount || 0.7 };
  const motions: Motion[] = ['zoom-in', 'pan-left', 'zoom-out', 'pan-right'];
  const sfx: { id: string; at: number }[] = [];
  let t = 0;
  let teaserEnd = 0;
  let reframed = false;
  const clips: Clip[] = plan.segments.map((s, i) => {
    const asset = assets.find((a) => a.id === s.assetId);
    const len = s.out - s.in;
    const tr = style.transitions && i > 0 && i % style.transitions.every === 0 ? { type: style.transitions.types[(i / style.transitions.every) % style.transitions.types.length | 0], duration: Math.min(style.transitions.duration, len / 2) } : undefined;
    if (tr && style.sfx?.on === 'transitions') sfx.push({ id: style.sfx.id, at: Math.max(0, t - 0.3) });
    const clip: Clip = {
      id: uid('clip'),
      assetId: s.assetId,
      in: s.in,
      out: s.out,
      speed: 1,
      volume: style.music === 'loud' && !style.speech ? 0.35 : 1,
      fadeIn: 0,
      fadeOut: 0,
      filters: NEUTRAL_FILTERS,
      transition: tr,
      grade,
      motion: s.photo || asset?.kind === 'image' ? motions[i % motions.length] : undefined,
    };
    // A quick punch-in on the beat, or alternating zoom for talking jump cuts.
    if (style.zoomOnBeat && len > 0.5) clip.keys = { scale: [{ t: 0, v: 1.1, ease: 'ease-out' }, { t: Math.min(0.35, len / 2), v: 1, ease: 'smooth' }] };
    else if (style.id === 'tutorial' && i % 2 === 1) clip.scale = 1.12;
    else if (style.id === 'longform' && i % 3 === 2 && !s.teaser) clip.scale = 1.1;
    if (s.teaser) teaserEnd = len;
    // Smart reframe: fill a narrower frame with the footage and follow the action.
    if (options.reframe && asset?.kind === 'video' && asset.width && asset.height) {
      const r = reframe(asset.width / asset.height, shape.width / shape.height, s.focus ?? 0.5);
      if (r.scale > 1.001) {
        clip.scale = (clip.scale ?? 1) * r.scale;
        clip.x = r.x;
        if (clip.keys?.scale) clip.keys = { ...clip.keys, scale: clip.keys.scale.map((k) => ({ ...k, v: k.v * r.scale })) };
        reframed = true;
      }
    }
    if (i === 1 && plan.segments[0]?.teaser) clip.transition = { type: 'zoom', duration: 0.3 };
    t += len;
    return clip;
  });
  const length = t;
  const texts: TextOverlay[] = [];
  const titleText = options.title || style.title.text;
  if (teaserEnd > 0) texts.push(createTextOverlay(0, { text: 'COMING UP', y: 0.1, size: 0.05, duration: teaserEnd, bold: true, background: '#111827', animation: 'fade' }));
  texts.push(createTextOverlay(teaserEnd + 0.1, { text: style.title.template === 'social' && !titleText.startsWith('@') ? titleText.toUpperCase() : titleText, template: style.title.template, animator: style.title.animator, animation: style.title.animator ? 'none' : 'fade', y: style.title.y, size: style.title.size, duration: Math.min(3, Math.max(1.5, length * 0.25)), bold: true, stroke: style.title.template ? undefined : '#000000' }));
  // Chapter title cards (named from the transcript when there is one).
  plan.chapters.slice(1).forEach((c, n) => {
    const name = chapterName(p, plan, c.t) ?? c.title;
    texts.push(createTextOverlay(c.t, { text: `CHAPTER ${n + 1}\n${name}`, template: 'chapter', y: 0.5, size: 0.08, duration: 2.5 }));
  });
  if (style.outro && length > 4) texts.push(createTextOverlay(Math.max(0, length - 2.2), { text: style.outro.text, template: style.outro.template, y: 0.5, size: 0.12, duration: 2.1, bold: true, background: '#111827', animation: 'pop' }));
  const effects = style.effects.map((e) => {
    const start = e.at === 'drop' ? Math.min(length * 0.3, (plan.segments[0]?.out ?? 0) - (plan.segments[0]?.in ?? 0)) : 0;
    const duration = e.at === 'all' ? length : Math.min(e.duration ?? 2, Math.max(0.2, length - start));
    return createEffect(e.type, start, { duration, intensity: e.intensity });
  });
  if (style.sfx?.on === 'start') sfx.push({ id: style.sfx.id, at: 0 });
  const music = options.musicAssetId ? assets.find((a) => a.id === options.musicAssetId) : undefined;
  const audio: AudioClip[] = [];
  if (music && style.music !== 'none') {
    // Long videos: the song repeats until the end.
    const speech: Range[] = [];
    let at = 0;
    for (const s of plan.segments) {
      if (style.speech && s.energy > 0.12) speech.push({ start: at, end: at + s.out - s.in });
      at += s.out - s.in;
    }
    for (let start = 0, first = true; start < length - 0.5; first = false) {
      const from = first ? plan.musicIn : 0;
      const len = Math.min(music.duration - from, length - start);
      if (len < 0.5) break;
      const clip: AudioClip = { id: uid('audio'), assetId: music.id, start, in: from, out: from + len, volume: style.music === 'quiet' ? (options.duck ? 0.45 : 0.22) : 0.9, fadeIn: first ? 0.3 : 0, fadeOut: start + len >= length - 0.01 ? Math.min(1.5, length / 4) : 0 };
      if (plan.musicBeats?.length) clip.beats = plan.musicBeats;
      // Lower the music while people talk.
      if (options.duck && speech.length) {
        const local = speech.map((r) => ({ start: r.start - start, end: r.end - start })).filter((r) => r.end > 0 && r.start < len);
        if (local.length) clip.keys = { volume: duckKeys(local, len, 0.4) };
      }
      audio.push(clip);
      start += len;
    }
  }
  const sourceShape = assets.find((a) => a.kind === 'video');
  const fill: 'blur' | 'color' = !reframed && sourceShape?.width && sourceShape.height && Math.abs(sourceShape.width / sourceShape.height - shape.width / shape.height) > 0.05 ? 'blur' : 'color';
  return {
    project: { ...p, width: shape.width, height: shape.height, fill, clips, texts, effects, overlays: [], audio },
    sfx,
  };
}

/** A chapter's name from the first words spoken at that point (when there is a transcript). */
function chapterName(p: VideoProject, plan: Plan, t: number): string | null {
  if (!p.transcript?.length) return null;
  let at = 0;
  for (const s of plan.segments) {
    const len = s.out - s.in;
    if (t < at + len + 1e-6) {
      const src = s.in + (t - at);
      const line = p.transcript.filter((l) => l.assetId === s.assetId && l.end > src).sort((a, b) => a.start - b.start)[0];
      if (!line) return null;
      const words = line.text.replace(/[^\p{L}\p{N}' ]+/gu, '').split(/\s+/).filter(Boolean).slice(0, 5);
      return words.length ? words.map((w, i) => (i === 0 ? w[0].toUpperCase() + w.slice(1) : w)).join(' ') : null;
    }
    at += len;
  }
  return null;
}
