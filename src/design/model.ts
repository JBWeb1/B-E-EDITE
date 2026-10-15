import { uid } from '../lib/id';
import type { DesignDoc, DesignElement, ImageElement, ShapeElement, ShapeKind, TextElement } from './types';

export interface Point {
  x: number;
  y: number;
}

export const FONTS = [
  'Inter, system-ui, sans-serif',
  'Georgia, serif',
  '"Courier New", monospace',
  'Impact, sans-serif',
  '"Trebuchet MS", sans-serif',
  '"Brush Script MT", cursive',
];

export function createDoc(width: number, height: number, name = 'Untitled design'): DesignDoc {
  return { name, width, height, background: '#ffffff', elements: [] };
}

export function createText(doc: DesignDoc, preset: Partial<TextElement> = {}): TextElement {
  const fontSize = preset.fontSize ?? Math.round(doc.width / 18);
  const width = Math.round(doc.width * 0.6);
  return {
    id: uid('text'),
    type: 'text',
    name: 'Text',
    text: 'Add your text',
    fontSize,
    fontFamily: FONTS[0],
    fontWeight: 'normal',
    italic: false,
    color: '#1f2937',
    align: 'center',
    lineHeight: 1.2,
    x: Math.round((doc.width - width) / 2),
    y: Math.round(doc.height / 2 - fontSize),
    width,
    height: Math.round(fontSize * 1.2),
    rotation: 0,
    opacity: 1,
    ...preset,
  };
}

export function createShape(doc: DesignDoc, shape: ShapeKind): ShapeElement {
  const size = Math.round(Math.min(doc.width, doc.height) / 4);
  const isLine = shape === 'line';
  return {
    id: uid('shape'),
    type: 'shape',
    name: shape[0].toUpperCase() + shape.slice(1),
    shape,
    fill: '#7c3aed',
    stroke: isLine ? '#1f2937' : '#000000',
    strokeWidth: isLine ? Math.max(4, Math.round(size / 25)) : 0,
    radius: 0,
    x: Math.round((doc.width - size) / 2),
    y: Math.round((doc.height - (isLine ? 0 : size)) / 2),
    width: size,
    height: isLine ? 0 : size,
    rotation: 0,
    opacity: 1,
  };
}

/** Fit an image of natural size (w, h) inside the doc at up to 60% of its size. */
export function createImage(doc: DesignDoc, src: string, w: number, h: number): ImageElement {
  const scale = Math.min((doc.width * 0.6) / w, (doc.height * 0.6) / h, 1);
  const width = Math.round(w * scale);
  const height = Math.round(h * scale);
  return {
    id: uid('image'),
    type: 'image',
    name: 'Image',
    src,
    radius: 0,
    x: Math.round((doc.width - width) / 2),
    y: Math.round((doc.height - height) / 2),
    width,
    height,
    rotation: 0,
    opacity: 1,
  };
}

export function addElement(doc: DesignDoc, el: DesignElement): DesignDoc {
  return { ...doc, elements: [...doc.elements, el] };
}

export function updateElement(doc: DesignDoc, id: string, patch: Partial<DesignElement>): DesignDoc {
  return {
    ...doc,
    elements: doc.elements.map((e) => (e.id === id ? ({ ...e, ...patch } as DesignElement) : e)),
  };
}

export function removeElement(doc: DesignDoc, id: string): DesignDoc {
  return { ...doc, elements: doc.elements.filter((e) => e.id !== id) };
}

export function duplicateElement(doc: DesignDoc, id: string, offset = 20): { doc: DesignDoc; id: string | null } {
  const index = doc.elements.findIndex((e) => e.id === id);
  if (index < 0) return { doc, id: null };
  const src = doc.elements[index];
  const copy = { ...src, id: uid(src.type), x: src.x + offset, y: src.y + offset, locked: false };
  const elements = [...doc.elements];
  elements.splice(index + 1, 0, copy);
  return { doc: { ...doc, elements }, id: copy.id };
}

export type LayerMove = 'up' | 'down' | 'top' | 'bottom';

export function moveLayer(doc: DesignDoc, id: string, move: LayerMove): DesignDoc {
  const index = doc.elements.findIndex((e) => e.id === id);
  if (index < 0) return doc;
  const elements = [...doc.elements];
  const [el] = elements.splice(index, 1);
  const last = elements.length;
  const target =
    move === 'up' ? Math.min(index + 1, last)
    : move === 'down' ? Math.max(index - 1, 0)
    : move === 'top' ? last
    : 0;
  elements.splice(target, 0, el);
  return { ...doc, elements };
}

export function center(el: Pick<DesignElement, 'x' | 'y' | 'width' | 'height'>): Point {
  return { x: el.x + el.width / 2, y: el.y + el.height / 2 };
}

export function rotatePoint(p: Point, origin: Point, degrees: number): Point {
  const r = (degrees * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const dx = p.x - origin.x;
  const dy = p.y - origin.y;
  return { x: origin.x + dx * cos - dy * sin, y: origin.y + dx * sin + dy * cos };
}

/** Is the point inside the element's (rotated) box? `pad` grows the box, useful for thin lines. */
export function hitTest(el: DesignElement, p: Point, pad = 0): boolean {
  const local = rotatePoint(p, center(el), -el.rotation);
  const extraY = el.height < 2 * pad ? pad : 0;
  return (
    local.x >= el.x - pad &&
    local.x <= el.x + el.width + pad &&
    local.y >= el.y - extraY &&
    local.y <= el.y + el.height + extraY
  );
}

/** Topmost element under the point, or null. */
export function elementAt(doc: DesignDoc, p: Point, pad = 6): DesignElement | null {
  for (let i = doc.elements.length - 1; i >= 0; i--) {
    if (hitTest(doc.elements[i], p, pad)) return doc.elements[i];
  }
  return null;
}

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export const HANDLE_SIGNS: Record<Handle, [number, number]> = {
  nw: [-1, -1], n: [0, -1], ne: [1, -1], e: [1, 0],
  se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0],
};

