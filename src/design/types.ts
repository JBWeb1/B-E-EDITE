import type { Filters } from '../lib/filters';
import type { Keyframes } from '../video/anim';
import type { PhotoAdjust } from './photo';

export interface ElementBase {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Degrees, clockwise. */
  rotation: number;
  opacity: number;
  locked?: boolean;
  /** How the element enters when the page is presented or exported as a video. */
  animation?: ElementAnimation;
  /** Keyframes (seconds from when the page appears), as for video layers. */
  keys?: Keyframes;
  /** Gentle hand-held wobble while the page plays. */
  wiggle?: { amount: number; speed: number } | null;
}

export type ElementAnimation = 'none' | 'fade' | 'rise' | 'pop' | 'slide' | 'wipe';

export interface TextElement extends ElementBase {
  type: 'text';
  text: string;
  fontSize: number;
  fontFamily: string;
  fontWeight: 'normal' | 'bold';
  italic: boolean;
  color: string;
  align: 'left' | 'center' | 'right';
  lineHeight: number;
  /** Extra px between letters. */
  letterSpacing?: number;
  shadow?: boolean;
  outlineWidth?: number;
  outlineColor?: string;
}

export type ShapeKind = 'rect' | 'ellipse' | 'triangle' | 'star' | 'line' | 'heart' | 'arrow' | 'bubble' | 'hexagon' | 'diamond';

export interface ShapeElement extends ElementBase {
  type: 'shape';
  shape: ShapeKind;
  fill: string;
  stroke: string;
  strokeWidth: number;
  radius: number;
}

export interface ImageElement extends ElementBase {
  type: 'image';
  /** Data URL so projects stay self-contained when saved. */
  src: string;
  radius: number;
  flipX?: boolean;
  flipY?: boolean;
  filters?: Filters;
  /** Exposure, white balance, highlights/shadows, sharpen, vignette. */
  photo?: PhotoAdjust;
  /** Size of the original picture, used for cropping. */
  naturalWidth?: number;
  naturalHeight?: number;
  crop?: Crop;
  /** The photo before its background was removed, so it can be restored. */
  originalSrc?: string;
}

/** Which part of a picture is shown. */
export interface Crop {
  /** Width / height of the visible area, or null to keep the picture's own shape. */
  aspect: number | null;
  /** 1 = as large as possible; 2 = half the width and height; … */
  zoom: number;
  /** Center of the visible area, 0..1 across the picture. */
  cx: number;
  cy: number;
}

export type DesignElement = TextElement | ShapeElement | ImageElement;

/**
 * One page, seen as a stand-alone design. The editor and renderer work on this
 * shape; a multi-page DesignFile is stored and edited one page view at a time.
 */
export interface DesignDoc {
  name: string;
  width: number;
  height: number;
  background: string;
  /** When set, drawn instead of the flat background color. */
  gradient?: Gradient | null;
  /** Bottom-most first. */
  elements: DesignElement[];
}

export interface Gradient {
  from: string;
  to: string;
  /** Degrees; 0 = left to right, 90 = top to bottom. */
  angle: number;
}

export interface DesignPage {
  id: string;
  background: string;
  gradient?: Gradient | null;
  elements: DesignElement[];
  /** Seconds the page shows for in present mode and video export. */
  duration?: number;
}

/** A whole design: shared name and size, plus one or more pages. */
export interface DesignFile {
  name: string;
  width: number;
  height: number;
  pages: DesignPage[];
}
