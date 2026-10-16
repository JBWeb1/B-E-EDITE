import { cssFilter } from '../lib/filters';
import { makePdf } from '../lib/pdf';
import { animationAt, animationOrder } from './animate';
import { elementAtTime } from './motion';
import { adjustedImage, isNeutralPhoto } from './photo';
import type { AnimFrame } from './animate';
import { center, cropRect, gradientLine, wrapText } from './model';
import { pageDuration, pageView } from './pages';
import type { DesignDoc, DesignElement, DesignFile, ShapeElement, TextElement } from './types';

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
  ctx.letterSpacing = `${el.letterSpacing ?? 0}px`;
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
    case 'diamond':
      ctx.moveTo(x + w / 2, y);
      ctx.lineTo(x + w, y + h / 2);
      ctx.lineTo(x + w / 2, y + h);
      ctx.lineTo(x, y + h / 2);
      ctx.closePath();
      break;
    case 'hexagon':
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i;
        const px = x + w / 2 + (Math.cos(a) * w) / 2;
        const py = y + h / 2 + (Math.sin(a) * h) / 2;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    case 'heart':
      ctx.moveTo(x + w / 2, y + h);
      ctx.bezierCurveTo(x - w * 0.1, y + h * 0.55, x + w * 0.05, y - h * 0.1, x + w / 2, y + h * 0.25);
      ctx.bezierCurveTo(x + w * 0.95, y - h * 0.1, x + w * 1.1, y + h * 0.55, x + w / 2, y + h);
      ctx.closePath();
      break;
    case 'arrow':
      ctx.moveTo(x, y + h * 0.3);
      ctx.lineTo(x + w * 0.6, y + h * 0.3);
      ctx.lineTo(x + w * 0.6, y);
      ctx.lineTo(x + w, y + h / 2);
      ctx.lineTo(x + w * 0.6, y + h);
      ctx.lineTo(x + w * 0.6, y + h * 0.7);
      ctx.lineTo(x, y + h * 0.7);
      ctx.closePath();
      break;
    case 'bubble': {
      const r = Math.min(w, h) * 0.18;
      const bh = h * 0.8;
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + bh, r);
      ctx.arcTo(x + w, y + bh, x, y + bh, r);
      ctx.lineTo(x + w * 0.38, y + bh);
      ctx.lineTo(x + w * 0.2, y + h);
      ctx.lineTo(x + w * 0.24, y + bh);
      ctx.arcTo(x, y + bh, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
      break;
    }
  }
}

function drawElement(ctx: CanvasRenderingContext2D, el: DesignElement, images: ImageCache, anim?: AnimFrame, page?: { width: number; height: number }) {
  if (anim && anim.alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = el.opacity * (anim?.alpha ?? 1);
  const c = center(el);
  if (anim && page) ctx.translate(anim.dx * page.width, anim.dy * page.height);
  ctx.translate(c.x, c.y);
  ctx.rotate((el.rotation * Math.PI) / 180);
  if (anim && anim.scale !== 1) ctx.scale(anim.scale, anim.scale);
  ctx.translate(-c.x, -c.y);
  if (anim && anim.reveal < 1) {
    ctx.beginPath();
    // Pad so strokes and shadows at the edges are not cut off once fully revealed.
    const pad = Math.max(el.width, el.height);
    ctx.rect(el.x - pad, el.y - pad, (el.width + pad * 2) * anim.reveal, el.height + pad * 2);
    ctx.clip();
  }

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
      if (el.flipX || el.flipY) {
        ctx.translate(c.x, c.y);
        ctx.scale(el.flipX ? -1 : 1, el.flipY ? -1 : 1);
        ctx.translate(-c.x, -c.y);
      }
      ctx.filter = cssFilter(el.filters);
      const r = cropRect(img.naturalWidth, img.naturalHeight, el.crop);
      if (isNeutralPhoto(el.photo)) ctx.drawImage(img, r.x, r.y, r.width, r.height, el.x, el.y, el.width, el.height);
      else ctx.drawImage(adjustedImage(img, el.src, r.x, r.y, r.width, r.height, el.photo!), el.x, el.y, el.width, el.height);
    }
  } else {
    const lines = textLines(ctx, el);
    ctx.fillStyle = el.color;
    ctx.textBaseline = 'top';
    ctx.textAlign = el.align;
    const lh = el.fontSize * el.lineHeight;
    const tx = el.align === 'left' ? el.x : el.align === 'right' ? el.x + el.width : el.x + el.width / 2;
    const padTop = (lh - el.fontSize) / 2;
    if (el.shadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = el.fontSize * 0.15;
      ctx.shadowOffsetX = el.fontSize * 0.04;
      ctx.shadowOffsetY = el.fontSize * 0.06;
    }
    const outline = el.outlineWidth ?? 0;
    lines.forEach((line, i) => {
      const y = el.y + padTop + i * lh;
      if (outline > 0) {
        ctx.strokeStyle = el.outlineColor ?? '#000000';
        ctx.lineWidth = outline * 2; // half of the stroke is covered by the fill
        ctx.lineJoin = 'round';
        ctx.strokeText(line, tx, y);
        ctx.shadowColor = 'transparent';
      }
      ctx.fillText(line, tx, y);
    });
  }
  ctx.restore();
}

