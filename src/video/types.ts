import type { Filters } from '../lib/filters';

export type AssetKind = 'video' | 'image' | 'audio';

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
}

export type TransitionType = 'fade' | 'black' | 'slide' | 'zoom' | 'wipe';

export interface Transition {
  type: TransitionType;
  /** Seconds at the start of the clip. */
  duration: number;
}

export type ClipFilters = Filters;

/** A clip on the main (magnetic) track. Clips play back to back. */
export interface Clip {
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

/** A photo or video layered on top of the main track (picture-in-picture). */
export interface OverlayClip {
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
}

export type EffectType = 'shake' | 'zoom-pulse' | 'flash' | 'vignette' | 'grain' | 'vhs' | 'glow' | 'letterbox';

/** A video effect applied to the whole frame for a stretch of time (its own track). */
export interface EffectItem {
  id: string;
  type: EffectType;
  start: number;
  duration: number;
  /** 0..1 strength. */
  intensity: number;
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
}
