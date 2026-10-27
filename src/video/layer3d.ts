/**
 * After Effects-style 3D layers: a flat layer turned around its horizontal (X) and
 * vertical (Y) axes, seen through a camera, so it tilts away with perspective. The
 * result is the four corners on screen, drawn with the corner-pin renderer.
 */
import type { Quad } from './cornerPin';

/**
 * Screen corners (top-left, top-right, bottom-right, bottom-left) of a w×h layer
 * centred on (cx, cy), turned rotX / rotY degrees in 3D and `rotation` degrees in its
 * own plane, seen from a camera `depth` pixels away (bigger = flatter perspective).
 */
export function layerQuad(cx: number, cy: number, w: number, h: number, rotX: number, rotY: number, rotation: number, depth: number): Quad {
  const ax = (rotX * Math.PI) / 180;
  const ay = (rotY * Math.PI) / 180;
  const az = (rotation * Math.PI) / 180;
  const corners: [number, number][] = [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ];
  return corners.map(([x0, y0]) => {
    // In-plane rotation first, then tilt around X, then turn around Y.
    let x = x0 * Math.cos(az) - y0 * Math.sin(az);
    let y = x0 * Math.sin(az) + y0 * Math.cos(az);
    // Positive tilt sends the top edge away from the camera.
    let z = -y * Math.sin(ax);
    y = y * Math.cos(ax);
    const x1 = x * Math.cos(ay) + z * Math.sin(ay);
    z = -x * Math.sin(ay) + z * Math.cos(ay);
    x = x1;
    const k = depth / Math.max(1, depth + z);
    return [cx + x * k, cy + y * k];
  }) as Quad;
}

/** Ready-made 3D moves (keyframes for rotX / rotY over `len` seconds). */
export const MOVES_3D = ['Card flip', 'Swing in', 'Tilt back', 'Spin around'] as const;
export type Move3D = (typeof MOVES_3D)[number];

export function move3d(move: Move3D, len: number): { rotX?: { t: number; v: number; ease?: 'smooth' | 'ease-out' | 'linear' }[]; rotY?: { t: number; v: number; ease?: 'smooth' | 'ease-out' | 'linear' }[] } {
  const d = Math.min(1.2, Math.max(0.3, len / 2));
  switch (move) {
    case 'Card flip':
      return { rotY: [{ t: 0, v: 0, ease: 'smooth' }, { t: d, v: 180 }] };
    case 'Swing in':
      return { rotY: [{ t: 0, v: -80, ease: 'ease-out' }, { t: d, v: 0 }] };
    case 'Tilt back':
      return { rotX: [{ t: 0, v: 0, ease: 'smooth' }, { t: d, v: 35 }] };
    case 'Spin around':
      return { rotY: [{ t: 0, v: 0, ease: 'linear' }, { t: len, v: 360 }] };
  }
}
