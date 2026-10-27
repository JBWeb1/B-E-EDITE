/**
 * Edit recipes: save how one video was edited (intro titles, caption style, colour
 * look, music, effects, transitions, watermark, shape) and replay it on another
 * video in one click — like Photoshop actions, for video.
 * Pure functions; the dialog stores recipes and copies their media.
 */
import { uid } from '../lib/id';
import { sameFilters } from '../lib/filters';
import { layoutClips, maxTransition, projectDuration } from './timeline';
import type { AudioClip, ClipFilters, EffectItem, MediaAsset, TextOverlay, Transition, VideoProject, Watermark } from './types';
import type { ColorGrade } from './grade';

export type RecipePart = 'shape' | 'intro' | 'outro' | 'captions' | 'look' | 'music' | 'effects' | 'transitions' | 'watermark';

export const RECIPE_PARTS: { id: RecipePart; label: string }[] = [
  { id: 'shape', label: 'Video shape' },
  { id: 'intro', label: 'Intro titles & sounds' },
  { id: 'outro', label: 'Outro / end screen' },
  { id: 'captions', label: 'Caption style' },
  { id: 'look', label: 'Colour look' },
  { id: 'music', label: 'Background music' },
  { id: 'effects', label: 'Effects at the start / end' },
  { id: 'transitions', label: 'Transitions' },
  { id: 'watermark', label: 'Watermark' },
];

/** A media file a recipe keeps its own copy of (music, logo). */
export type RecipeAsset = Omit<MediaAsset, 'url' | 'thumbnail' | 'peaks'> & { peaks?: number[] };

export interface Recipe {
  id: string;
  name: string;
  created: number;
  parts: RecipePart[];
  shape?: { width: number; height: number; fill?: 'color' | 'blur'; background: string };
  /** Items timed from the start of the video. */
  intro?: { texts: TextOverlay[]; sounds: AudioClip[] };
  /** Items timed back from the end (`start` = seconds before the end). */
  outro?: { texts: TextOverlay[]; sounds: AudioClip[] };
  captionStyle?: Partial<TextOverlay>;
  look?: { filters: ClipFilters; grade?: ColorGrade | null };
  music?: AudioClip;
  effects?: { item: EffectItem; fromEnd: boolean }[];
  transition?: Transition;
  watermark?: Watermark;
  assets: RecipeAsset[];
}

const INTRO = 3;
const OUTRO = 5;

/** Caption-looking texts: plain text (not titles or shapes) that appears several times at the same height. */
export function captionItems(texts: TextOverlay[]): TextOverlay[] {
  const plain = texts.filter((t) => !t.shape && !t.template && !t.animator);
  const rows = new Map<number, TextOverlay[]>();
  for (const t of plain) {
    const key = Math.round(t.y * 50);
    rows.set(key, [...(rows.get(key) ?? []), t]);
  }
  return [...rows.values()].filter((r) => r.length >= 2 || r.some((t) => t.words && t.words !== 'off')).flat();
}

const CAPTION_STYLE_KEYS = ['y', 'size', 'color', 'background', 'bold', 'stroke', 'glow', 'font', 'italic', 'words', 'accent', 'animation'] as const;

/** The length of the footage (main track and layers), not counting titles hanging off the end. */
export function footageLength(p: VideoProject): number {
  const placed = layoutClips(p.clips);
  const main = placed.length ? placed[placed.length - 1].end : 0;
  return Math.max(main, ...p.overlays.map((o) => o.start + o.out - o.in), main > 0 ? 0 : projectDuration(p));
}

