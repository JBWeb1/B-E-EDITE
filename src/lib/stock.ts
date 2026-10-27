/**
 * Free stock media. Photos and sounds come from Openverse (openly licensed, no account
 * needed); videos from Pexels, with the user's own free Pexels key. Results carry their
 * licence and creator so credits can be given. Tests can swap the search with
 * `window.__beeStock`.
 */

export type StockKind = 'image' | 'audio' | 'video';

export interface StockItem {
  id: string;
  kind: StockKind;
  title: string;
  /** Small picture for the results. */
  thumb: string;
  /** The full file, and a smaller one to fall back to if the full one can't be fetched. */
  url: string;
  fallback?: string;
  width?: number;
  height?: number;
  /** Seconds (sounds and videos). */
  duration?: number;
  creator: string;
  license: string;
  source: string;
  /** Page about the item (for credits). */
  page?: string;
}

const KEY = 'bee.stock';
export const loadPexelsKey = (): string => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}').pexelsKey ?? '';
  } catch {
    return '';
  }
};
export const savePexelsKey = (pexelsKey: string) => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ pexelsKey }));
  } catch {
    /* private mode */
  }
};

interface OpenverseItem {
  id: string;
  title?: string;
  url: string;
  thumbnail?: string;
  width?: number;
  height?: number;
  duration?: number;
  creator?: string;
  license: string;
  license_version?: string;
  source?: string;
  provider?: string;
  foreign_landing_url?: string;
}

/** Openverse results as stock items. */
export function fromOpenverse(kind: 'image' | 'audio', results: OpenverseItem[]): StockItem[] {
  return results.map((r) => ({
    id: `ov-${r.id}`,
    kind,
    title: r.title?.trim() || (kind === 'image' ? 'Photo' : 'Sound'),
    thumb: r.thumbnail ?? (kind === 'image' ? r.url : ''),
    url: r.url,
    fallback: kind === 'image' ? `https://api.openverse.org/v1/images/${r.id}/thumb/` : undefined,
    width: r.width,
    height: r.height,
    duration: r.duration ? r.duration / 1000 : undefined,
    creator: r.creator?.trim() || 'Unknown',
    license: `${r.license.toUpperCase() === 'CC0' || r.license === 'pdm' ? r.license.toUpperCase() : `CC ${r.license.toUpperCase()}`}${r.license_version && r.license !== 'cc0' && r.license !== 'pdm' ? ` ${r.license_version}` : ''}`,
    source: r.source ?? r.provider ?? 'Openverse',
    page: r.foreign_landing_url,
  }));
}

interface PexelsVideo {
  id: number;
  url: string;
  image: string;
  duration: number;
  width: number;
  height: number;
  user: { name: string };
  video_files: { link: string; width: number; height: number; file_type: string }[];
}

/** Pexels videos as stock items (the HD MP4 closest to 1080p). */
export function fromPexels(videos: PexelsVideo[]): StockItem[] {
  return videos.map((v) => {
    const mp4 = v.video_files.filter((f) => f.file_type === 'video/mp4').sort((a, b) => Math.abs(Math.min(a.width, a.height) - 1080) - Math.abs(Math.min(b.width, b.height) - 1080));
    const small = [...mp4].sort((a, b) => a.width - b.width)[0];
    return {
      id: `px-${v.id}`,
      kind: 'video' as const,
      title: `Video by ${v.user.name}`,
      thumb: v.image,
      url: mp4[0]?.link ?? '',
      fallback: small?.link,
      width: v.width,
      height: v.height,
      duration: v.duration,
      creator: v.user.name,
      license: 'Pexels licence',
      source: 'Pexels',
      page: v.url,
    };
  }).filter((v) => v.url);
}

/** Search free stock media. */
export async function searchStock(kind: StockKind, query: string, page = 1): Promise<StockItem[]> {
  const override = (globalThis as { __beeStock?: { search: (k: StockKind, q: string, p: number) => Promise<StockItem[]> } }).__beeStock;
  if (override) return override.search(kind, query, page);
  const q = encodeURIComponent(query.trim());
  if (kind === 'video') {
    const key = loadPexelsKey();
    if (!key) throw new Error('Stock videos come from Pexels: add your free Pexels key below.');
    const r = await fetch(`https://api.pexels.com/videos/search?query=${q}&per_page=18&page=${page}`, { headers: { Authorization: key } });
    if (!r.ok) throw new Error(r.status === 401 ? 'Pexels did not accept that key.' : `Pexels said: ${r.status}`);
    return fromPexels((await r.json()).videos ?? []);
  }
  const r = await fetch(`https://api.openverse.org/v1/${kind === 'image' ? 'images' : 'audio'}/?q=${q}&page_size=24&page=${page}`);
  if (!r.ok) throw new Error(`The stock library said: ${r.status}`);
  return fromOpenverse(kind, (await r.json()).results ?? []);
}

/** Download a stock file (falling back to the smaller copy if the full one is blocked). */
export async function fetchStock(item: StockItem): Promise<Blob> {
  const override = (globalThis as { __beeStock?: { fetch?: (i: StockItem) => Promise<Blob> } }).__beeStock;
  if (override?.fetch) return override.fetch(item);
  for (const url of [item.url, item.fallback].filter((u): u is string => !!u)) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.blob();
    } catch {
      /* try the next one */
    }
  }
  throw new Error('Could not download that file. Try another one.');
}

/** Credit line for a stock item, e.g. “Sunset” by Ana (CC BY 4.0) via Flickr. */
export const creditLine = (i: StockItem) => `“${i.title}” by ${i.creator} (${i.license}) via ${i.source}`;

/** A file name for a stock item. */
export function stockFileName(i: StockItem, type: string): string {
  const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : type.includes('svg') ? 'svg' : type.includes('jpeg') || type.includes('jpg') ? 'jpg' : type.includes('mp4') ? 'mp4' : type.includes('webm') ? 'webm' : type.includes('mpeg') || type.includes('mp3') ? 'mp3' : type.includes('ogg') ? 'ogg' : type.includes('wav') ? 'wav' : i.kind === 'image' ? 'jpg' : i.kind === 'video' ? 'mp4' : 'mp3';
  // The credit travels with the file: “Title by Creator (licence)”.
  const base = `${i.title.slice(0, 40)} by ${i.creator.slice(0, 30)} (${i.license})`.replace(/[\\/:*?"<>|]+/g, '').trim();
  return `${base}.${ext}`;
}
