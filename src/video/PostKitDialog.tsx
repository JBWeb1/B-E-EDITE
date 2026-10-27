import { useEffect, useRef, useState } from 'react';
import { toFile } from '../design/pages';
import { designThumbnail, exportDesign } from '../design/render';
import type { DesignFile } from '../design/types';
import { downloadBlob } from '../lib/download';
import { newProjectId, saveDesignProject } from '../lib/projects';
import { Icon } from '../ui/Icon';
import { VideoEngine } from './engine';
import { chapters, chaptersText, frameScore, KIT_FORMATS, kitDesign, pickBest, postCaption, postTitle } from './postkit';
import type { KitFormat } from './postkit';
import { projectDuration } from './timeline';
import type { VideoProject } from './types';

interface Frame {
  t: number;
  src: string;
  width: number;
  height: number;
}

const HANDLE_KEY = 'bee.handle';

/** Find the best-looking frames (without text on top), at full size. */
async function bestFrames(project: VideoProject, onProgress: (f: number) => void): Promise<Frame[]> {
  const duration = projectDuration(project);
  const canvas = document.createElement('canvas');
  const engine = new VideoEngine(canvas);
  engine.setProject({ ...project, texts: [], watermark: null });
  const small = document.createElement('canvas');
  small.width = 96;
  small.height = Math.max(2, Math.round((96 * project.height) / project.width));
  const sctx = small.getContext('2d', { willReadFrequently: true })!;
  const count = Math.max(1, Math.min(40, Math.floor(duration * 2)));
  const times = Array.from({ length: count }, (_, i) => Math.min(duration - 0.05, 0.3 + ((duration - 0.6) * i) / Math.max(1, count - 1)));
  const scores: number[] = [];
  try {
    for (let i = 0; i < times.length; i++) {
      sctx.drawImage(await engine.renderAt(Math.max(0, times[i])), 0, 0, small.width, small.height);
      scores.push(frameScore(sctx.getImageData(0, 0, small.width, small.height).data, small.width, small.height));
      onProgress(((i + 1) / times.length) * 0.8);
    }
    const out: Frame[] = [];
    for (const i of pickBest(scores, 3, Math.max(1, Math.floor(count / 4)))) {
      const c = await engine.renderAt(Math.max(0, times[i]));
      out.push({ t: times[i], src: c.toDataURL('image/jpeg', 0.9), width: c.width, height: c.height });
    }
    onProgress(1);
    return out.sort((a, b) => a.t - b.t);
  } finally {
    engine.destroy();
  }
}

const safeName = (s: string) => s.replace(/[^\w\- ]+/g, '').trim().slice(0, 40) || 'post';