/** World position of a resize handle on an element. */
export function handlePosition(el: DesignElement, handle: Handle): Point {
  const [sx, sy] = HANDLE_SIGNS[handle];
  const c = center(el);
  return rotatePoint({ x: c.x + (sx * el.width) / 2, y: c.y + (sy * el.height) / 2 }, c, el.rotation);
}

export function rotationHandlePosition(el: DesignElement, distance: number): Point {
  const c = center(el);
  return rotatePoint({ x: c.x, y: el.y - distance }, c, el.rotation);
}

type Box = Pick<DesignElement, 'x' | 'y' | 'width' | 'height' | 'rotation'>;

/**
 * Resize a (possibly rotated) box by dragging a handle by `delta` (world coords).
 * The opposite edge/corner stays fixed. `keepRatio` locks aspect ratio on corners.
 */
export function resizeBox(start: Box, handle: Handle, delta: Point, keepRatio = false, min = 5): Box {
  const [sx, sy] = HANDLE_SIGNS[handle];
  const d = rotatePoint(delta, { x: 0, y: 0 }, -start.rotation);
  let w = sx ? Math.max(min, start.width + sx * d.x) : start.width;
  let h = sy ? Math.max(min, start.height + sy * d.y) : start.height;
  if (keepRatio && sx && sy && start.width > 0 && start.height > 0) {
    const scale = Math.max(w / start.width, h / start.height);
    w = start.width * scale;
    h = start.height * scale;
  }
  // A line has zero height; keep it that way.
  if (start.height === 0 && !sy) h = 0;
  const shift = rotatePoint(
    { x: (sx * (w - start.width)) / 2, y: (sy * (h - start.height)) / 2 },
    { x: 0, y: 0 },
    start.rotation,
  );
  const c = center(start);
  const cx = c.x + shift.x;
  const cy = c.y + shift.y;
  return { x: cx - w / 2, y: cy - h / 2, width: w, height: h, rotation: start.rotation };
}

/** Angle (degrees) for the rotation handle being dragged to `p`. Snaps to 15° when `snap`. */
export function rotationFromPoint(el: DesignElement, p: Point, snap = false): number {
  const c = center(el);
  let deg = (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI + 90;
  if (snap) deg = Math.round(deg / 15) * 15;
  return ((deg % 360) + 360) % 360;
}

export interface Guide {
  axis: 'x' | 'y';
  /** Position in doc coordinates. */
  pos: number;
}

/**
 * Snap a moving box to the canvas edges/center and other elements' edges/centers.
 * Returns the adjusted position plus guides to draw.
 */
export function snapPosition(
  doc: DesignDoc,
  movingId: string,
  box: { x: number; y: number; width: number; height: number },
  threshold: number,
): { x: number; y: number; guides: Guide[] } {
  const xs = [0, doc.width / 2, doc.width];
  const ys = [0, doc.height / 2, doc.height];
  for (const e of doc.elements) {
    if (e.id === movingId) continue;
    xs.push(e.x, e.x + e.width / 2, e.x + e.width);
    ys.push(e.y, e.y + e.height / 2, e.y + e.height);
  }
  const best = (offsets: number[], targets: number[]) => {
    let found: { delta: number; pos: number } | null = null;
    for (const o of offsets) {
      for (const t of targets) {
        const delta = t - o;
        if (Math.abs(delta) <= threshold && (!found || Math.abs(delta) < Math.abs(found.delta))) {
          found = { delta, pos: t };
        }
      }
    }
    return found;
  };
  const bx = best([box.x, box.x + box.width / 2, box.x + box.width], xs);
  const by = best([box.y, box.y + box.height / 2, box.y + box.height], ys);
  const guides: Guide[] = [];
  if (bx) guides.push({ axis: 'x', pos: bx.pos });
  if (by) guides.push({ axis: 'y', pos: by.pos });
  return { x: box.x + (bx?.delta ?? 0), y: box.y + (by?.delta ?? 0), guides };
}

/** Break text into lines that fit `maxWidth`, honouring explicit newlines. */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let line = words[0];
    for (const word of words.slice(1)) {
      const candidate = `${line} ${word}`;
      if (measure(candidate) <= maxWidth) line = candidate;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

export function isDesignDoc(value: unknown): value is DesignDoc {
  const v = value as DesignDoc;
  return !!v && typeof v.width === 'number' && typeof v.height === 'number' && Array.isArray(v.elements);
}

/**
 * Change the canvas size, scaling and re-centering every element so the
 * layout still fits ("magic resize").
 */
export function resizeDoc(doc: DesignDoc, width: number, height: number): DesignDoc {
  const scale = Math.min(width / doc.width, height / doc.height);
  const offsetX = (width - doc.width * scale) / 2;
  const offsetY = (height - doc.height * scale) / 2;
  return {
    ...doc,
    width,
    height,
    elements: doc.elements.map((e) => {
      const scaled = {
        ...e,
        x: e.x * scale + offsetX,
        y: e.y * scale + offsetY,
        width: e.width * scale,
        height: e.height * scale,
      };
      if (e.type === 'text') return { ...scaled, fontSize: e.fontSize * scale } as DesignElement;
      if (e.type === 'shape') return { ...scaled, strokeWidth: e.strokeWidth * scale, radius: e.radius * scale } as DesignElement;
      return { ...scaled, radius: e.radius * scale } as DesignElement;
    }),
  };
}
