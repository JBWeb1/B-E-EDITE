import { useSyncExternalStore } from 'react';
import type { CSSProperties } from 'react';

/**
 * "Editor look": colour templates styled after popular editing apps, plus a few
 * layout options. The choice is saved in the browser and applied to both editors
 * as CSS variables and data attributes on the editor's root element.
 */

export interface Palette {
  light?: boolean;
  bg: string;
  surface: string;
  surface2: string;
  surface3: string;
  surface4: string;
  text: string;
  muted: string;
  accent: string;
  /** Timeline item colours. */
  clip: string;
  textClip: string;
  fxClip: string;
  audioClip: string;
  overlayClip: string;
  playhead: string;
}

export type LibrarySide = 'left' | 'right';
export type TimelineSize = 'small' | 'medium' | 'large';
export type Corners = 'round' | 'square';
export type Density = 'comfortable' | 'compact';

export interface LayoutOptions {
  library: LibrarySide;
  timeline: TimelineSize;
  corners: Corners;
  density: Density;
}

export interface LookTemplate {
  id: string;
  name: string;
  /** Short note on what it looks like. */
  note: string;
  palette: Palette;
  layout: LayoutOptions;
}

const DARK_TEXT = { text: '#eceef3', muted: '#8e95a6' };

export const LOOK_TEMPLATES: LookTemplate[] = [
  {
    id: 'bemotion',
    name: 'B-E Motion',
    note: 'Our own violet look',
    palette: {
      bg: '#0b0c10', surface: '#12141b', surface2: '#181b24', surface3: '#20242f', surface4: '#2a2f3c', ...DARK_TEXT,
      accent: '#8b5cf6',
      clip: '#312e81', textClip: '#7c3aed', fxClip: '#be185d', audioClip: '#047857', overlayClip: '#b45309', playhead: '#ffffff',
    },
    layout: { library: 'left', timeline: 'medium', corners: 'round', density: 'comfortable' },
  },
  {
    id: 'capcut',
    name: 'CapCut style',
    note: 'Near-black panels, cyan highlights',
    palette: {
      bg: '#0f0f10', surface: '#18181a', surface2: '#1f1f22', surface3: '#2a2a2e', surface4: '#36363b', ...DARK_TEXT,
      accent: '#00c8d2',
      clip: '#1d3b41', textClip: '#a16207', fxClip: '#6d28d9', audioClip: '#115e59', overlayClip: '#9a3412', playhead: '#ffffff',
    },
    layout: { library: 'left', timeline: 'medium', corners: 'round', density: 'comfortable' },
  },
  {
    id: 'premiere',
    name: 'Premiere Pro style',
    note: 'Flat grey panels, blue accent, big timeline',
    palette: {
      bg: '#1a1a1a', surface: '#232323', surface2: '#2b2b2b', surface3: '#333333', surface4: '#3d3d3d', text: '#dcdcdc', muted: '#9a9a9a',
      accent: '#2d8ceb',
      clip: '#5b5fc7', textClip: '#b0507f', fxClip: '#8a6d1f', audioClip: '#2f8f5b', overlayClip: '#4b8fb3', playhead: '#2d8ceb',
    },
    layout: { library: 'left', timeline: 'large', corners: 'square', density: 'compact' },
  },
  {
    id: 'resolve',
    name: 'DaVinci Resolve style',
    note: 'Cool grey, red playhead, pro density',
    palette: {
      bg: '#16161a', surface: '#26262b', surface2: '#2e2e34', surface3: '#38383f', surface4: '#44444c', text: '#d8d8dc', muted: '#8d8d96',
      accent: '#e8833a',
      clip: '#3e6ea6', textClip: '#7e4fa3', fxClip: '#a0632d', audioClip: '#3c8b5a', overlayClip: '#2f8a8a', playhead: '#e64b3d',
    },
    layout: { library: 'left', timeline: 'large', corners: 'square', density: 'compact' },
  },
  {
    id: 'finalcut',
    name: 'Final Cut style',
    note: 'Soft charcoal with yellow selection',
    palette: {
      bg: '#121214', surface: '#1e1e21', surface2: '#26262a', surface3: '#303035', surface4: '#3b3b41', ...DARK_TEXT,
      accent: '#f2c94c',
      clip: '#3d66b7', textClip: '#8a55c9', fxClip: '#c7473c', audioClip: '#3a9a5b', overlayClip: '#4f86c6', playhead: '#f2c94c',
    },
    layout: { library: 'left', timeline: 'large', corners: 'round', density: 'comfortable' },
  },
  {
    id: 'canva',
    name: 'Canva style (light)',
    note: 'Bright and friendly, purple accent',
    palette: {
      light: true,
      bg: '#eef0f4', surface: '#ffffff', surface2: '#f3f4f7', surface3: '#e7e9ee', surface4: '#d9dce3', text: '#0d1216', muted: '#5e6670',
      accent: '#7d2ae8',
      clip: '#6d5ce0', textClip: '#d9790f', fxClip: '#c0368a', audioClip: '#13a37c', overlayClip: '#2f80ed', playhead: '#0d1216',
    },
    layout: { library: 'left', timeline: 'medium', corners: 'round', density: 'comfortable' },
  },
];

