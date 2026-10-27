/** Color adjustments shared by design images and video clips. */
export interface Filters {
  brightness: number; // 1 = unchanged
  contrast: number;
  saturation: number;
  blur: number; // px
  grayscale: number; // 0..1
  /** Warm vintage tone, 0..1 (Instagram-style looks). */
  sepia?: number;
  /** Colour shift around the wheel, in degrees (-180..180). */
  hue?: number;
}

export const NEUTRAL_FILTERS: Filters = { brightness: 1, contrast: 1, saturation: 1, blur: 0, grayscale: 0 };

export const FILTER_PRESETS: { label: string; filters: Filters }[] = [
  { label: 'Original', filters: NEUTRAL_FILTERS },
  { label: 'Vivid', filters: { ...NEUTRAL_FILTERS, contrast: 1.15, saturation: 1.5 } },
  { label: 'Warm', filters: { ...NEUTRAL_FILTERS, brightness: 1.05, saturation: 1.2, contrast: 1.05 } },
  { label: 'Mono', filters: { ...NEUTRAL_FILTERS, grayscale: 1, contrast: 1.1 } },
  { label: 'Fade', filters: { ...NEUTRAL_FILTERS, contrast: 0.8, saturation: 0.7, brightness: 1.1 } },
  { label: 'Dream', filters: { ...NEUTRAL_FILTERS, blur: 1.5, brightness: 1.1, saturation: 1.2 } },
];

const ig = (label: string, patch: Partial<Filters>) => ({ label, filters: { ...NEUTRAL_FILTERS, ...patch } });

/** Instagram-style filters (close matches made from the same building blocks Instagram's looks use). */
export const INSTAGRAM_FILTERS: { label: string; filters: Filters }[] = [
  ig('Clarendon', { contrast: 1.2, saturation: 1.35 }),
  ig('Gingham', { brightness: 1.05, hue: -10, contrast: 0.95, saturation: 0.9 }),
  ig('Juno', { contrast: 1.15, saturation: 1.35, brightness: 1.05, sepia: 0.08 }),
  ig('Lark', { brightness: 1.08, contrast: 0.9, saturation: 1.1 }),
  ig('Mayfair', { contrast: 1.1, saturation: 1.1, brightness: 1.05, sepia: 0.05 }),
  ig('Sierra', { contrast: 0.85, saturation: 1.2, brightness: 1.05, sepia: 0.15 }),
  ig('Valencia', { contrast: 1.08, brightness: 1.08, sepia: 0.08 }),
  ig('Walden', { brightness: 1.1, hue: -10, sepia: 0.3, saturation: 1.6 }),
  ig('Hudson', { brightness: 1.2, contrast: 0.9, saturation: 1.1, hue: -8 }),
  ig('Amaro', { hue: -10, contrast: 0.9, brightness: 1.1, saturation: 1.5 }),
  ig('Rise', { brightness: 1.05, sepia: 0.2, contrast: 0.9, saturation: 0.9 }),
  ig('X-Pro II', { sepia: 0.3, contrast: 1.2, saturation: 1.2 }),
  ig('Lo-Fi', { saturation: 1.1, contrast: 1.5 }),
  ig('Earlybird', { contrast: 0.9, sepia: 0.2, brightness: 1.05 }),
  ig('Nashville', { sepia: 0.2, contrast: 1.2, brightness: 1.05, saturation: 1.2 }),
  ig('Toaster', { contrast: 1.5, brightness: 0.9, sepia: 0.15 }),
  ig('Brannan', { sepia: 0.5, contrast: 1.4 }),
  ig('Kelvin', { sepia: 0.35, saturation: 1.6, brightness: 1.1, hue: -10 }),
  ig('Reyes', { sepia: 0.22, brightness: 1.1, contrast: 0.85, saturation: 0.75 }),
  ig('Aden', { hue: -20, contrast: 0.9, saturation: 0.85, brightness: 1.2 }),
  ig('Perpetua', { brightness: 1.05, saturation: 1.1, hue: 6 }),
  ig('Ludwig', { contrast: 1.05, saturation: 0.9, brightness: 1.05, sepia: 0.05 }),
  ig('Crema', { contrast: 0.9, saturation: 0.9, sepia: 0.15, brightness: 1.05 }),
  ig('Slumber', { saturation: 0.66, brightness: 1.05, sepia: 0.1 }),
  ig('Stinson', { contrast: 0.75, saturation: 0.85, brightness: 1.15 }),
  ig('Brooklyn', { contrast: 0.9, brightness: 1.1, hue: 5 }),
  ig('1977', { contrast: 1.1, brightness: 1.1, saturation: 1.3, hue: -15, sepia: 0.1 }),
  ig('Willow', { grayscale: 0.5, contrast: 0.95, brightness: 0.9 }),
  ig('Inkwell', { sepia: 0.3, contrast: 1.1, brightness: 1.1, grayscale: 1 }),
  ig('Moon', { grayscale: 1, contrast: 1.1, brightness: 1.1 }),
];

/** Every named filter (basic and Instagram), for looking one up by name. */
export const ALL_FILTERS = [...FILTER_PRESETS, ...INSTAGRAM_FILTERS];

/** A filter by name, ignoring case, spaces and dashes ("xpro ii", "X-Pro II", "lofi"). */
export function filterByName(name: string): { label: string; filters: Filters } | undefined {
  const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const k = key(name);
  return k ? ALL_FILTERS.find((x) => key(x.label) === k) : undefined;
}

export function cssFilter(f: Filters | undefined): string {
  if (!f) return 'none';
  const parts = [
    f.brightness !== 1 && `brightness(${f.brightness})`,
    f.contrast !== 1 && `contrast(${f.contrast})`,
    f.saturation !== 1 && `saturate(${f.saturation})`,
    f.blur > 0 && `blur(${f.blur}px)`,
    f.grayscale > 0 && `grayscale(${f.grayscale})`,
    (f.sepia ?? 0) > 0 && `sepia(${f.sepia})`,
    (f.hue ?? 0) !== 0 && `hue-rotate(${f.hue}deg)`,
  ].filter(Boolean);
  return parts.length ? parts.join(' ') : 'none';
}

export function sameFilters(a: Filters | undefined, b: Filters): boolean {
  const x = a ?? NEUTRAL_FILTERS;
  const keys = new Set([...Object.keys(x), ...Object.keys(b)]) as Set<keyof Filters>;
  return [...keys].every((k) => Math.abs((x[k] ?? 0) - (b[k] ?? 0)) < 1e-9);
}
