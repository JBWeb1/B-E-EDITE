import { useEffect, useRef, useState } from 'react';
import { aiProvider, decodeMono, loadAISettings } from '../lib/aiService';
import { Icon } from '../ui/Icon';
import { loudness, motionScore, segmentsToCaptions, toProjectTime } from './ai';
import { buildAutoEdit, defaultOptions, findShots, grayQuality, parsePrompt, planAutoEdit, SHAPES, STYLES, styleById } from './autoedit';
import type { AutoEditOptions, Built, ClipAnalysis, Plan, Shape } from './autoedit';
import { detectBeats } from './beats';
import { grabGrayFrames } from './grab';
import { focusX, smooth } from './transcript';
import { LOOKS } from './grade';
import type { LookId } from './grade';
import { layoutClips } from './timeline';
import { createTextOverlay } from './timeline';
import type { MediaAsset, VideoProject } from './types';

const LENGTHS = [0, 15, 30, 60];

/** Measure one clip (cached by asset id). */
async function analyse(asset: MediaAsset, onProgress: (f: number) => void): Promise<ClipAnalysis> {
  if (asset.kind === 'image') return { assetId: asset.id, name: asset.name, kind: 'image', duration: Infinity, rate: 1, motion: [0], quality: [0.7], loud: [0], shots: [] };
  // About 4 looks a second (fewer for long clips, so it stays quick).
  const rate = Math.max(0.5, Math.min(4, 480 / Math.max(1, asset.duration)));
  const times = Array.from({ length: Math.max(1, Math.floor(asset.duration * rate)) }, (_, i) => i / rate);
  const frames = await grabGrayFrames(asset.url, times, 64, 36, (f) => onProgress(f * 0.85));
  const motion = motionScore(frames);
  // Long recordings decode at a lower rate (plenty for finding speech and pauses).
  const audioRate = asset.duration > 1200 ? 4000 : 8000;
  const samples = await decodeMono(asset.url, audioRate);
  onProgress(1);
  // Where the action is in each frame (for smart reframe), steadied like a camera operator would.
  const focus = smooth(frames.map((f, i) => focusX(f, frames[i - 1])), 2);
  return {
    assetId: asset.id,
    name: asset.name,
    kind: 'video',
    duration: asset.duration,
    rate,
    motion,
    quality: frames.map(grayQuality),
    loud: samples ? loudness(samples, audioRate, rate).slice(0, frames.length) : new Array(frames.length).fill(0),
    shots: findShots(motion, rate),
    focus,
    // Ten loudness readings a second, so pauses are found precisely even in long videos.
    audio: samples ? loudness(samples, audioRate, 10) : undefined,
    audioRate: 10,
  };
}

/** Loudness relative to the loudest of the clips (so quiet clips read as quiet). */
function normaliseLoudness(list: ClipAnalysis[]): ClipAnalysis[] {
  const all = list.flatMap((c) => c.loud).sort((a, b) => a - b);
  const top = all[Math.floor(all.length * 0.95)] || 1e-6;
  const fine = list.flatMap((c) => c.audio ?? []).sort((a, b) => a - b);
  const fineTop = fine[Math.floor(fine.length * 0.95)] || 1e-6;
  return list.map((c) => ({
    ...c,
    loud: c.loud.map((v) => Math.min(1, top > 1e-4 ? v / top : 0)),
    audio: c.audio?.map((v) => Math.min(1, fineTop > 1e-4 ? v / fineTop : 0)),
  }));
}

/**
 * Auto edit: pick clips and a style (or describe the video), and get a finished,
 * beat-synced edit that stays fully editable.
 */
