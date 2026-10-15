/**
 * Colour grading: three colour wheels (shadows / midtones / highlights, like
 * lift / gamma / gain) and LUT-style looks. Everything compiles to one SVG
 * filter that the canvas can apply (`ctx.filter = 'url(#id)'`), so grading
 * runs at full speed in the preview and in exports.
 */

export interface Wheel {
  /** Direction on the colour wheel, degrees (0 = red, 120 = green, 240 = blue). */
  hue: number;
  /** How strongly to tint, 0..1. */
  amount: number;
  /** Darker / brighter, -1..1. */
  luma: number;
}

export type LookId =
  | 'none'
  | 'teal-orange'
  | 'cinematic'
  | 'vintage'
  | 'moody'
  | 'warm-film'
  | 'cold'
  | 'golden-hour'
  | 'cyberpunk'
  | 'bleach'
  | 'noir'
  | 'faded';

export interface ColorGrade {
  shadows: Wheel;
  midtones: Wheel;
  highlights: Wheel;
  look: LookId;
  /** Strength of the look, 0..1. */
  lookAmount: number;
}

export const NEUTRAL_WHEEL: Wheel = { hue: 0, amount: 0, luma: 0 };
export const NEUTRAL_GRADE: ColorGrade = {
  shadows: NEUTRAL_WHEEL,
  midtones: NEUTRAL_WHEEL,
  highlights: NEUTRAL_WHEEL,
  look: 'none',
  lookAmount: 1,
};

type Table = [number, number, number, number, number];

interface Look {
  id: LookId;
  label: string;
  saturate?: number;
  r: Table;
  g: Table;
  b: Table;
}

const ID: Table = [0, 0.25, 0.5, 0.75, 1];
const same = (t: Table) => ({ r: t, g: t, b: t });

export const LOOKS: Look[] = [
  { id: 'none', label: 'None', ...same(ID) },
  { id: 'teal-orange', label: 'Teal & orange', saturate: 1.1, r: [0, 0.22, 0.52, 0.82, 1], g: [0.04, 0.26, 0.5, 0.76, 0.96], b: [0.12, 0.34, 0.52, 0.7, 0.86] },
  { id: 'cinematic', label: 'Cinematic', saturate: 0.85, r: [0.02, 0.18, 0.5, 0.84, 0.98], g: [0.02, 0.18, 0.5, 0.84, 0.98], b: [0.06, 0.22, 0.52, 0.82, 0.96] },
  { id: 'vintage', label: 'Vintage', saturate: 0.8, r: [0.12, 0.35, 0.6, 0.85, 0.95], g: [0.1, 0.32, 0.55, 0.78, 0.9], b: [0.15, 0.3, 0.45, 0.62, 0.75] },
  { id: 'moody', label: 'Moody', saturate: 0.7, r: [0, 0.15, 0.4, 0.7, 0.9], g: [0, 0.17, 0.42, 0.72, 0.92], b: [0.05, 0.22, 0.48, 0.76, 0.95] },
  { id: 'warm-film', label: 'Warm film', saturate: 1.05, r: [0.06, 0.3, 0.6, 0.88, 1], g: [0.04, 0.26, 0.53, 0.8, 0.95], b: [0.02, 0.2, 0.43, 0.68, 0.84] },
  { id: 'cold', label: 'Cold', r: [0, 0.2, 0.45, 0.75, 0.92], g: [0.02, 0.24, 0.5, 0.8, 0.97], b: [0.08, 0.32, 0.6, 0.88, 1] },
  { id: 'golden-hour', label: 'Golden hour', saturate: 1.15, r: [0.08, 0.34, 0.64, 0.9, 1], g: [0.04, 0.28, 0.55, 0.8, 0.94], b: [0, 0.16, 0.36, 0.6, 0.76] },
  { id: 'cyberpunk', label: 'Cyberpunk', saturate: 1.25, r: [0.1, 0.35, 0.6, 0.85, 1], g: [0, 0.18, 0.4, 0.66, 0.85], b: [0.2, 0.45, 0.7, 0.92, 1] },
  { id: 'bleach', label: 'Bleach bypass', saturate: 0.4, ...same([0, 0.12, 0.5, 0.9, 1]) },
  { id: 'noir', label: 'Noir', saturate: 0, ...same([0, 0.08, 0.5, 0.92, 1]) },
  { id: 'faded', label: 'Faded', saturate: 0.8, ...same([0.15, 0.32, 0.52, 0.74, 0.9]) },
];

