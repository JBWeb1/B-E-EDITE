/** Color adjustments shared by design images and video clips. */
export interface Filters {
  brightness: number; // 1 = unchanged
  contrast: number;
  saturation: number;
  blur: number; // px
  grayscale: number; // 0..1
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

export function cssFilter(f: Filters | undefined): string {
  if (!f) return 'none';
  const parts = [
    f.brightness !== 1 && `brightness(${f.brightness})`,
    f.contrast !== 1 && `contrast(${f.contrast})`,
    f.saturation !== 1 && `saturate(${f.saturation})`,
    f.blur > 0 && `blur(${f.blur}px)`,
    f.grayscale > 0 && `grayscale(${f.grayscale})`,
  ].filter(Boolean);
  return parts.length ? parts.join(' ') : 'none';
}

export function sameFilters(a: Filters | undefined, b: Filters): boolean {
  const x = a ?? NEUTRAL_FILTERS;
  return (Object.keys(b) as (keyof Filters)[]).every((k) => Math.abs(x[k] - b[k]) < 1e-9);
}