/** Which parts this project has something for (with a short description each). */
export function detectParts(p: VideoProject): Partial<Record<RecipePart, string>> {
  const out: Partial<Record<RecipePart, string>> = {};
  const len = footageLength(p);
  const captions = new Set(captionItems(p.texts).map((t) => t.id));
  const titles = p.texts.filter((t) => !captions.has(t.id));
  const sfx = p.audio.filter((a) => p.assets.find((x) => x.id === a.assetId)?.sfxId);
  out.shape = `${p.width}×${p.height}`;
  const intro = titles.filter((t) => t.start < INTRO).length + sfx.filter((a) => a.start < INTRO).length;
  if (intro) out.intro = `${intro} item${intro === 1 ? '' : 's'}`;
  const outro = titles.filter((t) => t.start >= len - OUTRO && t.start >= INTRO).length + sfx.filter((a) => a.start >= len - OUTRO && a.start >= INTRO).length;
  if (outro) out.outro = `${outro} item${outro === 1 ? '' : 's'}`;
  if (captions.size) out.captions = 'from your captions';
  const first = p.clips[0];
  if (first && (!sameFilters(first.filters, { brightness: 1, contrast: 1, saturation: 1, blur: 0, grayscale: 0 }) || first.grade)) out.look = 'from the first clip';
  const music = musicClip(p);
  if (music) out.music = p.assets.find((a) => a.id === music.assetId)?.name ?? 'music';
  const fx = p.effects.filter((e) => e.start < INTRO || e.start >= len - OUTRO).length;
  if (fx) out.effects = `${fx} effect${fx === 1 ? '' : 's'}`;
  const tr = commonTransition(p);
  if (tr) out.transitions = tr.type;
  if (p.watermark) out.watermark = p.watermark.assetId ? 'logo' : `“${p.watermark.text}”`;
  return out;
}

function musicClip(p: VideoProject): AudioClip | undefined {
  return p.audio.find((a) => {
    const asset = p.assets.find((x) => x.id === a.assetId);
    return asset?.kind === 'audio' && !asset.sfxId && a.out - a.in >= 5 && !asset.name.startsWith('Voice-over') && !asset.name.startsWith('AI voice');
  });
}

function commonTransition(p: VideoProject): Transition | undefined {
  const counts = new Map<string, { t: Transition; n: number }>();
  for (const c of p.clips.slice(1)) if (c.transition) counts.set(c.transition.type, { t: c.transition, n: (counts.get(c.transition.type)?.n ?? 0) + 1 });
  return [...counts.values()].sort((a, b) => b.n - a.n)[0]?.t;
}

const strip = (a: MediaAsset): RecipeAsset => {
  const { url: _url, thumbnail: _thumb, ...rest } = a;
  return rest;
};

/** Save the chosen parts of a project as a recipe. `assets` lists media the recipe must keep a copy of. */
export function extractRecipe(p: VideoProject, parts: RecipePart[], name: string): Recipe {
  const len = footageLength(p);
  const has = (x: RecipePart) => parts.includes(x);
  const captions = new Set(captionItems(p.texts).map((t) => t.id));
  const titles = p.texts.filter((t) => !captions.has(t.id));
  const assetOf = (id: string) => p.assets.find((a) => a.id === id);
  const sfx = p.audio.filter((a) => assetOf(a.assetId)?.sfxId);
  const assets = new Map<string, RecipeAsset>();
  const keep = (id: string | undefined) => {
    const a = id && assetOf(id);
    if (a) assets.set(a.id, strip(a));
  };
  const r: Recipe = { id: uid('recipe'), name, created: Date.now(), parts, assets: [] };
  if (has('shape')) r.shape = { width: p.width, height: p.height, fill: p.fill, background: p.background };
  if (has('intro')) {
    r.intro = { texts: titles.filter((t) => t.start < INTRO), sounds: sfx.filter((a) => a.start < INTRO) };
    r.intro.sounds.forEach((s) => keep(s.assetId));
  }
  if (has('outro')) {
    const late = (s: number) => s >= len - OUTRO && s >= INTRO;
    r.outro = {
      texts: titles.filter((t) => late(t.start)).map((t) => ({ ...t, start: len - t.start })),
      sounds: sfx.filter((a) => late(a.start)).map((a) => ({ ...a, start: len - a.start })),
    };
    r.outro.sounds.forEach((s) => keep(s.assetId));
  }
  if (has('captions')) {
    const first = p.texts.find((t) => captions.has(t.id));
    if (first) r.captionStyle = Object.fromEntries(CAPTION_STYLE_KEYS.map((k) => [k, first[k]])) as Partial<TextOverlay>;
  }
  if (has('look') && p.clips[0]) r.look = { filters: p.clips[0].filters, grade: p.clips[0].grade ?? null };
  if (has('music')) {
    r.music = musicClip(p);
    keep(r.music?.assetId);
  }
  if (has('effects')) r.effects = p.effects.filter((e) => e.start < INTRO || e.start >= len - OUTRO).map((e) => (e.start < INTRO ? { item: e, fromEnd: false } : { item: { ...e, start: len - e.start }, fromEnd: true }));
  if (has('transitions')) r.transition = commonTransition(p);
  if (has('watermark') && p.watermark) {
    r.watermark = p.watermark;
    keep(p.watermark.assetId);
  }
  r.assets = [...assets.values()];
  return r;
}

