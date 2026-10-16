/**
 * A whole video project in one file (.bemotion): the project plus every media file,
 * so it can be emailed, put on a USB stick or sent to another device.
 * Layout: "BEMOTION1" · 4-byte header length · JSON header · the files back to back.
 */
import type { MediaAsset, VideoProject } from '../video/types';

const MAGIC = 'BEMOTION1';

interface Header {
  project: VideoProject;
  files: { id: string; type: string; size: number }[];
}

/** Pack a project and its media (fetched from the asset URLs) into one file. */
export async function packProject(p: VideoProject): Promise<Blob> {
  const blobs: { id: string; blob: Blob }[] = [];
  const ids = new Set<string>();
  const wanted = [...p.assets, ...(p.versions ?? []).flatMap((v) => v.project.assets)];
  for (const a of wanted) {
    if (ids.has(a.id) || !a.url) continue;
    ids.add(a.id);
    try {
      blobs.push({ id: a.id, blob: await (await fetch(a.url)).blob() });
    } catch {
      /* missing media: the project opens without it */
    }
  }
  const strip = (list: MediaAsset[]) => list.map((a) => ({ ...a, url: '', thumbnail: a.thumbnail?.startsWith('blob:') ? undefined : a.thumbnail }));
  const project: VideoProject = { ...p, assets: strip(p.assets), versions: p.versions?.map((v) => ({ ...v, project: { ...v.project, assets: strip(v.project.assets) } })) };
  const header: Header = { project, files: blobs.map((b) => ({ id: b.id, type: b.blob.type, size: b.blob.size })) };
  const json = new TextEncoder().encode(JSON.stringify(header));
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, json.length);
  return new Blob([MAGIC, len, json, ...blobs.map((b) => b.blob)], { type: 'application/x-bemotion' });
}

/** Read a .bemotion file. Media come back as blobs keyed by asset id. */
export async function unpackProject(file: Blob): Promise<{ project: VideoProject; files: Map<string, Blob> }> {
  const head = new Uint8Array(await file.slice(0, MAGIC.length + 4).arrayBuffer());
  if (new TextDecoder().decode(head.subarray(0, MAGIC.length)) !== MAGIC) throw new Error('This is not a B-E Motion project file.');
  const len = new DataView(head.buffer).getUint32(MAGIC.length);
  const start = MAGIC.length + 4;
  const header: Header = JSON.parse(await file.slice(start, start + len).text());
  const files = new Map<string, Blob>();
  let at = start + len;
  for (const f of header.files) {
    files.set(f.id, file.slice(at, at + f.size, f.type));
    at += f.size;
  }
  return { project: header.project, files };
}

/** Give the project's assets working links to their media. */
export function attachMedia(p: VideoProject, files: Map<string, Blob>): VideoProject {
  const link = (a: MediaAsset): MediaAsset => {
    const blob = files.get(a.id);
    if (!blob) return a;
    const url = URL.createObjectURL(blob);
    return { ...a, url, thumbnail: a.kind === 'image' ? url : a.thumbnail };
  };
  const assets = p.assets.map(link).filter((a) => a.url);
  const ids = new Set(assets.map((a) => a.id));
  return {
    ...p,
    assets,
    clips: p.clips.filter((c) => ids.has(c.assetId)),
    audio: p.audio.filter((c) => ids.has(c.assetId)),
    overlays: p.overlays.filter((c) => ids.has(c.assetId)),
    versions: p.versions?.map((v) => ({ ...v, project: { ...v.project, assets: v.project.assets.map((a) => assets.find((x) => x.id === a.id) ?? a) } })),
  };
}