/** Everything to post a finished video: thumbnail, post, story, caption and chapters. */
export function PostKitDialog({ project, onClose, onOpenDesign }: { project: VideoProject; onClose: () => void; onOpenDesign?: (file: DesignFile, projectId: string) => void }) {
  const [frames, setFrames] = useState<Frame[] | null>(null);
  const [progress, setProgress] = useState(0);
  const [pick, setPick] = useState(0);
  const [title, setTitle] = useState(() => postTitle(project));
  const [handle, setHandle] = useState(() => {
    try {
      return localStorage.getItem(HANDLE_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [caption, setCaption] = useState(() => postCaption(project, handle));
  const [previews, setPreviews] = useState<Partial<Record<KitFormat, string>>>({});
  const [copied, setCopied] = useState('');
  const chapterList = chapters(project);
  const projectRef = useRef(project);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    let cancelled = false;
    bestFrames(projectRef.current, (f) => !cancelled && setProgress(f)).then(
      (f) => !cancelled && setFrames(f),
      () => !cancelled && setFrames([]),
    );
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCloseRef.current();
    window.addEventListener('keydown', onKey);
    return () => {
      cancelled = true;
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const frame = frames?.[pick];
  const design = (f: KitFormat) => kitDesign(f, frame!, title || 'Watch this', handle);

  // Live previews (rendered after images load).
  useEffect(() => {
    if (!frame) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const next: Partial<Record<KitFormat, string>> = {};
      for (const f of KIT_FORMATS) {
        const blob = await exportDesign(design(f.id), 'image/jpeg', 320 / Math.max(f.width, f.height));
        next[f.id] = URL.createObjectURL(blob);
      }
      if (!cancelled) setPreviews((old) => (Object.values(old).forEach((u) => u && URL.revokeObjectURL(u)), next));
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame, title, handle]);

  const saveHandle = (h: string) => {
    setHandle(h);
    try {
      localStorage.setItem(HANDLE_KEY, h);
    } catch {
      /* ignore */
    }
  };

  const download = async (f: KitFormat) => {
    const blob = await exportDesign(design(f), 'image/png');
    downloadBlob(blob, `${safeName(title)} - ${KIT_FORMATS.find((x) => x.id === f)!.label}.png`);
  };
  const edit = async (f: KitFormat) => {
    const doc = design(f);
    const file = toFile(doc);
    const id = newProjectId();
    await saveDesignProject(id, file, designThumbnail(doc, 240));
    onOpenDesign?.(file, id);
  };
  const copy = async (what: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(''), 1500);
    } catch {
      alert('Copy is blocked here. Select the text and copy it by hand.');
    }
  };

  return (
    <div className="modal-backdrop" data-modal onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal postkit-modal" role="dialog" aria-label="Post kit">
        <div className="look-head">
          <h3>Post kit</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close" title="Close (Esc)">
            <Icon name="x" />
          </button>
        </div>
        <p className="hint">Everything you need to post this video: a thumbnail from its best frame, a matching post and story, a caption with hashtags, and chapters.</p>
        {!frames && (
          <div className="pf-running" role="status">
            <div className="progress">
              <div style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <span>Finding the best frames… {Math.round(progress * 100)}%</span>
          </div>
        )}
        {frames && frames.length === 0 && <p className="ai-message">Could not read frames from this video.</p>}
        {frame && (
          <>
            <h4>Best frames</h4>
            <div className="kit-frames" role="radiogroup" aria-label="Frame">
              {frames.map((f, i) => (
                <button key={f.t} role="radio" aria-checked={pick === i} className={pick === i ? 'active' : ''} onClick={() => setPick(i)} aria-label={`Frame at ${f.t.toFixed(1)} seconds`}>
                  <img src={f.src} alt="" />
                  <small>{f.t.toFixed(1)}s</small>
                </button>
              ))}
            </div>
            <div className="grid2">
              <label className="field">
                <span>Title</span>
                <input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Post title" />
              </label>
              <label className="field">
                <span>Your handle</span>
                <input value={handle} onChange={(e) => saveHandle(e.target.value)} placeholder="@yourname" aria-label="Your handle" />
              </label>
            </div>
            <div className="kit-designs">
              {KIT_FORMATS.map((f) => (
                <div key={f.id} className={`kit-design ${f.id}`}>
                  <div className="kit-preview">{previews[f.id] ? <img src={previews[f.id]} alt={`${f.label} preview`} /> : <span className="hint">…</span>}</div>
                  <strong>{f.label}</strong>
                  <small>
                    {f.width}×{f.height}
                  </small>
                  <div className="row">
                    <button onClick={() => void download(f.id)} aria-label={`Download ${f.label}`} title="Download PNG">
                      <Icon name="download" size={14} />
                    </button>
                    {onOpenDesign && (
                      <button onClick={() => void edit(f.id)} aria-label={`Edit ${f.label}`} title="Open in the design editor">
                        Edit
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <button className="block" onClick={() => void (async () => { for (const f of KIT_FORMATS) await download(f.id); })()}>
              <Icon name="download" size={15} /> Download all three
            </button>
          </>
        )}
        <h4>Caption & hashtags</h4>
        <textarea rows={6} value={caption} onChange={(e) => setCaption(e.target.value)} aria-label="Post caption" />
        <div className="row">
          <button onClick={() => void copy('caption', caption)}>{copied === 'caption' ? 'Copied ✓' : 'Copy caption'}</button>
          <button onClick={() => setCaption(postCaption(project, handle))}>Rewrite</button>
        </div>
        <h4>YouTube chapters</h4>
        {chapterList.length ? (
          <>
            <pre className="kit-chapters" aria-label="Chapters">
              {chaptersText(chapterList)}
            </pre>
            <button onClick={() => void copy('chapters', chaptersText(chapterList))}>{copied === 'chapters' ? 'Copied ✓' : 'Copy chapters'}</button>
          </>
        ) : (
          <p className="hint">Chapters need a video of at least 30 seconds with three parts of 10 s or more. Add Chapter titles (Titles tab) to name them.</p>
        )}
      </div>
    </div>
  );
}