/** What applying the recipe will do, in words. */
export function describeRecipe(r: Recipe): string[] {
  const out: string[] = [];
  if (r.shape) out.push(`Shape ${r.shape.width}×${r.shape.height}`);
  if (r.intro && r.intro.texts.length + r.intro.sounds.length) out.push(`Intro: ${r.intro.texts.length} title${r.intro.texts.length === 1 ? '' : 's'}${r.intro.sounds.length ? `, ${r.intro.sounds.length} sound${r.intro.sounds.length === 1 ? '' : 's'}` : ''}`);
  if (r.outro && r.outro.texts.length + r.outro.sounds.length) out.push(`Outro: ${r.outro.texts.length + r.outro.sounds.length} item${r.outro.texts.length + r.outro.sounds.length === 1 ? '' : 's'}`);
  if (r.captionStyle) out.push('Caption style');
  if (r.look) out.push('Colour look on every clip');
  if (r.music) out.push(`Music: ${r.assets.find((a) => a.id === r.music!.assetId)?.name ?? 'music'}`);
  if (r.effects?.length) out.push(`${r.effects.length} effect${r.effects.length === 1 ? '' : 's'}`);
  if (r.transition) out.push(`${r.transition.type} transitions`);
  if (r.watermark) out.push('Watermark');
  return out;
}

/**
 * Apply a recipe to a project. `assets` are the recipe's media files, ready to use
 * (ids as in the recipe, with fresh URLs).
 */
export function applyRecipe(p: VideoProject, r: Recipe, assets: MediaAsset[]): VideoProject {
  let next: VideoProject = { ...p, assets: [...p.assets, ...assets.filter((a) => !p.assets.some((x) => x.id === a.id))] };
  if (r.shape) next = { ...next, width: r.shape.width, height: r.shape.height, fill: r.shape.fill, background: r.shape.background };
  const len = footageLength(next);
  const fresh = <T extends { id: string }>(x: T, prefix: string): T => ({ ...x, id: uid(prefix) });
  const texts: TextOverlay[] = [];
  const audio: AudioClip[] = [];
  if (r.intro) {
    texts.push(...r.intro.texts.map((t) => fresh(t, 'text')));
    audio.push(...r.intro.sounds.map((a) => fresh(a, 'audio')));
  }
  if (r.outro) {
    texts.push(...r.outro.texts.map((t) => ({ ...fresh(t, 'text'), start: Math.max(0, len - t.start) })));
    audio.push(...r.outro.sounds.map((a) => ({ ...fresh(a, 'audio'), start: Math.max(0, len - a.start) })));
  }
  let current = next.texts;
  if (r.captionStyle) {
    const ids = new Set(captionItems(current).map((t) => t.id));
    current = current.map((t) => (ids.has(t.id) ? { ...t, ...r.captionStyle } : t));
  }
  next = { ...next, texts: [...current, ...texts] };
  if (r.look) next = { ...next, clips: next.clips.map((c) => ({ ...c, filters: r.look!.filters, grade: r.look!.grade ?? undefined })) };
  if (r.music) {
    const m = r.music;
    const length = Math.max(1, Math.min(m.out - m.in, len || m.out - m.in));
    audio.push({ ...fresh(m, 'audio'), start: 0, out: m.in + length });
  }
  next = { ...next, audio: [...next.audio, ...audio] };
  if (r.effects?.length) {
    next = { ...next, effects: [...next.effects, ...r.effects.map(({ item, fromEnd }) => ({ ...fresh(item, 'fx'), start: fromEnd ? Math.max(0, len - item.start) : item.start }))] };
  }
  if (r.transition) {
    const tr = r.transition;
    next = { ...next, clips: next.clips.map((c, i) => (i === 0 ? c : { ...c, transition: { ...tr, duration: Math.min(tr.duration, maxTransition(c)) } })) };
  }
  if (r.watermark) next = { ...next, watermark: r.watermark };
  return next;
}
