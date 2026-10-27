/**
 * Post kit: from a finished video, everything needed to post it — a thumbnail from
 * the best frame, a matching square post and story, a caption with hashtags, and
 * YouTube chapters. Pure functions (frame scoring, text, layouts) so they are tested.
 */
import { addElement, createDoc, createShape, createText } from '../design/model';
import { uid } from '../lib/id';
import type { DesignDoc, ImageElement } from '../design/types';
import { captionItems, footageLength } from './recipes';
import { layoutClips } from './timeline';
import type { VideoProject } from './types';

// ---------- Best frame ----------

/**
 * How good a frame is as a thumbnail (higher is better): sharp detail, colour, and a
 * comfortable brightness. Works on small RGBA frames.
 */
export function frameScore(rgba: Uint8ClampedArray, w: number, h: number): number {
  const grey = new Float32Array(w * h);
  let sum = 0;
  let colour = 0;
  for (let i = 0, j = 0; j < grey.length; i += 4, j++) {
    const r = rgba[i];
    const g = rgba[i + 1];
    const b = rgba[i + 2];
    grey[j] = 0.299 * r + 0.587 * g + 0.114 * b;
    sum += grey[j];
    colour += Math.max(r, g, b) - Math.min(r, g, b);
  }
  const mean = sum / grey.length / 255;
  // Sharpness: variance of the Laplacian.
  let lap = 0;
  let lap2 = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = 4 * grey[i] - grey[i - 1] - grey[i + 1] - grey[i - w] - grey[i + w];
      lap += v;
      lap2 += v * v;
      n++;
    }
  const sharp = n ? Math.sqrt(Math.max(0, lap2 / n - (lap / n) ** 2)) / 64 : 0;
  const vivid = colour / grey.length / 255;
  const exposure = 1 - Math.min(1, Math.abs(mean - 0.5) * 2.2);
  return Math.min(1, sharp) * 0.45 + vivid * 0.3 + exposure * 0.25;
}

/** Indices of the `n` best frames, spread out (at least `gap` apart). */
export function pickBest(scores: number[], n = 3, gap = 3): number[] {
  const order = scores.map((s, i) => [s, i] as const).sort((a, b) => b[0] - a[0]);
  const out: number[] = [];
  for (const [, i] of order) {
    if (out.every((j) => Math.abs(j - i) >= gap)) out.push(i);
    if (out.length === n) break;
  }
  return out;
}

// ---------- Words ----------

const STOP = new Set(
  'a an and are as at be but by for from has have i in is it its me my of on or our so that the this to was we were what when with you your yours just not no yes do does did will can about into out up down over than then them they there these those here how why who very more most some any all also get got like really thing things one two'.split(' '),
);

/** The title for the post: the first title on screen, else the project name. */
export function postTitle(p: VideoProject): string {
  const captions = new Set(captionItems(p.texts).map((t) => t.id));
  const title = [...p.texts].sort((a, b) => a.start - b.start).find((t) => !t.shape && !captions.has(t.id) && t.text.trim());
  const name = p.name && p.name !== 'Untitled video' ? p.name : '';
  return (title?.text.replace(/\s*\n\s*/g, ' ') ?? name ?? '').trim() || 'Watch this';
}

/** The spoken words (from captions), in order. */
export function transcript(p: VideoProject): string {
  return captionItems(p.texts)
    .sort((a, b) => a.start - b.start)
    .map((t) => t.text.trim())
    .join(' ');
}

/** Hashtags from the most used meaningful words, plus the platform's own tags. */
export function hashtags(text: string, vertical: boolean, n = 6): string[] {
  const counts = new Map<string, number>();
  for (const raw of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (raw.length < 3 || STOP.has(raw) || /^\d+$/.test(raw)) continue;
    counts.set(raw, (counts.get(raw) ?? 0) + 1);
  }
  const words = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length).map(([w]) => `#${w}`);
  const platform = vertical ? ['#shorts', '#fyp', '#reels'] : ['#youtube', '#video'];
  return [...new Set([...words.slice(0, Math.max(0, n - platform.length)), ...platform])].slice(0, n);
}

/** A ready-to-paste caption: the hook, a line from the video, a call to action and hashtags. */
export function postCaption(p: VideoProject, handle = ''): string {
  const title = postTitle(p);
  const words = transcript(p);
  const vertical = p.height > p.width;
  const first = words.split(/(?<=[.!?])\s+/)[0]?.trim();
  const lines = [title.endsWith('!') || title.endsWith('?') ? title : `${title} ✨`];
  if (first && first.toLowerCase() !== title.toLowerCase()) lines.push(first.length > 140 ? first.slice(0, 137) + '…' : first);
  lines.push(vertical ? 'Follow for more 👉' : 'Subscribe for more 🔔');
  if (handle) lines.push(handle.startsWith('@') ? handle : `@${handle}`);
  lines.push('', hashtags(`${title} ${words}`, vertical).join(' '));
  return lines.join('\n');
}

/**
 * YouTube chapters: from chapter titles (or other titles) on the timeline, else one per
 * clip. YouTube needs the first at 0:00, at least three, each at least 10 s long.
 */
