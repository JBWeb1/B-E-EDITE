/**
 * Design extras: grouping, curved text layout, the icon library and photo frames.
 * Pure and unit-tested; the editor and renderer use them.
 */
import { uid } from '../lib/id';
import type { DesignDoc, ImageElement, ShapeKind } from './types';

// ---------- Groups ----------

/** The ids plus every other member of any group they belong to (in page order). */
export function withGroups(doc: DesignDoc, ids: string[]): string[] {
  const groups = new Set(doc.elements.filter((e) => ids.includes(e.id) && e.groupId).map((e) => e.groupId));
  return doc.elements.filter((e) => ids.includes(e.id) || (e.groupId && groups.has(e.groupId))).map((e) => e.id);
}

/** Put the elements in one new group (they then select and move together). */
export function groupElements(doc: DesignDoc, ids: string[]): DesignDoc {
  if (ids.length < 2) return doc;
  const groupId = uid('group');
  return { ...doc, elements: doc.elements.map((e) => (ids.includes(e.id) ? { ...e, groupId } : e)) };
}

export function ungroupElements(doc: DesignDoc, ids: string[]): DesignDoc {
  const groups = new Set(doc.elements.filter((e) => ids.includes(e.id) && e.groupId).map((e) => e.groupId));
  return { ...doc, elements: doc.elements.map((e) => (e.groupId && groups.has(e.groupId) ? { ...e, groupId: undefined } : e)) };
}

/** True when the ids are exactly one whole group. */
export function isOneGroup(doc: DesignDoc, ids: string[]): boolean {
  const els = doc.elements.filter((e) => ids.includes(e.id));
  const g = els[0]?.groupId;
  return !!g && els.length > 1 && els.every((e) => e.groupId === g) && doc.elements.filter((e) => e.groupId === g).length === els.length;
}

// ---------- Curved text ----------

/** Largest bend: 100% wraps the text around 90% of a circle. */
const MAX_SWEEP = Math.PI * 2 * 0.9;

export interface Glyph {
  /** Centre of the letter, relative to the top-centre of the element. */
  x: number;
  y: number;
  /** Turn (radians). */
  angle: number;
}

/**
 * Where each letter goes when text is bent along a circle. `curve` -100..100:
 * positive arches upwards (∩), negative dips (∪). Also returns the height needed.
 */
export function curveLayout(widths: number[], curve: number, fontSize: number): { glyphs: Glyph[]; height: number; width: number } {
  const total = widths.reduce((a, b) => a + b, 0);
  const c = Math.max(-100, Math.min(100, curve)) / 100;
  if (Math.abs(c) < 0.005 || total <= 0) {
    let at = -total / 2;
    return { glyphs: widths.map((w) => ({ x: (at += w) - w / 2, y: fontSize / 2, angle: 0 })), height: fontSize, width: total };
  }
  const sweep = Math.abs(c) * MAX_SWEEP;
  const r = total / sweep;
  const rise = r * (1 - Math.cos(sweep / 2));
  let s = -total / 2;
  const glyphs = widths.map((w) => {
    const mid = s + w / 2;
    s += w;
    const phi = mid / r;
    const drop = r * (1 - Math.cos(phi));
    return c > 0 ? { x: r * Math.sin(phi), y: fontSize / 2 + drop, angle: phi } : { x: r * Math.sin(phi), y: fontSize / 2 + rise - drop, angle: -phi };
  });
  const width = sweep >= Math.PI ? 2 * r + fontSize : 2 * r * Math.sin(sweep / 2) + fontSize;
  return { glyphs, height: Math.ceil(rise + fontSize * 1.2), width };
}

// ---------- Icons ----------

