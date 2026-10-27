/**
 * Ready-made video templates (vlog intro, product promo, …). Each one is plain
 * data: scenes with painted backgrounds, titles, effects and sounds, all timed.
 * `paintScene` draws a scene's background so templates need no image files.
 */
import type { EffectType, Motion, TextOverlay, TransitionType } from './types';

export interface TemplateScene {
  /** Gradient colours, top-left to bottom-right. */
  colors: [string, string, string?];
  /** Soft decoration painted over the gradient. */
  decor: 'orbs' | 'stripes' | 'grid' | 'rays' | 'waves' | 'none';
  duration: number;
  motion?: Motion;
  transition?: TransitionType;
}

export interface TemplateText {
  start: number;
  patch: Partial<TextOverlay>;
}

export interface VideoTemplate {
  id: string;
  name: string;
  /** Short description for the card. */
  blurb: string;
  width: number;
  height: number;
  scenes: TemplateScene[];
  texts: TemplateText[];
  effects: { type: EffectType; start: number; duration: number; intensity: number }[];
  sounds: { id: string; at: number }[];
}

const bold = { bold: true, font: 'Inter, system-ui, sans-serif' };

export const VIDEO_TEMPLATES: VideoTemplate[] = [
  {
    id: 'vlog-intro',
    name: 'Vlog intro',
    blurb: 'Bright opener with your channel name',
    width: 1280,
    height: 720,
    scenes: [
      { colors: ['#ff7a59', '#ffb347', '#ffd86b'], decor: 'orbs', duration: 2.5, motion: 'zoom-in' },
      { colors: ['#6a5cff', '#a66bff', '#ff8bd1'], decor: 'waves', duration: 2.5, motion: 'pan-right', transition: 'zoom' },
    ],
    texts: [
      { start: 0.2, patch: { text: 'MY WEEKEND VLOG', y: 0.45, size: 0.13, duration: 2.2, color: '#ffffff', animator: 'rise', animation: 'none', ...bold } },
      { start: 0.8, patch: { text: 'episode 12 · city edition', y: 0.62, size: 0.05, duration: 1.8, color: '#fff7e6', animation: 'fade' } },
      { start: 2.6, patch: { template: 'social', text: '@yourchannel', y: 0.8, size: 0.06, duration: 2.3 } },
    ],
    effects: [{ type: 'light-leak', start: 0, duration: 2.5, intensity: 0.6 }],
    sounds: [{ id: 'whoosh', at: 0.1 }, { id: 'swoosh', at: 2.35 }],
  },
  {
    id: 'product-promo',
    name: 'Product promo',
    blurb: 'Sale announcement with a call to action',
    width: 1080,
    height: 1080,
    scenes: [
      { colors: ['#0f172a', '#1e3a8a', '#0ea5e9'], decor: 'grid', duration: 2, motion: 'zoom-in' },
      { colors: ['#111827', '#7c3aed', '#ec4899'], decor: 'rays', duration: 2.5, transition: 'slide' },
      { colors: ['#022c22', '#059669', '#a3e635'], decor: 'orbs', duration: 2.5, transition: 'wipe' },
    ],
    texts: [
      { start: 0.2, patch: { template: 'title-reveal', text: 'NEW DROP', y: 0.5, size: 0.14, duration: 1.8 } },
      { start: 2.1, patch: { text: '50% OFF', y: 0.45, size: 0.2, duration: 2.3, color: '#fde047', stroke: '#111111', animation: 'pop', ...bold } },
      { start: 2.6, patch: { text: 'this weekend only', y: 0.62, size: 0.055, duration: 1.8, color: '#ffffff', animation: 'fade' } },
      { start: 4.6, patch: { text: 'SHOP NOW', y: 0.5, size: 0.12, duration: 2.3, color: '#ffffff', background: '#111827', animation: 'pop', ...bold } },
      { start: 4.8, patch: { shape: 'arrow', text: '', x: 0.5, y: 0.7, size: 0.1, duration: 2, color: '#fde047', shapeAnim: 'pulse', rotation: 90 } },
    ],
    effects: [{ type: 'sparkles', start: 2, duration: 2.5, intensity: 0.7 }],
    sounds: [{ id: 'riser', at: 0.2 }, { id: 'boom', at: 2 }, { id: 'ding', at: 4.6 }],
  },
  {
    id: 'travel-story',
    name: 'Travel story',
    blurb: 'Vertical story with a location tag',
    width: 720,
    height: 1280,
    scenes: [
      { colors: ['#0c4a6e', '#38bdf8', '#fde68a'], decor: 'waves', duration: 3, motion: 'zoom-in' },
      { colors: ['#7c2d12', '#f97316', '#fde68a'], decor: 'rays', duration: 3, motion: 'zoom-out', transition: 'fade' },
    ],
    texts: [
      { start: 0.3, patch: { text: 'SUMMER IN\nLISBON', y: 0.4, size: 0.09, duration: 2.6, color: '#ffffff', animator: 'typewriter', animation: 'none', ...bold } },
      { start: 1, patch: { template: 'location', text: 'Lisbon, Portugal', y: 0.75, size: 0.045, duration: 2 } },
      { start: 3.2, patch: { text: 'best trip ever ☀️', y: 0.5, size: 0.05, duration: 2.6, color: '#ffffff', animation: 'slide' } },
    ],
    effects: [{ type: 'dust', start: 0, duration: 6, intensity: 0.5 }],
    sounds: [{ id: 'shutter', at: 0.2 }, { id: 'whoosh', at: 2.8 }],
  },
  {
    id: 'end-screen',
    name: 'YouTube end screen',
    blurb: 'Thanks for watching + subscribe',
    width: 1280,
    height: 720,
    scenes: [{ colors: ['#18181b', '#3f3f46', '#ef4444'], decor: 'stripes', duration: 6, motion: 'zoom-in' }],
    texts: [
      { start: 0.2, patch: { text: 'THANKS FOR WATCHING', y: 0.35, size: 0.1, duration: 5.6, color: '#ffffff', animator: 'fade-letters', animation: 'none', ...bold } },
      { start: 1, patch: { template: 'subscribe', text: 'SUBSCRIBE', y: 0.62, size: 0.07, duration: 4.5 } },
      { start: 1.5, patch: { shape: 'rect', text: '', x: 0.3, y: 0.8, size: 0.16, aspect: 1.78, duration: 4.3, color: '#ffffff', outline: true, shapeAnim: 'draw' } },
      { start: 1.5, patch: { shape: 'rect', text: '', x: 0.7, y: 0.8, size: 0.16, aspect: 1.78, duration: 4.3, color: '#ffffff', outline: true, shapeAnim: 'draw' } },
    ],
    effects: [{ type: 'vignette', start: 0, duration: 6, intensity: 0.6 }],
    sounds: [{ id: 'click', at: 1.2 }],
  },
  {
    id: 'birthday',
    name: 'Birthday wishes',
    blurb: 'Confetti, balloons and a big hello',
    width: 720,
    height: 1280,
    scenes: [
      { colors: ['#db2777', '#f472b6', '#fde68a'], decor: 'orbs', duration: 3, motion: 'zoom-in' },
      { colors: ['#4c1d95', '#8b5cf6', '#f9a8d4'], decor: 'rays', duration: 3, transition: 'zoom' },
    ],
    texts: [
      { start: 0.3, patch: { text: 'HAPPY\nBIRTHDAY!', y: 0.42, size: 0.085, duration: 2.6, color: '#ffffff', stroke: '#9d174d', animator: 'bounce', animation: 'none', ...bold } },
      { start: 3.1, patch: { text: 'Love you, Sam 💖', y: 0.5, size: 0.052, duration: 2.8, color: '#ffffff', glow: '#ec4899', animation: 'pop' } },
    ],
    effects: [
      { type: 'confetti', start: 0, duration: 3, intensity: 0.8 },
      { type: 'hearts', start: 3, duration: 3, intensity: 0.6 },
    ],
    sounds: [{ id: 'pop', at: 0.3 }, { id: 'applause', at: 3 }],
  },
  {
    id: 'quote-card',
    name: 'Quote of the day',
    blurb: 'Calm square post with a quote',
    width: 1080,
    height: 1080,
    scenes: [{ colors: ['#1c1917', '#44403c', '#a8a29e'], decor: 'none', duration: 6, motion: 'zoom-in' }],
    texts: [
      { start: 0.3, patch: { template: 'quote', text: 'Make it simple, but significant.\n— Don Draper', y: 0.5, size: 0.065, duration: 5.4 } },
    ],
    effects: [{ type: 'grain', start: 0, duration: 6, intensity: 0.4 }],
    sounds: [],
  },
];

