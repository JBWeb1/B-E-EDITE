import { normalizeFile } from '../design/pages';
import type { DesignDoc, DesignFile } from '../design/types';
import type { VideoProject } from '../video/types';
import { normalizeProject } from '../video/timeline';
import { uid } from './id';

/**
 * Saved projects live in IndexedDB so they survive closing the tab.
 *
 * - `projects`: one record per project (design or video), with a small thumbnail.
 * - `media`: imported video/audio/photo files for video projects, keyed by asset id.
 *   Object URLs only last one page load, so they are rebuilt when a project opens.
 */
const DB_NAME = 'bee-editor';
const MEDIA = 'media';
const PROJECTS = 'projects';
/** Key used by v0.2, which kept a single video project. */
const LEGACY_VIDEO_KEY = 'video-autosave';
/** localStorage key used by v0.1/v0.2 for the single design autosave. */
export const LEGACY_DESIGN_KEY = 'bee.design.autosave';

export type ProjectKind = 'design' | 'video';

export interface ProjectRecord<T = DesignFile | VideoProject> {
  id: string;
  kind: ProjectKind;
  name: string;
  updatedAt: number;
  thumbnail?: string;
  data: T;
}

export type ProjectSummary = Omit<ProjectRecord, 'data'> & { detail: string };

