import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { downloadBlob, formatTime } from '../lib/download';
import { cssFilter, sameFilters } from '../lib/filters';
import { useHistory } from '../lib/history';
import { uid } from '../lib/id';
import { putMedia, saveVideoProject } from '../lib/projects';
import { ColorField, NumberField, RangeField } from '../ui/fields';
import { FilterSliders } from '../ui/FilterSliders';
import { FirstRunTips, ShortcutsDialog, shortcutsBlocked } from '../ui/Help';
import type { Shortcut } from '../ui/Help';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/Icon';
import { Logo } from '../ui/Logo';
import { overlayBox, probeMedia, VideoEngine } from './engine';
import { SFX_CATEGORIES, SOUND_EFFECTS, soundEffectFile } from './sfx';
import type { SoundEffect } from './sfx';
import { HEAD_W, Timeline } from './Timeline';
import type { Selection } from './Timeline';
import {
  ASPECTS,
  clipDuration,
  createAudioClip,
  createClip,
  createEffect,
  createOverlay,
  createProject,
  createTextOverlay,
  EFFECTS,
  estimateSizeMB,
  EXPORT_QUALITIES,
  FILTER_PRESETS,
  insertClipAt,
  layoutClips,
  locate,
  maxTransition,
  MOTIONS,
  NEUTRAL_FILTERS,
  normalizeProject,
  parseSubtitles,
  projectDuration,
  scriptToCaptions,
  splitClips,
  splitTexts,
  textsAt,
  toSrt,
  TRANSITIONS,
  trimAtPlayhead,
} from './timeline';
import type { ExportOptions } from './timeline';
import type {
  AudioClip,
  Clip,
  ClipFilters,
  EffectItem,
  EffectType,
  MediaAsset,
  Motion,
  OverlayClip,
  TextOverlay,
  Transition,
  TransitionType,
  VideoProject,
} from './types';

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

const TEXT_PRESETS: { label: string; patch: Partial<TextOverlay>; preview: React.CSSProperties }[] = [
  { label: 'Title', patch: { text: 'Big Title', y: 0.5, size: 0.14, animation: 'pop' }, preview: { fontWeight: 800, fontSize: 18 } },
  { label: 'Subtitle', patch: { text: 'Subtitle', y: 0.85, size: 0.06, bold: false, animation: 'fade' }, preview: { fontSize: 13 } },
  {
    label: 'Caption box',
    patch: { text: 'Caption', y: 0.85, size: 0.06, background: 'rgba(0,0,0,0.65)', animation: 'slide' },
    preview: { background: 'rgba(0,0,0,0.75)', padding: '2px 8px', borderRadius: 4, fontSize: 13 },
  },
  {
    label: 'Highlight',
    patch: { text: 'WOW!', y: 0.2, size: 0.1, color: '#111827', background: '#fde047', animation: 'pop' },
    preview: { background: '#fde047', color: '#111827', padding: '2px 8px', borderRadius: 4, fontWeight: 800 },
  },
  {
    label: 'Outline',
    patch: { text: 'OUTLINE', y: 0.5, size: 0.12, color: '#ffffff', stroke: '#111111', animation: 'pop' },
    preview: { fontWeight: 900, fontSize: 17, color: '#fff', WebkitTextStroke: '1.5px #000' },
  },
  {
    label: 'Neon',
    patch: { text: 'NEON', y: 0.5, size: 0.13, color: '#ffffff', glow: '#22d3ee', animation: 'fade' },
    preview: { fontWeight: 800, fontSize: 17, color: '#fff', textShadow: '0 0 6px #22d3ee, 0 0 12px #22d3ee' },
  },
  {
    label: 'Neon pink',
    patch: { text: 'PARTY', y: 0.5, size: 0.13, color: '#ffffff', glow: '#ec4899', animation: 'pop' },
    preview: { fontWeight: 800, fontSize: 17, color: '#fff', textShadow: '0 0 6px #ec4899, 0 0 12px #ec4899' },
  },
  {
    label: 'Yellow pop',
    patch: { text: 'NO WAY!', y: 0.25, size: 0.12, color: '#fde047', stroke: '#111111', animation: 'pop' },
    preview: { fontWeight: 900, fontSize: 17, color: '#fde047', WebkitTextStroke: '1.5px #000' },
  },
];

const SHORTCUTS: Shortcut[] = [
  { keys: ['Space'], action: 'Play / pause' },
  { keys: ['Ctrl', 'B'], action: 'Split at the playhead (also S)' },
  { keys: ['Q'], action: 'Delete the part of the clip before the playhead' },
  { keys: ['W'], action: 'Delete the part of the clip after the playhead' },
  { keys: ['Del'], action: 'Delete selected' },
  { keys: ['←', '→'], action: 'Step one frame (Shift: 1 second)' },
  { keys: ['Home'], action: 'Go to start' },
  { keys: ['End'], action: 'Go to end' },
  { keys: ['Ctrl', 'Z'], action: 'Undo' },
  { keys: ['Ctrl', 'Shift', 'Z'], action: 'Redo' },
  { keys: ['?'], action: 'Show this help' },
];

const STICKERS = [
  '😀', '😂', '🤣', '😍', '🥰', '😎', '🤩', '🥳', '😮', '😱', '🤔', '😴', '😭', '😡', '🤯', '🙈',
  '🔥', '✨', '⭐', '🌟', '💥', '💯', '❤️', '💔', '👍', '👎', '👏', '🙌', '🙏', '💪', '👀', '👉',
  '🎉', '🎊', '🎁', '🎵', '🎬', '📸', '🚀', '⚡', '🌈', '☀️', '🌙', '❄️', '🍕', '☕', '🏆', '✅',
];

const DEFAULT_TRANSITION: Transition = { type: 'fade', duration: 0.5 };

type LibraryTab = 'media' | 'audio' | 'text' | 'stickers' | 'effects' | 'transitions' | 'filters';
const LIBRARY_TABS: { id: LibraryTab; label: string; icon: IconName }[] = [
  { id: 'media', label: 'Media', icon: 'film' },
  { id: 'audio', label: 'Audio', icon: 'music' },
  { id: 'text', label: 'Text', icon: 'text' },
  { id: 'stickers', label: 'Stickers', icon: 'smile' },
  { id: 'effects', label: 'Effects', icon: 'sparkles' },
  { id: 'transitions', label: 'Transitions', icon: 'shuffle' },
  { id: 'filters', label: 'Filters', icon: 'droplet' },
];

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
}