/**
 * Draw the whole design (no editor overlays) in doc coordinates. Pass `time`
 * (seconds since the page appeared) to play element entrance animations.
 */
export function renderDesign(ctx: CanvasRenderingContext2D, doc: DesignDoc, images: ImageCache, skipId?: string, time?: number) {
  if (doc.gradient) {
    const [a, b] = gradientLine(doc.width, doc.height, doc.gradient.angle);
    const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
    g.addColorStop(0, doc.gradient.from);
    g.addColorStop(1, doc.gradient.to);
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = doc.background;
  }
  ctx.fillRect(0, 0, doc.width, doc.height);
  const order = time === undefined ? null : animationOrder(doc.elements);
  doc.elements.forEach((el, i) => {
    if (el.id === skipId) return;
    const anim = order && order[i] >= 0 ? animationAt(el.animation, order[i], time!) : undefined;
    drawElement(ctx, time === undefined ? el : elementAtTime(el, time, doc), images, anim, doc);
  });
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

export function designThumbnail(doc: DesignDoc, maxSize = 240, images?: ImageCache): string {
  const scale = maxSize / Math.max(doc.width, doc.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(doc.width * scale);
  canvas.height = Math.round(doc.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  renderDesign(ctx, doc, images ?? new ImageCache(() => {}));
  return canvas.toDataURL('image/jpeg', 0.85);
}

/** Render every page of a design as a multi-page PDF (each page is a high-quality JPEG). */
export async function exportPdf(file: DesignFile, scale = 2): Promise<Blob> {
  const pages = [];
  for (let i = 0; i < file.pages.length; i++) {
    const jpeg = await exportDesign(pageView(file, i), 'image/jpeg', scale);
    pages.push({
      jpeg: new Uint8Array(await jpeg.arrayBuffer()),
      width: Math.round(file.width * scale),
      height: Math.round(file.height * scale),
      pageWidth: file.width * 0.75,
      pageHeight: file.height * 0.75,
    });
  }
  return makePdf(pages);
}

/**
 * Play every page with its animations and record it as a video (WebM, or MP4
 * on Safari). Runs in real time: a 3-page design with 4s pages takes 12s.
 */
export async function exportDesignVideo(file: DesignFile, onProgress?: (fraction: number) => void): Promise<Blob> {
  const images = new ImageCache(() => {});
  await images.preload(file.pages.flatMap((p) => p.elements.flatMap((e) => (e.type === 'image' ? [e.src] : []))));
  // Keep the video a sensible size: at most 1920px on the long side, even dimensions.
  const scale = Math.min(1, 1920 / Math.max(file.width, file.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round((file.width * scale) / 2) * 2;
  canvas.height = Math.round((file.height * scale) / 2) * 2;
  const ctx = canvas.getContext('2d')!;
  const stream = canvas.captureStream(30);
  const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find((m) => MediaRecorder.isTypeSupported(m));
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);

  const durations = file.pages.map(pageDuration);
  const total = durations.reduce((a, b) => a + b, 0);
  const draw = (t: number) => {
    let page = 0;
    let local = t;
    while (page < durations.length - 1 && local >= durations[page]) local -= durations[page++];
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    renderDesign(ctx, pageView(file, page), images, undefined, local);
  };

  draw(0);
  recorder.start(250);
  const started = performance.now();
  await new Promise<void>((resolve) => {
    const tick = () => {
      const t = (performance.now() - started) / 1000;
      draw(Math.min(t, total - 0.001));
      onProgress?.(Math.min(1, t / total));
      if (t >= total) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
    recorder.stop();
  });
  stream.getTracks().forEach((t) => t.stop());
  return new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
}
