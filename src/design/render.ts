import { center, wrapText } from './model';
import type { DesignDoc, DesignElement, ShapeElement, TextElement } from './types';

/** Cache of decoded images keyed by src. Calls `onLoad` when a new image finishes loading. */
export class ImageCache {
  private images = new Map<string, HTMLImageElement>();
  constructor(private onLoad: () => void) {}

  get(src: string): HTMLImageElement | null {
    let img = this.images.get(src);
    if (!img) {
      img = new Image();
      img.onload = () => this.onLoad();
      img.src = src;
      this.images.set(src, img);
    }
    return img.complete && img.naturalWidth > 0 ? img : null;
  }

  /** Resolve once every src has loaded (or failed). */
  preload(srcs: string[]): Promise<void> {
    return Promise.all(
      srcs.map((src) => {
        this.get(src);
        const img = this.images.get(src)!;
        if (img.complete) return Promise.resolve();
        return new Promise<void>((resolve) => {
          img.addEventListener('load', () => resolve(), { once: true });
          img.addEventListener('error', () => resolve(), { once: true });
        });
      }),
    ).then(() => undefined);
  }
}

export function textFont(el: TextElement): string {
  return `${el.italic ? 'italic ' : ''}${el.fontWeight} ${el.fontSize}px ${el.fontFamily}`;
}

/** Lines of a text element as drawn, using the context for measurement. */
export function textLines(ctx: CanvasRenderingContext2D, el: TextElement): string[] {
  ctx.font = textFont(el);
  return wrapText(el.text, el.width, (s) => ctx.measureText(s).width);
}

/** Height a text element needs to show all of its lines. */
export function measureTextHeight(ctx: CanvasRenderingContext2D, el: TextElement): number {
  return Math.ceil(textLines(ctx, el).length * el.fontSize * el.lineHeight);
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function shapePath(ctx: CanvasRenderingContext2D, el: ShapeElement) {
  const { x, y, width: w, height: h } = el;
  ctx.beginPath();
  switch (el.shape) {
    case 'rect':
      roundedRect(ctx, x, y, w, h, el.radius);
      break;
    case 'ellipse':
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      break;
    case 'triangle':
      ctx.moveTo(x + w / 2, y);
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x, y + h);
      ctx.closePath();
      break;
    case 'star': {
      const cx = x + w / 2;
      const cy = y + h / 2;
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? 1 : 0.4;
        const a = (Math.PI / 5) * i - Math.PI / 2;
        const px = cx + Math.cos(a) * (w / 2) * r;
        const py = cy + Math.sin(a) * (h / 2) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }
    case 'line':
      ctx.moveTo(x, y + h / 2);
      ctx.lineTo(x + w, y + h / 2);
      break;
  }
}

function drawElement(ctx: CanvasRenderingContext2D, el: DesignElement, images: ImageCache) {
  ctx.save();
  ctx.globalAlpha = el.opacity;
  const c = center(el);
  ctx.translate(c.x, c.y);
  ctx.rotate((el.rotation * Math.PI) / 180);
  ctx.translate(-c.x, -c.y);

  if (el.type === 'shape') {
    shapePath(ctx, el);
    if (el.shape !== 'line') {
      ctx.fillStyle = el.fill;
      ctx.fill();
    }
    if (el.strokeWidth > 0) {
      ctx.strokeStyle = el.stroke;
      ctx.lineWidth = el.strokeWidth;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
  } else if (el.type === 'image') {
    const img = images.get(el.src);
    if (img) {
      roundedRect(ctx, el.x, el.y, el.width, el.height, el.radius);
      ctx.clip();
      ctx.drawImage(img, el.x, el.y, el.width, el.height);
    }
  } else {
    const lines = textLines(ctx, el);
    ctx.fillStyle = el.color;
    ctx.textBaseline = 'top';
    ctx.textAlign = el.align;
    const lh = el.fontSize * el.lineHeight;
    const tx = el.align === 'left' ? el.x : el.align === 'right' ? el.x + el.width : el.x + el.width / 2;
    const padTop = (lh - el.fontSize) / 2;
    lines.forEach((line, i) => ctx.fillText(line, tx, el.y + padTop + i * lh));
  }
  ctx.restore();
}

/** Draw the whole design (no editor overlays) in doc coordinates. */
export function renderDesign(ctx: CanvasRenderingContext2D, doc: DesignDoc, images: ImageCache, skipId?: string) {
  ctx.fillStyle = doc.background;
  ctx.fillRect(0, 0, doc.width, doc.height);
  for (const el of doc.elements) {
    if (el.id !== skipId) drawElement(ctx, el, images);
  }
}

/** Render the design to an image blob at the given scale. Waits for images to decode. */
export async function exportDesign(doc: DesignDoc, type: 'image/png' | 'image/jpeg', scale = 1): Promise<Blob> {
  const cache = new ImageCache(() => {});
  await cache.preload(doc.elements.flatMap((e) => (e.type === 'image' ? [e.src] : [])));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(doc.width * scale);
  canvas.height = Math.round(doc.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  renderDesign(ctx, doc, cache);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Export failed'))), type, 0.92),
  );
}