export const newProjectId = () => uid('proj');

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(MEDIA);
      req.result.createObjectStore(PROJECTS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

function request<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(req.result as T);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

export function putMedia(id: string, blob: Blob): Promise<void> {
  return request(MEDIA, 'readwrite', (s) => s.put(blob, id));
}

export function getMedia(id: string): Promise<Blob | undefined> {
  return request<Blob | undefined>(MEDIA, 'readonly', (s) => s.get(id));
}

/** Media kept by edit recipes (music, logos) uses this id prefix and is never cleaned up. */
export const RECIPE_MEDIA_PREFIX = 'recipe-';

export function saveDesignProject(id: string, file: DesignFile, thumbnail?: string): Promise<void> {
  const rec: ProjectRecord<DesignFile> = { id, kind: 'design', name: file.name, updatedAt: Date.now(), thumbnail, data: file };
  return request(PROJECTS, 'readwrite', (s) => s.put(rec, id));
}

/** Save a video project without its session-only object URLs. */
export function saveVideoProject(id: string, project: VideoProject): Promise<void> {
  const data: VideoProject = {
    ...project,
    assets: project.assets.map((a) => ({
      ...a,
      url: '',
      thumbnail: a.thumbnail?.startsWith('blob:') ? undefined : a.thumbnail,
    })),
  };
  const firstVisual = project.clips.map((c) => data.assets.find((a) => a.id === c.assetId)).find((a) => a?.thumbnail);
  const rec: ProjectRecord<VideoProject> = {
    id,
    kind: 'video',
    name: project.name,
    updatedAt: Date.now(),
    thumbnail: firstVisual?.thumbnail,
    data,
  };
  return request(PROJECTS, 'readwrite', (s) => s.put(rec, id));
}

/** Bring older saved formats into the current shape (runs once, then they are rewritten). */
async function migrateLegacy() {
  try {
    const raw = localStorage.getItem(LEGACY_DESIGN_KEY);
    if (raw) {
      const doc = JSON.parse(raw) as DesignDoc;
      if (Array.isArray(doc?.elements) && doc.elements.length > 0) await saveDesignProject(newProjectId(), normalizeFile(doc));
      localStorage.removeItem(LEGACY_DESIGN_KEY);
    }
  } catch {
    // Unreadable legacy data: nothing to migrate.
  }
  const legacy = await request<(VideoProject & { savedAt?: number }) | undefined>(PROJECTS, 'readonly', (s) =>
    s.get(LEGACY_VIDEO_KEY),
  );
  if (legacy && !(legacy as unknown as ProjectRecord).kind) {
    const id = newProjectId();
    await saveVideoProject(id, legacy);
    await request(PROJECTS, 'readwrite', (s) => s.delete(LEGACY_VIDEO_KEY));
  }
}

function describe(rec: ProjectRecord): string {
  if (rec.kind === 'design') {
    const d = normalizeFile(rec.data as DesignFile | DesignDoc);
    const pages = d.pages.length > 1 ? ` · ${d.pages.length} pages` : '';
    return `Design · ${d.width}×${d.height}${pages}`;
  }
  const v = rec.data as VideoProject;
  return `Video · ${v.clips.length} clip${v.clips.length === 1 ? '' : 's'}`;
}

/** All saved projects, most recently edited first. */
export async function listProjects(): Promise<ProjectSummary[]> {
  await migrateLegacy();
  const all = await request<ProjectRecord[]>(PROJECTS, 'readonly', (s) => s.getAll());
  return all
    .filter((r) => r && r.kind)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((r) => ({ id: r.id, kind: r.kind, name: r.name, updatedAt: r.updatedAt, thumbnail: r.thumbnail, detail: describe(r) }));
}

export async function loadDesignProject(id: string): Promise<DesignFile | null> {
  // Projects saved before multi-page support hold a single-page DesignDoc.
  const rec = await request<ProjectRecord<DesignFile | DesignDoc> | undefined>(PROJECTS, 'readonly', (s) => s.get(id));
  return rec?.kind === 'design' ? normalizeFile(rec.data) : null;
}

/** Load a video project, recreating media URLs. Assets whose file is missing are dropped. */
export async function loadVideoProject(id: string): Promise<VideoProject | null> {
  const rec = await request<ProjectRecord<VideoProject> | undefined>(PROJECTS, 'readonly', (s) => s.get(id));
  if (rec?.kind !== 'video') return null;
  const p = normalizeProject(rec.data);
  const assets = [];
  for (const a of p.assets) {
    const blob = await request<Blob | undefined>(MEDIA, 'readonly', (s) => s.get(a.id));
    if (!blob) continue;
    const url = URL.createObjectURL(blob);
    assets.push({ ...a, url, thumbnail: a.kind === 'image' ? url : a.thumbnail });
  }
  const ids = new Set(assets.map((a) => a.id));
  // Saved versions point at the same media; give them today's links too.
  const urls = new Map(assets.map((a) => [a.id, a]));
  const versions = p.versions?.map((v) => ({ ...v, project: { ...v.project, assets: v.project.assets.map((a) => urls.get(a.id) ?? a) } }));
  return {
    ...p,
    versions,
    assets,
    clips: p.clips.filter((c) => ids.has(c.assetId)),
    audio: p.audio.filter((c) => ids.has(c.assetId)),
    overlays: p.overlays.filter((c) => ids.has(c.assetId)),
  };
}

export async function deleteProject(id: string): Promise<void> {
  await request(PROJECTS, 'readwrite', (s) => s.delete(id));
  await removeUnusedMedia();
}

/** Delete media files that no saved video project refers to any more. */
async function removeUnusedMedia() {
  const all = await request<ProjectRecord[]>(PROJECTS, 'readonly', (s) => s.getAll());
  const used = new Set(
    all
      .filter((r) => r.kind === 'video')
      .flatMap((r) => {
        const p = r.data as VideoProject;
        const all = [p, ...(p.versions ?? []).map((v) => v.project)];
        const cutouts = all.flatMap((q) => [...q.clips, ...q.overlays]).flatMap((c) => (c.cutout ? [`cutout-${c.cutout.id}`] : []));
        return [...all.flatMap((q) => q.assets.map((a) => a.id)), ...cutouts];
      }),
  );
  const keys = await request<IDBValidKey[]>(MEDIA, 'readonly', (s) => s.getAllKeys());
  await Promise.all(keys.filter((k) => !used.has(String(k)) && !String(k).startsWith(RECIPE_MEDIA_PREFIX)).map((k) => request(MEDIA, 'readwrite', (s) => s.delete(k))));
}
