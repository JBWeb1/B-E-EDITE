/**
 * Live editing: keeps two editors showing the same project. Every change is sent to
 * the other device (new media files first), and its changes are applied here.
 * The last change wins; each side can still undo.
 */
import { useEffect, useRef, useState } from 'react';
import { packProject } from '../lib/bundle';
import type { Peer } from '../lib/p2p';
import { putMedia } from '../lib/projects';
import type { MediaAsset, VideoProject } from './types';

const stripAsset = (a: MediaAsset): MediaAsset => ({ ...a, url: '', thumbnail: a.thumbnail?.startsWith('blob:') ? undefined : a.thumbnail });

/** The project as sent: no saved versions, no device-only links. */
export const serializeProject = (p: VideoProject) => JSON.stringify({ ...p, versions: undefined, assets: p.assets.map(stripAsset) });

export type LiveState = 'off' | 'connecting' | 'live' | 'ended';

export function useLive(peer: Peer | null, project: VideoProject, apply: (p: VideoProject) => void, sendBundleFirst: boolean) {
  const [state, setState] = useState<LiveState>(peer ? 'live' : 'off');
  const [receiving, setReceiving] = useState<number | null>(null);
  /** Bumped when the first transfer is done, so changes made meanwhile are sent. */
  const [tick, setTick] = useState(0);
  const projectRef = useRef(project);
  projectRef.current = project;
  const applyRef = useRef(apply);
  applyRef.current = apply;
  /** Media the other side already has. */
  const known = useRef(new Set<string>());
  const received = useRef(new Map<string, MediaAsset>());
  const lastJson = useRef('');
  const pending = useRef<VideoProject | null>(null);
  const ready = useRef(false);

  useEffect(() => {
    if (!peer) return;
    setState('live');
    known.current = new Set(projectRef.current.assets.map((a) => a.id));
    lastJson.current = serializeProject(projectRef.current);
    ready.current = !sendBundleFirst;
    const tryApply = () => {
      const p = pending.current;
      if (!p) return;
      const here = new Map(projectRef.current.assets.map((a) => [a.id, a]));
      const assets: MediaAsset[] = [];
      for (const a of p.assets) {
        const local = here.get(a.id) ?? received.current.get(a.id);
        if (!local) return; // wait for the file
        assets.push(local);
      }
      pending.current = null;
      applyRef.current({ ...p, assets, versions: projectRef.current.versions });
    };
    const offMsg = peer.onMessage((m) => {
      if (m.t !== 'project') return;
      lastJson.current = m.json as string;
      pending.current = JSON.parse(m.json as string);
      tryApply();
    });
    const offFile = peer.onFile((file, meta) => {
      setReceiving(null);
      if (meta.kind !== 'asset') return;
      const asset = meta.asset as MediaAsset;
      const url = URL.createObjectURL(file);
      received.current.set(asset.id, { ...asset, url, thumbnail: asset.kind === 'image' ? url : asset.thumbnail });
      known.current.add(asset.id);
      void putMedia(asset.id, file).catch(() => {});
      tryApply();
    });
    const offRecv = peer.onReceiving((_n, f) => setReceiving(f < 1 ? f : null));
    const offClose = peer.onClose(() => setState('ended'));
    if (sendBundleFirst) {
      // The guest starts from the whole project with its media.
      void packProject(projectRef.current).then(async (bundle) => {
        await peer.sendFile(bundle, 'project.bemotion', { kind: 'bundle' });
        ready.current = true;
        setTick((n) => n + 1);
      });
    }
    return () => {
      offMsg();
      offFile();
      offRecv();
      offClose();
    };
  }, [peer, sendBundleFirst]);

  // Send our changes (debounced), new media first.
  useEffect(() => {
    if (!peer || state !== 'live') return;
    const t = setTimeout(async () => {
      if (!ready.current) return;
      const json = serializeProject(project);
      if (json === lastJson.current) return;
      lastJson.current = json;
      for (const a of project.assets) {
        if (known.current.has(a.id) || !a.url) continue;
        known.current.add(a.id);
        try {
          await peer.sendFile(await (await fetch(a.url)).blob(), a.name, { kind: 'asset', asset: stripAsset(a) });
        } catch {
          known.current.delete(a.id);
        }
      }
      peer.send({ t: 'project', json });
    }, 250);
    return () => clearTimeout(t);
  }, [peer, project, state, tick]);

  return { state, receiving, stop: () => (peer?.close(), setState('ended')) };
}