/** Line icons on a 24×24 grid (stroke paths). */
export const ICONS: Record<string, string[]> = {
  heart: ['M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z'],
  star: ['M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z'],
  check: ['M20 6 9 17l-5-5'],
  'check-circle': ['M22 11.1V12a10 10 0 1 1-5.9-9.1', 'M22 4 12 14l-3-3'],
  x: ['M18 6 6 18', 'M6 6l12 12'],
  plus: ['M12 5v14', 'M5 12h14'],
  'arrow-right': ['M5 12h14', 'M12 5l7 7-7 7'],
  'arrow-up': ['M12 19V5', 'M5 12l7-7 7 7'],
  phone: ['M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z'],
  mail: ['M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'M22 6l-10 7L2 6'],
  pin: ['M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z', 'M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
  globe: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M2 12h20', 'M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z'],
  cart: ['M9 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2z', 'M20 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2z', 'M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6'],
  bag: ['M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z', 'M3 6h18', 'M16 10a4 4 0 0 1-8 0'],
  gift: ['M20 12v10H4V12', 'M2 7h20v5H2z', 'M12 22V7', 'M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z', 'M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z'],
  tag: ['M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z', 'M7 7h.01'],
  camera: ['M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z', 'M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
  video: ['M23 7l-7 5 7 5V7z', 'M3 5h11a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z'],
  music: ['M9 18V5l12-2v13', 'M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M18 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
  mic: ['M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z', 'M19 10v2a7 7 0 0 1-14 0v-2', 'M12 19v3'],
  play: ['M5 3l14 9-14 9V3z'],
  sun: ['M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z', 'M12 1v2', 'M12 21v2', 'M4.2 4.2l1.4 1.4', 'M18.4 18.4l1.4 1.4', 'M1 12h2', 'M21 12h2', 'M4.2 19.8l1.4-1.4', 'M18.4 5.6l1.4-1.4'],
  moon: ['M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z'],
  cloud: ['M18 10h-1.3A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z'],
  leaf: ['M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10z', 'M2 21c0-3 1.9-5.4 5.1-6'],
  flower: ['M12 7.5a4.5 4.5 0 1 1 4.5 4.5M12 7.5A4.5 4.5 0 1 0 7.5 12M12 7.5V9m-4.5 3a4.5 4.5 0 1 0 4.5 4.5M7.5 12H9m7.5 0a4.5 4.5 0 1 1-4.5 4.5m4.5-4.5H15m-3 4.5V15', 'M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z'],
  coffee: ['M18 8h1a4 4 0 0 1 0 8h-1', 'M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z', 'M6 1v3', 'M10 1v3', 'M14 1v3'],
  home: ['M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z'],
  user: ['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2', 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
  users: ['M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M23 21v-2a4 4 0 0 0-3-3.9', 'M16 3.1a4 4 0 0 1 0 7.8'],
  calendar: ['M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'M16 2v4', 'M8 2v4', 'M3 10h18'],
  clock: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 6v6l4 2'],
  bell: ['M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9', 'M13.7 21a2 2 0 0 1-3.4 0'],
  bolt: ['M13 2 3 14h9l-1 8 10-12h-9z'],
  fire: ['M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3.3.3 1.4 1.4 2.8 3.5 2.8z'],
  trophy: ['M6 9H4.5a2.5 2.5 0 0 1 0-5H6', 'M18 9h1.5a2.5 2.5 0 0 0 0-5H18', 'M4 22h16', 'M10 14.7V17c0 .6-.5 1-1 1.2C7.8 18.8 7 20.2 7 22', 'M14 14.7V17c0 .6.5 1 1 1.2 1.2.6 2 2 2 3.8', 'M18 2H6v7a6 6 0 0 0 12 0V2z'],
  rocket: ['M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2.1-.1-2.9a2.2 2.2 0 0 0-2.9-.1z', 'M12 15l-3-3a22 22 0 0 1 2-3.9A12.9 12.9 0 0 1 22 2c0 2.7-.8 7.5-6 11a22.4 22.4 0 0 1-4 2z', 'M9 12H4s.6-3 2-4c1.6-1.1 5 0 5 0', 'M12 15v5s3-.6 4-2c1.1-1.6 0-5 0-5'],
  smile: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M8 14s1.5 2 4 2 4-2 4-2', 'M9 9h.01', 'M15 9h.01'],
  thumbs: ['M7 10v12', 'M15 5.9 14 10h5.8a2 2 0 0 1 2 2.3l-1.4 8A2 2 0 0 1 18.4 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.8a2 2 0 0 0 1.8-1.1L12 2a3.1 3.1 0 0 1 3 3.9z'],
  chat: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'],
  link: ['M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7', 'M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7'],
  wifi: ['M5 12.6a10 10 0 0 1 14 0', 'M1.4 9a16 16 0 0 1 21.2 0', 'M8.5 16.1a5 5 0 0 1 7 0', 'M12 20h.01'],
  lock: ['M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z', 'M7 11V7a5 5 0 0 1 10 0v4'],
  search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'M21 21l-4.3-4.3'],
  quote: ['M3 21c3 0 7-1 7-8V5c0-1.3-.8-2-2-2H4c-1.3 0-2 .8-2 2v6c0 1.3.8 2 2 2h1c0 4-1 5-2 6z', 'M15 21c3 0 7-1 7-8V5c0-1.3-.8-2-2-2h-4c-1.3 0-2 .8-2 2v6c0 1.3.8 2 2 2h1c0 4-1 5-2 6z'],
};

/** A coloured SVG picture of an icon, as a data URL (drawn like any image). */
export function iconSrc(name: string, color: string, stroke = 2): string {
  const paths = (ICONS[name] ?? ICONS.star).map((d) => `<path d="${d}"/>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="-1 -1 26 26" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** An icon as a design element (an image that keeps its icon name, so its colour can change). */
export function createIcon(doc: Pick<DesignDoc, 'width' | 'height'>, name: string, color = '#111827'): ImageElement {
  const size = Math.round(Math.min(doc.width, doc.height) * 0.18);
  return {
    id: uid('el'),
    type: 'image',
    name: `Icon: ${name}`,
    x: Math.round((doc.width - size) / 2),
    y: Math.round((doc.height - size) / 2),
    width: size,
    height: size,
    rotation: 0,
    opacity: 1,
    radius: 0,
    src: iconSrc(name, color),
    naturalWidth: 240,
    naturalHeight: 240,
    icon: { name, color, stroke: 2 },
  };
}

// ---------- Frames ----------

/** Shapes a photo can be framed in. */
export const FRAMES: { shape: ShapeKind; label: string }[] = [
  { shape: 'ellipse', label: 'Circle' },
  { shape: 'rect', label: 'Rounded' },
  { shape: 'heart', label: 'Heart' },
  { shape: 'star', label: 'Star' },
  { shape: 'hexagon', label: 'Hexagon' },
  { shape: 'diamond', label: 'Diamond' },
  { shape: 'triangle', label: 'Triangle' },
  { shape: 'bubble', label: 'Speech' },
];

/** Grey "drop a photo here" picture for an empty frame. */
export const FRAME_PLACEHOLDER = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><rect width="400" height="400" fill="#cbd5e1"/><g fill="none" stroke="#64748b" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"><rect x="110" y="130" width="180" height="140" rx="16"/><circle cx="160" cy="180" r="16"/><path d="M290 240l-50-50-110 80"/></g></svg>',
)}`;

/** An empty photo frame: pick it and upload or click a photo to fill it. */
export function createFrame(doc: Pick<DesignDoc, 'width' | 'height'>, shape: ShapeKind): ImageElement {
  const size = Math.round(Math.min(doc.width, doc.height) * 0.45);
  return {
    id: uid('el'),
    type: 'image',
    name: `Frame: ${FRAMES.find((f) => f.shape === shape)?.label ?? shape}`,
    x: Math.round((doc.width - size) / 2),
    y: Math.round((doc.height - size) / 2),
    width: size,
    height: size,
    rotation: 0,
    opacity: 1,
    radius: shape === 'rect' ? Math.round(size * 0.12) : 0,
    src: FRAME_PLACEHOLDER,
    naturalWidth: 400,
    naturalHeight: 400,
    frame: shape,
    crop: { aspect: 1, zoom: 1, cx: 0.5, cy: 0.5 },
  };
}

/** Put a photo into a frame: it fills the frame's shape (cropped to cover it). */
export function fillFrame(el: ImageElement, src: string, w: number, h: number): ImageElement {
  return { ...el, src, naturalWidth: w, naturalHeight: h, originalSrc: undefined, crop: { aspect: el.width / el.height, zoom: 1, cx: 0.5, cy: 0.5 } };
}