export const templateDuration = (t: VideoTemplate) => t.scenes.reduce((s, sc) => s + sc.duration, 0);

/** Small deterministic random numbers, so a template always looks the same. */
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

/** Paint a scene background onto a canvas context. */
export function paintScene(ctx: CanvasRenderingContext2D, scene: TemplateScene, w: number, h: number, seed = 1) {
  const g = ctx.createLinearGradient(0, 0, w, h);
  const stops = scene.colors.filter(Boolean) as string[];
  stops.forEach((c, i) => g.addColorStop(i / Math.max(1, stops.length - 1), c));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const rand = rng(seed * 97 + 13);
  const m = Math.min(w, h);
  ctx.save();
  switch (scene.decor) {
    case 'orbs':
      for (let i = 0; i < 7; i++) {
        const x = rand() * w;
        const y = rand() * h;
        const r = m * (0.1 + rand() * 0.25);
        const og = ctx.createRadialGradient(x, y, 0, x, y, r);
        og.addColorStop(0, 'rgba(255,255,255,0.35)');
        og.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = og;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
      break;
    case 'stripes':
      ctx.globalAlpha = 0.08;
      ctx.fillStyle = '#ffffff';
      ctx.translate(w / 2, h / 2);
      ctx.rotate(-Math.PI / 6);
      for (let x = -w; x < w; x += m * 0.08) ctx.fillRect(x, -h, m * 0.03, h * 2);
      break;
    case 'grid':
      ctx.strokeStyle = 'rgba(255,255,255,0.09)';
      ctx.lineWidth = Math.max(1, m / 400);
      for (let x = 0; x <= w; x += m / 12) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y <= h; y += m / 12) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      break;
    case 'rays': {
      ctx.translate(w / 2, h * 0.55);
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      for (let i = 0; i < 16; i++) {
        ctx.rotate((Math.PI * 2) / 16);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.max(w, h), -m * 0.12);
        ctx.lineTo(Math.max(w, h), m * 0.12);
        ctx.fill();
      }
      break;
    }
    case 'waves':
      for (let k = 0; k < 4; k++) {
        ctx.fillStyle = `rgba(255,255,255,${0.06 + k * 0.03})`;
        ctx.beginPath();
        const base = h * (0.6 + k * 0.1);
        ctx.moveTo(0, h);
        for (let x = 0; x <= w; x += w / 40) ctx.lineTo(x, base + Math.sin(x / (w / (3 + k)) + k * 1.7) * m * 0.04);
        ctx.lineTo(w, h);
        ctx.fill();
      }
      break;
    case 'none':
      break;
  }
  ctx.restore();
  // Soft darkening at the edges keeps white titles readable.
  const v = ctx.createRadialGradient(w / 2, h / 2, m * 0.3, w / 2, h / 2, Math.hypot(w, h) / 2);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
}

/** A scene background as a PNG file, ready to import. */
export async function sceneFile(t: VideoTemplate, index: number): Promise<File> {
  const c = document.createElement('canvas');
  c.width = t.width;
  c.height = t.height;
  paintScene(c.getContext('2d')!, t.scenes[index], t.width, t.height, index + 1);
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
  if (!blob) throw new Error('Could not draw the template');
  return new File([blob], `${t.name} ${index + 1}.png`, { type: 'image/png' });
}
