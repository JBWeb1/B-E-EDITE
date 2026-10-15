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
}

export interface ClipFilters {
  brightness: number; // 1 = unchanged
  contrast: number;
  saturation: number;
  blur: number; // px
  grayscale: number; // 0..1
}

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
}

export interface AudioClip {
  id: string;
  assetId: string;
  start: number;
  in: number;
  out: number;
  volume: number;
}

export interface VideoProject {
  name: string;
  width: number;
  height: number;
  background: string;
  assets: MediaAsset[];
  clips: Clip[];
  texts: TextOverlay[];
  audio: AudioClip[];
}
