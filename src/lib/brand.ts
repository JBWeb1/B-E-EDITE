/**
 * Brand kit: your colours, heading and body fonts and logos, kept in this browser
 * and offered in both editors (swatches, fonts, one-click logos, "apply brand").
 */
import { useEffect, useState } from 'react';

export interface BrandKit {
  name: string;
  colors: string[];
  /** Font-family values. */
  heading?: string;
  body?: string;
  /** Logo pictures as data URLs. */
  logos: string[];
}

const KEY = 'bee.brand';
export const EMPTY_BRAND: BrandKit = { name: 'My brand', colors: [], logos: [] };

export function loadBrand(): BrandKit {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return raw ? { ...EMPTY_BRAND, ...raw, colors: Array.isArray(raw.colors) ? raw.colors : [], logos: Array.isArray(raw.logos) ? raw.logos : [] } : EMPTY_BRAND;
  } catch {
    return EMPTY_BRAND;
  }
}

export function saveBrand(b: BrandKit) {
  try {
    localStorage.setItem(KEY, JSON.stringify(b));
  } catch {
    alert('The brand kit is too big to save in this browser. Try smaller logos.');
  }
  window.dispatchEvent(new Event('bee-brand'));
}

export const isEmptyBrand = (b: BrandKit) => !b.colors.length && !b.logos.length && !b.heading && !b.body;

/** Add colours (no repeats, newest first, at most 16). */
export function addColors(b: BrandKit, colors: string[]): BrandKit {
  const norm = (c: string) => c.trim().toLowerCase();
  const list = [...colors.map(norm), ...b.colors.map(norm)].filter((c) => /^#[0-9a-f]{6}$/.test(c));
  return { ...b, colors: [...new Set(list)].slice(0, 16) };
}

/** The brand kit, kept in sync across editors and tabs. */
export function useBrand(): [BrandKit, (b: BrandKit) => void] {
  const [brand, setBrand] = useState(loadBrand);
  useEffect(() => {
    const sync = () => setBrand(loadBrand());
    window.addEventListener('bee-brand', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('bee-brand', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return [brand, (b) => (saveBrand(b), setBrand(b))];
}

/**
 * Which font each text gets when the brand is applied: big or bold text is a
 * heading, the rest is body text.
 */
export function brandFontFor(el: { fontSize: number; fontWeight: string }, sizes: number[], b: BrandKit): string | undefined {
  const sorted = [...sizes].sort((x, y) => x - y);
  const median = sorted[Math.floor(sorted.length / 2)] ?? el.fontSize;
  const heading = el.fontWeight === 'bold' || el.fontSize >= median * 1.3 || sizes.length === 1;
  return heading ? b.heading ?? b.body : b.body ?? b.heading;
}