export function chapters(p: VideoProject): { t: number; title: string }[] {
  const length = footageLength(p);
  const captions = new Set(captionItems(p.texts).map((t) => t.id));
  const marked = p.texts.filter((t) => t.template === 'chapter').map((t) => ({ t: t.start, title: t.text.replace(/\n/g, ' — ') }));
  const titles = p.texts.filter((t) => !t.shape && !captions.has(t.id) && t.template !== 'subscribe' && t.text.trim()).map((t) => ({ t: t.start, title: t.text.split('\n')[0] }));
  const clips = layoutClips(p.clips).map((c, i) => ({ t: c.start, title: `Part ${i + 1}` }));
  for (const source of [marked, titles, clips]) {
    const list = [...source].sort((a, b) => a.t - b.t);
    if (list.length === 0) continue;
    const out = [{ t: 0, title: list[0].t <= 1 ? list[0].title : 'Intro' }];
    for (const c of list) {
      if (c.t <= 1) continue;
      if (c.t - out[out.length - 1].t >= 10 && length - c.t >= 10) out.push(c);
    }
    if (out.length >= 3) return out;
  }
  return [];
}

const clock = (t: number) => {
  const s = Math.floor(t);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

export const chaptersText = (list: { t: number; title: string }[]) => list.map((c) => `${clock(c.t)} ${c.title}`).join('\n');

// ---------- Designs ----------

export type KitFormat = 'thumbnail' | 'post' | 'story';

export const KIT_FORMATS: { id: KitFormat; label: string; width: number; height: number }[] = [
  { id: 'thumbnail', label: 'YouTube thumbnail', width: 1280, height: 720 },
  { id: 'post', label: 'Instagram post', width: 1080, height: 1080 },
  { id: 'story', label: 'Story / Reel cover', width: 1080, height: 1920 },
];

/** A design with the frame filling the page, the title and the handle. */
export function kitDesign(format: KitFormat, frame: { src: string; width: number; height: number }, title: string, handle: string, accent = '#facc15'): DesignDoc {
  const f = KIT_FORMATS.find((x) => x.id === format)!;
  let doc = createDoc(f.width, f.height, `${title} — ${f.label}`);
  doc.background = '#000000';
  const photo: ImageElement = {
    id: uid('image'),
    type: 'image',
    name: 'Video frame',
    src: frame.src,
    radius: 0,
    naturalWidth: frame.width,
    naturalHeight: frame.height,
    crop: { aspect: f.width / f.height, zoom: 1, cx: 0.5, cy: 0.5 },
    x: 0,
    y: 0,
    width: f.width,
    height: f.height,
    rotation: 0,
    opacity: 1,
    photo: { exposure: 0.1, temperature: 0, tint: 0, highlights: -10, shadows: 15, sharpen: 0.25, vignette: 0.3 },
  };
  doc = addElement(doc, photo);
  const m = Math.min(f.width, f.height);
  const words = title.toUpperCase();
  const lines = format === 'thumbnail' ? 2 : 3;
  // Big, bold, outlined title (the thumbnail style that gets clicks).
  const fontSize = Math.round(Math.min(m * (format === 'thumbnail' ? 0.15 : 0.12), (f.width * 0.9 * lines) / Math.max(4, words.length * 0.6)));
  const textH = Math.round(fontSize * 1.15 * Math.min(lines, Math.ceil((words.length * fontSize * 0.6) / (f.width * 0.88))));
  const y = format === 'story' ? Math.round(f.height * 0.38) : format === 'post' ? Math.round(f.height * 0.62) : Math.round(f.height * 0.56);
  doc = addElement(doc, { ...createShape(doc, 'rect'), name: 'Shade', x: 0, y: y - Math.round(m * 0.06), width: f.width, height: textH + Math.round(m * 0.14), fill: '#000000', opacity: 0.35, radius: 0 });
  doc = addElement(doc, createText(doc, { text: words, fontSize, fontWeight: 'bold', fontFamily: 'Impact, "Arial Black", sans-serif', color: '#ffffff', outlineWidth: Math.max(2, Math.round(fontSize / 14)), outlineColor: '#000000', shadow: true, x: Math.round(f.width * 0.06), y, width: Math.round(f.width * 0.88), height: textH, lineHeight: 1.15 }));
  if (handle) {
    const hs = Math.round(m * 0.045);
    doc = addElement(doc, { ...createShape(doc, 'rect'), name: 'Handle bar', x: Math.round(f.width * 0.06), y: y + textH + Math.round(m * 0.03), width: Math.round(Math.min(f.width * 0.6, (handle.length + 3) * hs * 0.62)), height: Math.round(hs * 1.7), fill: accent, radius: Math.round(hs * 0.85) });
    doc = addElement(doc, createText(doc, { text: handle.startsWith('@') ? handle : `@${handle}`, fontSize: hs, fontWeight: 'bold', color: '#111111', x: Math.round(f.width * 0.06), y: y + textH + Math.round(m * 0.03) + Math.round(hs * 0.32), width: Math.round(Math.min(f.width * 0.6, (handle.length + 3) * hs * 0.62)), height: Math.round(hs * 1.2) }));
  }
  return doc;
}
