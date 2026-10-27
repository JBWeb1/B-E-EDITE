/**
 * Google Fonts picker data and loading. Fonts load on demand from Google's font
 * service (a small preview of just the name first, the full font when picked) and
 * are remembered in the design or video by family name, so they load again on open.
 */

export interface WebFont {
  family: string;
  category: 'Sans' | 'Serif' | 'Display' | 'Handwriting' | 'Mono';
  /** Weights the font has (normal and/or bold). */
  bold: boolean;
}

const f = (family: string, category: WebFont['category'], bold = true): WebFont => ({ family, category, bold });

export const WEB_FONTS: WebFont[] = [
  f('Inter', 'Sans'), f('Poppins', 'Sans'), f('Montserrat', 'Sans'), f('Roboto', 'Sans'), f('Open Sans', 'Sans'), f('Lato', 'Sans'),
  f('Raleway', 'Sans'), f('Nunito', 'Sans'), f('Work Sans', 'Sans'), f('DM Sans', 'Sans'), f('Rubik', 'Sans'), f('Manrope', 'Sans'),
  f('Outfit', 'Sans'), f('Space Grotesk', 'Sans'), f('Barlow', 'Sans'), f('Quicksand', 'Sans'),
  f('Playfair Display', 'Serif'), f('Merriweather', 'Serif'), f('Lora', 'Serif'), f('DM Serif Display', 'Serif', false), f('Cormorant Garamond', 'Serif'),
  f('Libre Baskerville', 'Serif'), f('Crimson Pro', 'Serif'), f('EB Garamond', 'Serif'), f('Bitter', 'Serif'),
  f('Bebas Neue', 'Display', false), f('Anton', 'Display', false), f('Oswald', 'Display'), f('Archivo Black', 'Display', false), f('Abril Fatface', 'Display', false),
  f('Bungee', 'Display', false), f('Righteous', 'Display', false), f('Lobster', 'Display', false), f('Alfa Slab One', 'Display', false), f('Russo One', 'Display', false),
  f('Bangers', 'Display', false), f('Fredoka', 'Display'), f('Luckiest Guy', 'Display', false), f('Monoton', 'Display', false), f('Press Start 2P', 'Display', false),
  f('Pacifico', 'Handwriting', false), f('Dancing Script', 'Handwriting'), f('Caveat', 'Handwriting'), f('Satisfy', 'Handwriting', false), f('Great Vibes', 'Handwriting', false),
  f('Permanent Marker', 'Handwriting', false), f('Amatic SC', 'Handwriting'), f('Shadows Into Light', 'Handwriting', false), f('Kalam', 'Handwriting'), f('Sacramento', 'Handwriting', false),
  f('Space Mono', 'Mono'), f('JetBrains Mono', 'Mono'), f('Fira Code', 'Mono'), f('IBM Plex Mono', 'Mono'),
];

/** The CSS font-family value stored on text. */
export const fontStack = (family: string) => {
  const font = WEB_FONTS.find((x) => x.family === family);
  const fallback = font?.category === 'Serif' ? 'serif' : font?.category === 'Mono' ? 'monospace' : font?.category === 'Handwriting' ? 'cursive' : 'sans-serif';
  return `"${family}", ${fallback}`;
};

/** The Google font named first in a font-family value, if it is one we offer. */
export function webFontIn(stack: string): WebFont | undefined {
  const first = stack.split(',')[0].trim().replace(/^["']|["']$/g, '');
  return WEB_FONTS.find((x) => x.family === first);
}

/** Address of the stylesheet for a font (`text` limits it to those letters, for previews). */
export function fontCssUrl(font: WebFont, text?: string): string {
  const name = font.family.replace(/ /g, '+');
  const styles = font.bold ? ':wght@400;700' : '';
  return `https://fonts.googleapis.com/css2?family=${name}${styles}&display=swap${text ? `&text=${encodeURIComponent(text)}` : ''}`;
}

const added = new Set<string>();
function addSheet(href: string) {
  if (added.has(href) || typeof document === 'undefined') return;
  added.add(href);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.dataset.webfont = '1';
  document.head.appendChild(link);
}

/** Just enough of the font to show its name in the picker. */
export const previewFont = (font: WebFont) => addSheet(fontCssUrl(font, font.family));

/** Load a font fully (resolves when it can be drawn, or after a few seconds offline). */
export async function loadWebFont(stack: string): Promise<void> {
  const font = webFontIn(stack);
  if (!font || typeof document === 'undefined') return;
  addSheet(fontCssUrl(font));
  const wait = Promise.all([document.fonts.load(`400 32px "${font.family}"`), font.bold ? document.fonts.load(`700 32px "${font.family}"`) : null]);
  await Promise.race([wait, new Promise((r) => setTimeout(r, 5000))]).catch(() => {});
}

/** Load every Google font used by some text (after opening a project). */
export async function loadWebFonts(stacks: string[]): Promise<void> {
  await Promise.all([...new Set(stacks)].filter((s) => webFontIn(s)).map(loadWebFont));
}