export function AutoEditDialog({
  project,
  onImport,
  onApply,
  onUndo,
  onClose,
}: {
  project: VideoProject;
  onImport: (files: File[]) => Promise<void> | void;
  /** Puts the edit on the timeline (may first make sound effects), before the result shows. */
  onApply: (built: Built) => void | Promise<void>;
  onUndo: () => void;
  onClose: () => void;
}) {
  const visual = project.assets.filter((a) => (a.kind === 'video' || a.kind === 'image') && !a.logo);
  const songs = project.assets.filter((a) => a.kind === 'audio' && !a.sfxId && a.duration >= 8);
  const [picked, setPicked] = useState<string[]>(() => visual.map((a) => a.id));
  const [options, setOptions] = useState<AutoEditOptions>(() => ({ ...defaultOptions('hype'), musicAssetId: songs[0]?.id ?? null }));
  const [prompt, setPrompt] = useState('');
  const [understood, setUnderstood] = useState<string[]>([]);
  const [busy, setBusy] = useState<{ label: string; value: number } | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [seed, setSeed] = useState(1);
  const [error, setError] = useState('');
  const cache = useRef(new Map<string, ClipAnalysis>());
  const beatCache = useRef(new Map<string, number[]>());
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // New clips imported while the dialog is open are picked automatically.
  const known = useRef(new Set(visual.map((a) => a.id)));
  useEffect(() => {
    const fresh = visual.filter((a) => !known.current.has(a.id)).map((a) => a.id);
    fresh.forEach((id) => known.current.add(id));
    if (fresh.length) setPicked((p) => [...p, ...fresh]);
    if (!options.musicAssetId && songs[0]) setOptions((o) => ({ ...o, musicAssetId: songs[0].id }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.assets]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onCloseRef.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy]);

  const update = (patch: Partial<AutoEditOptions>) => setOptions((o) => ({ ...o, ...patch }));
  const longest = Math.max(0, ...picked.map((id) => project.assets.find((a) => a.id === id)?.duration ?? 0).filter(Number.isFinite));
  const pickStyle = (id: AutoEditOptions['style']) => update({ style: id, shape: styleById(id).shape, captions: styleById(id).speech, coldOpen: id === 'longform', chapters: id === 'longform' });
  const readPrompt = (text: string) => {
    setPrompt(text);
    const r = parsePrompt(text, { ...options, style: options.style });
    setUnderstood(r.understood);
    if (r.understood.length) setOptions({ ...r.options, musicAssetId: /no music|without music/i.test(text) ? null : options.musicAssetId });
  };

  const run = async (nextSeed: number) => {
    setError('');
    const assets = picked.map((id) => project.assets.find((a) => a.id === id)).filter(Boolean) as MediaAsset[];
    if (!assets.length) return setError('Pick at least one clip.');
    try {
      const list: ClipAnalysis[] = [];
      for (let i = 0; i < assets.length; i++) {
        const a = assets[i];
        if (!cache.current.has(a.id)) cache.current.set(a.id, await analyse(a, (f) => setBusy({ label: `Watching ${a.name} (${i + 1} of ${assets.length})…`, value: (i + f) / assets.length })));
        list.push(cache.current.get(a.id)!);
      }
      let beats: number[] = [];
      const song = options.musicAssetId ? project.assets.find((a) => a.id === options.musicAssetId) : undefined;
      if (song && styleById(options.style).music !== 'none') {
        setBusy({ label: 'Finding the beat…', value: 1 });
        if (!beatCache.current.has(song.id)) {
          const samples = await decodeMono(song.url, 11025);
          const grid = samples ? detectBeats(samples, 11025) : null;
          beatCache.current.set(song.id, grid && grid.confidence > 0.08 ? grid.beats : []);
        }
        beats = beatCache.current.get(song.id)!;
      }
      setBusy({ label: 'Choosing the best moments…', value: 1 });
      const p = planAutoEdit(normaliseLoudness(list), options, beats, nextSeed);
      if (!p.segments.length) throw new Error('Nothing usable was found in these clips (too dark, blurry or short).');
      const built = buildAutoEdit(project, p, project.assets);
      if (options.captions && styleById(options.style).speech) {
        setBusy({ label: 'Writing captions…', value: 0 });
        try {
          built.project = { ...built.project, texts: [...built.project.texts, ...(await captionsFor(built.project, (f) => setBusy({ label: 'Writing captions…', value: f })))] };
        } catch (e) {
          p.notes.push(`Captions skipped: ${e instanceof Error ? e.message : 'the speech model could not load'}. Try AI → Auto captions later.`);
        }
      }
      await onApply(built);
      setPlan(p);
      setSeed(nextSeed);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  if (plan && !busy) {
    return (
      <div className="autoedit-result" role="dialog" aria-label="Auto edit result">
        <div className="look-head">
          <h3>
            {plan.style.emoji} Your {plan.style.label.toLowerCase()} edit
          </h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close" title="Close">
            <Icon name="x" />
          </button>
        </div>
        <p className="hint">
          {plan.segments.length} cuts · {plan.length.toFixed(1)} s{plan.beat ? ` · ${Math.round(60 / plan.beat)} BPM` : ''} · press Space to watch
        </p>
        <ul className="autoedit-notes">
          {plan.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
        <details>
          <summary>Why each cut</summary>
          <ol className="autoedit-cuts">
            {plan.segments.map((s, i) => (
              <li key={i}>
                <span>{project.assets.find((a) => a.id === s.assetId)?.name}</span> {s.photo ? '' : `${s.in.toFixed(1)}–${s.out.toFixed(1)} s`} <em>{s.reason}</em>
              </li>
            ))}
          </ol>
        </details>
        <div className="row">
          <button className="primary" onClick={onClose}>
            Keep it
          </button>
          <button
            onClick={() => {
              onUndo();
              void run(seed + 1);
            }}
          >
            <Icon name="shuffle" size={15} /> Try another
          </button>
          <button
            onClick={() => {
              onUndo();
              setPlan(null);
            }}
          >
            Undo
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" data-modal onPointerDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal autoedit-modal" role="dialog" aria-label="Auto edit">
        <div className="look-head">
          <h3>✨ Auto edit</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close" title="Close (Esc)" disabled={!!busy}>
            <Icon name="x" />
          </button>
        </div>
        <p className="hint">Drop in your raw clips. It watches every one, keeps the best moments, cuts them to the beat of your music and finishes the video in the style you pick — then you can change anything.</p>

        <h4>1. Your clips</h4>
        <div className="autoedit-clips">
          {visual.map((a) => (
            <label key={a.id} className={`autoedit-clip ${picked.includes(a.id) ? 'on' : ''}`}>
              <input type="checkbox" checked={picked.includes(a.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, a.id] : picked.filter((x) => x !== a.id))} aria-label={`Use ${a.name}`} />
              {a.thumbnail ? <img src={a.thumbnail} alt="" /> : <span className="asset-icon">🎞</span>}
              <small>{a.name}</small>
            </label>
          ))}
          <label className="autoedit-clip add">
            <Icon name="plus" size={22} />
            <small>Add clips or a song</small>
            <input
              type="file"
              accept="video/*,image/*,audio/*"
              multiple
              hidden
              aria-label="Add clips"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = '';
                if (files.length) void onImport(files);
              }}
            />
          </label>
        </div>

        <h4>2. Describe it (optional)</h4>
        <textarea rows={2} value={prompt} onChange={(e) => readPrompt(e.target.value)} placeholder={'e.g. “a 30 second energetic travel video for TikTok with warm colours called ‘Lisbon’”'} aria-label="Describe your video" />
        {understood.length > 0 && (
          <div className="chips">
            {understood.map((u) => (
              <span key={u} className="chip active">
                ✓ {u}
              </span>
            ))}
          </div>
        )}

        <h4>3. Style</h4>
        <div className="autoedit-styles" role="radiogroup" aria-label="Style">
          {STYLES.map((s) => (
            <button key={s.id} role="radio" aria-checked={options.style === s.id} className={options.style === s.id ? 'active' : ''} onClick={() => pickStyle(s.id)}>
              <span className="emoji">{s.emoji}</span>
              <strong>{s.label}</strong>
              <small>{s.blurb}</small>
            </button>
          ))}
        </div>

        <h4>4. Details</h4>
        <div className="grid2">
          <label className="field">
            <span>Length</span>
            <select value={options.length} onChange={(e) => update({ length: Number(e.target.value) })} aria-label="Length">
              {[...new Set([...LENGTHS, options.length])].map((l) => (
                <option key={l} value={l}>{l === 0 ? `Auto (${styleById(options.style).length >= 90 ? 'all the good parts' : `about ${styleById(options.style).length} s`})` : `${l} seconds`}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Shape</span>
            <select value={options.shape} onChange={(e) => update({ shape: e.target.value as Shape })} aria-label="Shape">
              {(Object.keys(SHAPES) as Shape[]).map((k) => (
                <option key={k} value={k}>{`${k} · ${SHAPES[k].label}`}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Music</span>
            <select value={options.musicAssetId ?? ''} onChange={(e) => update({ musicAssetId: e.target.value || null })} aria-label="Music" disabled={styleById(options.style).music === 'none'}>
              <option value="">{songs.length ? 'No music' : 'No music (add a song above)'}</option>
              {songs.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Colour</span>
            <select value={options.look ?? ''} onChange={(e) => update({ look: (e.target.value || null) as LookId | null })} aria-label="Colour">
              <option value="">Style default</option>
              {LOOKS.map((l) => (
                <option key={l.id} value={l.id}>{l.label}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="grid2">
          <label className="field">
            <span>Title</span>
            <input value={options.title} onChange={(e) => update({ title: e.target.value })} placeholder={styleById(options.style).title.text.split('\n')[0]} aria-label="Title" />
          </label>
          <label className="check autoedit-captions">
            <input type="checkbox" checked={options.captions} onChange={(e) => update({ captions: e.target.checked })} disabled={!styleById(options.style).speech} />
            <span>
              Captions from speech <small>{styleById(options.style).speech ? 'talking styles' : 'for Vlog and Talking styles'}</small>
            </span>
          </label>
        </div>
        <div className="autoedit-extras">
          {styleById(options.style).speech && (
            <>
              <label className="check">
                <input type="checkbox" checked={options.coldOpen} onChange={(e) => update({ coldOpen: e.target.checked })} aria-label="Teaser at the start" />
                <span>
                  Teaser at the start <small>the liveliest moment first, “coming up”</small>
                </span>
              </label>
              <label className="check">
                <input type="checkbox" checked={options.chapters} onChange={(e) => update({ chapters: e.target.checked })} aria-label="Chapters" />
                <span>
                  Chapters <small>title cards at the natural breaks</small>
                </span>
              </label>
            </>
          )}
          <label className="check">
            <input type="checkbox" checked={options.duck} onChange={(e) => update({ duck: e.target.checked })} aria-label="Lower music under speech" />
            <span>
              Lower music under speech <small>auto-ducking</small>
            </span>
          </label>
          <label className="check">
            <input type="checkbox" checked={options.reframe} onChange={(e) => update({ reframe: e.target.checked })} aria-label="Smart reframe" />
            <span>
              Smart reframe <small>fill the frame and follow the action</small>
            </span>
          </label>
        </div>
        {longest > 600 && <p className="hint">Long footage ({Math.round(longest / 60)} min): watching it takes about {Math.max(1, Math.round(longest / 600))} min the first time; “Try another” is instant after that.</p>}
        {project.clips.length > 0 && <p className="hint">This replaces what is on your timeline (Undo brings it back).</p>}
        {error && <p className="ai-message">{error}</p>}
        {busy ? (
          <div className="pf-running" role="status">
            <div className="progress">
              <div style={{ width: `${Math.round(busy.value * 100)}%` }} />
            </div>
            <span>{busy.label}</span>
          </div>
        ) : (
          <button className="primary block autoedit-go" onClick={() => void run(seed)} disabled={picked.length === 0}>
            ✨ Auto edit {picked.length} clip{picked.length === 1 ? '' : 's'}
          </button>
        )}
      </div>
    </div>
  );
}

/** Captions for the spoken parts of an auto-edited project. */
async function captionsFor(p: VideoProject, onProgress: (f: number) => void) {
  const provider = aiProvider(loadAISettings());
  const placed = layoutClips(p.clips);
  const out = [];
  const sounds = new Map<string, Float32Array | null>();
  for (let i = 0; i < placed.length; i++) {
    const { clip, start } = placed[i];
    const asset = p.assets.find((a) => a.id === clip.assetId);
    if (asset?.kind !== 'video') continue;
    if (!sounds.has(asset.id)) sounds.set(asset.id, await decodeMono(asset.url, 16000));
    const samples = sounds.get(asset.id);
    if (!samples) continue;
    const slice = samples.subarray(Math.floor(clip.in * 16000), Math.ceil(clip.out * 16000));
    const segs = await provider.transcribe(slice, '', (f) => onProgress((i + f) / placed.length));
    const caps = segmentsToCaptions(segs).map((c) => ({ ...c, start: c.start + clip.in, end: c.end + clip.in }));
    out.push(...toProjectTime(caps, clip, start));
  }
  return out.map((c) => createTextOverlay(c.start, { text: c.text, duration: c.end - c.start, y: 0.72, size: 0.07, bold: true, background: null, stroke: '#000000', color: '#ffffff', accent: '#facc15', words: 'highlight', animation: 'none' }));
}
