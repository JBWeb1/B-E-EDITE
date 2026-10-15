import { useEffect, useMemo, useRef, useState } from 'react';
import { pageView } from './pages';
import { ImageCache, renderDesign } from './render';
import type { DesignFile } from './types';

/**
 * Full-screen slideshow. Arrow keys, Space or a click move between pages;
 * each page plays its entrance animations when it appears. Esc closes.
 */
export function Presenter({ file, startPage, onClose }: { file: DesignFile; startPage: number; onClose: () => void }) {
  const [page, setPage] = useState(startPage);
  const [, setLoaded] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const images = useMemo(() => new ImageCache(() => setLoaded((n) => n + 1)), []);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const last = file.pages.length - 1;
  const next = () => setPage((p) => Math.min(last, p + 1));
  const prev = () => setPage((p) => Math.max(0, p - 1));

  useEffect(() => {
    const el = rootRef.current;
    el?.requestFullscreen?.().catch(() => {
      // Fullscreen can be refused (e.g. inside an iframe); the overlay still covers the window.
    });
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) onCloseRef.current();
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) {
        e.preventDefault();
        setPage((p) => Math.min(last, p + 1));
      } else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) {
        e.preventDefault();
        setPage((p) => Math.max(0, p - 1));
      } else if (e.key === 'Escape') {
        onCloseRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [last]);

  // Draw the current page, playing its animations from the moment it appears.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const doc = pageView(file, page);
    const started = performance.now();
    let raf = 0;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const scale = Math.min(window.innerWidth / doc.width, window.innerHeight / doc.height);
      const w = Math.round(doc.width * scale);
      const h = Math.round(doc.height * scale);
      if (canvas.width !== Math.round(w * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
      const ctx = canvas.getContext('2d')!;
      ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
      renderDesign(ctx, doc, images, undefined, (performance.now() - started) / 1000);
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [file, page, images]);

  return (
    <div className="presenter" ref={rootRef} onClick={next} role="dialog" aria-label="Presentation">
      <canvas ref={canvasRef} />
      <div className="presenter-bar" onClick={(e) => e.stopPropagation()}>
        <button onClick={prev} disabled={page === 0} aria-label="Previous page">‹</button>
        <span>
          {page + 1} / {file.pages.length}
        </span>
        <button onClick={next} disabled={page === last} aria-label="Next page">›</button>
        <button onClick={onClose}>Exit</button>
      </div>
    </div>
  );
}
