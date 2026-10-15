import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { downloadBlob, formatTime } from '../lib/download';
import { useHistory } from '../lib/history';
import { uid } from '../lib/id';
import { sameFilters } from '../lib/filters';
import { ColorField, NumberField, RangeField } from '../ui/fields';
import { FilterSliders } from '../ui/FilterSliders';
import { FirstRunTips, ShortcutsDialog } from '../ui/Help';
import type { Shortcut } from '../ui/Help';
import { probeMedia, VideoEngine } from './engine';
import { putMedia, saveVideoProject } from './storage';
import { Timeline } from './Timeline';
import type { Selection } from './Timeline';
import {
  ASPECTS,
  clipDuration,
  createAudioClip,
  createClip,
  createProject,
  createTextOverlay,
  FILTER_PRESETS,
  locate,
  maxTransition,
  NEUTRAL_FILTERS,
  projectDuration,
  splitClips,
  splitTexts,
  textsAt,
  TRANSITIONS,
} from './timeline';
import type { AudioClip, Clip, ClipFilters, TextOverlay, Transition, VideoProject } from './types';

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

const TEXT_PRESETS: { label: string; patch: Partial<TextOverlay> }[] = [
  { label: 'Title', patch: { text: 'Big Title', y: 0.5, size: 0.14, animation: 'pop' } },
  { label: 'Subtitle', patch: { text: 'Subtitle', y: 0.85, size: 0.06, bold: false, animation: 'fade' } },
  { label: 'Caption box', patch: { text: 'Caption', y: 0.85, size: 0.06, background: 'rgba(0,0,0,0.65)', animation: 'slide' } },
  { label: 'Highlight', patch: { text: 'WOW!', y: 0.2, size: 0.1, color: '#111827', background: '#fde047', animation: 'pop' } },
];

const SHORTCUTS: Shortcut[] = [
  { keys: ['Space'], action: 'Play / pause' },
  { keys: ['S'], action: 'Split at the playhead' },
  { keys: ['Del'], action: 'Delete selected' },
  { keys: ['←', '→'], action: 'Step one frame (Shift: 1 second)' },
  { keys: ['Home'], action: 'Go to start' },
  { keys: ['End'], action: 'Go to end' },
  { keys: ['Ctrl', 'Z'], action: 'Undo' },
  { keys: ['Ctrl', 'Shift', 'Z'], action: 'Redo' },
  { keys: ['?'], action: 'Show this help' },
];

const DEFAULT_TRANSITION: Transition = { type: 'fade', duration: 0.5 };

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
}

