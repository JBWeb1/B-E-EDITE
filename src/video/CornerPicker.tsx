/**
 * Screen replacement on the player: click the four corners of the screen to place a
 * layer on it, or drag the corners of a placed layer to fine-tune them.
 */
import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { orderCorners } from './cornerPin';
import type { Pt, Quad } from './cornerPin';

export function CornerPicker({
  aspect,
  quad,
  onPlace,
  onNudge,
  onClose,
}: {
  aspect: number;
  /** Corners being adjusted (fractions of the frame); none while placing. */
  quad?: Quad | null;
  onPlace: (q: Quad) => void;
  /** Move one corner by (dx, dy) fractions; `done` at the end of a drag. */
  onNudge: (corner: number, dx: number, dy: number, done: boolean) => void;
  onClose: () => void;
}) {
  const [points, setPoints] = useState<Pt[]>([]);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ corner: number; x: number; y: number } | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const W = 1000;
  const H = 1000 / aspect;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      close.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const at = (e: ReactPointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  const placing = !quad;
  const down = (e: ReactPointerEvent) => {
    if (!placing) return;
    const p = at(e);
    const next = [...points, [p.x, p.y] as Pt];
    if (next.length === 4) {
      setPoints([]);
      onPlace(orderCorners(next));
    } else setPoints(next);
  };
  const shown: Pt[] = quad ?? points;
  const labels = ['Top left', 'Top right', 'Bottom right', 'Bottom left'];
  return (
    <div className="pen-tool corner-picker">
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        onPointerDown={down}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const p = at(e);
          onNudge(d.corner, p.x - d.x, p.y - d.y, false);
          drag.current = { ...d, x: p.x, y: p.y };
        }}
        onPointerUp={() => {
          if (drag.current) onNudge(drag.current.corner, 0, 0, true);
          drag.current = null;
        }}
        role="application"
        aria-label={placing ? 'Click the four corners of the screen' : 'Drag a corner to adjust it'}
      >
        {shown.length > 1 && <polygon points={shown.map(([x, y]) => `${x * W},${y * H}`).join(' ')} className="pen-line" />}
        {shown.map(([x, y], i) => (
          <circle
            key={i}
            cx={x * W}
            cy={y * H}
            r={9}
            className="corner-dot"
            role={placing ? undefined : 'slider'}
            aria-label={placing ? undefined : `${labels[i]} corner`}
            onPointerDown={(e) => {
              if (placing) return;
              e.stopPropagation();
              const p = at(e);
              drag.current = { corner: i, x: p.x, y: p.y };
              svg.current?.setPointerCapture(e.pointerId);
            }}
          />
        ))}
      </svg>
      <div className="pen-bar">
        <span>{placing ? `Click the 4 corners of the screen (${points.length}/4)` : 'Drag the corners to line them up.'}</span>
        {placing && points.length > 0 && <button onClick={() => setPoints((p) => p.slice(0, -1))}>Undo corner</button>}
        <button className="primary" onClick={() => close.current()}>
          {placing ? 'Cancel' : 'Done'}
        </button>
      </div>
    </div>
  );
}
