/**
 * Keyframe animation for design elements. Keys use the same format as video layers
 * (centre position as fractions of the page, size multiplier, angle, opacity), so the
 * video editor's keyframe controls and one-click animations work here too.
 */
import { transformAt } from '../video/anim';
import type { Keyframes } from '../video/anim';
import type { DesignElement } from './types';

export const hasMotion = (el: DesignElement) => Object.values(el.keys ?? {}).some((l) => (l?.length ?? 0) > 0);

/** The element's resting transform, as fractions of the page (the keyframe "base"). */
export function motionBase(el: DesignElement, page: { width: number; height: number }) {
  return { x: (el.x + el.width / 2) / page.width, y: (el.y + el.height / 2) / page.height, scale: 1, rotation: el.rotation, opacity: el.opacity };
}

/** How the element looks `t` seconds after its page appears. */
export function elementAtTime(el: DesignElement, t: number, page: { width: number; height: number }): DesignElement {
  if (!hasMotion(el) && !el.wiggle) return el;
  const base = motionBase(el, page);
  const tr = transformAt({ ...base, keys: el.keys, wiggle: el.wiggle }, t, el.id.length + 3);
  const width = el.width * tr.scale;
  const height = el.height * tr.scale;
  const next = { ...el, x: tr.x * page.width - width / 2, y: tr.y * page.height - height / 2, width, height, rotation: tr.rotation, opacity: tr.opacity };
  if (next.type === 'text' && el.type === 'text') next.fontSize = el.fontSize * tr.scale;
  return next as DesignElement;
}

/** Seconds until the last keyframe on the page. */
export function motionLength(elements: DesignElement[]): number {
  let end = 0;
  for (const el of elements) for (const list of Object.values(el.keys ?? {})) for (const k of list ?? []) end = Math.max(end, k.t);
  return end;
}

/** Keyframes moved by (dx, dy) fractions of the page (dragging an animated element). */
export function shiftKeys(keys: Keyframes | undefined, dx: number, dy: number): Keyframes | undefined {
  if (!keys || (!keys.x?.length && !keys.y?.length)) return keys;
  return {
    ...keys,
    x: keys.x?.map((k) => ({ ...k, v: k.v + dx })),
    y: keys.y?.map((k) => ({ ...k, v: k.v + dy })),
  };
}
