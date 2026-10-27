/**
 * Visual history: name each step ("Added text “Hello”", "Trimmed a clip"…) and list
 * what is different between two versions. Pure, so it is unit-tested.
 */
import { uid } from '../lib/id';
import type { SavedVersion, VideoProject } from './types';

type Item = { id: string };
const byId = <T extends Item>(list: T[]) => new Map(list.map((x) => [x.id, x]));
const quote = (s: string) => `“${s.split('\n')[0].slice(0, 24)}${s.length > 24 ? '…' : ''}”`;

interface Collection {
  key: 'clips' | 'texts' | 'audio' | 'overlays' | 'effects';
  one: string;
  name: (x: never, p: VideoProject) => string;
}

const COLLECTIONS: Collection[] = [
  { key: 'clips', one: 'clip', name: (c: { assetId: string }, p: VideoProject) => p.assets.find((x: { id: string }) => x.id === c.assetId)?.name ?? 'clip' },
  { key: 'texts', one: 'text', name: (t: { text: string; shape?: string }) => (t.shape ? `${t.shape} shape` : quote(t.text)) },
  { key: 'audio', one: 'sound', name: (a: { assetId: string }, p: VideoProject) => p.assets.find((x: { id: string }) => x.id === a.assetId)?.name ?? 'sound' },
  { key: 'overlays', one: 'layer', name: (o: { assetId: string }, p: VideoProject) => p.assets.find((x: { id: string }) => x.id === o.assetId)?.name ?? 'layer' },
  { key: 'effects', one: 'effect', name: (e: { type: string }) => e.type.replace('-', ' ') },
] as unknown as Collection[];

/** What a clip edit was, in words. */
function clipEdit(a: Record<string, unknown>, b: Record<string, unknown>): string {
  if (a.in !== b.in || a.out !== b.out) return 'Trimmed';
  if (a.speed !== b.speed || a.ramp !== b.ramp) return 'Changed the speed of';
  if (a.transition !== b.transition) return 'Changed the transition of';
  if (a.filters !== b.filters || a.grade !== b.grade) return 'Changed the colour of';
  if (a.volume !== b.volume || a.fadeIn !== b.fadeIn || a.fadeOut !== b.fadeOut) return 'Changed the sound of';
  if (a.keys !== b.keys) return 'Animated';
  if (a.start !== b.start) return 'Moved';
  return 'Edited';
}

/** All the differences from `a` to `b`, most important first. */
export function changes(a: VideoProject, b: VideoProject): string[] {
  const out: string[] = [];
  if (a.width !== b.width || a.height !== b.height) out.push(`Changed the size to ${b.width}×${b.height}`);
  for (const c of COLLECTIONS) {
    const before = a[c.key] as Item[];
    const after = b[c.key] as Item[];
    if (before === after) continue;
    const old = byId(before);
    const now = byId(after);
    const added = after.filter((x) => !old.has(x.id));
    const removed = before.filter((x) => !now.has(x.id));
    const name = (x: Item, p: VideoProject) => c.name(x as never, p);
    if (added.length === 1) out.push(`Added ${c.one === 'text' ? '' : `${c.one} `}${name(added[0], b)}`.replace('Added “', 'Added text “'));
    else if (added.length > 1) out.push(`Added ${added.length} ${c.one}s`);
    if (removed.length === 1) out.push(`Deleted ${c.one === 'text' ? 'text ' : `${c.one} `}${name(removed[0], a)}`);
    else if (removed.length > 1) out.push(`Deleted ${removed.length} ${c.one}s`);
    const edited = after.filter((x) => old.has(x.id) && old.get(x.id) !== x);
    if (edited.length === 1) {
      const prev = old.get(edited[0].id)!;
      const verb = c.key === 'clips' || c.key === 'overlays' || c.key === 'audio' ? clipEdit(prev as never, edited[0] as never) : (prev as { text?: string }).text !== (edited[0] as { text?: string }).text ? 'Rewrote' : (prev as { start?: number }).start !== (edited[0] as { start?: number }).start ? 'Moved' : 'Styled';
      out.push(`${verb} ${c.one === 'text' && verb !== 'Rewrote' ? 'text ' : c.one === 'text' ? '' : 'the ' + c.one + ' '}${name(edited[0], b)}`.replace(/ +/g, ' '));
    } else if (edited.length > 1) out.push(`Edited ${edited.length} ${c.one}s`);
    if (!added.length && !removed.length && !edited.length && before.some((x, i) => after[i] !== x)) out.push(`Reordered ${c.one}s`);
  }
  if (a.watermark !== b.watermark) out.push(b.watermark ? 'Changed the watermark' : 'Removed the watermark');
  if (a.fill !== b.fill || a.background !== b.background) out.push('Changed the background');
  if (a.name !== b.name) out.push(`Renamed to ${quote(b.name)}`);
  if (a.tracks !== b.tracks) out.push('Changed track settings');
  return out;
}

/** One-line name for the step from `a` to `b`. */
export function describeChange(a: VideoProject | undefined, b: VideoProject): string {
  if (!a) return 'Start';
  const list = changes(a, b);
  if (list.length === 0) return 'Small change';
  return list.length === 1 ? list[0] : `${list[0]} (+${list.length - 1} more)`;
}

/** A project without its saved versions (what a version stores). */
export function snapshot(p: VideoProject): Omit<VideoProject, 'versions'> {
  const { versions: _v, ...rest } = p;
  return rest;
}

export const MAX_VERSIONS = 20;

export function saveVersion(p: VideoProject, name: string, at = Date.now()): VideoProject {
  const v: SavedVersion = { id: uid('ver'), name: name.trim() || `Version ${(p.versions?.length ?? 0) + 1}`, at, project: snapshot(p) };
  return { ...p, versions: [v, ...(p.versions ?? [])].slice(0, MAX_VERSIONS) };
}

/** Go back to a saved version, keeping the list of versions (and the media). */
export function restoreVersion(p: VideoProject, v: SavedVersion): VideoProject {
  // Use today's links to the media (old links stop working after a reload).
  const assets = [...v.project.assets.map((a) => p.assets.find((x) => x.id === a.id) ?? a), ...p.assets.filter((a) => !v.project.assets.some((x) => x.id === a.id))];
  return { ...v.project, assets, versions: p.versions };
}
