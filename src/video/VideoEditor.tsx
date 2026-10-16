import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { downloadBlob, formatTime } from '../lib/download';
import { cssFilter, sameFilters } from '../lib/filters';
import { useHistory } from '../lib/history';
import { uid } from '../lib/id';
import { putMedia, saveVideoProject } from '../lib/projects';
import { ColorField, NumberField, RangeField } from '../ui/fields';
import { FilterSliders } from '../ui/FilterSliders';
import { keyBelongsToField, ShortcutsDialog, shortcutsBlocked } from '../ui/Help';
import { Tour, tourSeen } from '../ui/Tour';
import type { TourStep } from '../ui/Tour';
import type { Shortcut } from '../ui/Help';
import { LookSettings } from '../ui/LookSettings';
import { lookAttributes, lookStyle, useLook } from '../lib/look';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/Icon';
import { Logo } from '../ui/Logo';
import { keyAt, setKey, sourceTimeAt, transformAt } from './anim';
import type { Keyframes } from './anim';
import { loadFont, probeMedia, VideoEngine } from './engine';
import { AIPanel } from './AIPanel';
import { TemplateGallery } from './TemplateGallery';
import { sceneFile, VIDEO_TEMPLATES } from './videoTemplates';
import type { VideoTemplate } from './videoTemplates';
import { ExportDialog } from './ExportDialog';
import { PreflightDialog, SafeZoneOverlay } from './PreflightDialog';
import { RecipesDialog } from './RecipesDialog';
import { PostKitDialog } from './PostKitDialog';
import { HistoryDialog } from './HistoryDialog';
import { ShareDialog } from './ShareDialog';
import { useLive } from './useLive';
import type { Peer } from '../lib/p2p';
import { restoreVersion, saveVersion } from './versions';
import type { DesignFile } from '../design/types';
import { applyRecipe } from './recipes';
import { overlap, SAFE_ZONES, textBox } from './preflight';
import type { FixId, Platform } from './preflight';
import { defaultPlatform } from './preflightRun';
import type { VideoExportChoice } from './ExportDialog';
import { extensionFor, mixSoundtrack } from './export';
import { LOOKS } from './grade';
import type { ColorGrade, LookId } from './grade';
import {
  AudioTools,
  BlendField,
  ColorSection,
  CropSection,
  GreenScreenSection,
  KeyframeTools,
  loadSavedLooks,
  MotionTrackSection,
  MaskSection,
  saveLooks,
  Section,
  SpeedRampSection,
  TransformFields,
} from './inspector';
import type { SavedLook } from './inspector';
import { DEFAULT_KEY } from './keyer';
import { clipFrame, cropRect, hitFrame, overlayFrame } from './layers';
import { grabGrayFrames } from './grab';
import { pathToKeys, trackSequence } from './tracker';
import { SFX_CATEGORIES, SOUND_EFFECTS, soundEffectFile } from './sfx';
import type { SoundEffect } from './sfx';
import { ANIMATORS, FONTS, SHAPE_ANIMS, SHAPES, TEMPLATES, textBounds, WORD_MODES } from './textfx';
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
  EFFECT_GROUPS,
  EFFECTS,
  FILTER_PRESETS,
  freeTrack,
  insertClipAt,
  isParticleEffect,
  layoutClips,
  locate,
  maxTransition,
  MOTIONS,
  NEUTRAL_FILTERS,
  normalizeProject,
  overlayTracks,
  parseSubtitles,
  projectDuration,
  scriptToCaptions,
  splitClips,
  splitTexts,
  textsAt,
  toSrt,
  trackOf,
  TRANSITIONS,
  trimAtPlayhead,
} from './timeline';
import type {
  AudioClip,
  Clip,
  ClipFilters,
  EffectItem,
  EffectType,
  LayerProps,
  MediaAsset,
  Motion,
  OverlayClip,
  ShapeAnim,
  ShapeKind,
  TextAnimator,
  TextOverlay,
  TitleTemplate,
  Transition,
  TransitionType,
  VideoProject,
  Watermark,
  WordMode,
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

/** Caption styles for "Create captions": classic boxes or TikTok-style word by word. */
const CAPTION_STYLES: { label: string; patch: Partial<TextOverlay> }[] = [
  { label: 'Classic box', patch: { y: 0.86, size: 0.055, bold: true, background: '#111827', animation: 'none', words: 'off' } },
  { label: 'TikTok highlight', patch: { y: 0.72, size: 0.075, bold: true, background: null, stroke: '#000000', color: '#ffffff', accent: '#facc15', animation: 'none', words: 'highlight', font: 'Impact, "Arial Black", sans-serif' } },
  { label: 'One word at a time', patch: { y: 0.62, size: 0.12, bold: true, background: null, stroke: '#000000', color: '#ffffff', accent: '#ffffff', animation: 'none', words: 'single', font: 'Impact, "Arial Black", sans-serif' } },
  { label: 'Build up', patch: { y: 0.75, size: 0.07, bold: true, background: null, stroke: '#000000', color: '#ffffff', accent: '#4ade80', animation: 'none', words: 'build' } },
];

const SHORTCUTS: Shortcut[] = [
  { keys: ['Space'], action: 'Play / pause' },
  { keys: ['Ctrl', 'B'], action: 'Split at the playhead (also S)' },
  { keys: ['Q'], action: 'Delete the part of the clip before the playhead' },
  { keys: ['W'], action: 'Delete the part of the clip after the playhead' },
  { keys: ['K'], action: 'Add / remove a position keyframe on the selected item' },
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

const TOUR: TourStep[] = [
  { title: 'Welcome to the video editor 🎬', body: 'A quick tour of the main parts — it takes 30 seconds. Replay it any time with the ? button at the top.' },
  { target: '.cc-tabs', title: 'Your library', body: 'Import videos, photos and music, and find text, titles, effects, transitions, filters and the AI tools here.' },
  { target: '.vtpl-grid', title: 'Start from a template', body: 'Not sure where to begin? Pick a ready-made video (vlog intro, product promo…) and change the words.' },
  { target: '.preview-frame', title: 'The player', body: 'Watch your video here. Click text or layers on the player to select them, and drag to move them.' },
  { target: '.timeline', title: 'The timeline', body: 'Clips play left to right. Drag to reorder, drag the edges to trim, press S to split. Text, layers, effects and sound get their own tracks.' },
  { target: '.cc-details', title: 'Details', body: 'Everything about the selected item: style, animation with keyframes (◆), colour, speed, green screen and motion tracking.' },
  { target: '.tour-export', title: 'Export', body: 'Save your video as MP4 or WebM in up to 4K, with one-click sizes for TikTok, YouTube and Instagram.' },
];

const DEFAULT_TRANSITION: Transition = { type: 'fade', duration: 0.5 };

type LibraryTab = 'media' | 'audio' | 'text' | 'titles' | 'effects' | 'transitions' | 'filters' | 'ai';
const LIBRARY_TABS: { id: LibraryTab; label: string; icon: IconName }[] = [
  { id: 'media', label: 'Media', icon: 'film' },
  { id: 'audio', label: 'Audio', icon: 'music' },
  { id: 'text', label: 'Text', icon: 'text' },
  { id: 'titles', label: 'Titles', icon: 'layers' },
  { id: 'effects', label: 'Effects', icon: 'sparkles' },
  { id: 'transitions', label: 'Transitions', icon: 'shuffle' },
  { id: 'filters', label: 'Filters', icon: 'droplet' },
  { id: 'ai', label: 'AI', icon: 'wand' },
];

/** Files the media library shows (fonts, watermark logos and built-in sounds live elsewhere). */
const isLibraryAsset = (a: MediaAsset) => !a.sfxId && !a.logo && a.kind !== 'font';


const clampLocal = (t: number, len: number) => Math.max(0, Math.min(len, t));

export function VideoEditor({
  onExit,
  aspect,
  initialProject,
  projectId,
  template,
  onOpenDesign,
  live,
}: {
  onExit: () => void;
  /** Joined someone's live editing session: stay in sync with them. */
  live?: Peer;
  /** Open a design (made by the post kit) in the design editor. */
  onOpenDesign?: (file: DesignFile, projectId: string) => void;
  aspect?: { width: number; height: number };
  initialProject?: VideoProject;
  /** Start from this ready-made video template (id from VIDEO_TEMPLATES). */
  template?: string;
  projectId: string;
}) {
  const history = useHistory<VideoProject>(() =>
    initialProject ? normalizeProject(initialProject) : createProject(aspect?.width, aspect?.height),
  );
  const { state: project, set, setTransient, mark } = history;
  /** Live session this editor started (Share → Edit together). */
  const [hostedPeer, setHostedPeer] = useState<Peer | null>(null);
  const liveSession = useLive(live ?? hostedPeer, project, (p) => set(p), !!hostedPeer && !live);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);
  const [pps, setPps] = useState(60);
  const [tab, setTab] = useState<LibraryTab>('media');
  const [importing, setImporting] = useState(0);
  const [progress, setProgress] = useState<{ label: string; value: number } | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [showLook, setShowLook] = useState(false);
  const look = useLook();
  const [panelOpen, setPanelOpen] = useState(() => !window.matchMedia?.('(max-width: 760px)').matches);
  const [exportDialog, setExportDialog] = useState(false);
  const [preflight, setPreflight] = useState(false);
  const [recipesOpen, setRecipesOpen] = useState(false);
  const [postKit, setPostKit] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [platform, setPlatform] = useState<Platform>(() => defaultPlatform(initialProject ?? { width: aspect?.width ?? 16, height: aspect?.height ?? 9 }));
  const [showZones, setShowZones] = useState(false);
  // Follow the video's shape: vertical videos default to TikTok, landscape to YouTube.
  useEffect(() => {
    const vertical = project.height > project.width;
    setPlatform((p) => (SAFE_ZONES.find((z) => z.id === p)!.vertical === vertical ? p : defaultPlatform(project)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.width, project.height]);
  const [recorder, setRecorder] = useState<MediaRecorder | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error' | null>(null);
  const [script, setScript] = useState('');
  const [captionStyle, setCaptionStyle] = useState(0);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [transitionPick, setTransitionPick] = useState<TransitionType>('fade');
  /** Waiting for a click on the player to pick a green-screen colour for this item. */
  const [picking, setPicking] = useState<{ kind: 'clip' | 'overlay'; id: string } | null>(null);
  const [myLooks, setMyLooks] = useState<SavedLook[]>(loadSavedLooks);
  const [showTour, setShowTour] = useState(false);
  // First visit: start the tour once the editor is on screen (it points at real parts of it).
  useEffect(() => {
    if (!tourSeen('bee.tour.video') && !tourSeen('bee.tips.video')) setShowTour(true);
  }, []);
  /** Waiting for a click on the player: the point this item should follow (motion tracking). */
  const [trackPick, setTrackPick] = useState<{ kind: 'text' | 'overlay'; id: string } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<VideoEngine | null>(null);
  const previewAudio = useRef<HTMLAudioElement | null>(null);
  const dragRef = useRef<{ id: string; kind: 'text' | 'overlay' | 'clip'; offX: number; offY: number; local: number } | null>(null);

  const duration = projectDuration(project);
  const placed = layoutClips(project.clips);
  const selectedClip = selection?.kind === 'clip' ? project.clips.find((c) => c.id === selection.id) : undefined;
  const selectedText = selection?.kind === 'text' ? project.texts.find((t) => t.id === selection.id) : undefined;
  const selectedAudio = selection?.kind === 'audio' ? project.audio.find((a) => a.id === selection.id) : undefined;
  const selectedOverlay = selection?.kind === 'overlay' ? project.overlays.find((o) => o.id === selection.id) : undefined;
  const selectedEffect = selection?.kind === 'effect' ? project.effects.find((o) => o.id === selection.id) : undefined;
  const currentClip = locate(project.clips, time);
  /** The clip edits apply to: the selected clip, or else the one under the playhead. */
  const targetClip = selectedClip ?? currentClip?.clip;
  const assetOf = (id: string) => project.assets.find((a) => a.id === id);
  const fonts = project.assets.filter((a) => a.kind === 'font' && a.family);

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

  // Uploaded fonts: load them once so text can use them (and redraw when ready).
  const loadedFonts = useRef(new Set<string>());
  useEffect(() => {
    for (const a of project.assets) {
      if (a.kind !== 'font' || !a.family || loadedFonts.current.has(a.id)) continue;
      loadedFonts.current.add(a.id);
      void loadFont(a.family, a.url)
        .then(() => engineRef.current?.draw())
        .catch(() => {});
    }
  }, [project.assets]);

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

  const uploadFont = async (file: File) => {
    const family = file.name.replace(/\.[^.]+$/, '').replace(/[^\w -]/g, '').trim() || 'My font';
    const id = uid('asset');
    const url = URL.createObjectURL(file);
    try {
      await loadFont(family, url);
    } catch {
      alert('That font file could not be read. Use a .ttf, .otf, .woff or .woff2 file.');
      return;
    }
    loadedFonts.current.add(id);
    await putMedia(id, file).catch(() => setSaveState('error'));
    const asset: MediaAsset = { id, kind: 'font', name: file.name, url, duration: 0, family };
    set((p) => ({ ...p, assets: [...p.assets, asset] }));
    if (selectedText) updateText({ font: `"${family}", Inter, sans-serif` });
  };

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

  // ---------- Pre-flight fixes ----------

  const applyFix = (fix: FixId, ids: string[]) => {
    const only = new Set(ids);
    const zone = SAFE_ZONES.find((z) => z.id === platform)!;
    switch (fix) {
      case 'add-hook-title': {
        const o = createTextOverlay(0, { text: 'WAIT FOR IT 👀', y: 0.3, size: 0.09, duration: 2.5, bold: true, stroke: '#000000', animator: 'rise', animation: 'none' });
        set((p) => ({ ...p, texts: [...p.texts, o] }));
        setSelection({ kind: 'text', id: o.id });
        break;
      }
      case 'trim-slow-start': {
        const cut = Number(ids[0]) || 0;
        set((p) => {
          const [first, ...rest] = p.clips;
          if (!first || clipDuration(first) <= cut + 0.5) return p;
          return { ...p, clips: [{ ...first, in: first.in + cut * first.speed }, ...rest] };
        });
        break;
      }
      case 'add-captions':
        setTab('ai');
        setPanelOpen(true);
        break;
      case 'slow-captions':
        set((p) => {
          const starts = [...p.texts].filter((t) => !t.shape && !t.template).map((t) => t.start).sort((a, b) => a - b);
          // Never past the end of the footage (that would make the video longer).
          const placedNow = layoutClips(p.clips);
          const footageEnd = Math.max(placedNow.length ? placedNow[placedNow.length - 1].end : 0, ...p.overlays.map((o) => o.start + o.out - o.in));
          return {
            ...p,
            texts: p.texts.map((t) => {
              if (!only.has(t.id)) return t;
              const next = Math.min(starts.find((s) => s > t.start + 0.01) ?? Infinity, footageEnd > t.start ? footageEnd : Infinity);
              const chars = t.text.replace(/\s+/g, ' ').trim().length;
              const duration = Math.max(t.duration, Math.min(chars / 17, next - t.start));
              // Still too fast: show it word by word, in time with the speech, instead.
              return chars / duration > 20 ? { ...t, duration, words: 'highlight' as const, accent: t.accent ?? '#facc15' } : { ...t, duration };
            }),
          };
        });
        break;
      case 'bigger-captions':
        set((p) => ({ ...p, texts: p.texts.map((t) => (only.has(t.id) ? { ...t, size: 0.045 / (t.scale ?? 1) } : t)) }));
        break;
      case 'caption-box':
        set((p) => ({ ...p, texts: p.texts.map((t) => (only.has(t.id) ? { ...t, stroke: '#000000' } : t)) }));
        break;
      case 'remove-flashes':
        set((p) => ({ ...p, effects: p.effects.filter((e) => !only.has(e.id)) }));
        break;
      case 'move-into-safe-zone':
        set((p) => ({
          ...p,
          texts: p.texts.map((t) => {
            if (!only.has(t.id)) return t;
            let { x, y } = t;
            // Nudge away from each covered area it overlaps, keeping it on screen.
            for (let pass = 0; pass < 3; pass++) {
              const box = textBox({ ...t, x, y }, p.width, p.height);
              const hit = zone.covered.find((c) => overlap(box, c) > 0.05);
              if (!hit) break;
              if (hit.w > 0.5) y = hit.y > 0.5 ? hit.y - box.h / 2 - 0.02 : hit.y + hit.h + box.h / 2 + 0.02;
              else x = hit.x - box.w / 2 - 0.02 + (t.template?.startsWith('lower-third') ? -box.w / 2 : 0);
            }
            return { ...t, x: Math.max(0.05, Math.min(0.95, x)), y: Math.max(0.08, Math.min(0.92, y)) };
          }),
        }));
        break;
    }
  };

  // ---------- Video templates ----------

  const applyTemplate = async (t: VideoTemplate) => {
    const busy = project.clips.length + project.texts.length + project.overlays.length > 0;
    if (busy && !confirm(`Start from the "${t.name}" template? It replaces what is on your timeline (Undo brings it back).`)) return;
    engineRef.current?.pause();
    setProgress({ label: 'Building template…', value: 0 });
    try {
      const added: MediaAsset[] = [];
      const clips: Clip[] = [];
      for (let i = 0; i < t.scenes.length; i++) {
        const scene = t.scenes[i];
        const asset = await addAssetFile(await sceneFile(t, i));
        added.push(asset);
        clips.push({
          ...createClip(asset),
          out: scene.duration,
          motion: scene.motion,
          transition: i > 0 && scene.transition ? { type: scene.transition, duration: 0.5 } : undefined,
        });
        setProgress({ label: 'Building template…', value: (i + 1) / (t.scenes.length + 1) });
      }
      const audio: AudioClip[] = [];
      for (const s of t.sounds) {
        const fx = SOUND_EFFECTS.find((f) => f.id === s.id);
        if (!fx) continue;
        let asset = [...project.assets, ...added].find((a) => a.sfxId === fx.id);
        if (!asset) {
          asset = await addAssetFile(soundEffectFile(fx), { sfxId: fx.id, name: fx.name });
          added.push(asset);
        }
        audio.push({ ...createAudioClip(asset, s.at), volume: 0.8 });
      }
      set((p) => ({
        ...p,
        name: p.name === 'Untitled video' ? t.name : p.name,
        width: t.width,
        height: t.height,
        fill: 'color',
        assets: [...p.assets, ...added],
        clips,
        overlays: [],
        texts: t.texts.map((x) => createTextOverlay(x.start, x.patch)),
        effects: t.effects.map((e) => createEffect(e.type, e.start, e)),
        audio,
      }));
      setSelection(null);
      seek(0);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not build the template');
    } finally {
      setProgress(null);
    }
  };

  const templateStarted = useRef(false);
  useEffect(() => {
    const t = VIDEO_TEMPLATES.find((x) => x.id === template);
    if (!t || templateStarted.current) return;
    templateStarted.current = true;
    void applyTemplate(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template]);

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
      const start = selectedOverlay.start + selectedOverlay.out - selectedOverlay.in;
      const copy = { ...selectedOverlay, id: uid('overlay'), start };
      set((p) => ({ ...p, overlays: [...p.overlays, { ...copy, track: freeTrack(p.overlays, start, start + copy.out - copy.in) }] }));
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
    const style = CAPTION_STYLES[captionStyle].patch;
    const items = captions.map((c) => createTextOverlay(c.start, { ...style, text: c.text, duration: c.end - c.start }));
    set((p) => ({ ...p, texts: [...p.texts, ...items] }));
  };

  const importCaptions = async (file: File) => {
    const captions = parseSubtitles(await file.text());
    if (captions.length === 0) alert('No captions found in that file. Use a .srt or .vtt subtitle file.');
    addCaptions(captions);
  };

  const exportCaptions = () => downloadBlob(new Blob([toSrt(project.texts.filter((t) => !t.shape && !t.template))], { type: 'text/plain' }), `${project.name || 'captions'}.srt`);

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
    const cuts = placed.slice(1);
    if (cuts.length === 0) return;
    const pick =
      selectedClip && project.clips.indexOf(selectedClip) > 0
        ? selectedClip
        : cuts.reduce((best, p) => (Math.abs(p.start - time) < Math.abs(best.start - time) ? p : best)).clip;
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

  const applyLookPreset = (lookId: LookId) =>
    targetClip && updateClip({ grade: { ...(targetClip.grade ?? { shadows: { hue: 0, amount: 0, luma: 0 }, midtones: { hue: 0, amount: 0, luma: 0 }, highlights: { hue: 0, amount: 0, luma: 0 }, lookAmount: 1, look: 'none' }), look: lookId } }, false, targetClip.id);

  const saveCurrentLook = () => {
    if (!targetClip) return;
    const name = prompt('Name this look', `My look ${myLooks.length + 1}`);
    if (!name) return;
    const next = [...myLooks.filter((l) => l.name !== name), { name, filters: targetClip.filters, grade: targetClip.grade ?? null }];
    setMyLooks(next);
    saveLooks(next);
  };

  const applySavedLook = (l: SavedLook, all = false) =>
    set((p) => ({
      ...p,
      clips: p.clips.map((c) => (all || c.id === targetClip?.id ? { ...c, filters: l.filters ?? c.filters, grade: l.grade ?? null } : c)),
    }));

  const deleteSavedLook = (name: string) => {
    const next = myLooks.filter((l) => l.name !== name);
    setMyLooks(next);
    saveLooks(next);
  };

  const addEffect = (type: EffectType) => {
    const fx = createEffect(type, now(), { duration: type === 'flash' ? 1 : isParticleEffect(type) ? 4 : 3 });
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

  /** Put a photo/video on the lowest video track (2+) that has room at the playhead. */
  const addAsLayer = (a: MediaAsset) => {
    const o = createOverlay(a, time);
    set((p) => ({ ...p, overlays: [...p.overlays, { ...o, track: freeTrack(p.overlays, o.start, o.start + o.out - o.in) }] }));
    setSelection({ kind: 'overlay', id: o.id });
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void frameRef.current?.requestFullscreen?.().catch(() => {});
  };

  // ---------- Local times & keyframes ----------

  const clipStart = (id: string) => placed.find((p) => p.clip.id === id)?.start ?? 0;
  const clipLocal = (c: Clip) => clampLocal(time - clipStart(c.id), clipDuration(c));
  const overlayLocal = (o: OverlayClip) => clampLocal(time - o.start, o.out - o.in);
  const textLocal = (o: TextOverlay) => clampLocal(time - o.start, o.duration);

  /** K: add or remove a position keyframe on the selected item at the playhead. */
  const togglePositionKey = () => {
    const item = selectedClip ?? selectedOverlay ?? selectedText;
    if (!item) return;
    const local = selectedClip ? clipLocal(selectedClip) : selectedOverlay ? overlayLocal(selectedOverlay) : textLocal(selectedText!);
    const tr = transformAt(item as LayerProps, local, 1, selectedOverlay ? { x: selectedOverlay.x, y: selectedOverlay.y, scale: selectedOverlay.scale, opacity: selectedOverlay.opacity } : {});
    const has = keyAt(item.keys?.x, local);
    const keys: Keyframes = { ...item.keys };
    if (has) {
      keys.x = item.keys?.x?.filter((k) => k !== has);
      keys.y = item.keys?.y?.filter((k) => Math.abs(k.t - local) > 1 / 60);
    } else {
      keys.x = setKey(item.keys?.x, local, tr.x);
      keys.y = setKey(item.keys?.y, local, tr.y);
    }
    if (selectedClip) updateClip({ keys });
    else if (selectedOverlay) updateOverlay({ keys });
    else updateText({ keys });
  };

  // Keyboard shortcuts: one window listener that always calls the latest handler.
  const keyHandler = useRef<(e: KeyboardEvent) => void>();
  {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && trackPick) {
        setTrackPick(null);
        return;
      }
      if (e.key === 'Escape' && picking) {
        setPicking(null);
        if (engineRef.current) engineRef.current.keyingOff = false;
        return;
      }
      // Off while typing, while a dialog/menu is open (Space during an export would pause
      // the recording), and while a voice-over is being recorded.
      if (keyBelongsToField(e) || shortcutsBlocked() || recorder) return;
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
      } else if (key === 'k' && !mod) {
        togglePositionKey();
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

  // ---------- Player: pick colours, select and drag things ----------

  const previewPoint = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
  };

  const startPick = (target: { kind: 'clip' | 'overlay'; id: string }) => {
    engineRef.current?.pause();
    setPicking(target);
  };

  /**
   * Motion tracking: follow the point (px, py) (fractions of the frame) through the main
   * clip from the playhead, and write position keyframes so the item moves with it.
   */
  const runTrack = async (target: { kind: 'text' | 'overlay'; id: string }, px: number, py: number) => {
    const W = project.width;
    const H = project.height;
    const t0 = time;
    const hit = locate(project.clips, t0);
    const asset = hit && assetOf(hit.clip.assetId);
    if (!hit || asset?.kind !== 'video' || !asset.width || !asset.height) {
      alert('Put the playhead over a video clip on the main track, then try again. Tracking follows things that move in that video.');
      return;
    }
    const text = target.kind === 'text' ? project.texts.find((t) => t.id === target.id) : undefined;
    const layer = target.kind === 'overlay' ? project.overlays.find((o) => o.id === target.id) : undefined;
    const item = text ?? layer;
    if (!item) return;
    const itemEnd = text ? text.start + text.duration : layer!.start + layer!.out - layer!.in;
    const t1 = Math.min(itemEnd, hit.end);
    if (t1 - t0 < 0.2) {
      alert('Move the playhead to where the movement starts (inside this item and the video clip).');
      return;
    }
    const clip = hit.clip;
    const len = clipDuration(clip);
    const frameAt = (t: number) => clipFrame(clip, asset, W, H, t - hit.start, (t - hit.start) / len);
    const src = cropRect(asset.width, asset.height, clip.crop);
    // Track in a small copy of the video: fast, and plenty for following an object.
    const gw = 240;
    const gh = Math.max(2, Math.round((gw * asset.height) / asset.width));
    const toSource = (x: number, y: number, t: number) => {
      const f = frameAt(t);
      let u = (x * W - (f.cx - f.w / 2)) / f.w;
      const v = (y * H - (f.cy - f.h / 2)) / f.h;
      if (clip.mirror) u = 1 - u;
      return { x: ((src.sx + u * src.sw) / asset.width!) * gw, y: ((src.sy + v * src.sh) / asset.height!) * gh };
    };
    const fromSource = (sx: number, sy: number, t: number) => {
      const f = frameAt(t);
      let u = ((sx / gw) * asset.width! - src.sx) / src.sw;
      const v = ((sy / gh) * asset.height! - src.sy) / src.sh;
      if (clip.mirror) u = 1 - u;
      return { x: (f.cx - f.w / 2 + u * f.w) / W, y: (f.cy - f.h / 2 + v * f.h) / H };
    };
    const times: number[] = [];
    for (let t = t0; t <= t1 + 1e-6; t += 1 / 15) times.push(t);
    engineRef.current?.pause();
    setProgress({ label: 'Tracking motion…', value: 0 });
    try {
      const frames = await grabGrayFrames(asset.url, times.map((t) => sourceTimeAt(clip, t - hit.start)), gw, gh, (v) => setProgress({ label: 'Tracking motion…', value: v * 0.95 }));
      const start = toSource(px, py, t0);
      const path = trackSequence(frames, start.x, start.y, { patch: 7, search: 12 });
      const points = path.map((q, i) => ({ t: times[i] - item.start, ...fromSource(q.x, q.y, times[i]) }));
      const now0 = text ? transformAt(text, t0 - text.start, 1, { x: text.x, y: text.y }) : overlayFrame(layer!, assetOf(layer!.assetId)!, W, H, t0 - layer!.start);
      const at = 'cx' in now0 ? { x: now0.cx / W, y: now0.cy / H } : { x: now0.x, y: now0.y };
      const keys = pathToKeys(points, { x: at.x - points[0].x, y: at.y - points[0].y });
      const next = { ...item.keys, x: keys.x, y: keys.y };
      if (text) updateItem('texts', text.id, { keys: next });
      else updateItem('overlays', layer!.id, { keys: next });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Tracking failed');
    } finally {
      setProgress(null);
    }
  };

  const onPreviewDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const p = previewPoint(e);
    const W = project.width;
    const H = project.height;
    if (trackPick) {
      const target = trackPick;
      setTrackPick(null);
      void runTrack(target, p.x, p.y);
      return;
    }
    if (picking) {
      const color = engineRef.current?.sampleColor(p.x, p.y) ?? DEFAULT_KEY.color;
      const fn = (x: LayerProps) => ({ ...x, chroma: { ...(x.chroma ?? DEFAULT_KEY), color } });
      if (picking.kind === 'clip') set((pr) => ({ ...pr, clips: pr.clips.map((c) => (c.id === picking.id ? (fn(c) as Clip) : c)) }));
      else set((pr) => ({ ...pr, overlays: pr.overlays.map((o) => (o.id === picking.id ? (fn(o) as OverlayClip) : o)) }));
      setPicking(null);
      return;
    }
    const ctx = e.currentTarget.getContext('2d')!;
    const px = p.x * W;
    const py = p.y * H;
    const textHit = [...(project.tracks?.textHidden ? [] : textsAt(project.texts, time))].reverse().find((o) => {
      const local = time - o.start;
      const tr = transformAt(o, local, 1, { x: o.x, y: o.y });
      const b = textBounds(ctx, o, W, H);
      const anchorLeft = o.template?.startsWith('lower-third');
      const cx = anchorLeft ? tr.x + (b.w * tr.scale) / 2 : tr.x;
      return hitFrame({ cx: cx * W, cy: tr.y * H, w: b.w * W * tr.scale, h: b.h * H * tr.scale, rotation: tr.rotation, opacity: 1 }, px, py, 12);
    });
    let hit: { kind: 'text' | 'overlay' | 'clip'; id: string; x: number; y: number; local: number } | null = null;
    if (textHit) {
      const local = time - textHit.start;
      const tr = transformAt(textHit, local, 1, { x: textHit.x, y: textHit.y });
      hit = { kind: 'text', id: textHit.id, x: tr.x, y: tr.y, local };
    } else {
      // Hidden tracks can't be clicked on the player.
      const visible = project.tracks?.overlayHidden ? [] : project.overlays;
      const layers = visible.filter((o) => time >= o.start && time < o.start + o.out - o.in).sort((a, b) => trackOf(b) - trackOf(a));
      const layer = layers.find((o) => {
        const asset = assetOf(o.assetId);
        return asset && hitFrame(overlayFrame(o, asset, W, H, time - o.start), px, py);
      });
      if (layer) {
        const f = overlayFrame(layer, assetOf(layer.assetId)!, W, H, time - layer.start);
        hit = { kind: 'overlay', id: layer.id, x: f.cx / W, y: f.cy / H, local: time - layer.start };
      } else if (currentClip && selection?.kind === 'clip' && selection.id === currentClip.clip.id) {
        // The main clip moves only once it is selected, so clicks don't nudge it by accident.
        const asset = assetOf(currentClip.clip.assetId);
        const local = time - currentClip.start;
        const f = asset && clipFrame(currentClip.clip, asset, W, H, local, local / clipDuration(currentClip.clip));
        if (f && hitFrame(f, px, py)) {
          const tr = transformAt(currentClip.clip, local);
          hit = { kind: 'clip', id: currentClip.clip.id, x: tr.x, y: tr.y, local };
        }
      }
    }
    if (!hit) return;
    setSelection({ kind: hit.kind, id: hit.id });
    dragRef.current = { id: hit.id, kind: hit.kind, offX: p.x - hit.x, offY: p.y - hit.y, local: hit.local };
    mark();
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPreviewMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const p = previewPoint(e);
    const x = p.x - d.offX;
    const y = p.y - d.offY;
    // Animated position: dragging sets a keyframe at the playhead instead of moving every frame.
    const move = <T extends { id: string; keys?: Keyframes; x?: number; y?: number }>(o: T): T => {
      if (o.id !== d.id) return o;
      if (o.keys?.x?.length || o.keys?.y?.length) {
        return { ...o, keys: { ...o.keys, x: setKey(o.keys?.x, d.local, x), y: setKey(o.keys?.y, d.local, y) } };
      }
      return { ...o, x, y };
    };
    setTransient((proj) =>
      d.kind === 'text' ? { ...proj, texts: proj.texts.map(move) } : d.kind === 'overlay' ? { ...proj, overlays: proj.overlays.map(move) } : { ...proj, clips: proj.clips.map(move) },
    );
  };

  // ---------- Export ----------

  const doExport = async (c: VideoExportChoice) => {
    const engine = engineRef.current;
    if (!engine || duration <= 0) return;
    setExportDialog(false);
    setSelection(null);
    setProgress({ label: 'Exporting video…', value: 0 });
    try {
      const blob = await engine.record((v) => setProgress({ label: 'Exporting video…', value: v }), c);
      downloadBlob(blob, `${project.name || 'video'}.${extensionFor(blob.type)}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setProgress(null);
    }
  };

  const saveFrame = async (type: 'image/png' | 'image/jpeg', width: number, height: number) => {
    const blob = await engineRef.current?.captureFrame(type, width, height);
    if (blob) downloadBlob(blob, `${project.name || 'frame'} ${formatTime(time).replace(/[:.]/g, '-')}.${type === 'image/png' ? 'png' : 'jpg'}`);
  };

  const saveAudio = async () => {
    setExportDialog(false);
    setProgress({ label: 'Saving audio…', value: 0 });
    try {
      const blob = await mixSoundtrack(project, (v) => setProgress({ label: 'Saving audio…', value: v }));
      downloadBlob(blob, `${project.name || 'audio'}.wav`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not save the audio');
    } finally {
      setProgress(null);
    }
  };

  const setWatermark = (w: Watermark | null, live = false) => (live ? setTransient : set)((p) => ({ ...p, watermark: w }));

  const uploadLogo = async (file: File) => {
    try {
      const asset = await addAssetFile(file, { logo: true });
      set((p) => ({
        ...p,
        assets: [...p.assets, asset],
        watermark: { ...(p.watermark ?? { text: '', position: 'bottom-right', opacity: 0.8, size: 0.16 }), assetId: asset.id },
      }));
    } catch {
      alert('That image could not be used as a logo.');
    }
  };

  /** Picture used for the filter previews: the clip under the playhead, else any visual. */
  const previewThumb = assetOf(targetClip?.assetId ?? '')?.thumbnail ?? project.assets.find((a) => a.thumbnail && isLibraryAsset(a))?.thumbnail;

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
        {project.assets.filter(isLibraryAsset).length === 0 && (
          <div className="library-empty">
            <Icon name="film" size={28} />
            <p>Drop videos, photos or music here, or click Import.</p>
          </div>
        )}
        <div className="asset-grid">
          {project.assets.filter(isLibraryAsset).map((a) => (
            <div key={a.id} className="card asset">
              {a.thumbnail ? <img src={a.thumbnail} alt="" /> : <div className="asset-icon">♪</div>}
              <span className="asset-dur">{a.kind === 'image' ? 'Photo' : formatTime(a.duration)}</span>
              <span className="asset-name" title={a.name}>{a.name}</span>
              <button className="asset-add" title="Add to the main track" onClick={() => addToTimeline(a)} aria-label="Add to timeline">
                <Icon name="plus" size={16} />
              </button>
              {a.kind !== 'audio' && (
                <button className="asset-add asset-overlay" title="Add on a video track above, at the playhead (picture-in-picture, green screen, layers)" onClick={() => addAsLayer(a)} aria-label="Add as picture-in-picture">
                  <Icon name="pip" size={15} />
                </button>
              )}
            </div>
          ))}
        </div>
        {project.assets.some(isLibraryAsset) && <p className="hint">＋ adds to the main track. ⧉ puts it on a video track above (layers, green screen, picture-in-picture).</p>}
        <h4>Video templates</h4>
        <p className="hint">Ready-made videos with titles, effects and sound. Swap in your own clips and words.</p>
        <TemplateGallery onPick={(t) => void applyTemplate(t)} compact />
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
        <h4>Animated text</h4>
        <div className="grid3 animator-grid">
          {ANIMATORS.filter((a) => a.value !== 'none').map((a) => (
            <button
              key={a.value}
              className={`animator-card anim-${a.value}`}
              aria-label={`Animated text: ${a.label}`}
              onClick={() => addText({ text: a.label.toUpperCase(), y: 0.5, size: 0.11, animation: 'none', animator: a.value, duration: 3 })}
            >
              {a.label}
            </button>
          ))}
        </div>
        <h4>Captions</h4>
        <label className="field">
          <span>Caption style</span>
          <select value={captionStyle} onChange={(e) => setCaptionStyle(Number(e.target.value))} aria-label="Caption style">
            {CAPTION_STYLES.map((s, i) => (
              <option key={s.label} value={i}>{s.label}</option>
            ))}
          </select>
        </label>
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
        <h4>Fonts</h4>
        <label className="button block">
          <Icon name="upload" /> Upload a font
          <input
            type="file"
            accept=".ttf,.otf,.woff,.woff2,font/*"
            hidden
            aria-label="Upload font"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void uploadFont(f);
            }}
          />
        </label>
        {fonts.length > 0 && (
          <div className="font-list">
            {fonts.map((f) => (
              <button key={f.id} style={{ fontFamily: `"${f.family}"` }} onClick={() => addText({ text: f.family ?? 'Text', font: `"${f.family}", Inter, sans-serif`, y: 0.5, size: 0.1 })}>
                {f.family}
              </button>
            ))}
          </div>
        )}
      </>
    ),
    titles: (
      <>
        <p className="hint">Animated titles: just type your words and pick colours. Added at the playhead.</p>
        <div className="template-grid">
          {TEMPLATES.map((t) => (
            <button
              key={t.value}
              className={`template-tile tpl-${t.value}`}
              aria-label={`Title: ${t.label}`}
              onClick={() => addText({ bold: true, color: '#ffffff', animation: 'none', accent: look.accent ?? undefined, ...t.patch, template: t.value })}
            >
              <span className="tpl-art" />
              <span>{t.label}</span>
            </button>
          ))}
        </div>
        <h4>Shapes</h4>
        <div className="shape-grid">
          {SHAPES.map((s) => (
            <button
              key={s.value}
              className={`shape-tile shp-${s.value}`}
              aria-label={`Shape: ${s.label}`}
              title={s.label}
              onClick={() => addText({ text: '', shape: s.value, size: s.value === 'line' || s.value === 'arrow' ? 0.08 : 0.2, color: '#ffffff', animation: 'none', shapeAnim: 'draw', duration: 3 })}
            >
              <ShapeIcon shape={s.value} />
            </button>
          ))}
        </div>
        <h4>Stickers</h4>
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
        {EFFECT_GROUPS.map((g) => (
          <div key={g}>
            <h4>{g}</h4>
            <div className="fx-grid">
              {EFFECTS.filter((fx) => fx.group === g).map((fx) => (
                <button key={fx.type} className="fx-card" onClick={() => addEffect(fx.type)} title={fx.hint}>
                  <span className={`fx-thumb fx-${fx.type}`} style={previewThumb ? { backgroundImage: `url(${previewThumb})` } : undefined} />
                  <span className="fx-label">{fx.label}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
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
        <h4>Cinematic looks</h4>
        <div className="grid3 looks-grid">
          {LOOKS.filter((l) => l.id !== 'none').map((l) => (
            <button key={l.id} className={targetClip?.grade?.look === l.id ? 'active' : ''} disabled={!targetClip} onClick={() => applyLookPreset(l.id)}>
              {l.label}
            </button>
          ))}
        </div>
        <h4>My looks</h4>
        {myLooks.length === 0 && <p className="hint">Make a clip look just right (filters, looks, colour wheels), then save it here to reuse with one click.</p>}
        <div className="my-looks">
          {myLooks.map((l) => (
            <div key={l.name} className="my-look">
              <button onClick={() => applySavedLook(l)} disabled={!targetClip} title="Apply to this clip">
                {l.name}
              </button>
              <button className="icon-btn" onClick={() => applySavedLook(l, true)} title="Apply to every clip" aria-label={`Apply ${l.name} to all clips`}>
                <Icon name="copy" size={14} />
              </button>
              <button className="icon-btn" onClick={() => deleteSavedLook(l.name)} title="Delete this look" aria-label={`Delete ${l.name}`}>
                <Icon name="trash" size={14} />
              </button>
            </div>
          ))}
        </div>
        <button className="block" disabled={!targetClip} onClick={saveCurrentLook}>
          Save this clip's look
        </button>
        <button className="block" disabled={!targetClip} onClick={() => targetClip && applyFilter(targetClip.filters, true)}>
          Apply this clip's filter to all clips
        </button>
      </>
    ),
    ai: (
      <AIPanel
        project={project}
        time={time}
        set={set}
        setProgress={setProgress}
        addCaptions={addCaptions}
        addAudioFile={async (file, at) => {
          const asset = await addAssetFile(file);
          set((p) => ({ ...p, assets: [...p.assets, asset], audio: [...p.audio, createAudioClip(asset, at)] }));
        }}
      />
    ),
  };

  const overlayAsset = selectedOverlay && assetOf(selectedOverlay.assetId);

  return (
    <div
      className={`editor video cc ${picking || trackPick ? 'picking' : ''}`}
      style={lookStyle(look)}
      {...lookAttributes(look)}
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
          <button className="icon-btn" onClick={() => setShowLook(true)} title="Editor look: themes and layout" aria-label="Editor look">
            <Icon name="palette" />
          </button>
          <button className="icon-btn" onClick={() => setShowTour(true)} title="Guided tour" aria-label="Guided tour">
            <Icon name="help" />
          </button>
          <button className="icon-btn" onClick={() => setShowHelp(true)} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">
            <Icon name="keyboard" />
          </button>
          {liveSession.state !== 'off' && (
            <span className={`live-badge ${liveSession.state}`} title={liveSession.state === 'live' ? 'Live editing: changes show on both screens' : 'The other device left'}>
              <span className="dot" /> {liveSession.state === 'live' ? (liveSession.receiving !== null ? `Live · ${Math.round(liveSession.receiving * 100)}%` : 'Live') : 'Live ended'}
            </span>
          )}
          <button onClick={() => setShareOpen(true)} title="Send from your phone, edit together live, or download the project file">
            <Icon name="upload" /> <span className="label">Share</span>
          </button>
          <button onClick={() => setPostKit(true)} disabled={duration <= 0 || progress !== null} title="Post kit: thumbnail, post, story, caption, hashtags and chapters">
            <Icon name="sparkles" /> <span className="label">Post kit</span>
          </button>
          <button onClick={() => setRecipesOpen(true)} title="Edit recipes: save how this video is edited and replay it on another">
            <Icon name="wand" /> <span className="label">Recipes</span>
          </button>
          <button className="tour-preflight" onClick={() => setPreflight(true)} disabled={duration <= 0 || progress !== null} title="Pre-flight check: hook score, safe zones and accessibility">
            <Icon name="check" /> <span className="label">Check</span>
          </button>
          <button className="primary tour-export" onClick={() => setExportDialog(true)} disabled={duration <= 0 || progress !== null}>
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
            {picking && <span className="pick-hint">Click the background colour to remove · Esc to cancel</span>}
            {trackPick && <span className="pick-hint">Click the thing to follow · Esc to cancel</span>}
          </div>
          <div className="preview-frame" ref={frameRef}>
            <canvas
              ref={canvasRef}
              className="preview"
              style={{ aspectRatio: `${project.width} / ${project.height}` }}
              onPointerDown={onPreviewDown}
              onPointerMove={onPreviewMove}
              onPointerUp={() => (dragRef.current = null)}
            />
            {project.clips.length === 0 && project.texts.length === 0 && project.overlays.length === 0 && <div className="preview-empty">Import a video or photo to get started</div>}
            {showZones && (
              <CanvasCover canvasRef={canvasRef}>
                <SafeZoneOverlay platform={platform} />
                <button className="safe-zone-close" onClick={() => setShowZones(false)} aria-label="Hide safe zones" title="Hide safe zones">
                  <Icon name="x" size={14} />
                </button>
              </CanvasCover>
            )}
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
                {!ASPECTS.some((a) => a.width === project.width && a.height === project.height) && (
                  <option value={`${project.width}x${project.height}`}>
                    {project.width}×{project.height}
                  </option>
                )}
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
                key={selectedClip.id}
                clip={selectedClip}
                asset={assetOf(selectedClip.assetId)}
                isFirst={project.clips[0]?.id === selectedClip.id}
                local={clipLocal(selectedClip)}
                picking={picking?.id === selectedClip.id}
                mark={mark}
                update={updateClip}
                updateFilters={updateFilters}
                applyTransitionToAll={applyTransitionToAll}
                onSeekLocal={(t) => seek(clipStart(selectedClip.id) + t)}
                onPick={() => (picking ? setPicking(null) : startPick({ kind: 'clip', id: selectedClip.id }))}
                onSaveLook={saveCurrentLook}
              />
            ) : selectedText ? (
              <TextInspector
                key={selectedText.id}
                text={selectedText}
                fonts={fonts}
                local={textLocal(selectedText)}
                mark={mark}
                update={updateText}
                onSeekLocal={(t) => seek(selectedText.start + t)}
                onUploadFont={(f) => void uploadFont(f)}
                trackWaiting={trackPick?.id === selectedText.id}
                onTrackStart={() => setTrackPick(trackPick ? null : { kind: 'text', id: selectedText.id })}
              />
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
                {['shake', 'glitch', 'light-leak', 'chromatic', ...EFFECTS.filter((e) => isParticleEffect(e.type)).map((e) => e.type)].includes(selectedEffect.type) && (
                  <RangeField label="Speed" value={selectedEffect.speed ?? 1} min={0.2} max={3} step={0.05} onStart={mark} onChange={(v) => updateEffect({ speed: v }, true)} format={(v) => `${v.toFixed(2)}×`} />
                )}
                <div className="grid2">
                  <NumberField label="Start (s)" value={selectedEffect.start} min={0} step={0.1} onChange={(v) => updateEffect({ start: v })} />
                  <NumberField label="Length (s)" value={selectedEffect.duration} min={0.2} step={0.1} onChange={(v) => updateEffect({ duration: v })} />
                </div>
              </>
            ) : selectedOverlay && overlayAsset ? (
              <OverlayInspector
                key={selectedOverlay.id}
                o={selectedOverlay}
                asset={overlayAsset}
                tracks={overlayTracks(project.overlays)}
                local={overlayLocal(selectedOverlay)}
                picking={picking?.id === selectedOverlay.id}
                mark={mark}
                update={updateOverlay}
                onSeekLocal={(t) => seek(selectedOverlay.start + t)}
                onPick={() => (picking ? setPicking(null) : startPick({ kind: 'overlay', id: selectedOverlay.id }))}
                onTrack={(track) => updateOverlay({ track: track === 'new' ? Math.max(1, ...overlayTracks(project.overlays)) + 1 : track })}
                trackWaiting={trackPick?.id === selectedOverlay.id}
                onTrackStart={() => setTrackPick(trackPick ? null : { kind: 'overlay', id: selectedOverlay.id })}
              />
            ) : selectedAudio ? (
              <>
                <h3>Audio</h3>
                <p className="hint">{assetOf(selectedAudio.assetId)?.name}</p>
                <AudioTools
                  volume={selectedAudio.volume}
                  keys={selectedAudio.keys}
                  local={clampLocal(time - selectedAudio.start, selectedAudio.out - selectedAudio.in)}
                  denoise={selectedAudio.denoise}
                  mark={mark}
                  onVolume={(v, live) => updateAudio({ volume: v }, live)}
                  onKeys={(keys, live) => updateAudio({ keys }, live)}
                  onDenoise={(v) => updateAudio({ denoise: v })}
                />
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
          <button className="icon-btn" onClick={() => setHistoryOpen(true)} title="History: see every step, compare versions side by side" aria-label="History">
            <Icon name="layers" />
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
          <button
            className={`icon-btn ${targetClip?.reverse ? 'on' : ''}`}
            onClick={() => targetClip && updateClip({ reverse: !targetClip.reverse }, false, targetClip.id)}
            disabled={!targetClip}
            title="Play the clip backwards"
            aria-label="Reverse"
          >
            <Icon name="undo" />
          </button>
          <button
            className="icon-btn"
            onClick={togglePositionKey}
            disabled={!selectedClip && !selectedOverlay && !selectedText}
            title="Add / remove a position keyframe at the playhead (K)"
            aria-label="Keyframe"
          >
            <Icon name="diamond" />
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

      {showLook && <LookSettings onClose={() => setShowLook(false)} />}

      {showHelp && <ShortcutsDialog shortcuts={SHORTCUTS} onClose={() => setShowHelp(false)} />}
      {showTour && <Tour steps={TOUR} storageKey="bee.tour.video" onClose={() => setShowTour(false)} />}

      {shareOpen && (
        <ShareDialog
          project={project}
          liveActive={liveSession.state === 'live'}
          onImport={(files) => void importFiles(files)}
          onLive={setHostedPeer}
          onClose={() => setShareOpen(false)}
        />
      )}
      {historyOpen && (
        <HistoryDialog
          steps={history.steps}
          time={time}
          onJump={history.jumpTo}
          onRestore={(v) => set((p) => restoreVersion(p, v))}
          onSaveVersion={(name) => set((p) => saveVersion(p, name))}
          onDeleteVersion={(id) => set((p) => ({ ...p, versions: p.versions?.filter((v) => v.id !== id) }))}
          onClose={() => setHistoryOpen(false)}
        />
      )}
      {postKit && <PostKitDialog project={project} onClose={() => setPostKit(false)} onOpenDesign={onOpenDesign} />}
      {recipesOpen && <RecipesDialog project={project} onClose={() => setRecipesOpen(false)} onApply={(r, assets) => set((p) => applyRecipe(p, r, assets))} />}
      {preflight && (
        <PreflightDialog
          project={project}
          platform={platform}
          onPlatform={setPlatform}
          showZones={showZones}
          onShowZones={setShowZones}
          onClose={() => setPreflight(false)}
          onSeek={(t) => {
            setPreflight(false);
            seek(t + 0.05);
          }}
          onFix={applyFix}
          onExport={() => (setPreflight(false), setExportDialog(true))}
        />
      )}
      {exportDialog && (
        <ExportDialog
          onPreflight={() => (setExportDialog(false), setPreflight(true))}
          project={project}
          duration={duration}
          onClose={() => setExportDialog(false)}
          onExport={(c) => void doExport(c)}
          onSaveFrame={(type, w, h) => void saveFrame(type, w, h)}
          onSaveAudio={() => void saveAudio()}
          onWatermark={setWatermark}
          onLogo={(f) => void uploadLogo(f)}
          onAspect={(width, height) => set((p) => ({ ...p, width, height }))}
        />
      )}

      {progress !== null && (
        <div className="modal-backdrop" data-modal>
          <div className="modal">
            <h3>{progress.label}</h3>
            <p className="hint">Keep this tab open until it finishes.</p>
            <div className="progress">
              <div style={{ width: `${Math.round(progress.value * 100)}%` }} />
            </div>
            <p>{Math.round(progress.value * 100)}%</p>
          </div>
        </div>
      )}
    </div>
  );
}

/** Small drawing of a shape for the Shapes grid. */
function ShapeIcon({ shape }: { shape: ShapeKind }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const solid = { fill: 'currentColor' };
  const shapes: Record<ShapeKind, ReactNode> = {
    rect: <rect x="3" y="7" width="18" height="11" rx="1.5" {...solid} />,
    circle: <circle cx="12" cy="12" r="8" {...solid} />,
    ring: <circle cx="12" cy="12" r="8" {...common} />,
    line: <path d="M3 12h18" {...common} />,
    arrow: <path d="M3 12h17M14 6l6 6-6 6" {...common} />,
    star: <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" {...solid} />,
    heart: <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" {...solid} />,
    burst: <path d="M12 2l1.8 4.2L18 4l-1.4 4.4L21 10l-4.2 1.8L18 16l-4.4-1.4L12 19l-1.8-4.4L6 16l1.4-4.2L3 10l4.4-1.6L6 4l4.2 2.2z" {...solid} />,
    check: <path d="M4 12l5 5L20 6" {...common} />,
    cross: <path d="M6 6l12 12M18 6L6 18" {...common} />,
    triangle: <path d="M12 4l9 16H3z" {...solid} />,
  };
  return (
    <svg viewBox="0 0 24 24" width={26} height={26} aria-hidden>
      {shapes[shape]}
    </svg>
  );
}

type ClipTab = 'basic' | 'animate' | 'cutout' | 'speed' | 'audio' | 'color';

function SubTabs<T extends string>({ tabs, current, onChange }: { tabs: { id: T; label: string }[]; current: T; onChange: (t: T) => void }) {
  return (
    <div className="cc-subtabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={current === t.id} className={current === t.id ? 'active' : ''} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

function ClipInspector({
  clip,
  asset,
  isFirst,
  local,
  picking,
  mark,
  update,
  updateFilters,
  applyTransitionToAll,
  onSeekLocal,
  onPick,
  onSaveLook,
}: {
  clip: Clip;
  asset: MediaAsset | undefined;
  isFirst: boolean;
  local: number;
  picking: boolean;
  mark: () => void;
  update: (patch: Partial<Clip>, live?: boolean) => void;
  updateFilters: (patch: Partial<ClipFilters>) => void;
  applyTransitionToAll: (t: Transition | undefined) => void;
  onSeekLocal: (t: number) => void;
  onPick: () => void;
  onSaveLook: () => void;
}) {
  const [tab, setTab] = useState<ClipTab>('basic');
  const isVideo = asset?.kind === 'video';
  const f = clip.filters;
  const maxFade = Math.min(3, clipDuration(clip) / 2);
  const tabs: { id: ClipTab; label: string }[] = [
    { id: 'basic', label: 'Video' },
    { id: 'animate', label: 'Animate' },
    { id: 'cutout', label: 'Cutout' },
    { id: 'speed', label: 'Speed' },
    ...(isVideo ? [{ id: 'audio' as const, label: 'Audio' }] : []),
    { id: 'color', label: 'Color' },
  ];
  const current = tabs.some((t) => t.id === tab) ? tab : 'basic';
  const base = { x: clip.x ?? 0.5, y: clip.y ?? 0.5, scale: clip.scale ?? 1, rotation: clip.rotation ?? 0, opacity: clip.opacity ?? 1 };
  return (
    <>
      <SubTabs tabs={tabs} current={current} onChange={setTab} />
      <p className="hint">
        {asset?.name} · {clipDuration(clip).toFixed(2)}s
      </p>

      {current === 'basic' && (
        <>
          <div className="row">
            <button className={clip.mirror ? 'active' : ''} onClick={() => update({ mirror: !clip.mirror })}>
              <Icon name="mirror" size={16} /> Mirror
            </button>
            <button className={clip.reverse ? 'active' : ''} onClick={() => update({ reverse: !clip.reverse })}>
              <Icon name="undo" size={16} /> Reverse
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

      {current === 'animate' && (
        <>
          <TransformFields item={clip} base={base} local={local} mark={mark} onBase={(patch, live) => update(patch, live)} update={update} />
          <KeyframeTools item={clip} local={local} length={clipDuration(clip)} base={base} mark={mark} onSeekLocal={onSeekLocal} update={update} />
        </>
      )}

      {current === 'cutout' && (
        <>
          <Section title="Crop" defaultOpen>
            <CropSection crop={clip.crop} size={{ w: asset?.width ?? 16, h: asset?.height ?? 9 }} mark={mark} update={update} />
          </Section>
          <Section title="Green screen" defaultOpen={!!clip.chroma}>
            <GreenScreenSection layer={clip} picking={picking} mark={mark} update={update} onPick={onPick} />
          </Section>
          <Section title="Mask" defaultOpen={!!clip.mask}>
            <MaskSection layer={clip} local={local} mark={mark} update={update} />
          </Section>
          <Section title="Blend mode">
            <BlendField value={clip.blend} onChange={(blend) => update({ blend })} />
          </Section>
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
          <SpeedRampSection ramp={clip.ramp} reverse={clip.reverse} update={(patch) => update(patch)} />
        </>
      )}

      {current === 'audio' && isVideo && (
        <>
          <AudioTools
            volume={clip.volume}
            keys={clip.keys}
            local={local}
            denoise={clip.denoise}
            mark={mark}
            onVolume={(v, live) => update({ volume: v }, live)}
            onKeys={(keys, live) => update({ keys }, live)}
            onDenoise={(v) => update({ denoise: v })}
          />
          <div className="row">
            <button className={clip.volume === 0 ? 'active' : ''} onClick={() => update({ volume: clip.volume === 0 ? 1 : 0 })}>
              <Icon name={clip.volume === 0 ? 'volumeOff' : 'volume'} size={16} /> {clip.volume === 0 ? 'Unmute clip' : 'Mute clip'}
            </button>
          </div>
        </>
      )}

      {current === 'color' && (
        <>
          <Section title="Filters" defaultOpen>
            <div className="grid3">
              {FILTER_PRESETS.map((p) => (
                <button key={p.label} className={sameFilters(f, p.filters) ? 'active' : ''} onClick={() => update({ filters: p.filters })}>
                  {p.label}
                </button>
              ))}
            </div>
            <FilterSliders filters={f} mark={mark} onChange={updateFilters} />
            <button className="block" onClick={() => update({ filters: NEUTRAL_FILTERS })}>Reset adjustments</button>
          </Section>
          <Section title="Colour grading" defaultOpen>
            <ColorSection grade={clip.grade} mark={mark} onChange={(grade: ColorGrade | null, live) => update({ grade }, live)} />
          </Section>
          <button className="block" onClick={onSaveLook}>
            Save as my look
          </button>
        </>
      )}
    </>
  );
}

type OverlayTab = 'layer' | 'animate' | 'cutout' | 'color' | 'audio';

function OverlayInspector({
  o,
  asset,
  tracks,
  local,
  picking,
  mark,
  update,
  onSeekLocal,
  onPick,
  onTrack,
  trackWaiting,
  onTrackStart,
}: {
  o: OverlayClip;
  asset: MediaAsset;
  tracks: number[];
  local: number;
  picking: boolean;
  mark: () => void;
  update: (patch: Partial<OverlayClip>, live?: boolean) => void;
  onSeekLocal: (t: number) => void;
  onPick: () => void;
  onTrack: (t: number | 'new') => void;
  trackWaiting: boolean;
  onTrackStart: () => void;
}) {
  const [tab, setTab] = useState<OverlayTab>('layer');
  const isVideo = asset.kind === 'video';
  const tabs: { id: OverlayTab; label: string }[] = [
    { id: 'layer', label: 'Layer' },
    { id: 'animate', label: 'Animate' },
    { id: 'cutout', label: 'Cutout' },
    { id: 'color', label: 'Color' },
    ...(isVideo ? [{ id: 'audio' as const, label: 'Audio' }] : []),
  ];
  const current = tabs.some((t) => t.id === tab) ? tab : 'layer';
  const base = { x: o.x, y: o.y, scale: o.scale, rotation: o.rotation ?? 0, opacity: o.opacity };
  const len = o.out - o.in;
  return (
    <>
      <SubTabs tabs={tabs} current={current} onChange={setTab} />
      <p className="hint">
        {asset.name} · track V{trackOf(o)} · drag it on the player to move it.
      </p>
      {current === 'layer' && (
        <>
          <label className="field">
            <span>Video track</span>
            <select value={trackOf(o)} onChange={(e) => onTrack(e.target.value === 'new' ? 'new' : Number(e.target.value))} aria-label="Video track">
              {tracks.map((t) => (
                <option key={t} value={t}>V{t}</option>
              ))}
              <option value="new">+ New track on top</option>
            </select>
          </label>
          <BlendField value={o.blend} onChange={(blend) => update({ blend })} />
          <RangeField label="Rounded corners" value={o.rounded} min={0} max={0.5} step={0.01} onStart={mark} onChange={(v) => update({ rounded: v }, true)} format={(v) => `${Math.round(v * 200)}%`} />
          <div className="row">
            <button className={o.shadow !== false ? 'active' : ''} onClick={() => update({ shadow: o.shadow === false })}>Shadow</button>
            <button className={o.reverse ? 'active' : ''} onClick={() => update({ reverse: !o.reverse })}>
              <Icon name="undo" size={15} /> Reverse
            </button>
          </div>
          <h4>Position</h4>
          <div className="grid3">
            <button onClick={() => update({ x: 0.25, y: 0.28 })}>↖ Top left</button>
            <button onClick={() => update({ x: 0.5, y: 0.5 })}>Center</button>
            <button onClick={() => update({ x: 0.75, y: 0.28 })}>↗ Top right</button>
            <button onClick={() => update({ x: 0.25, y: 0.72 })}>↙ Bottom left</button>
            <button onClick={() => update({ x: 0.5, y: 0.5, scale: 1, rounded: 0 })}>Full frame</button>
            <button onClick={() => update({ x: 0.75, y: 0.72 })}>↘ Bottom right</button>
          </div>
          <NumberField label="Start (s)" value={o.start} min={0} step={0.1} onChange={(v) => update({ start: v })} />
        </>
      )}
      {current === 'animate' && (
        <>
          <TransformFields item={o} base={base} local={local} mark={mark} onBase={(patch, live) => update(patch, live)} update={update} sizeRange={[0.05, 1.5]} />
          <KeyframeTools item={o} local={local} length={len} base={base} mark={mark} onSeekLocal={onSeekLocal} update={update} />
          <MotionTrackSection waiting={trackWaiting} tracked={(o.keys?.x?.length ?? 0) > 3} onStart={onTrackStart} onClear={() => update({ keys: { ...o.keys, x: undefined, y: undefined } })} />
        </>
      )}
      {current === 'cutout' && (
        <>
          <Section title="Green screen" defaultOpen>
            <GreenScreenSection layer={o} picking={picking} mark={mark} update={update} onPick={onPick} />
          </Section>
          <Section title="Mask" defaultOpen={!!o.mask}>
            <MaskSection layer={o} local={local} mark={mark} update={update} />
          </Section>
          <Section title="Crop">
            <CropSection crop={o.crop} size={{ w: asset.width ?? 16, h: asset.height ?? 9 }} mark={mark} update={update} />
          </Section>
        </>
      )}
      {current === 'color' && (
        <>
          <Section title="Filters" defaultOpen>
            <div className="grid3">
              {FILTER_PRESETS.map((p) => (
                <button key={p.label} className={sameFilters(o.filters, p.filters) ? 'active' : ''} onClick={() => update({ filters: p.filters })}>
                  {p.label}
                </button>
              ))}
            </div>
            <FilterSliders filters={o.filters ?? NEUTRAL_FILTERS} mark={mark} onChange={(patch) => update({ filters: { ...(o.filters ?? NEUTRAL_FILTERS), ...patch } }, true)} />
          </Section>
          <Section title="Colour grading" defaultOpen>
            <ColorSection grade={o.grade} mark={mark} onChange={(grade, live) => update({ grade }, live)} />
          </Section>
        </>
      )}
      {current === 'audio' && isVideo && (
        <AudioTools
          volume={o.volume}
          keys={o.keys}
          local={local}
          denoise={o.denoise}
          mark={mark}
          onVolume={(v, live) => update({ volume: v }, live)}
          onKeys={(keys, live) => update({ keys }, live)}
          onDenoise={(v) => update({ denoise: v })}
        />
      )}
    </>
  );
}

type TextTab = 'text' | 'style' | 'animate';

function TextInspector({
  text,
  fonts,
  local,
  mark,
  update,
  onSeekLocal,
  onUploadFont,
  trackWaiting,
  onTrackStart,
}: {
  text: TextOverlay;
  fonts: MediaAsset[];
  local: number;
  mark: () => void;
  update: (patch: Partial<TextOverlay>, live?: boolean) => void;
  onSeekLocal: (t: number) => void;
  onUploadFont: (f: File) => void;
  trackWaiting: boolean;
  onTrackStart: () => void;
}) {
  const [tab, setTab] = useState<TextTab>('text');
  const isShape = !!text.shape;
  const tabs: { id: TextTab; label: string }[] = [
    { id: 'text', label: isShape ? 'Shape' : text.template ? 'Title' : 'Text' },
    { id: 'style', label: 'Style' },
    { id: 'animate', label: 'Animate' },
  ];
  const base = { x: text.x, y: text.y, scale: 1, rotation: text.rotation ?? 0, opacity: 1 };
  const fontOptions = [...FONTS, ...fonts.map((f) => ({ family: `"${f.family}", Inter, sans-serif`, label: `${f.family} (yours)` }))];
  return (
    <>
      <SubTabs tabs={tabs} current={tab} onChange={setTab} />
      {tab === 'text' && (
        <>
          {!isShape && (
            <label className="field">
              <span>{text.template ? 'Words (new line = second line)' : 'Content'}</span>
              <textarea rows={3} value={text.text} onFocus={mark} onChange={(e) => update({ text: e.target.value }, true)} aria-label="Text content" />
            </label>
          )}
          {text.template && (
            <label className="field">
              <span>Title template</span>
              <select value={text.template} onChange={(e) => update({ template: e.target.value as TitleTemplate })} aria-label="Title template">
                {TEMPLATES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </label>
          )}
          {isShape && (
            <>
              <label className="field">
                <span>Shape</span>
                <select value={text.shape} onChange={(e) => update({ shape: e.target.value as ShapeKind, aspect: undefined })} aria-label="Shape">
                  {SHAPES.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Animation</span>
                <select value={text.shapeAnim ?? 'draw'} onChange={(e) => update({ shapeAnim: e.target.value as ShapeAnim })} aria-label="Shape animation">
                  {SHAPE_ANIMS.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </label>
              <RangeField
                label="Width"
                value={text.aspect ?? SHAPES.find((s) => s.value === text.shape)?.aspect ?? 1}
                min={0.2}
                max={10}
                step={0.05}
                onStart={mark}
                onChange={(v) => update({ aspect: v }, true)}
                format={(v) => `${v.toFixed(1)}×`}
              />
              <button className={text.outline ? 'active block' : 'block'} onClick={() => update({ outline: !text.outline })}>
                Outline only
              </button>
            </>
          )}
          {!isShape && !text.template && (
            <>
              <label className="field">
                <span>Letter animation</span>
                <select value={text.animator ?? 'none'} onChange={(e) => update({ animator: e.target.value as TextAnimator })} aria-label="Letter animation">
                  {ANIMATORS.map((a) => (
                    <option key={a.value} value={a.value}>{a.label}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Word by word (TikTok captions)</span>
                <select value={text.words ?? 'off'} onChange={(e) => update({ words: e.target.value as WordMode })} aria-label="Word by word">
                  {WORD_MODES.map((w) => (
                    <option key={w.value} value={w.value}>{w.label} — {w.hint}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Entrance</span>
                <select value={text.animation} onChange={(e) => update({ animation: e.target.value as TextOverlay['animation'] })} aria-label="Entrance">
                  <option value="none">None</option>
                  <option value="fade">Fade</option>
                  <option value="pop">Pop</option>
                  <option value="slide">Slide up</option>
                </select>
              </label>
            </>
          )}
          <div className="grid2">
            <NumberField label="Start (s)" value={text.start} min={0} step={0.1} onChange={(v) => update({ start: v })} />
            <NumberField label="Length (s)" value={text.duration} min={0.2} step={0.1} onChange={(v) => update({ duration: v })} />
          </div>
        </>
      )}
      {tab === 'style' && (
        <>
          <RangeField label="Size" value={text.size} min={0.02} max={0.5} step={0.005} onStart={mark} onChange={(v) => update({ size: v }, true)} format={(v) => `${Math.round(v * 100)}%`} />
          <ColorField label={isShape ? 'Colour' : 'Text colour'} value={text.color} onStart={mark} onChange={(v) => update({ color: v }, true)} />
          {(text.template || (text.words && text.words !== 'off')) && (
            <ColorField label="Accent colour" value={text.accent ?? (text.template ? '#00c8d2' : '#facc15')} onStart={mark} onChange={(v) => update({ accent: v }, true)} />
          )}
          {!isShape && (
            <>
              <label className="field">
                <span>Font</span>
                <select value={text.font ?? FONTS[0].family} onChange={(e) => update({ font: e.target.value })} aria-label="Font">
                  {fontOptions.map((f) => (
                    <option key={f.family} value={f.family}>{f.label}</option>
                  ))}
                </select>
              </label>
              <label className="button block">
                <Icon name="upload" size={15} /> Upload a font
                <input
                  type="file"
                  accept=".ttf,.otf,.woff,.woff2,font/*"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) onUploadFont(f);
                  }}
                />
              </label>
              <div className="row">
                <button className={text.bold ? 'active' : ''} onClick={() => update({ bold: !text.bold })}><b>B</b></button>
                <button className={text.italic ? 'active' : ''} onClick={() => update({ italic: !text.italic })}><i>I</i></button>
                <button className={text.background ? 'active' : ''} onClick={() => update({ background: text.background ? null : '#111827' })}>Box</button>
                <button className={text.stroke ? 'active' : ''} onClick={() => update({ stroke: text.stroke ? null : '#111111' })}>Outline</button>
              </div>
            </>
          )}
          <div className="row">
            <button className={text.glow ? 'active' : ''} onClick={() => update({ glow: text.glow ? null : '#22d3ee' })}>Neon glow</button>
            {isShape && (
              <button className={text.stroke ? 'active' : ''} onClick={() => update({ stroke: text.stroke ? null : '#111111' })}>Border</button>
            )}
          </div>
          {text.background && text.background.startsWith('#') && <ColorField label="Box colour" value={text.background} onStart={mark} onChange={(v) => update({ background: v }, true)} />}
          {text.stroke && <ColorField label="Outline colour" value={text.stroke} onStart={mark} onChange={(v) => update({ stroke: v }, true)} />}
          {text.glow && <ColorField label="Neon colour" value={text.glow} onStart={mark} onChange={(v) => update({ glow: v }, true)} />}
          <h4>Position</h4>
          <div className="row">
            <button onClick={() => update({ x: 0.5, y: 0.15 })}>Top</button>
            <button onClick={() => update({ x: 0.5, y: 0.5 })}>Center</button>
            <button onClick={() => update({ x: 0.5, y: 0.85 })}>Bottom</button>
          </div>
        </>
      )}
      {tab === 'animate' && (
        <>
          <TransformFields item={text} base={base} local={local} mark={mark} onBase={(patch, live) => update(patch, live)} update={update} sizeLabel="Scale" sizeRange={[0, 4]} />
          <KeyframeTools item={text} local={local} length={text.duration} base={base} mark={mark} onSeekLocal={onSeekLocal} update={update} />
          <MotionTrackSection waiting={trackWaiting} tracked={(text.keys?.x?.length ?? 0) > 3} onStart={onTrackStart} onClear={() => update({ keys: { ...text.keys, x: undefined, y: undefined } })} />
        </>
      )}
    </>
  );
}

/** A box laid exactly over the player canvas (for overlays such as safe zones). */
function CanvasCover({ canvasRef, children }: { canvasRef: React.RefObject<HTMLCanvasElement>; children: ReactNode }) {
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const measure = () => setBox({ left: c.offsetLeft, top: c.offsetTop, width: c.offsetWidth, height: c.offsetHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(c);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [canvasRef]);
  if (!box) return null;
  return (
    <div className="canvas-cover" style={box}>
      {children}
    </div>
  );
}
