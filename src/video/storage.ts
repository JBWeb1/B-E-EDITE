import type { VideoProject } from './types';

/**
 * Video projects are saved in IndexedDB: the project JSON under one key, and
 * every imported media file as a Blob keyed by asset id. Object URLs only live
 * for one page load, so they are rebuilt from the blobs when a project loads.
 */
const DB_NAME = 'bee-editor';
const MEDIA = 'media';
const PROJECTS = 'projects';
const AUTOSAVE = 'video-autosave';

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

/** Save the project (without session-only object URLs). */
export function saveVideoProject(project: VideoProject): Promise<void> {
  const stored = {
    ...project,
    savedAt: Date.now(),
    assets: project.assets.map((a) => ({
      ...a,
      url: '',
      thumbnail: a.thumbnail?.startsWith('blob:') ? undefined : a.thumbnail,
    })),
  };
  return request(PROJECTS, 'readwrite', (s) => s.put(stored, AUTOSAVE));
}

export interface SavedVideoInfo {
  name: string;
  width: number;
  height: number;
  clipCount: number;
  thumbnail?: string;
}

export async function getSavedVideoInfo(): Promise<SavedVideoInfo | null> {
  try {
    const p = await request<VideoProject | undefined>(PROJECTS, 'readonly', (s) => s.get(AUTOSAVE));
    if (!p) return null;
    const firstVisual = p.clips.map((c) => p.assets.find((a) => a.id === c.assetId)).find((a) => a?.thumbnail);
    return { name: p.name, width: p.width, height: p.height, clipCount: p.clips.length, thumbnail: firstVisual?.thumbnail };
  } catch {
    return null;
  }
}

/** Load the autosaved project, recreating media URLs. Assets whose file is missing are dropped. */
export async function loadVideoProject(): Promise<VideoProject | null> {
  const p = await request<VideoProject | undefined>(PROJECTS, 'readonly', (s) => s.get(AUTOSAVE));
  if (!p) return null;
  const assets = [];
  for (const a of p.assets) {
    const blob = await request<Blob | undefined>(MEDIA, 'readonly', (s) => s.get(a.id));
    if (!blob) continue;
    const url = URL.createObjectURL(blob);
    assets.push({ ...a, url, thumbnail: a.kind === 'image' ? url : a.thumbnail });
  }
  const ids = new Set(assets.map((a) => a.id));
  await removeUnusedMedia(ids);
  return {
    ...p,
    assets,
    clips: p.clips.filter((c) => ids.has(c.assetId)),
    audio: p.audio.filter((c) => ids.has(c.assetId)),
  };
}

async function removeUnusedMedia(keep: Set<string>) {
  const keys = await request<IDBValidKey[]>(MEDIA, 'readonly', (s) => s.getAllKeys());
  await Promise.all(keys.filter((k) => !keep.has(String(k))).map((k) => request(MEDIA, 'readwrite', (s) => s.delete(k))));
}