export const DEFAULT_TEMPLATE = 'capcut';

export interface Look extends LayoutOptions {
  template: string;
  /** Custom accent colour, or null to use the template's. */
  accent: string | null;
}

export function templateById(id: string): LookTemplate {
  return LOOK_TEMPLATES.find((t) => t.id === id) ?? LOOK_TEMPLATES.find((t) => t.id === DEFAULT_TEMPLATE)!;
}

/** The look a template gives you before any tweaks. */
export function lookFromTemplate(id: string): Look {
  const t = templateById(id);
  return { template: t.id, accent: null, ...t.layout };
}

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;

/** Read a saved look, ignoring anything unknown or broken. */
export function parseLook(raw: string | null): Look {
  let data: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object') data = parsed as Record<string, unknown>;
  } catch {
    // Fall through to the default look.
  }
  const base = lookFromTemplate(typeof data.template === 'string' ? data.template : DEFAULT_TEMPLATE);
  return {
    template: base.template,
    accent: typeof data.accent === 'string' && /^#[0-9a-f]{6}$/i.test(data.accent) ? data.accent : null,
    library: pick(data.library, ['left', 'right'] as const, base.library),
    timeline: pick(data.timeline, ['small', 'medium', 'large'] as const, base.timeline),
    corners: pick(data.corners, ['round', 'square'] as const, base.corners),
    density: pick(data.density, ['comfortable', 'compact'] as const, base.density),
  };
}

/** True when the look differs from its template (the user tweaked something). */
export function isCustomized(look: Look): boolean {
  const base = lookFromTemplate(look.template);
  return (Object.keys(base) as (keyof Look)[]).some((k) => base[k] !== look[k]);
}

// ---------- Colour helpers ----------

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: number[]): string {
  return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}

/** Blend `hex` toward `target` by `amount` (0..1). */
export function mix(hex: string, target: string, amount: number): string {
  const a = rgb(hex);
  const b = rgb(target);
  return toHex(a.map((v, i) => v + (b[i] - v) * amount));
}

export function alpha(hex: string, a: number): string {
  const [r, g, b] = rgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Relative brightness 0..1, used to pick readable text on the accent. */
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** CSS variables for the editor root. */
export function lookStyle(look: Look): CSSProperties {
  const p = templateById(look.template).palette;
  const accent = look.accent ?? p.accent;
  const light = !!p.light;
  const ink = light ? '#000000' : '#ffffff';
  const vars: Record<string, string> = {
    '--bg': p.bg,
    '--surface': p.surface,
    '--surface-2': p.surface2,
    '--surface-3': p.surface3,
    '--surface-4': p.surface4,
    '--text': p.text,
    '--muted': p.muted,
    '--faint': mix(p.muted, p.bg, 0.4),
    '--border': alpha(ink, light ? 0.09 : 0.07),
    '--border-strong': alpha(ink, light ? 0.16 : 0.13),
    '--accent': accent,
    '--accent-strong': mix(accent, '#000000', 0.15),
    '--accent-text': light ? mix(accent, '#000000', 0.15) : mix(accent, '#ffffff', 0.45),
    '--accent-soft': alpha(accent, light ? 0.12 : 0.14),
    '--accent-ring': alpha(accent, 0.45),
    '--on-accent': luminance(accent) > 0.45 ? '#111111' : '#ffffff',
    '--grad': `linear-gradient(135deg, ${accent} 0%, ${mix(accent, light ? '#000000' : '#ffffff', 0.25)} 100%)`,
    '--clip-main': p.clip,
    '--clip-text': p.textClip,
    '--clip-fx': p.fxClip,
    '--clip-audio': p.audioClip,
    '--clip-overlay': p.overlayClip,
    '--playhead': p.playhead,
    '--panel-radius': look.corners === 'square' ? '2px' : '8px',
    '--radius-sm': look.corners === 'square' ? '3px' : '7px',
    '--radius': look.corners === 'square' ? '4px' : '10px',
    '--radius-lg': look.corners === 'square' ? '6px' : '16px',
    colorScheme: light ? 'light' : 'dark',
  };
  return vars as CSSProperties;
}

/** Data attributes that switch layout rules in the stylesheet. */
export function lookAttributes(look: Look) {
  return {
    'data-library': look.library,
    'data-timeline': look.timeline,
    'data-density': look.density,
    'data-corners': look.corners,
    'data-light': templateById(look.template).palette.light ? 'true' : undefined,
  };
}

// ---------- Saved setting (shared by both editors) ----------

const KEY = 'bee.look';
const listeners = new Set<() => void>();
let current: Look | null = null;

function read(): Look {
  if (!current) {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(KEY);
    } catch {
      // Private mode etc.: use the default look.
    }
    current = parseLook(raw);
  }
  return current;
}

/** A custom accent equal to the template's own colour is no custom accent at all. */
export function normalizeLook(look: Look): Look {
  const own = templateById(look.template).palette.accent;
  return look.accent && look.accent.toLowerCase() === own.toLowerCase() ? { ...look, accent: null } : look;
}

export function setLook(next: Look) {
  next = normalizeLook(next);
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // The look still applies for this visit.
  }
  listeners.forEach((l) => l());
}

export function useLook(): Look {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read,
    read,
  );
}