export function VideoEditor({
  onExit,
  aspect,
  initialProject,
}: {
  onExit: () => void;
  aspect?: { width: number; height: number };
  initialProject?: VideoProject;
}) {
  const history = useHistory<VideoProject>(() => initialProject ?? createProject(aspect?.width, aspect?.height));
  const { state: project, set, setTransient, mark } = history;
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);
  const [pps, setPps] = useState(60);
  const [tab, setTab] = useState<'media' | 'text'>('media');
  const [importing, setImporting] = useState(0);
  const [exportProgress, setExportProgress] = useState<number | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [recorder, setRecorder] = useState<MediaRecorder | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error' | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<VideoEngine | null>(null);
  const textDragRef = useRef<{ id: string; offX: number; offY: number } | null>(null);

  const duration = projectDuration(project);
  const selectedClip = selection?.kind === 'clip' ? project.clips.find((c) => c.id === selection.id) : undefined;
  const selectedText = selection?.kind === 'text' ? project.texts.find((t) => t.id === selection.id) : undefined;
  const selectedAudio = selection?.kind === 'audio' ? project.audio.find((a) => a.id === selection.id) : undefined;

  useEffect(() => {
    const engine = new VideoEngine(canvasRef.current!);
    engine.onTime = setTime;
    engine.onPlayingChange = setPlaying;
    engineRef.current = engine;
    return () => engine.destroy();
  }, []);

  useEffect(() => {
    engineRef.current?.setProject(project);
  }, [project]);

  // Autosave the project (media files are stored once, at import time).
  useEffect(() => {
    if (project.assets.length === 0 && project.texts.length === 0) return;
    setSaveState('saving');
    const t = setTimeout(() => {
      saveVideoProject(project).then(
        () => setSaveState('saved'),
        () => setSaveState('error'),
      );
    }, 800);
    return () => clearTimeout(t);
  }, [project]);

  const seek = useCallback((t: number) => engineRef.current?.seek(t), []);
  const togglePlay = useCallback(() => engineRef.current?.toggle(), []);

  const importFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files).filter((f) => /^(video|audio|image)\//.test(f.type));
      setImporting((n) => n + list.length);
      for (const file of list) {
        try {
          const asset = await probeMedia(file, uid('asset'));
          await putMedia(asset.id, file).catch(() => setSaveState('error'));
          set((p) => {
            const next = { ...p, assets: [...p.assets, asset] };
            if (asset.kind === 'audio') {
              return { ...next, audio: [...p.audio, createAudioClip(asset, engineRef.current?.time ?? 0)] };
            }
            return { ...next, clips: [...p.clips, createClip(asset)] };
          });
        } catch (err) {
          alert(err instanceof Error ? err.message : `Could not import ${file.name}`);
        } finally {
          setImporting((n) => n - 1);
        }
      }
    },
    [set],
  );

  const updateClip = (patch: Partial<Clip>, live = false) => {
    if (!selectedClip) return;
    const fn = (p: VideoProject) => ({ ...p, clips: p.clips.map((c) => (c.id === selectedClip.id ? { ...c, ...patch } : c)) });
    if (live) setTransient(fn);
    else set(fn);
  };
  const updateFilters = (patch: Partial<ClipFilters>) =>
    selectedClip && updateClip({ filters: { ...selectedClip.filters, ...patch } }, true);
  const updateText = (patch: Partial<TextOverlay>, live = false) => {
    if (!selectedText) return;
    const fn = (p: VideoProject) => ({ ...p, texts: p.texts.map((t) => (t.id === selectedText.id ? { ...t, ...patch } : t)) });
    if (live) setTransient(fn);
    else set(fn);
  };
  const updateAudio = (patch: Partial<AudioClip>, live = false) => {
    if (!selectedAudio) return;
    const fn = (p: VideoProject) => ({ ...p, audio: p.audio.map((a) => (a.id === selectedAudio.id ? { ...a, ...patch } : a)) });
    if (live) setTransient(fn);
    else set(fn);
  };

  const split = useCallback(() => {
    const t = engineRef.current?.time ?? 0;
    if (selection?.kind === 'text') {
      set((p) => ({
        ...p,
        texts: p.texts.flatMap((o) => (o.id === selection.id ? splitTexts([o], t) : [o])),
      }));
    } else if (selection?.kind === 'audio') {
      set((p) => ({
        ...p,
        audio: p.audio.flatMap((a) => {
          const local = t - a.start;
          if (a.id !== selection.id || local < 0.1 || a.out - a.in - local < 0.1) return [a];
          return [
            { ...a, out: a.in + local },
            { ...a, id: uid('audio'), start: t, in: a.in + local },
          ];
        }),
      }));
    } else {
      set((p) => ({ ...p, clips: splitClips(p.clips, t) }));
    }
  }, [selection, set]);

  const removeSelected = useCallback(() => {
    if (!selection) return;
    const key = selection.kind === 'clip' ? 'clips' : selection.kind === 'text' ? 'texts' : 'audio';
    set((p) => ({ ...p, [key]: (p[key] as { id: string }[]).filter((x) => x.id !== selection.id) }));
    setSelection(null);
  }, [selection, set]);

  const duplicateSelected = () => {
    if (selectedClip) {
      const idx = project.clips.indexOf(selectedClip);
      const copy = { ...selectedClip, id: uid('clip') };
      set((p) => ({ ...p, clips: [...p.clips.slice(0, idx + 1), copy, ...p.clips.slice(idx + 1)] }));
      setSelection({ kind: 'clip', id: copy.id });
    } else if (selectedText) {
      const copy = { ...selectedText, id: uid('text'), start: selectedText.start + selectedText.duration };
      set((p) => ({ ...p, texts: [...p.texts, copy] }));
      setSelection({ kind: 'text', id: copy.id });
    }
  };

  const setTransition = (clipId: string, transition: Transition | undefined) =>
    set((p) => ({ ...p, clips: p.clips.map((c) => (c.id === clipId ? { ...c, transition } : c)) }));

  const onTransitionClick = (clipId: string) => {
    setSelection({ kind: 'clip', id: clipId });
    const clip = project.clips.find((c) => c.id === clipId);
    if (clip && !clip.transition) {
      setTransition(clipId, { ...DEFAULT_TRANSITION, duration: Math.min(DEFAULT_TRANSITION.duration, maxTransition(clip)) });
    }
  };

  const applyTransitionToAll = (transition: Transition | undefined) =>
    set((p) => ({
      ...p,
      clips: p.clips.map((c, i) =>
        i === 0 ? c : { ...c, transition: transition && { ...transition, duration: Math.min(transition.duration, maxTransition(c)) } },
      ),
    }));

  // Voice-over: record the microphone while the timeline plays, then drop it on the audio track.
  const startVoiceOver = async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      alert('Microphone access is needed to record a voice-over.');
      return;
    }
    const startAt = engineRef.current?.time ?? 0;
    const rec = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      setRecorder(null);
      engineRef.current?.pause();
      const type = (rec.mimeType || 'audio/webm').split(';')[0];
      const count = project.assets.filter((a) => a.name.startsWith('Voice-over')).length + 1;
      const file = new File(chunks, `Voice-over ${count}.${type.includes('mp4') ? 'm4a' : 'webm'}`, { type });
      try {
        const asset = await probeMedia(file, uid('asset'));
        await putMedia(asset.id, file).catch(() => setSaveState('error'));
        set((p) => ({ ...p, assets: [...p.assets, asset], audio: [...p.audio, createAudioClip(asset, startAt)] }));
      } catch {
        alert('Could not save the recording.');
      }
    };
    rec.start();
    setRecorder(rec);
    if ((engineRef.current?.duration ?? 0) > startAt) engineRef.current?.play();
  };

  const addText = (patch: Partial<TextOverlay>) => {
    const o = createTextOverlay(engineRef.current?.time ?? 0, patch);
    set((p) => ({ ...p, texts: [...p.texts, o] }));
    setSelection({ kind: 'text', id: o.id });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (e.key === ' ') {
        e.preventDefault();
        togglePlay();
      } else if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) history.redo();
        else history.undo();
      } else if (mod && key === 'y') {
        e.preventDefault();
        history.redo();
      } else if (key === 's' && !mod) {
        split();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        removeSelected();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const step = e.shiftKey ? 1 : 1 / 30;
        seek((engineRef.current?.time ?? 0) + (e.key === 'ArrowLeft' ? -step : step));
      } else if (e.key === '?') {
        setShowHelp(true);
      } else if (e.key === 'Home') {
        seek(0);
      } else if (e.key === 'End') {
        seek(duration);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [history, togglePlay, split, removeSelected, seek, duration]);

  // Drag text overlays directly on the preview.
  const previewPoint = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
  };
  const onPreviewDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const p = previewPoint(e);
    const ctx = e.currentTarget.getContext('2d')!;
    const hit = [...textsAt(project.texts, time)].reverse().find((o) => {
      const size = o.size * project.height;
      ctx.font = `${o.bold ? 'bold ' : ''}${size}px Inter, system-ui, sans-serif`;
      const lines = o.text.split('\n');
      const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) / project.width;
      const h = (lines.length * size * 1.2) / project.height;
      return Math.abs(p.x - o.x) <= w / 2 + 0.02 && Math.abs(p.y - o.y) <= h / 2 + 0.02;
    });
    if (!hit) return;
    setSelection({ kind: 'text', id: hit.id });
    textDragRef.current = { id: hit.id, offX: p.x - hit.x, offY: p.y - hit.y };
    mark();
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPreviewMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = textDragRef.current;
    if (!d) return;
    const p = previewPoint(e);
    const clamp = (v: number) => Math.max(0, Math.min(1, v));
    setTransient((proj) => ({
      ...proj,
      texts: proj.texts.map((o) => (o.id === d.id ? { ...o, x: clamp(p.x - d.offX), y: clamp(p.y - d.offY) } : o)),
    }));
  };

  const doExport = async () => {
    const engine = engineRef.current;
    if (!engine || duration <= 0) return;
    setSelection(null);
    setExportProgress(0);
    try {
      const blob = await engine.record(setExportProgress);
      downloadBlob(blob, `${project.name || 'video'}.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExportProgress(null);
    }
  };

  const currentClip = locate(project.clips, time);

  return (
    <div
      className="editor video"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void importFiles(e.dataTransfer.files);
      }}
    >
      <header className="topbar">
        <button className="ghost" onClick={onExit}>← Home</button>
        <input
          className="title-input"
          value={project.name}
          onFocus={mark}
          onChange={(e) => setTransient((p) => ({ ...p, name: e.target.value }))}
          aria-label="Video name"
        />
        <div className="spacer" />
        <select
          value={`${project.width}x${project.height}`}
          onChange={(e) => {
            const [w, h] = e.target.value.split('x').map(Number);
            set((p) => ({ ...p, width: w, height: h }));
          }}
          title="Aspect ratio"
        >
          {ASPECTS.map((a) => (
            <option key={a.label} value={`${a.width}x${a.height}`}>{a.label}</option>
          ))}
        </select>
        <button onClick={history.undo} disabled={!history.canUndo} title="Undo (Ctrl+Z)">↶ Undo</button>
        <button onClick={history.redo} disabled={!history.canRedo} title="Redo (Ctrl+Shift+Z)">↷ Redo</button>
        <button className="primary" onClick={doExport} disabled={duration <= 0 || exportProgress !== null}>
          Export video
        </button>
      </header>

      <div className="workspace">
        <nav className="rail">
          <button className={tab === 'media' ? 'active' : ''} onClick={() => setTab('media')}>
            <span className="rail-icon">▶</span>Media
          </button>
          <button className={tab === 'text' ? 'active' : ''} onClick={() => setTab('text')}>
            <span className="rail-icon">T</span>Text
          </button>
        </nav>

        <aside className="panel">
          {tab === 'media' ? (
            <>
              <h3>Media</h3>
              <label className="button primary block">
                Import video, photos or music
                <input
                  type="file"
                  accept="video/*,image/*,audio/*"
                  multiple
                  hidden
                  onChange={(e) => {
                    if (e.target.files) void importFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>
              {importing > 0 && <p className="hint">Importing {importing} file(s)…</p>}
              {recorder ? (
                <button className="block recording" onClick={() => recorder.stop()}>■ Stop recording</button>
              ) : (
                <button className="block" onClick={startVoiceOver} title="Record from your microphone while the video plays">
                  🎙 Record voice-over
                </button>
              )}
              <p className="hint">Or drag files anywhere onto the editor. Videos and photos are added to the end of the timeline; music goes on the audio track at the playhead.</p>
              <div className="grid2">
                {project.assets.map((a) => (
                  <div key={a.id} className="card asset">
                    {a.thumbnail ? <img src={a.thumbnail} alt="" /> : <div className="asset-icon">♪</div>}
                    <span className="asset-name" title={a.name}>{a.name}</span>
                    <small>{a.kind === 'image' ? 'Photo' : formatTime(a.duration)}</small>
                    <button
                      className="asset-add"
                      title="Add to timeline"
                      onClick={() =>
                        set((p) =>
                          a.kind === 'audio'
                            ? { ...p, audio: [...p.audio, createAudioClip(a, time)] }
                            : { ...p, clips: [...p.clips, createClip(a)] },
                        )
                      }
                    >
                      +
                    </button>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <h3>Text</h3>
              <p className="hint">Added at the playhead. Drag text on the preview to move it.</p>
              <div className="list">
                {TEXT_PRESETS.map((t) => (
                  <button key={t.label} className="text-preset" onClick={() => addText(t.patch)}>
                    {t.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </aside>

        <main className="preview-area">
          <div className="preview-frame">
            <canvas
              ref={canvasRef}
              className="preview"
              style={{ aspectRatio: `${project.width} / ${project.height}` }}
              onPointerDown={onPreviewDown}
              onPointerMove={onPreviewMove}
              onPointerUp={() => (textDragRef.current = null)}
            />
            {project.clips.length === 0 && project.texts.length === 0 && (
              <div className="preview-empty">Import a video or photo to get started</div>
            )}
            <FirstRunTips
              storageKey="bee.tips.video"
              title="Welcome to the video editor 🎬"
              tips={[
                'Import clips: they line up on the timeline automatically.',
                'Drag clips to reorder, drag their edges to trim, and press S to split.',
                'Click ⇄ between two clips to add a transition. Press ? for all shortcuts.',
              ]}
            />
          </div>
          <div className="transport">
            <button onClick={() => seek(0)} title="Go to start (Home)">⏮</button>
            <button className="primary round" onClick={togglePlay} disabled={duration <= 0} title="Play/Pause (Space)">
              {playing ? '❚❚' : '▶'}
            </button>
            <span className="timecode">
              {formatTime(time)} / {formatTime(duration)}
            </span>
            <div className="spacer" />
            <button onClick={split} title="Split at playhead (S)">✂ Split</button>
            <button onClick={duplicateSelected} disabled={!selectedClip && !selectedText}>Duplicate</button>
            <button className="danger" onClick={removeSelected} disabled={!selection} title="Delete (Del)">Delete</button>
            <label className="zoom-slider" title="Timeline zoom">
              🔍
              <input type="range" min={10} max={300} value={pps} onChange={(e) => setPps(Number(e.target.value))} />
            </label>
          </div>
        </main>

        <aside className="panel right">
          {selectedClip ? (
            <ClipInspector
              clip={selectedClip}
              assetName={project.assets.find((a) => a.id === selectedClip.assetId)?.name ?? ''}
              isVideo={project.assets.find((a) => a.id === selectedClip.assetId)?.kind === 'video'}
              isFirst={project.clips[0]?.id === selectedClip.id}
              mark={mark}
              update={updateClip}
              updateFilters={updateFilters}
              applyTransitionToAll={applyTransitionToAll}
            />
          ) : selectedText ? (
            <>
              <h3>Text</h3>
              <label className="field">
                <span>Content</span>
                <textarea rows={3} value={selectedText.text} onFocus={mark} onChange={(e) => updateText({ text: e.target.value }, true)} />
              </label>
              <RangeField label="Size" value={selectedText.size} min={0.02} max={0.3} step={0.005} onStart={mark} onChange={(v) => updateText({ size: v }, true)} format={(v) => `${Math.round(v * 100)}%`} />
              <ColorField label="Color" value={selectedText.color} onStart={mark} onChange={(v) => updateText({ color: v }, true)} />
              <div className="row">
                <button className={selectedText.bold ? 'active' : ''} onClick={() => updateText({ bold: !selectedText.bold })}><b>B</b></button>
                <button
                  className={selectedText.background ? 'active' : ''}
                  onClick={() => updateText({ background: selectedText.background ? null : '#111827' })}
                >
                  Background
                </button>
              </div>
              {selectedText.background && selectedText.background.startsWith('#') && (
                <ColorField label="Background color" value={selectedText.background} onStart={mark} onChange={(v) => updateText({ background: v }, true)} />
              )}
              <label className="field">
                <span>Animation</span>
                <select value={selectedText.animation} onChange={(e) => updateText({ animation: e.target.value as TextOverlay['animation'] })}>
                  <option value="none">None</option>
                  <option value="fade">Fade</option>
                  <option value="pop">Pop</option>
                  <option value="slide">Slide up</option>
                </select>
              </label>
              <h4>Position</h4>
              <div className="row">
                <button onClick={() => updateText({ x: 0.5, y: 0.15 })}>Top</button>
                <button onClick={() => updateText({ x: 0.5, y: 0.5 })}>Center</button>
                <button onClick={() => updateText({ x: 0.5, y: 0.85 })}>Bottom</button>
              </div>
              <div className="grid2">
                <NumberField label="Start (s)" value={selectedText.start} min={0} step={0.1} onChange={(v) => updateText({ start: v })} />
                <NumberField label="Length (s)" value={selectedText.duration} min={0.2} step={0.1} onChange={(v) => updateText({ duration: v })} />
              </div>
            </>
          ) : selectedAudio ? (
            <>
              <h3>Audio</h3>
              <p className="hint">{project.assets.find((a) => a.id === selectedAudio.assetId)?.name}</p>
              <RangeField label="Volume" value={selectedAudio.volume} min={0} max={2} step={0.05} onStart={mark} onChange={(v) => updateAudio({ volume: v }, true)} format={(v) => `${Math.round(v * 100)}%`} />
              <NumberField label="Start (s)" value={selectedAudio.start} min={0} step={0.1} onChange={(v) => updateAudio({ start: v })} />
            </>
          ) : (
            <>
              <h3>Project</h3>
              <p className="hint">{project.width} × {project.height} · {formatTime(duration)}</p>
              <ColorField label="Background" value={project.background} onStart={mark} onChange={(v) => setTransient((p) => ({ ...p, background: v }))} />
              {currentClip && (
                <button className="block" onClick={() => setSelection({ kind: 'clip', id: currentClip.clip.id })}>
                  Edit clip under playhead
                </button>
              )}
              <p className="hint">
                {saveState === 'saving' && 'Saving…'}
                {saveState === 'saved' && '✓ Saved in this browser. Reopen it from the home screen any time.'}
                {saveState === 'error' && '⚠ Could not save in this browser (storage may be full or blocked).'}
              </p>
              <button className="block" onClick={() => setShowHelp(true)}>⌨ Keyboard shortcuts</button>
            </>
          )}
        </aside>
      </div>

      <Timeline
        project={project}
        time={time}
        pps={pps}
        selection={selection}
        onSelect={setSelection}
        onSeek={seek}
        onBegin={mark}
        onChange={setTransient}
        onCommit={set}
        onTransitionClick={onTransitionClick}
      />

      {showHelp && <ShortcutsDialog shortcuts={SHORTCUTS} onClose={() => setShowHelp(false)} />}

      {exportProgress !== null && (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>Exporting video…</h3>
            <p className="hint">The video plays through once while it is recorded. Keep this tab open.</p>
            <div className="progress"><div style={{ width: `${Math.round(exportProgress * 100)}%` }} /></div>
            <p>{Math.round(exportProgress * 100)}%</p>
          </div>
        </div>
      )}
    </div>
  );
}

function ClipInspector({
  clip,
  assetName,
  isVideo,
  isFirst,
  mark,
  update,
  updateFilters,
  applyTransitionToAll,
}: {
  clip: Clip;
  assetName: string;
  isVideo: boolean;
  isFirst: boolean;
  mark: () => void;
  update: (patch: Partial<Clip>, live?: boolean) => void;
  updateFilters: (patch: Partial<ClipFilters>) => void;
  applyTransitionToAll: (t: Transition | undefined) => void;
}) {
  const f = clip.filters;
  const maxFade = Math.min(3, clipDuration(clip) / 2);
  return (
    <>
      <h3>Clip</h3>
      <p className="hint">{assetName} · {clipDuration(clip).toFixed(2)}s</p>
      <label className="field">
        <span>Speed</span>
        <select value={clip.speed} onChange={(e) => update({ speed: Number(e.target.value) })}>
          {SPEEDS.map((s) => (
            <option key={s} value={s}>{s}×</option>
          ))}
        </select>
      </label>
      {isVideo && (
        <RangeField label="Volume" value={clip.volume} min={0} max={2} step={0.05} onStart={mark} onChange={(v) => update({ volume: v }, true)} format={(v) => `${Math.round(v * 100)}%`} />
      )}
      <RangeField label="Fade in" value={clip.fadeIn} min={0} max={maxFade} step={0.1} onStart={mark} onChange={(v) => update({ fadeIn: v }, true)} format={(v) => `${v.toFixed(1)}s`} />
      <RangeField label="Fade out" value={clip.fadeOut} min={0} max={maxFade} step={0.1} onStart={mark} onChange={(v) => update({ fadeOut: v }, true)} format={(v) => `${v.toFixed(1)}s`} />
      {!isFirst && (
        <>
          <h4>Transition in</h4>
          <div className="grid3">
            <button className={!clip.transition ? 'active' : ''} onClick={() => update({ transition: undefined })}>None</button>
            {TRANSITIONS.map((t) => (
              <button
                key={t.type}
                className={clip.transition?.type === t.type ? 'active' : ''}
                onClick={() => update({ transition: { type: t.type, duration: Math.min(clip.transition?.duration ?? 0.5, maxTransition(clip)) } })}
              >
                {t.label}
              </button>
            ))}
          </div>
          {clip.transition && (
            <>
              <RangeField
                label="Transition length"
                value={clip.transition.duration}
                min={0.1}
                max={maxTransition(clip)}
                step={0.1}
                onStart={mark}
                onChange={(v) => update({ transition: { ...clip.transition!, duration: v } }, true)}
                format={(v) => `${v.toFixed(1)}s`}
              />
              <button className="block" onClick={() => applyTransitionToAll(clip.transition)}>Apply to all clips</button>
            </>
          )}
        </>
      )}
      <h4>Filters</h4>
      <div className="grid3">
        {FILTER_PRESETS.map((p) => (
          <button
            key={p.label}
            className={sameFilters(f, p.filters) ? 'active' : ''}
            onClick={() => update({ filters: p.filters })}
          >
            {p.label}
          </button>
        ))}
      </div>
      <h4>Adjust</h4>
      <FilterSliders filters={f} mark={mark} onChange={updateFilters} />
      <button className="block" onClick={() => update({ filters: NEUTRAL_FILTERS })}>Reset adjustments</button>
    </>
  );
}
