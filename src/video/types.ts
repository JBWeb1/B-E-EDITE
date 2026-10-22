import type { Filters } from '../lib/filters';
import type { Keyframes, Ramp } from './anim';
import type { FaceLook, FaceScan } from './faces';
import type { VectorPath } from './vectorPath';
import type { Matte, React } from './react';
import type { CornerPin } from './cornerPin';
import type { ColorGrade } from './grade';
import type { ChromaKey } from './keyer';

export type AssetKind = 'video' | 'image' | 'audio' | 'font';

export interface MediaAsset {
  id: string;
  kind: AssetKind;
  name: string;
  /** Object URL for the imported file (valid for this browser session). */
  url: string;
  /** Seconds. Images have no natural length; we use Infinity. */
  duration: number;
  width?: number;
  height?: number;
  thumbnail?: string;
  /** Loudness samples (0..1), PEAKS_PER_SECOND per second, for drawing waveforms. */
  peaks?: number[];
  /** Set when the file is one of the built-in sound effects (so it is added only once). */
  sfxId?: string;
  /** Font assets: the family name to use in text. */
  family?: string;
  /** Logo used as the export watermark (not shown in the media library). */
  logo?: boolean;
}

export type TransitionType = 'fade' | 'black' | 'slide' | 'zoom' | 'wipe';

export interface Transition {
  type: TransitionType;
  /** Seconds at the start of the clip. */
  duration: number;
}

export type ClipFilters = Filters;

export type BlendMode = 'normal' | 'screen' | 'multiply' | 'overlay' | 'lighten' | 'darken' | 'add' | 'difference' | 'soft-light' | 'color-dodge';

export type MaskShape = 'none' | 'rect' | 'ellipse' | 'heart' | 'star' | 'diamond';

export interface Mask {
  shape: MaskShape;
  /** Centre and size as fractions of the layer. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Soft edge, 0..0.5 of the layer's shorter side. */
  feather: number;
  /** Show everything except the shape. */
  invert: boolean;
  /** Overall size multiplier (animatable as `maskScale`). */
  scale?: number;
}