const lookById = (id: LookId) => LOOKS.find((l) => l.id === id) ?? LOOKS[0];

/** Unit direction (-1..1 per channel, summing to ~0) for a hue on the wheel. */
export function hueDirection(hue: number): [number, number, number] {
  const h = (hue * Math.PI) / 180;
  return [Math.cos(h), Math.cos(h - (2 * Math.PI) / 3), Math.cos(h - (4 * Math.PI) / 3)];
}

/** Per-channel amplitude / exponent / offset (C' = amplitude · C^exponent + offset). */
export function wheelParams(g: ColorGrade): { amplitude: number; exponent: number; offset: number }[] {
  const s = hueDirection(g.shadows.hue);
  const m = hueDirection(g.midtones.hue);
  const h = hueDirection(g.highlights.hue);
  return [0, 1, 2].map((i) => {
    const offset = 0.12 * g.shadows.amount * s[i] + 0.1 * g.shadows.luma;
    const mid = 1 + 0.45 * g.midtones.amount * m[i] + 0.5 * g.midtones.luma;
    const exponent = Math.max(0.25, Math.min(4, 1 / Math.max(0.05, mid)));
    const amplitude = Math.max(0, 1 + 0.35 * g.highlights.amount * h[i] + 0.45 * g.highlights.luma - offset);
    return { amplitude, exponent, offset };
  });
}

const r4 = (v: number) => Math.round(v * 10000) / 10000;

export function isNeutral(g: ColorGrade | undefined): boolean {
  if (!g) return true;
  const w = (x: Wheel) => x.amount === 0 && x.luma === 0;
  return w(g.shadows) && w(g.midtones) && w(g.highlights) && (g.look === 'none' || g.lookAmount === 0);
}

/** The look's tables blended with "no change" by `amount`. */
export function lookTables(id: LookId, amount: number): { r: number[]; g: number[]; b: number[]; saturate: number } {
  const look = lookById(id);
  const a = Math.max(0, Math.min(1, amount));
  const mixT = (t: Table) => t.map((v, i) => r4(ID[i] + (v - ID[i]) * a));
  return { r: mixT(look.r), g: mixT(look.g), b: mixT(look.b), saturate: r4(1 + ((look.saturate ?? 1) - 1) * a) };
}

/** Short stable id for a grade, so identical grades share one SVG filter. */
export function gradeId(g: ColorGrade): string {
  const s = JSON.stringify([g.shadows, g.midtones, g.highlights, g.look, g.lookAmount]);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return `bem-grade-${(h >>> 0).toString(36)}`;
}

/** SVG <filter> markup for a grade. */
export function gradeFilterMarkup(g: ColorGrade): string {
  const parts: string[] = [];
  if (g.look !== 'none' && g.lookAmount > 0) {
    const t = lookTables(g.look, g.lookAmount);
    if (t.saturate !== 1) parts.push(`<feColorMatrix type="saturate" values="${t.saturate}"/>`);
    parts.push(
      `<feComponentTransfer><feFuncR type="table" tableValues="${t.r.join(' ')}"/><feFuncG type="table" tableValues="${t.g.join(' ')}"/><feFuncB type="table" tableValues="${t.b.join(' ')}"/></feComponentTransfer>`,
    );
  }
  const w = wheelParams(g);
  if (w.some((c) => c.amplitude !== 1 || c.exponent !== 1 || c.offset !== 0)) {
    const fn = (tag: string, c: (typeof w)[number]) =>
      `<${tag} type="gamma" amplitude="${r4(c.amplitude)}" exponent="${r4(c.exponent)}" offset="${r4(c.offset)}"/>`;
    parts.push(`<feComponentTransfer>${fn('feFuncR', w[0])}${fn('feFuncG', w[1])}${fn('feFuncB', w[2])}</feComponentTransfer>`);
  }
  return `<filter id="${gradeId(g)}" color-interpolation-filters="sRGB">${parts.join('')}</filter>`;
}

/** CSS colour preview of a wheel (for the swatch in the middle of the wheel control). */
export function wheelColor(w: Wheel): string {
  const [r, g, b] = hueDirection(w.hue);
  const c = (v: number) => Math.round(Math.max(0, Math.min(255, 128 + v * 127 * w.amount + w.luma * 100)));
  return `rgb(${c(r)}, ${c(g)}, ${c(b)})`;
}
