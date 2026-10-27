/**
 * Particle overlays (confetti, snow, sparkles, hearts, dust, bubbles).
 * Every particle's position is worked out from time alone, so scrubbing and
 * exporting always show exactly the same frame.
 */

export type ParticleKind = 'confetti' | 'snow' | 'sparkles' | 'hearts' | 'dust' | 'bubbles';

export interface Particle {
  /** Centre, 0..1 of the frame. */
  x: number;
  y: number;
  /** Fraction of the frame height. */
  size: number;
  /** Radians. */
  rot: number;
  color: string;
  alpha: number;
  shape: 'rect' | 'circle' | 'star' | 'heart' | 'ring';
}

const CONFETTI = ['#f43f5e', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#facc15'];
const HEARTS = ['#f43f5e', '#ec4899', '#fb7185', '#e11d48'];
const BASE_COUNT: Record<ParticleKind, number> = { confetti: 90, snow: 120, sparkles: 45, hearts: 26, dust: 70, bubbles: 30 };

/** Deterministic 0..1 random number for particle `i`, value `k`. */
export function hash01(i: number, k: number): number {
  let h = Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(k + 7, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

const frac = (v: number) => v - Math.floor(v);

/** Particles visible `t` seconds into the effect. */
export function particlesAt(kind: ParticleKind, t: number, intensity = 0.7, speed = 1): Particle[] {
  const n = Math.round(BASE_COUNT[kind] * Math.max(0.1, Math.min(1, intensity)) * 1.4);
  const s = Math.max(0.1, speed);
  const out: Particle[] = [];
  for (let i = 0; i < n; i++) {
    const r = (k: number) => hash01(i, k);
    switch (kind) {
      case 'confetti': {
        const period = 2.5 + r(1) * 2.5;
        const p = frac((t * s) / period + r(2));
        out.push({
          x: r(3) + 0.05 * Math.sin(t * s * (1 + r(4) * 2) + i),
          y: -0.05 + p * 1.1,
          size: 0.012 + r(5) * 0.012,
          rot: t * s * (2 + r(6) * 6) + r(7) * 6,
          color: CONFETTI[Math.floor(r(8) * CONFETTI.length)],
          alpha: 1,
          shape: 'rect',
        });
        break;
      }
      case 'snow': {
        const period = 6 + r(1) * 6;
        const p = frac((t * s) / period + r(2));
        out.push({
          x: r(3) + 0.03 * Math.sin(t * s * (0.6 + r(4)) + i),
          y: -0.03 + p * 1.06,
          size: 0.004 + r(5) * 0.008,
          rot: 0,
          color: '#ffffff',
          alpha: 0.55 + r(6) * 0.4,
          shape: 'circle',
        });
        break;
      }
      case 'sparkles': {
        const period = 1.2 + r(1) * 1.8;
        const p = frac((t * s) / period + r(2));
        // Each twinkle appears somewhere new.
        const cycle = Math.floor((t * s) / period + r(2));
        out.push({
          x: hash01(i, 50 + cycle),
          y: hash01(i, 90 + cycle),
          size: 0.015 + r(5) * 0.02,
          rot: p * 1.5,
          color: r(6) > 0.5 ? '#fde68a' : '#ffffff',
          alpha: Math.sin(p * Math.PI) ** 3,
          shape: 'star',
        });
        break;
      }
      case 'hearts': {
        const period = 3.5 + r(1) * 3;
        const p = frac((t * s) / period + r(2));
        out.push({
          x: r(3) + 0.06 * Math.sin(t * s * (1 + r(4)) + i),
          y: 1.05 - p * 1.15,
          size: 0.025 + r(5) * 0.03,
          rot: 0.3 * Math.sin(t * s * 2 + i),
          color: HEARTS[Math.floor(r(8) * HEARTS.length)],
          alpha: Math.min(1, (1 - p) * 3),
          shape: 'heart',
        });
        break;
      }
      case 'dust': {
        const period = 10 + r(1) * 10;
        const p = frac((t * s) / period + r(2));
        out.push({
          x: frac(r(3) + p * (r(4) - 0.5) * 0.4),
          y: frac(r(5) + p * (r(6) - 0.5) * 0.4),
          size: 0.002 + r(7) * 0.004,
          rot: 0,
          color: '#fff7e0',
          alpha: (0.25 + r(8) * 0.4) * Math.sin(p * Math.PI),
          shape: 'circle',
        });
        break;
      }
      case 'bubbles': {
        const period = 4 + r(1) * 4;
        const p = frac((t * s) / period + r(2));
        out.push({
          x: r(3) + 0.04 * Math.sin(t * s * (1.5 + r(4)) + i),
          y: 1.05 - p * 1.12,
          size: 0.015 + r(5) * 0.035,
          rot: 0,
          color: '#bae6fd',
          alpha: 0.7 * Math.min(1, (1 - p) * 4),
          shape: 'ring',
        });
        break;
      }
    }
  }
  return out;
}

/** Draw particles onto a canvas of size W×H. */
export function drawParticles(ctx: CanvasRenderingContext2D, list: Particle[], W: number, H: number) {
  ctx.save();
  for (const p of list) {
    if (p.alpha <= 0.01) continue;
    const s = p.size * H;
    ctx.globalAlpha = p.alpha;
    ctx.fillStyle = p.color;
    ctx.strokeStyle = p.color;
    ctx.save();
    ctx.translate(p.x * W, p.y * H);
    ctx.rotate(p.rot);
    switch (p.shape) {
      case 'rect':
        // Confetti flips as it falls: squash it with the rotation.
        ctx.scale(1, Math.abs(Math.cos(p.rot * 1.3)) * 0.8 + 0.2);
        ctx.fillRect(-s / 2, -s / 4, s, s / 2);
        break;
      case 'circle':
        ctx.beginPath();
        ctx.arc(0, 0, s / 2, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'ring':
        ctx.lineWidth = Math.max(1, s * 0.08);
        ctx.beginPath();
        ctx.arc(0, 0, s / 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = p.alpha * 0.6;
        ctx.beginPath();
        ctx.arc(-s * 0.15, -s * 0.15, s * 0.08, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'star':
        starPath(ctx, s / 2, 4, 0.25);
        ctx.shadowColor = p.color;
        ctx.shadowBlur = s;
        ctx.fill();
        break;
      case 'heart':
        heartPath(ctx, s);
        ctx.fill();
        break;
    }
    ctx.restore();
  }
  ctx.restore();
}

/** Star outline centred on 0,0 with radius r. */
export function starPath(ctx: CanvasRenderingContext2D, r: number, points = 5, inner = 0.45) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = (i * Math.PI) / points - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * inner;
    ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath();
}

/** Heart outline centred on 0,0, `s` wide. */
export function heartPath(ctx: CanvasRenderingContext2D, s: number) {
  const h = s / 2;
  ctx.beginPath();
  ctx.moveTo(0, h * 0.7);
  ctx.bezierCurveTo(-h * 1.2, -h * 0.1, -h * 0.6, -h * 1.05, 0, -h * 0.45);
  ctx.bezierCurveTo(h * 0.6, -h * 1.05, h * 1.2, -h * 0.1, 0, h * 0.7);
  ctx.closePath();
}