/** Cut away the edges of a picture, as fractions 0..0.45 of each side. */
export interface Crop {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Pro settings shared by main-track clips and layers on the upper video tracks. */
export interface LayerProps {
  /** Position, size, angle and see-through level (keyframes in `keys` animate them). */
  x?: number;
  y?: number;
  scale?: number;
  rotation?: number;
  opacity?: number;
  keys?: Keyframes;
  crop?: Crop | null;
  chroma?: ChromaKey | null;
  mask?: Mask | null;
  blend?: BlendMode;
  motionBlur?: boolean;
  wiggle?: { amount: number; speed: number } | null;
  grade?: ColorGrade | null;
  /** Play backwards. */
  reverse?: boolean;
  ramp?: Ramp;
  /** Custom speed curve (used when `ramp` is 'custom'): speed at evenly spaced moments. */
  curve?: number[];
  /** Audio noise reduction, 0 (off) to 3 (strong). */
  denoise?: number;
  /** Studio sound (clear, even voice) and the loudness boost measured for it, in dB. */
  studio?: boolean;
  boost?: number;
  /** Smart cut-out: AI masks that keep only the person (background removed). */
  cutout?: Cutout | null;
  /** Steadied camera: small moves that cancel the shake (see stabilize.ts). */
  stabilize?: Stabilize | null;
  /** Faces found in the clip, and what to do with them (blur, retouch, enhance). */
  faces?: FaceScan | null;
  faceLook?: FaceLook | null;
  /** Moves with the music (audio-reactive). */
  react?: React | null;
  /** Show this layer only through a text or shape item (track matte). */
  matte?: Matte | null;
  /** Screen replacement: drawn onto four (tracked) corners with perspective. */
  pin?: CornerPin | null;
}

/** Masks stored with the project (key `cutout-<id>` in the media store). */
export interface Cutout {
  id: string;
  /** Source second of the first mask. */
  from: number;
  /** Masks per second (ignored for photos, which have one mask). */
  fps: number;
  count: number;
  /** Mask size in pixels. */
  w: number;
  h: number;
  /** Stored gzipped. */
  gzip: boolean;
}

/** Per-frame corrections that steady a shaky clip. */
export interface Stabilize {
  /** Source second of the first sample, and samples per second. */
  from: number;
  rate: number;
  /** Shift (fractions of the frame) to apply at each sample. */
  dx: number[];
  dy: number[];
  /** Zoom that hides the moving edges. */
  zoom: number;
  /** 0..1: how much of the shake is removed. */
  strength: number;
}

/** A clip on the main (magnetic) track. Clips play back to back. */
export interface Clip extends LayerProps {
  id: string;
  assetId: string;
  /** Source in/out points in seconds. */
  in: number;
  out: number;
  speed: number;
  volume: number;
  fadeIn: number;
  fadeOut: number;
  filters: ClipFilters;
  /** Transition from the previous clip into this one. */
  transition?: Transition;
  /** Slow zoom/pan over the clip ("Ken Burns"), great for photos. */
  motion?: Motion;
  /** Flip the picture left-to-right. */
  mirror?: boolean;
}

export type Motion = 'none' | 'zoom-in' | 'zoom-out' | 'pan-left' | 'pan-right';

/** A photo or video layered on top of the main track (picture-in-picture), on video track 2 and up. */
export interface OverlayClip extends Omit<LayerProps, 'x' | 'y' | 'scale' | 'opacity'> {
  id: string;
  assetId: string;
  start: number;
  in: number;
  out: number;
  /** Center position, 0..1 of the frame. */
  x: number;
  y: number;
  /** Width as a fraction of the frame width. */
  scale: number;
  opacity: number;
  volume: number;
  /** Rounded corners as a fraction of the overlay's shorter side. */
  rounded: number;
  /** Video track number: 2 is just above the main track, higher numbers are drawn on top. */
  track?: number;
  filters?: Filters;
  /** Soft shadow behind the layer. */
  shadow?: boolean;
}

export interface TextOverlay {
  id: string;
  text: string;
  start: number;
  duration: number;
  /** Center position, 0..1 of the frame. */
  x: number;
  y: number;
  /** Fraction of frame height. */
  size: number;
  color: string;
  background: string | null;
  bold: boolean;
  animation: 'none' | 'fade' | 'pop' | 'slide';
  /** Outline around the letters. */
  stroke?: string | null;
  /** Coloured glow behind the letters ("neon"). */
  glow?: string | null;
  /** Font family (built-in or uploaded). */
  font?: string;
  italic?: boolean;
  /** Size multiplier and see-through level (animatable; `size` stays the text size). */
  scale?: number;
  opacity?: number;
  rotation?: number;
  keys?: Keyframes;
  wiggle?: { amount: number; speed: number } | null;
  motionBlur?: boolean;
  /** Letter-by-letter animation style. */
  animator?: TextAnimator;
  /** TikTok-style word-by-word captions. */
  words?: WordMode;
  /** Highlight colour for word captions and title templates. */
  accent?: string;
  /** Draw an animated title template instead of plain text. */
  template?: TitleTemplate;
  /** Draw a shape instead of text (graphics live on the text track too). */
  shape?: ShapeKind;
  /** Shape width / height. */
  aspect?: number;
  outline?: boolean;
  shapeAnim?: ShapeAnim;
  /** Pen-tool shape (when `shape` is 'path'): points in frame-height units around x, y. */
  path?: VectorPath;
  /** Fill colour of a closed path (null: line only). */
  fill?: string | null;
  /** Line thickness of a path, as a fraction of the frame height. */
  lineWidth?: number;
  /** Show only part of the line, 0..1 ("Trim Paths"; animate with trimStart / trimEnd keys). */
  trim?: { start: number; end: number };
  /** Run the text along this path instead of in straight lines. */
  textPath?: VectorPath;
  /** Moves with the music (audio-reactive). */
  react?: React | null;
}

export type TextAnimator = 'none' | 'typewriter' | 'wave' | 'bounce' | 'glitch' | 'fade-letters' | 'rise' | 'zoom' | 'flicker' | 'rainbow' | 'spin';
export type WordMode = 'off' | 'highlight' | 'single' | 'build';
export type TitleTemplate =
  | 'lower-third-bar'
  | 'lower-third-box'
  | 'lower-third-line'
  | 'subscribe'
  | 'countdown'
  | 'title-reveal'
  | 'breaking-news'
  | 'location'
  | 'quote'
  | 'social'
  | 'chapter';
export type ShapeKind = 'rect' | 'circle' | 'ring' | 'line' | 'arrow' | 'star' | 'heart' | 'burst' | 'check' | 'cross' | 'triangle' | 'path';
export type ShapeAnim = 'none' | 'draw' | 'pop' | 'spin' | 'pulse';

export type EffectType =
  | 'shake'
  | 'zoom-pulse'
  | 'flash'
  | 'vignette'
  | 'grain'
  | 'vhs'
  | 'glow'
  | 'letterbox'
  | 'blur'
  | 'chromatic'
  | 'glitch'
  | 'light-leak'
  | 'lens-flare'
  | 'confetti'
  | 'snow'
  | 'sparkles'
  | 'hearts'
  | 'dust'
  | 'bubbles'
  | 'light-rays'
  | 'turbulence'
  | 'echo'
  | 'fractal-noise'
  | 'adjustment';

/** A video effect applied to the whole frame for a stretch of time (its own track). */
export interface EffectItem {
  id: string;
  type: EffectType;
  start: number;
  duration: number;
  /** 0..1 strength. */
  intensity: number;
  /** How fast it moves (shake, particles), 1 = normal. */
  speed?: number;
  /** Adjustment layer: colour changes applied to everything under it (strength = intensity). */
  filters?: ClipFilters;
  grade?: ColorGrade;
}

/** Per-track switches from the timeline's track headers. */
export interface TrackState {
  mainMuted?: boolean;
  audioMuted?: boolean;
  textHidden?: boolean;
  overlayHidden?: boolean;
  effectsHidden?: boolean;
}

export interface AudioClip {
  id: string;
  assetId: string;
  start: number;
  in: number;
  out: number;
  volume: number;
  /** Seconds to fade the sound in at the start / out at the end. */
  fadeIn?: number;
  fadeOut?: number;
  /** Volume keyframes (`volume`, multiplies `volume`). */
  keys?: Keyframes;
  /** Noise reduction, 0 (off) to 3 (strong). */
  denoise?: number;
  /** Studio sound (clear, even voice) and its loudness boost in dB. */
  studio?: boolean;
  boost?: number;
  /** Beat times found in the song (seconds in the source file), and its tempo. */
  beats?: number[];
  bpm?: number;
}

export type WatermarkPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';

export interface Watermark {
  /** Text watermark (used when there is no logo). */
  text: string;
  /** Logo image asset. */
  assetId?: string;
  position: WatermarkPosition;
  /** 0..1. */
  opacity: number;
  /** Width (logo) or text height as a fraction of the frame. */
  size: number;
}

export interface VideoProject {
  name: string;
  width: number;
  height: number;
  background: string;
  /** How empty space around clips that don't match the frame shape is filled. */
  fill?: 'color' | 'blur';
  assets: MediaAsset[];
  clips: Clip[];
  texts: TextOverlay[];
  audio: AudioClip[];
  overlays: OverlayClip[];
  effects: EffectItem[];
  tracks?: TrackState;
  /** Shown in exports (and the preview) when set. */
  watermark?: Watermark | null;
  /** Versions saved by name (visual history), newest first. */
  versions?: SavedVersion[];
  /** What is said in the media (source times), for editing by transcript. */
  transcript?: TranscriptLine[];
  /** Markers the user dropped on the timeline (project seconds). */
  markers?: number[];
}

export interface TranscriptLine {
  id: string;
  assetId: string;
  /** Seconds in the source file. */
  start: number;
  end: number;
  text: string;
  words?: { start: number; end: number; text: string }[];
}

export interface SavedVersion {
  id: string;
  name: string;
  /** Time saved (ms since 1970). */
  at: number;
  project: Omit<VideoProject, 'versions'>;
}