export function VideoEditor({
  onExit,
  aspect,
  initialProject,
  projectId,
}: {
  onExit: () => void;
  aspect?: { width: number; height: number };
  initialProject?: VideoProject;
  projectId: string;
}) {
  const history = useHistory<VideoProject>(() =>
    initialProject ? normalizeProject(initialProject) : createProject(aspect?.width, aspect?.height),
  );
  const { state: project, set, setTransient, mark } = history;
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);
  const [pps, setPps] = useState(60);
  const [tab, setTab] = useState<LibraryTab>('media');
  const [importing, setImporting] = useState(0);
  const [exportProgress, setExportProgress] = useState<number | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [panelOpen, setPanelOpen] = useState(() => !window.matchMedia?.('(max-width: 760px)').matches);
  const [exportDialog, setExportDialog] = useState(false);
  const [exportOpts, setExportOpts] = useState<ExportOptions>({ fps: 30, bitrate: 8_000_000 });
  const [recorder, setRecorder] = useState<MediaRecorder | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error' | null>(null);
  const [script, setScript] = useState('');
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [transitionPick, setTransitionPick] = useState<TransitionType>('fade');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<VideoEngine | null>(null);
  const previewAudio = useRef<HTMLAudioElement | null>(null);
  const textDragRef = useRef<{ id: string; kind: 'text' | 'overlay'; offX: number; offY: number } | null>(null);

  const duration = projectDuration(project);
  const selectedClip = selection?.kind === 'clip' ? project.clips.find((c) => c.id === selection.id) : undefined;
  const selectedText = selection?.kind === 'text' ? project.texts.find((t) => t.id === selection.id) : undefined;
  const selectedAudio = selection?.kind === 'audio' ? project.audio.find((a) => a.id === selection.id) : undefined;
  const selectedOverlay = selection?.kind === 'overlay' ? project.overlays.find((o) => o.id === selection.id) : undefined;
  const selectedEffect = selection?.kind === 'effect' ? project.effects.find((o) => o.id === selection.id) : undefined;
  const currentClip = locate(project.clips, time);
  /** The clip edits apply to: the selected clip, or else the one under the playhead. */
  const targetClip = selectedClip ?? currentClip?.clip;

  useEffect(() => {
    const engine = new VideoEngine(canvasRef.current!);
    engine.onTime = setTime;
    engine.onPlayingChange = setPlaying;
    engineRef.current = engine;
    return () => {
      engine.destroy();
      previewAudio.current?.pause();
    };
  }, []);

  useEffect(() => {
    engineRef.current?.setProject(project);
  }, [project]);

  // Autosave the project (media files are stored once, at import time).
  useEffect(() => {
    if (project.assets.length === 0 && project.texts.length === 0) return;
    setSaveState('saving');
    const t = setTimeout(() => {
      saveVideoProject(projectId, project).then(
        () => setSaveState('saved'),
        () => setSaveState('error'),
      );
    }, 800);
    return () => clearTimeout(t);
  }, [project, projectId]);

  const seek = useCallback((t: number) => engineRef.current?.seek(t), []);
  const togglePlay = useCallback(() => engineRef.current?.toggle(), []);
  const now = () => engineRef.current?.time ?? 0;

  /** Probe a file, store it with the project, and return the new asset. */
  const addAssetFile = async (file: File, extra: Partial<MediaAsset> = {}) => {
    const asset = { ...(await probeMedia(file, uid('asset'))), ...extra };
    await putMedia(asset.id, file).catch(() => setSaveState('error'));
    return asset;
  };

  const importFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files).filter((f) => /^(video|audio|image)\//.test(f.type));
      setImporting((n) => n + list.length);
      for (const file of list) {
        try {
          const asset = await addAssetFile(file);
          set((p) => {
            const next = { ...p, assets: [...p.assets, asset] };
            if (asset.kind === 'audio') return { ...next, audio: [...p.audio, createAudioClip(asset, now())] };
            return { ...next, clips: [...p.clips, createClip(asset)] };
          });
        } catch (err) {
          alert(err instanceof Error ? err.message : `Could not import ${file.name}`);
        } finally {
          setImporting((n) => n - 1);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [set],
  );

  // ---------- Sound effects ----------

  const previewSfx = (fx: SoundEffect) => {
    previewAudio.current?.pause();
    if (previewing === fx.id) {
      setPreviewing(null);
      return;
    }
    const el = new Audio(URL.createObjectURL(soundEffectFile(fx)));
    el.onended = () => setPreviewing(null);
    previewAudio.current = el;
    setPreviewing(fx.id);
    void el.play().catch(() => setPreviewing(null));
  };

  const addSfx = async (fx: SoundEffect) => {
    const at = now();
    let asset = project.assets.find((a) => a.sfxId === fx.id);
    if (!asset) asset = await addAssetFile(soundEffectFile(fx), { sfxId: fx.id, name: fx.name });
    const a = asset;
    const clip = createAudioClip(a, at);
    set((p) => ({ ...p, assets: p.assets.some((x) => x.id === a.id) ? p.assets : [...p.assets, a], audio: [...p.audio, clip] }));
    setSelection({ kind: 'audio', id: clip.id });
  };

  // ---------- Editing ----------

  const updateClip = (patch: Partial<Clip>, live = false, id = selectedClip?.id) => {
    if (!id) return;
    const fn = (p: VideoProject) => ({ ...p, clips: p.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
    if (live) setTransient(fn);
    else set(fn);
  };
  const updateFilters = (patch: Partial<ClipFilters>) => selectedClip && updateClip({ filters: { ...selectedClip.filters, ...patch } }, true);
  const updateItem = <K extends 'texts' | 'audio' | 'overlays' | 'effects'>(key: K, id: string | undefined, patch: object, live = false) => {
    if (!id) return;
    const fn = (p: VideoProject) => ({ ...p, [key]: (p[key] as { id: string }[]).map((x) => (x.id === id ? { ...x, ...patch } : x)) });
    if (live) setTransient(fn);
    else set(fn);
  };
  const updateText = (patch: Partial<TextOverlay>, live = false) => updateItem('texts', selectedText?.id, patch, live);
  const updateAudio = (patch: Partial<AudioClip>, live = false) => updateItem('audio', selectedAudio?.id, patch, live);
  const updateOverlay = (patch: Partial<OverlayClip>, live = false) => updateItem('overlays', selectedOverlay?.id, patch, live);
  const updateEffect = (patch: Partial<EffectItem>, live = false) => updateItem('effects', selectedEffect?.id, patch, live);

  const split = useCallback(() => {
    const t = engineRef.current?.time ?? 0;
    if (selection?.kind === 'text') {
      set((p) => ({ ...p, texts: p.texts.flatMap((o) => (o.id === selection.id ? splitTexts([o], t) : [o])) }));
    } else if (selection?.kind === 'effect') {
      set((p) => ({
        ...p,
        effects: p.effects.flatMap((o) =>
          o.id !== selection.id || t - o.start < 0.1 || o.start + o.duration - t < 0.1
            ? [o]
            : [
                { ...o, duration: t - o.start },
                { ...o, id: uid('fx'), start: t, duration: o.start + o.duration - t },
              ],
        ),
      }));
    } else if (selection?.kind === 'audio' || selection?.kind === 'overlay') {
      const key = selection.kind === 'audio' ? 'audio' : 'overlays';
      const splitItem = <T extends AudioClip | OverlayClip>(a: T): T[] => {
        const local = t - a.start;
        if (a.id !== selection.id || local < 0.1 || a.out - a.in - local < 0.1) return [a];
        return [
          { ...a, out: a.in + local },
          { ...a, id: uid(key), start: t, in: a.in + local },
        ];
      };
      set((p) => ({ ...p, [key]: (p[key] as (AudioClip | OverlayClip)[]).flatMap(splitItem) }));
    } else {
      set((p) => ({ ...p, clips: splitClips(p.clips, t) }));
    }
  }, [selection, set]);

  const trimPlayhead = (side: 'before' | 'after') => set((p) => ({ ...p, clips: trimAtPlayhead(p.clips, now(), side) }));

  const removeSelected = useCallback(() => {
    if (!selection) return;
    const key = ({ clip: 'clips', text: 'texts', audio: 'audio', overlay: 'overlays', effect: 'effects' } as const)[selection.kind];
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
    } else if (selectedOverlay) {
      const copy = { ...selectedOverlay, id: uid('overlay'), start: selectedOverlay.start + selectedOverlay.out - selectedOverlay.in };
      set((p) => ({ ...p, overlays: [...p.overlays, copy] }));
      setSelection({ kind: 'overlay', id: copy.id });
    } else if (selectedEffect) {
      const copy = { ...selectedEffect, id: uid('fx'), start: selectedEffect.start + selectedEffect.duration };
      set((p) => ({ ...p, effects: [...p.effects, copy] }));
      setSelection({ kind: 'effect', id: copy.id });
    }
  };

  /** Freeze frame: grab the picture at the playhead and insert it as a 3-second still. */
  const freezeFrame = async () => {
    const engine = engineRef.current;
    if (!engine || !currentClip) return;
    engine.pause();
    const at = engine.time;
    const blob = await engine.captureClipFrame();
    if (!blob) return;
    const count = project.assets.filter((a) => a.name.startsWith('Freeze frame')).length + 1;
    const asset = await addAssetFile(new File([blob], `Freeze frame ${count}.png`, { type: 'image/png' }));
    const clip = createClip(asset);
    set((p) => ({ ...p, assets: [...p.assets, asset], clips: insertClipAt(p.clips, at, clip) }));
    setSelection({ kind: 'clip', id: clip.id });
  };

  const fitTimeline = () => {
    const w = (document.querySelector('.timeline') as HTMLElement | null)?.clientWidth ?? window.innerWidth;
    setPps(Math.max(10, Math.min(300, Math.floor((w - HEAD_W - 40) / Math.max(1, duration)))));
  };

  const addCaptions = (captions: { start: number; end: number; text: string }[]) => {
    if (captions.length === 0) return;
    const items = captions.map((c) =>
      createTextOverlay(c.start, { text: c.text, duration: c.end - c.start, y: 0.86, size: 0.055, bold: true, background: '#111827', animation: 'none' }),
    );
    set((p) => ({ ...p, texts: [...p.texts, ...items] }));
  };

  const importCaptions = async (file: File) => {
    const captions = parseSubtitles(await file.text());
    if (captions.length === 0) alert('No captions found in that file. Use a .srt or .vtt subtitle file.');
    addCaptions(captions);
  };

  const exportCaptions = () => downloadBlob(new Blob([toSrt(project.texts)], { type: 'text/plain' }), `${project.name || 'captions'}.srt`);

  const setTransition = (clipId: string, transition: Transition | undefined) =>
    set((p) => ({ ...p, clips: p.clips.map((c) => (c.id === clipId ? { ...c, transition } : c)) }));

  const onTransitionClick = (clipId: string) => {
    setSelection({ kind: 'clip', id: clipId });
    const clip = project.clips.find((c) => c.id === clipId);
    if (clip && !clip.transition) setTransition(clipId, { ...DEFAULT_TRANSITION, duration: Math.min(DEFAULT_TRANSITION.duration, maxTransition(clip)) });
  };

  /** From the Transitions tab: apply to the selected clip, or the cut nearest the playhead. */
  const applyTransitionHere = (type: TransitionType) => {
    setTransitionPick(type);
    const placed = layoutClips(project.clips).slice(1);
    if (placed.length === 0) return;
    const pick =
      selectedClip && project.clips.indexOf(selectedClip) > 0
        ? selectedClip
        : placed.reduce((best, p) => (Math.abs(p.start - time) < Math.abs(best.start - time) ? p : best)).clip;
    setTransition(pick.id, { type, duration: Math.min(pick.transition?.duration ?? 0.5, maxTransition(pick)) });
    setSelection({ kind: 'clip', id: pick.id });
  };

  const applyTransitionToAll = (transition: Transition | undefined) =>
    set((p) => ({
      ...p,
      clips: p.clips.map((c, i) => (i === 0 ? c : { ...c, transition: transition && { ...transition, duration: Math.min(transition.duration, maxTransition(c)) } })),
    }));

  const applyFilter = (filters: ClipFilters, all = false) =>
    set((p) => ({ ...p, clips: p.clips.map((c) => (all || c.id === targetClip?.id ? { ...c, filters } : c)) }));

  const addEffect = (type: EffectType) => {
    const fx = createEffect(type, now(), { duration: type === 'flash' ? 1 : 3 });
    set((p) => ({ ...p, effects: [...p.effects, fx] }));
    setSelection({ kind: 'effect', id: fx.id });
  };

  // Voice-over: record the microphone while the timeline plays, then drop it on the audio track.
  const startVoiceOver = async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      alert('Microphone access is needed to record a voice-over.');
      return;
    }
    const startAt = now();
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
        const asset = await addAssetFile(file);
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
    const o = createTextOverlay(now(), patch);
    set((p) => ({ ...p, texts: [...p.texts, o] }));
    setSelection({ kind: 'text', id: o.id });
  };

  const addToTimeline = (a: MediaAsset) =>
    set((p) => (a.kind === 'audio' ? { ...p, audio: [...p.audio, createAudioClip(a, time)] } : { ...p, clips: [...p.clips, createClip(a)] }));

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void frameRef.current?.requestFullscreen?.().catch(() => {});
  };

  // Keyboard shortcuts: one window listener that always calls the latest handler.
  const keyHandler = useRef<(e: KeyboardEvent) => void>();
  {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && exportDialog) {
        setExportDialog(false);
        return;
      }
      // Off while typing, while a dialog/menu is open (Space during an export would pause
      // the recording), and while a voice-over is being recorded.
      if (isTyping(e.target) || shortcutsBlocked() || recorder) return;
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
      } else if ((key === 's' && !mod) || (mod && key === 'b')) {
        e.preventDefault();
        split();
      } else if (key === 'q' && !mod) {
        trimPlayhead('before');
      } else if (key === 'w' && !mod) {
        trimPlayhead('after');
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        removeSelected();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const step = e.shiftKey ? 1 : 1 / 30;
        seek(now() + (e.key === 'ArrowLeft' ? -step : step));
      } else if (e.key === '?') {
        setShowHelp(true);
      } else if (e.key === 'Home') {
        seek(0);
      } else if (e.key === 'End') {
        seek(duration);
      }
    };
    keyHandler.current = onKey;
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyHandler.current?.(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Drag text and picture-in-picture overlays directly on the preview.
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
    const overlayHit = hit
      ? undefined
      : [...project.overlays].reverse().find((o) => {
          if (time < o.start || time >= o.start + o.out - o.in) return false;
          const asset = project.assets.find((a) => a.id === o.assetId);
          if (!asset) return false;
          const b = overlayBox(o, asset, project.width, project.height);
          const px = p.x * project.width;
          const py = p.y * project.height;
          return px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h;
        });
    const target = hit ?? overlayHit;
    if (!target) return;
    const kind = hit ? 'text' : 'overlay';
    setSelection({ kind, id: target.id });
    textDragRef.current = { id: target.id, kind, offX: p.x - target.x, offY: p.y - target.y };
    mark();
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPreviewMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = textDragRef.current;
    if (!d) return;
    const p = previewPoint(e);
    const clamp = (v: number) => Math.max(0, Math.min(1, v));
    const move = <T extends { id: string; x: number; y: number }>(o: T): T => (o.id === d.id ? { ...o, x: clamp(p.x - d.offX), y: clamp(p.y - d.offY) } : o);
    setTransient((proj) => (d.kind === 'text' ? { ...proj, texts: proj.texts.map(move) } : { ...proj, overlays: proj.overlays.map(move) }));
  };

  const doExport = async () => {
    const engine = engineRef.current;
    if (!engine || duration <= 0) return;
    setExportDialog(false);
    setSelection(null);
    setExportProgress(0);
    try {
      const blob = await engine.record(setExportProgress, exportOpts);
      downloadBlob(blob, `${project.name || 'video'}.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExportProgress(null);
    }
  };

  /** Picture used for the filter previews: the clip under the playhead, else any visual. */
  const previewThumb =
    project.assets.find((a) => a.id === targetClip?.assetId)?.thumbnail ?? project.assets.find((a) => a.thumbnail)?.thumbnail;

  const library: Record<LibraryTab, ReactNode> = {
    media: (
      <>
        <label className="button primary block import-btn">
          <Icon name="upload" /> Import
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
        {project.assets.filter((a) => !a.sfxId).length === 0 && (
          <div className="library-empty">
            <Icon name="film" size={28} />
            <p>Drop videos, photos or music here, or click Import.</p>
          </div>
        )}
        <div className="asset-grid">
          {project.assets
            .filter((a) => !a.sfxId)
            .map((a) => (
              <div key={a.id} className="card asset">
                {a.thumbnail ? <img src={a.thumbnail} alt="" /> : <div className="asset-icon">♪</div>}
                <span className="asset-dur">{a.kind === 'image' ? 'Photo' : formatTime(a.duration)}</span>
                <span className="asset-name" title={a.name}>{a.name}</span>
                <button className="asset-add" title="Add to timeline" onClick={() => addToTimeline(a)} aria-label="Add to timeline">
                  <Icon name="plus" size={16} />
                </button>
                {a.kind !== 'audio' && (
                  <button
                    className="asset-add asset-overlay"
                    title="Add on top as picture-in-picture, at the playhead"
                    onClick={() => {
                      const o = createOverlay(a, time);
                      set((p) => ({ ...p, overlays: [...p.overlays, o] }));
                      setSelection({ kind: 'overlay', id: o.id });
                    }}
                    aria-label="Add as picture-in-picture"
                  >
                    <Icon name="pip" size={15} />
                  </button>
                )}
              </div>
            ))}
        </div>
      </>
    ),
    audio: (
      <>
        <div className="row">
          <label className="button">
            <Icon name="music" /> Import music
            <input
              type="file"
              accept="audio/*"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) void importFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </label>
          {recorder ? (
            <button className="recording" onClick={() => recorder.stop()}>
              <span className="rec-dot" /> Stop recording
            </button>
          ) : (
            <button onClick={startVoiceOver} title="Record from your microphone while the video plays">
              <Icon name="mic" /> Record voice-over
            </button>
          )}
        </div>
        {project.assets.some((a) => a.kind === 'audio' && !a.sfxId) && (
          <>
            <h4>Your audio</h4>
            <div className="sfx-list">
              {project.assets
                .filter((a) => a.kind === 'audio' && !a.sfxId)
                .map((a) => (
                  <div key={a.id} className="sfx-row">
                    <span className="sfx-icon">
                      <Icon name="music" size={15} />
                    </span>
                    <span className="sfx-name">{a.name}</span>
                    <span className="sfx-dur">{formatTime(a.duration)}</span>
                    <button className="icon-btn sfx-add" onClick={() => addToTimeline(a)} title="Add at the playhead" aria-label={`Add ${a.name}`}>
                      <Icon name="plus" size={16} />
                    </button>
                  </div>
                ))}
            </div>
          </>
        )}
        <h4>Sound effects</h4>
        {SFX_CATEGORIES.map((cat) => (
          <div key={cat} className="sfx-group">
            <span className="sfx-cat">{cat}</span>
            <div className="sfx-list">
              {SOUND_EFFECTS.filter((s) => s.category === cat).map((fx) => (
                <div key={fx.id} className={`sfx-row ${previewing === fx.id ? 'playing' : ''}`}>
                  <button className="icon-btn sfx-play" onClick={() => previewSfx(fx)} title="Preview" aria-label={`Preview ${fx.name}`}>
                    <Icon name={previewing === fx.id ? 'pause' : 'play'} size={14} />
                  </button>
                  <span className="sfx-name">{fx.name}</span>
                  <span className="sfx-dur">{fx.duration.toFixed(1)}s</span>
                  <button className="icon-btn sfx-add" onClick={() => void addSfx(fx)} title="Add at the playhead" aria-label={`Add ${fx.name}`}>
                    <Icon name="plus" size={16} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </>
    ),
    text: (
      <>
        <p className="hint">Added at the playhead. Drag text on the player to move it.</p>
        <div className="text-style-grid">
          {TEXT_PRESETS.map((t) => (
            <button key={t.label} className="text-style" onClick={() => addText(t.patch)} title={t.label} aria-label={t.label}>
              <span style={t.preview}>{t.label === 'Title' || t.label === 'Subtitle' ? t.label : (t.patch.text ?? t.label)}</span>
            </button>
          ))}
        </div>
        <h4>Captions</h4>
        <label className="field">
          <span>Captions from a script</span>
          <textarea
            rows={4}
            placeholder="Type or paste what is said. Each line (or sentence) becomes one caption, spread over the video."
            value={script}
            onChange={(e) => setScript(e.target.value)}
          />
        </label>
        <button
          className="block"
          disabled={!script.trim() || duration <= 0}
          onClick={() => {
            addCaptions(scriptToCaptions(script, duration));
            setScript('');
          }}
        >
          Create captions
        </button>
        <div className="row">
          <label className="button">
            Import .srt
            <input
              type="file"
              accept=".srt,.vtt,text/vtt"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void importCaptions(f);
              }}
            />
          </label>
          <button onClick={exportCaptions} disabled={project.texts.length === 0}>Download .srt</button>
        </div>
      </>
    ),
    stickers: (
      <>
        <p className="hint">Added at the playhead. Drag them on the player.</p>
        <div className="sticker-grid">
          {STICKERS.map((em) => (
            <button key={em} onClick={() => addText({ text: em, y: 0.3, x: 0.5, size: 0.16, bold: false, animation: 'pop' })} title="Add sticker">
              {em}
            </button>
          ))}
        </div>
      </>
    ),
    effects: (
      <>
        <p className="hint">Added at the playhead on the Effects track. Drag its edges to change how long it lasts.</p>
        <div className="fx-grid">
          {EFFECTS.map((fx) => (
            <button key={fx.type} className="fx-card" onClick={() => addEffect(fx.type)} title={fx.hint}>
              <span className={`fx-thumb fx-${fx.type}`} style={previewThumb ? { backgroundImage: `url(${previewThumb})` } : undefined} />
              <span className="fx-label">{fx.label}</span>
            </button>
          ))}
        </div>
      </>
    ),
    transitions: (
      <>
        <p className="hint">
          {project.clips.length < 2 ? 'Add at least two clips to use transitions.' : 'Applies to the selected clip, or to the cut nearest the playhead.'}
        </p>
        <div className="fx-grid">
          {TRANSITIONS.map((t) => (
            <button key={t.type} className={`fx-card ${transitionPick === t.type ? 'active' : ''}`} onClick={() => applyTransitionHere(t.type)} disabled={project.clips.length < 2}>
              <span className={`fx-thumb tr-${t.type}`} />
              <span className="fx-label">{t.label}</span>
            </button>
          ))}
        </div>
        <button className="block" disabled={project.clips.length < 2} onClick={() => applyTransitionToAll({ type: transitionPick, duration: 0.5 })}>
          Apply “{TRANSITIONS.find((t) => t.type === transitionPick)?.label}” to every cut
        </button>
      </>
    ),
    filters: (
      <>
        <p className="hint">{targetClip ? 'Applies to the selected clip (or the one under the playhead).' : 'Add a clip to use filters.'}</p>
        <div className="fx-grid">
          {FILTER_PRESETS.map((f) => (
            <button
              key={f.label}
              className={`fx-card ${targetClip && sameFilters(targetClip.filters, f.filters) ? 'active' : ''}`}
              onClick={() => applyFilter(f.filters)}
              disabled={!targetClip}
            >
              <span className="fx-thumb" style={{ backgroundImage: previewThumb ? `url(${previewThumb})` : undefined, filter: cssFilter(f.filters) }} />
              <span className="fx-label">{f.label}</span>
            </button>
          ))}
        </div>
        <button className="block" disabled={!targetClip} onClick={() => targetClip && applyFilter(targetClip.filters, true)}>
          Apply this clip's filter to all clips
        </button>
      </>
    ),
  };

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
        <div className="topbar-group">
          <button className="brand-btn" onClick={onExit} title="Back to home" aria-label="Home">
            <Logo height={17} />
          </button>
          <span className="divider" />
          <span className="save-state-wrap">
            <span className={`save-state ${saveState ?? ''}`} aria-live="polite">
              {saveState === 'saving' && 'Saving…'}
              {saveState === 'saved' && (
                <>
                  <Icon name="check" size={14} /> Saved
                </>
              )}
              {saveState === 'error' && '⚠ Not saved'}
            </span>
          </span>
        </div>
        <div className="topbar-group center">
          <input
            className="title-input center-title"
            value={project.name}
            onFocus={mark}
            onChange={(e) => setTransient((p) => ({ ...p, name: e.target.value }))}
            aria-label="Video name"
          />
        </div>
        <div className="topbar-group end">
          <button className="icon-btn" onClick={() => setShowHelp(true)} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">
            <Icon name="help" />
          </button>
          <button className="primary" onClick={() => setExportDialog(true)} disabled={duration <= 0 || exportProgress !== null}>
            <Icon name="download" /> <span className="label">Export</span>
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className={`panel cc-library ${panelOpen ? '' : 'collapsed-body'}`}>
          <nav className="cc-tabs" aria-label="Library">
            {LIBRARY_TABS.map((t) => (
              <button
                key={t.id}
                className={tab === t.id ? 'active' : ''}
                onClick={() => {
                  if (tab === t.id) setPanelOpen((o) => !o);
                  else {
                    setTab(t.id);
                    setPanelOpen(true);
                  }
                }}
              >
                <Icon name={t.icon} size={18} />
                <span>{t.label}</span>
              </button>
            ))}
          </nav>
          {panelOpen && <div className="cc-library-body">{library[tab]}</div>}
        </aside>

        <main className="preview-area cc-player">
          <div className="cc-panel-head">
            <span>Player</span>
          </div>
          <div className="preview-frame" ref={frameRef}>
            <canvas
              ref={canvasRef}
              className="preview"
              style={{ aspectRatio: `${project.width} / ${project.height}` }}
              onPointerDown={onPreviewDown}
              onPointerMove={onPreviewMove}
              onPointerUp={() => (textDragRef.current = null)}
            />
            {project.clips.length === 0 && project.texts.length === 0 && <div className="preview-empty">Import a video or photo to get started</div>}
            <FirstRunTips
              storageKey="bee.tips.video"
              title="Welcome to the video editor 🎬"
              tips={[
                'Import clips: they line up on the timeline automatically.',
                'Drag clips to reorder, drag their edges to trim, and press Ctrl+B to split.',
                'Browse Audio, Text, Effects, Transitions and Filters at the top left. Press ? for shortcuts.',
              ]}
            />
          </div>
          <div className="cc-player-bar">
            <span className="timecode">
              <strong>{formatTime(time)}</strong> / {formatTime(duration)}
            </span>
            <div className="transport-center">
              <button className="icon-btn" onClick={() => seek(0)} title="Go to start (Home)" aria-label="Go to start">
                <Icon name="skipBack" />
              </button>
              <button className="play-btn" onClick={togglePlay} disabled={duration <= 0} title="Play/Pause (Space)" aria-label={playing ? 'Pause' : 'Play'}>
                <Icon name={playing ? 'pause' : 'play'} size={20} />
              </button>
            </div>
            <div className="cc-player-right">
              <select
                className="pill-select"
                value={`${project.width}x${project.height}`}
                onChange={(e) => {
                  const [w, h] = e.target.value.split('x').map(Number);
                  set((p) => ({ ...p, width: w, height: h }));
                }}
                title="Aspect ratio"
                aria-label="Aspect ratio"
              >
                {ASPECTS.map((a) => (
                  <option key={a.label} value={`${a.width}x${a.height}`}>{a.label}</option>
                ))}
              </select>
              <button className="icon-btn" onClick={toggleFullscreen} title="Full screen" aria-label="Full screen">
                <Icon name="fullscreen" />
              </button>
            </div>
          </div>
        </main>

        <aside className="panel right cc-details">
          <div className="cc-panel-head">
            <span>Details</span>
          </div>
          <div className="cc-details-body">
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
                  <button className={selectedText.background ? 'active' : ''} onClick={() => updateText({ background: selectedText.background ? null : '#111827' })}>
                    Box
                  </button>
                  <button className={selectedText.stroke ? 'active' : ''} onClick={() => updateText({ stroke: selectedText.stroke ? null : '#111111' })}>
                    Outline
                  </button>
                  <button className={selectedText.glow ? 'active' : ''} onClick={() => updateText({ glow: selectedText.glow ? null : '#22d3ee' })}>
                    Neon
                  </button>
                </div>
                {selectedText.background && selectedText.background.startsWith('#') && (
                  <ColorField label="Box color" value={selectedText.background} onStart={mark} onChange={(v) => updateText({ background: v }, true)} />
                )}
                {selectedText.stroke && <ColorField label="Outline color" value={selectedText.stroke} onStart={mark} onChange={(v) => updateText({ stroke: v }, true)} />}
                {selectedText.glow && <ColorField label="Neon color" value={selectedText.glow} onStart={mark} onChange={(v) => updateText({ glow: v }, true)} />}
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
            ) : selectedEffect ? (
              <>
                <h3>Effect</h3>
                <label className="field">
                  <span>Type</span>
                  <select value={selectedEffect.type} onChange={(e) => updateEffect({ type: e.target.value as EffectType })}>
                    {EFFECTS.map((fx) => (
                      <option key={fx.type} value={fx.type}>{fx.label}</option>
                    ))}
                  </select>
                </label>
                <RangeField label="Strength" value={selectedEffect.intensity} min={0.1} max={1} step={0.01} onStart={mark} onChange={(v) => updateEffect({ intensity: v }, true)} format={(v) => `${Math.round(v * 100)}%`} />
                <div className="grid2">
                  <NumberField label="Start (s)" value={selectedEffect.start} min={0} step={0.1} onChange={(v) => updateEffect({ start: v })} />
                  <NumberField label="Length (s)" value={selectedEffect.duration} min={0.2} step={0.1} onChange={(v) => updateEffect({ duration: v })} />
                </div>
              </>
            ) : selectedOverlay ? (
              <>
                <h3>Overlay</h3>
                <p className="hint">{project.assets.find((a) => a.id === selectedOverlay.assetId)?.name} · drag it on the player to move it.</p>
                <RangeField label="Size" value={selectedOverlay.scale} min={0.1} max={1} step={0.01} onStart={mark} onChange={(v) => updateOverlay({ scale: v }, true)} format={(v) => `${Math.round(v * 100)}%`} />
                <RangeField label="Opacity" value={selectedOverlay.opacity} min={0.1} max={1} step={0.01} onStart={mark} onChange={(v) => updateOverlay({ opacity: v }, true)} format={(v) => `${Math.round(v * 100)}%`} />
                <RangeField label="Rounded corners" value={selectedOverlay.rounded} min={0} max={0.5} step={0.01} onStart={mark} onChange={(v) => updateOverlay({ rounded: v }, true)} format={(v) => `${Math.round(v * 200)}%`} />
                {project.assets.find((a) => a.id === selectedOverlay.assetId)?.kind === 'video' && (
                  <RangeField label="Volume" value={selectedOverlay.volume} min={0} max={2} step={0.05} onStart={mark} onChange={(v) => updateOverlay({ volume: v }, true)} format={(v) => `${Math.round(v * 100)}%`} />
                )}
                <h4>Position</h4>
                <div className="grid3">
                  <button onClick={() => updateOverlay({ x: 0.25, y: 0.28 })}>↖ Top left</button>
                  <button onClick={() => updateOverlay({ x: 0.5, y: 0.5 })}>Center</button>
                  <button onClick={() => updateOverlay({ x: 0.75, y: 0.28 })}>↗ Top right</button>
                  <button onClick={() => updateOverlay({ x: 0.25, y: 0.72 })}>↙ Bottom left</button>
                  <button onClick={() => updateOverlay({ x: 0.5, y: 0.5, scale: 1 })}>Full frame</button>
                  <button onClick={() => updateOverlay({ x: 0.75, y: 0.72 })}>↘ Bottom right</button>
                </div>
                <NumberField label="Start (s)" value={selectedOverlay.start} min={0} step={0.1} onChange={(v) => updateOverlay({ start: v })} />
              </>
            ) : selectedAudio ? (
              <>
                <h3>Audio</h3>
                <p className="hint">{project.assets.find((a) => a.id === selectedAudio.assetId)?.name}</p>
                <RangeField label="Volume" value={selectedAudio.volume} min={0} max={2} step={0.05} onStart={mark} onChange={(v) => updateAudio({ volume: v }, true)} format={(v) => `${Math.round(v * 100)}%`} />
                <RangeField label="Fade in" value={selectedAudio.fadeIn ?? 0} min={0} max={Math.min(5, (selectedAudio.out - selectedAudio.in) / 2)} step={0.1} onStart={mark} onChange={(v) => updateAudio({ fadeIn: v }, true)} format={(v) => `${v.toFixed(1)}s`} />
                <RangeField label="Fade out" value={selectedAudio.fadeOut ?? 0} min={0} max={Math.min(5, (selectedAudio.out - selectedAudio.in) / 2)} step={0.1} onStart={mark} onChange={(v) => updateAudio({ fadeOut: v }, true)} format={(v) => `${v.toFixed(1)}s`} />
                <NumberField label="Start (s)" value={selectedAudio.start} min={0} step={0.1} onChange={(v) => updateAudio({ start: v })} />
              </>
            ) : (
              <>
                <h3>Project</h3>
                <p className="hint">
                  {project.width} × {project.height} · {formatTime(duration)}
                </p>
                <h4>Empty space around clips</h4>
                <div className="row">
                  <button className={project.fill !== 'blur' ? 'active' : ''} onClick={() => set((p) => ({ ...p, fill: 'color' }))}>Color</button>
                  <button className={project.fill === 'blur' ? 'active' : ''} onClick={() => set((p) => ({ ...p, fill: 'blur' }))} title="Fill with a blurred copy of the clip">
                    Blur
                  </button>
                </div>
                <ColorField label="Background" value={project.background} onStart={mark} onChange={(v) => setTransient((p) => ({ ...p, background: v }))} />
                {currentClip && (
                  <button className="block" onClick={() => setSelection({ kind: 'clip', id: currentClip.clip.id })}>
                    Edit clip under playhead
                  </button>
                )}
                <p className="hint">Your project saves automatically in this browser. Reopen it from the home screen any time.</p>
                <button className="block" onClick={() => setShowHelp(true)}>
                  <Icon name="keyboard" /> Keyboard shortcuts
                </button>
              </>
            )}
          </div>
        </aside>
      </div>

      <div className="cc-toolbar">
        <div className="cc-tools">
          <button className="icon-btn" onClick={history.undo} disabled={!history.canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">
            <Icon name="undo" />
          </button>
          <button className="icon-btn" onClick={history.redo} disabled={!history.canRedo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">
            <Icon name="redo" />
          </button>
          <span className="divider" />
          <button className="icon-btn" onClick={split} title="Split (Ctrl+B)" aria-label="Split">
            <Icon name="scissors" />
          </button>
          <button className="icon-btn" onClick={() => trimPlayhead('before')} disabled={!currentClip} title="Delete left of playhead (Q)" aria-label="Delete left of playhead">
            <Icon name="trimBefore" />
          </button>
          <button className="icon-btn" onClick={() => trimPlayhead('after')} disabled={!currentClip} title="Delete right of playhead (W)" aria-label="Delete right of playhead">
            <Icon name="trimAfter" />
          </button>
          <button className="icon-btn danger" onClick={removeSelected} disabled={!selection} title="Delete (Del)" aria-label="Delete">
            <Icon name="trash" />
          </button>
          <button className="icon-btn" onClick={duplicateSelected} disabled={!selectedClip && !selectedText && !selectedOverlay && !selectedEffect} title="Duplicate" aria-label="Duplicate">
            <Icon name="copy" />
          </button>
          <span className="divider" />
          <button className="icon-btn" onClick={() => void freezeFrame()} disabled={!currentClip} title="Freeze frame: insert a 3s still of this frame" aria-label="Freeze frame">
            <Icon name="freeze" />
          </button>
          <button
            className={`icon-btn ${targetClip?.mirror ? 'on' : ''}`}
            onClick={() => targetClip && updateClip({ mirror: !targetClip.mirror }, false, targetClip.id)}
            disabled={!targetClip}
            title="Mirror the clip"
            aria-label="Mirror"
          >
            <Icon name="mirror" />
          </button>
        </div>
        <div className="cc-tools end">
          <button className="icon-btn" onClick={() => setPps((v) => Math.max(10, Math.round(v / 1.4)))} title="Zoom out" aria-label="Zoom out timeline">
            <Icon name="minus" size={16} />
          </button>
          <input className="zoom-range" type="range" min={10} max={300} value={pps} onChange={(e) => setPps(Number(e.target.value))} aria-label="Timeline zoom" />
          <button className="icon-btn" onClick={() => setPps((v) => Math.min(300, Math.round(v * 1.4)))} title="Zoom in" aria-label="Zoom in timeline">
            <Icon name="plus" size={16} />
          </button>
          <button className="icon-btn" onClick={fitTimeline} disabled={duration <= 0} title="Fit the whole video" aria-label="Fit timeline">
            <Icon name="fit" />
          </button>
        </div>
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

      {exportDialog && (
        <div className="modal-backdrop" data-modal onPointerDown={(e) => e.target === e.currentTarget && setExportDialog(false)}>
          <div className="modal" role="dialog" aria-label="Export video">
            <h3>Export video</h3>
            <p className="hint">
              {project.width} × {project.height} · {formatTime(duration)}
            </p>
            <h4>Quality</h4>
            <div className="segmented">
              {EXPORT_QUALITIES.map((q) => (
                <button key={q.label} className={exportOpts.bitrate === q.bitrate ? 'active' : ''} onClick={() => setExportOpts((o) => ({ ...o, bitrate: q.bitrate }))}>
                  {q.label}
                </button>
              ))}
            </div>
            <h4>Frame rate</h4>
            <div className="segmented">
              {([30, 60] as const).map((fps) => (
                <button key={fps} className={exportOpts.fps === fps ? 'active' : ''} onClick={() => setExportOpts((o) => ({ ...o, fps }))}>
                  {fps} fps{fps === 60 ? ' (smoother)' : ''}
                </button>
              ))}
            </div>
            <p className="hint">About {estimateSizeMB(duration, exportOpts).toFixed(1)} MB. The video plays through once while it records.</p>
            <div className="row">
              <button onClick={() => setExportDialog(false)}>Cancel</button>
              <button className="primary" onClick={doExport}>Export</button>
            </div>
          </div>
        </div>
      )}

      {exportProgress !== null && (
        <div className="modal-backdrop" data-modal>
          <div className="modal">
            <h3>Exporting video…</h3>
            <p className="hint">The video plays through once while it is recorded. Keep this tab open.</p>
            <div className="progress">
              <div style={{ width: `${Math.round(exportProgress * 100)}%` }} />
            </div>
            <p>{Math.round(exportProgress * 100)}%</p>
          </div>
        </div>
      )}
    </div>
  );
}

type ClipTab = 'basic' | 'speed' | 'audio' | 'adjust';

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
  const [tab, setTab] = useState<ClipTab>('basic');
  const f = clip.filters;
  const maxFade = Math.min(3, clipDuration(clip) / 2);
  const tabs: { id: ClipTab; label: string }[] = [
    { id: 'basic', label: 'Video' },
    { id: 'speed', label: 'Speed' },
    ...(isVideo ? [{ id: 'audio' as const, label: 'Audio' }] : []),
    { id: 'adjust', label: 'Adjust' },
  ];
  const current = tabs.some((t) => t.id === tab) ? tab : 'basic';
  return (
    <>
      <div className="cc-subtabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={current === t.id} className={current === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <p className="hint">
        {assetName} · {clipDuration(clip).toFixed(2)}s
      </p>

      {current === 'basic' && (
        <>
          <div className="row">
            <button className={clip.mirror ? 'active' : ''} onClick={() => update({ mirror: !clip.mirror })}>
              <Icon name="mirror" size={16} /> Mirror
            </button>
          </div>
          <label className="field">
            <span>Motion</span>
            <select value={clip.motion ?? 'none'} onChange={(e) => update({ motion: e.target.value as Motion })}>
              {MOTIONS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </label>
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
        </>
      )}

      {current === 'speed' && (
        <>
          <div className="speed-grid">
            {SPEEDS.map((s) => (
              <button key={s} className={clip.speed === s ? 'active' : ''} onClick={() => update({ speed: s })}>
                {s}×
              </button>
            ))}
          </div>
          <label className="field">
            <span>Speed</span>
            <select value={clip.speed} onChange={(e) => update({ speed: Number(e.target.value) })} aria-label="Speed">
              {SPEEDS.map((s) => (
                <option key={s} value={s}>{s}×</option>
              ))}
            </select>
          </label>
          <p className="hint">Faster makes the clip shorter on the timeline; slower makes it longer.</p>
        </>
      )}

      {current === 'audio' && isVideo && (
        <>
          <RangeField label="Volume" value={clip.volume} min={0} max={2} step={0.05} onStart={mark} onChange={(v) => update({ volume: v }, true)} format={(v) => `${Math.round(v * 100)}%`} />
          <div className="row">
            <button className={clip.volume === 0 ? 'active' : ''} onClick={() => update({ volume: clip.volume === 0 ? 1 : 0 })}>
              <Icon name={clip.volume === 0 ? 'volumeOff' : 'volume'} size={16} /> {clip.volume === 0 ? 'Unmute clip' : 'Mute clip'}
            </button>
          </div>
        </>
      )}

      {current === 'adjust' && (
        <>
          <h4>Filters</h4>
          <div className="grid3">
            {FILTER_PRESETS.map((p) => (
              <button key={p.label} className={sameFilters(f, p.filters) ? 'active' : ''} onClick={() => update({ filters: p.filters })}>
                {p.label}
              </button>
            ))}
          </div>
          <h4>Adjust</h4>
          <FilterSliders filters={f} mark={mark} onChange={updateFilters} />
          <button className="block" onClick={() => update({ filters: NEUTRAL_FILTERS })}>Reset adjustments</button>
        </>
      )}
    </>
  );
}
