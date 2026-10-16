import { useEffect, useMemo, useRef, useState } from 'react';
import { formatTime } from '../lib/download';
import type { History } from '../lib/history';
import { Icon } from '../ui/Icon';
import { VideoEngine } from './engine';
import { projectDuration } from './timeline';
import type { SavedVersion, VideoProject } from './types';
import { changes, describeChange } from './versions';

interface Entry {
  key: string;
  label: string;
  project: VideoProject;
  /** Index in the undo history, or the saved version. */
  step?: number;
  version?: SavedVersion;
}

/** Renders projects at a time into small images, one at a time (they share one hidden engine). */
function useFrameRenderer() {
  const engine = useRef<VideoEngine | null>(null);
  const queue = useRef(Promise.resolve());
  useEffect(() => () => engine.current?.destroy(), []);
  return (p: VideoProject, t: number, width: number): Promise<string> => {
    const job = queue.current.then(async () => {
      if (!engine.current) engine.current = new VideoEngine(document.createElement('canvas'));
      engine.current.setProject(p);
      const c = await engine.current.renderAt(Math.min(t, Math.max(0, projectDuration(p) - 0.01)));
      const out = document.createElement('canvas');
      out.width = width;
      out.height = Math.round((width * p.height) / p.width);
      out.getContext('2d')!.drawImage(c, 0, 0, out.width, out.height);
      return out.toDataURL('image/jpeg', 0.8);
    });
    queue.current = job.then(
      () => undefined,
      () => undefined,
    );
    return job;
  };
}

/**
 * Every step of this session plus the versions saved by name, as pictures. Pick one
 * to compare it side by side with now, then go back to it (nothing is lost: you can
 * come forward again).
 */
export function HistoryDialog({
  steps,
  time,
  onJump,
  onRestore,
  onSaveVersion,
  onDeleteVersion,
  onClose,
}: {
  steps: History<VideoProject>;
  time: number;
  onJump: (index: number) => void;
  onRestore: (v: SavedVersion) => void;
  onSaveVersion: (name: string) => void;
  onDeleteVersion: (id: string) => void;
  onClose: () => void;
}) {
  const current = steps.present;
  const all = useMemo(() => [...steps.past, steps.present, ...steps.future], [steps]);
  const now = steps.past.length;
  const entries: Entry[] = useMemo(
    () => [
      ...all.map((p, i) => ({ key: `s${i}`, label: describeChange(all[i - 1], p), project: p, step: i })).reverse(),
      ...(current.versions ?? []).map((v) => ({ key: v.id, label: v.name, project: { ...v.project, versions: current.versions } as VideoProject, version: v })),
    ],
    [all, current.versions],
  );
  const [picked, setPicked] = useState<string>(() => entries.find((e) => e.step === Math.max(0, now - 1))?.key ?? entries[0].key);
  const [at, setAt] = useState(time);
  const [name, setName] = useState('');
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [compare, setCompare] = useState<{ then?: string; now?: string }>({});
  const render = useFrameRenderer();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCloseRef.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const pick = entries.find((e) => e.key === picked) ?? entries[0];
  const length = Math.max(projectDuration(current), projectDuration(pick.project));

  // Thumbnails for the strip (newest first, a few at a time).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const e of entries.slice(0, 40)) {
        if (cancelled || thumbs[e.key]) continue;
        const src = await render(e.project, at, 160).catch(() => '');
        if (!cancelled && src) setThumbs((t) => ({ ...t, [e.key]: src }));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);

  // The two big pictures.
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      const then = await render(pick.project, at, 480).catch(() => undefined);
      const nowSrc = await render(current, at, 480).catch(() => undefined);
      if (!cancelled) setCompare({ then, now: nowSrc });
    }, 60);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pick.key, at, current]);

  const diff = pick.step === now ? [] : changes(pick.project, current);
  return (
    <div className="modal-backdrop" data-modal onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal history-modal" role="dialog" aria-label="History">
        <div className="look-head">
          <h3>History</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close" title="Close (Esc)">
            <Icon name="x" />
          </button>
        </div>
        <div className="history-compare">
          <figure>
            {compare.then ? <img src={compare.then} alt="Selected version" /> : <div className="history-blank" />}
            <figcaption>
              <strong>{pick.version ? `★ ${pick.label}` : pick.step === now ? 'Now' : pick.label}</strong>
            </figcaption>
          </figure>
          <figure>
            {compare.now ? <img src={compare.now} alt="Now" /> : <div className="history-blank" />}
            <figcaption>
              <strong>Now</strong>
            </figcaption>
          </figure>
        </div>
        <label className="field history-time">
          <span>Compare at {formatTime(at)}</span>
          <input type="range" min={0} max={Math.max(0.1, length)} step={0.05} value={Math.min(at, length)} onChange={(e) => setAt(Number(e.target.value))} aria-label="Compare at" />
        </label>
        <div className="history-diff">
          {pick.step === now ? (
            <p className="hint">This is the current version. Pick an earlier one below to compare.</p>
          ) : diff.length ? (
            <>
              <span className="hint">Since then:</span>
              <ul>
                {diff.slice(0, 6).map((d) => (
                  <li key={d}>{d}</li>
                ))}
                {diff.length > 6 && <li>…and {diff.length - 6} more</li>}
              </ul>
            </>
          ) : (
            <p className="hint">No differences.</p>
          )}
          <div className="row">
            {pick.step !== undefined && pick.step !== now && (
              <button className="primary" onClick={() => (onJump(pick.step!), onClose())}>
                Go back to this
              </button>
            )}
            {pick.version && (
              <>
                <button className="primary" onClick={() => (onRestore(pick.version!), onClose())}>
                  Restore this version
                </button>
                <button onClick={() => onDeleteVersion(pick.version!.id)}>Delete version</button>
              </>
            )}
          </div>
        </div>
        <h4>Steps this session</h4>
        <div className="history-strip" role="listbox" aria-label="Versions">
          {entries.map((e) => (
            <button
              key={e.key}
              role="option"
              aria-selected={e.key === picked}
              className={`history-item ${e.key === picked ? 'active' : ''} ${e.step === now ? 'now' : ''} ${e.version ? 'saved' : ''} ${e.step !== undefined && e.step > now ? 'undone' : ''}`}
              onClick={() => setPicked(e.key)}
              title={e.label}
            >
              {thumbs[e.key] ? <img src={thumbs[e.key]} alt="" /> : <span className="history-blank" />}
              <span className="history-label">
                {e.version ? '★ ' : ''}
                {e.step === now ? 'Now · ' : ''}
                {e.label}
              </span>
              {e.version && <small>{new Date(e.version.at).toLocaleString()}</small>}
            </button>
          ))}
        </div>
        <h4>Save a version</h4>
        <p className="hint">Saved versions stay with the project (up to 20), even after you close it.</p>
        <div className="row">
          <input className="grow" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. First cut" aria-label="Version name" />
          <button
            onClick={() => {
              onSaveVersion(name);
              setName('');
            }}
          >
            <Icon name="plus" size={15} /> Save version
          </button>
        </div>
      </div>
    </div>
  );
}
