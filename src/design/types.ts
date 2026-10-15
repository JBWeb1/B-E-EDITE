import type { Filters } from '../lib/filters';

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
}

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

export type ShapeKind = 'rect' | 'ellipse' | 'triangle' | 'star' | 'line';

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
}

export type DesignElement = TextElement | ShapeElement | ImageElement;

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
