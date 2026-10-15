import type { DesignElement, DesignPage, ElementAnimation } from './types';

export const ANIMATIONS: { value: ElementAnimation; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'fade', label: 'Fade' },
  { value: 'rise', label: 'Rise' },
  { value: 'pop', label: 'Pop' },
  { value: 'slide', label: 'Slide in' },
  { value: 'wipe', label: 'Wipe' },
];

/** Seconds between one animated element starting and the next. */
export const STAGGER = 0.15;
/** Seconds each entrance takes. */
export const ENTRANCE = 0.6;

export interface AnimFrame {
  alpha: number;
  /** Offsets as fractions of the page width/height. */
  dx: number;
  dy: number;
  scale: number;
  /** 0..1 portion of the element revealed from the left (wipe). */
  reveal: number;
}

const IDENTITY: AnimFrame = { alpha: 1, dx: 0, dy: 0, scale: 1, reveal: 1 };

/** How an element looks `t` seconds after its page appears. `order` staggers elements. */
export function animationAt(anim: ElementAnimation | undefined, order: number, t: number): AnimFrame {
  if (!anim || anim === 'none') return IDENTITY;
  const p = Math.max(0, Math.min(1, (t - order * STAGGER) / ENTRANCE));
  const e = 1 - Math.pow(1 - p, 3);
  switch (anim) {
    case 'fade':
      return { ...IDENTITY, alpha: e };
    case 'rise':
      return { ...IDENTITY, alpha: e, dy: (1 - e) * 0.06 };
    case 'pop':
      return { ...IDENTITY, alpha: Math.min(1, p * 2), scale: 0.6 + 0.4 * e + Math.sin(p * Math.PI) * 0.08 };
    case 'slide':
      return { ...IDENTITY, alpha: e, dx: -(1 - e) * 0.08 };
    case 'wipe':
      return { ...IDENTITY, reveal: e };
  }
}

/** Stagger position of each element among the animated ones on its page (-1 if not animated). */
export function animationOrder(elements: DesignElement[]): number[] {
  let n = 0;
  return elements.map((e) => (e.animation && e.animation !== 'none' ? n++ : -1));
}

/** Seconds until every entrance on the page has finished. */
export function entranceLength(page: Pick<DesignPage, 'elements'>): number {
  const count = page.elements.filter((e) => e.animation && e.animation !== 'none').length;
  return count === 0 ? 0 : (count - 1) * STAGGER + ENTRANCE;
}

/** Give every element on a page the same entrance (or remove them all with 'none'). */
export function animateAll<T extends { elements: DesignElement[] }>(page: T, anim: ElementAnimation): T {
  return { ...page, elements: page.elements.map((e) => ({ ...e, animation: anim })) };
}
