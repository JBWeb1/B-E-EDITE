/**
 * Where clips and layers sit on the frame (position, size, angle, crop) at a
 * moment in time. Pure, so the engine, the editor's click-to-select and the
 * tests all agree.
 */
import { transformAt } from './anim';
import { motionTransform } from './timeline';
import type { BlendMode, Clip, Crop, MaskShape, MediaAsset, OverlayClip } from './types';

export const NO_CROP: Crop = { left: 0, top: 0, right: 0, bottom: 0 };

export interface LayerFrame {
  /** Centre in project pixels. */
  cx: number;
  cy: number;
  /** Drawn size in project pixels (before rotation). */
  w: number;
  h: number;
  /** Degrees. */
  rotation: number;
  opacity: number;
}

/** Part of the source to draw, in source pixels, after cropping. */
export function cropRect(sw: number, sh: number, crop: Crop | null | undefined) {
  const c = crop ?? NO_CROP;
  const l = Math.max(0, Math.min(0.45, c.left));
  const r = Math.max(0, Math.min(0.45, c.right));
  const t = Math.max(0, Math.min(0.45, c.top));
  const b = Math.max(0, Math.min(0.45, c.bottom));
  return { sx: sw * l, sy: sh * t, sw: sw * (1 - l - r), sh: sh * (1 - t - b) };
}

const seedOf = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h % 997) + 1;
};

/** A main-track clip at `local` seconds into it (`progress` 0..1 drives its slow zoom/pan motion). */
export function clipFrame(clip: Clip, asset: Pick<MediaAsset, 'width' | 'height'>, W: number, H: number, local: number, progress: number): LayerFrame {
  const src = cropRect(asset.width ?? W, asset.height ?? H, clip.crop);
  const fit = Math.min(W / src.sw, H / src.sh);
  const tr = transformAt(clip, local, seedOf(clip.id));
  const m = motionTransform(clip.motion, progress);
  return {
    cx: tr.x * W + m.dx * W,
    cy: tr.y * H,
    w: src.sw * fit * tr.scale * m.scale,
    h: src.sh * fit * tr.scale * m.scale,
    rotation: tr.rotation,
    opacity: tr.opacity,
  };
}

/** A layer on video track 2+ at `local` seconds into it. `scale` is its width as a fraction of the frame. */
export function overlayFrame(o: OverlayClip, asset: Pick<MediaAsset, 'width' | 'height'>, W: number, H: number, local: number): LayerFrame {
  const src = cropRect(asset.width ?? 16, asset.height ?? 9, o.crop);
  const tr = transformAt({ ...o }, local, seedOf(o.id), { x: o.x, y: o.y, scale: o.scale, opacity: o.opacity });
  const w = tr.scale * W;
  return { cx: tr.x * W, cy: tr.y * H, w, h: (w * src.sh) / src.sw, rotation: tr.rotation, opacity: tr.opacity };
}

/** Is project point (px, py) inside a (possibly rotated) layer? */
export function hitFrame(f: LayerFrame, px: number, py: number, pad = 0): boolean {
  const a = (-f.rotation * Math.PI) / 180;
  const dx = px - f.cx;
  const dy = py - f.cy;
  const x = dx * Math.cos(a) - dy * Math.sin(a);
  const y = dx * Math.sin(a) + dy * Math.cos(a);
  return Math.abs(x) <= f.w / 2 + pad && Math.abs(y) <= f.h / 2 + pad;
}

/** Canvas compositing operation for a blend mode. */
export function blendOp(mode: BlendMode | undefined): GlobalCompositeOperation {
  switch (mode) {
    case 'add':
      return 'lighter';
    case 'screen':
    case 'multiply':
    case 'overlay':
    case 'lighten':
    case 'darken':
    case 'difference':
    case 'soft-light':
    case 'color-dodge':
      return mode;
    default:
      return 'source-over';
  }
}

export const BLEND_MODES: { value: BlendMode; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'screen', label: 'Screen (lighten)' },
  { value: 'multiply', label: 'Multiply (darken)' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'soft-light', label: 'Soft light' },
  { value: 'add', label: 'Add (glow)' },
  { value: 'lighten', label: 'Lighten' },
  { value: 'darken', label: 'Darken' },
  { value: 'difference', label: 'Difference' },
  { value: 'color-dodge', label: 'Colour dodge' },
];

export const MASK_SHAPES: { value: MaskShape; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'ellipse', label: 'Circle' },
  { value: 'rect', label: 'Rectangle' },
  { value: 'heart', label: 'Heart' },
  { value: 'star', label: 'Star' },
  { value: 'diamond', label: 'Diamond' },
];

/** Times to draw a moving layer at for motion blur (a 180° shutter at `fps`). */
export function blurSamples(local: number, fps: number, n = 6): number[] {
  const shutter = 0.5 / Math.max(1, fps);
  return Array.from({ length: n }, (_, i) => local - (shutter * i) / Math.max(1, n - 1));
}
