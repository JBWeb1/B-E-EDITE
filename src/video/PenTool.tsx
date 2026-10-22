/**
 * Pen tool over the player: click to add corner points, drag to pull out a curve,
 * click the first point to close the shape. Enter or Done finishes, Esc cancels.
 * Points are fractions of the frame; handles too.
 */
import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { PathPoint } from './vectorPath';

export function PenTool({ aspect, mode, onDone, onCancel }: { aspect: number; mode: 'shape' | 'text'; onDone: (points: PathPoint[], closed: boolean) => void; onCancel: () => void }) {
  const [points, setPoints] = useState<PathPoint[]>([]);
  const drag = useRef<{ i: number; x: number; y: number } | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const done = useRef(onDone);
  done.current = onDone;
  const cancel = useRef(onCancel);
  cancel.current = onCancel;
  const W = 1000;
  const H = 1000 / aspect;

  const finish = (closed: boolean, pts = points) => {
    if (pts.length >= 2) done.current(pts, closed && pts.length >= 3);
    else cancel.current();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // While drawing, these keys belong to the pen (not the editor's shortcuts).
      if (['Escape', 'Enter', 'Backspace'].includes(e.key)) e.stopImmediatePropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        cancel.current();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        finish(false);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        setPoints((p) => p.slice(0, -1));
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const at = (e: ReactPointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  const down = (e: ReactPointerEvent) => {
    e.preventDefault();
    const p = at(e);
    // Clicking the first point closes the shape.
    if (points.length >= 3 && Math.hypot((p.x - points[0].x) * W, (p.y - points[0].y) * H) < 18) {
      finish(true);
      return;
    }
    const next = [...points, { x: p.x, y: p.y }];
    setPoints(next);
    drag.current = { i: next.length - 1, x: p.x, y: p.y };
    svg.current?.setPointerCapture(e.pointerId);
  };
  const move = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = at(e);
    const dx = p.x - d.x;
    const dy = p.y - d.y;
    if (Math.hypot(dx * W, dy * H) < 4) return;
    // Dragging pulls out smooth handles, like in After Effects or Illustrator.
    setPoints((pts) => pts.map((q, i) => (i === d.i ? { ...q, ox: dx, oy: dy, ix: -dx, iy: -dy } : q)));
  };

  const d = points
    .map((p, i) => {
      if (i === 0) return `M${p.x * W} ${p.y * H}`;
      const a = points[i - 1];
      return `C${(a.x + (a.ox ?? 0)) * W} ${(a.y + (a.oy ?? 0)) * H} ${(p.x + (p.ix ?? 0)) * W} ${(p.y + (p.iy ?? 0)) * H} ${p.x * W} ${p.y * H}`;
    })
    .join('');
  return (
    <div className="pen-tool">
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" onPointerDown={down} onPointerMove={move} onPointerUp={() => (drag.current = null)} role="application" aria-label="Pen tool: click to add points, drag to curve">
        <path d={d} className="pen-line" />
        {points.map((p, i) => (
          <g key={i}>
            {p.ox !== undefined && (
              <>
                <line x1={(p.x + (p.ix ?? 0)) * W} y1={(p.y + (p.iy ?? 0)) * H} x2={(p.x + p.ox) * W} y2={(p.y + (p.oy ?? 0)) * H} className="pen-handle-line" />
                <circle cx={(p.x + p.ox) * W} cy={(p.y + (p.oy ?? 0)) * H} r={5} className="pen-handle" />
                <circle cx={(p.x + (p.ix ?? 0)) * W} cy={(p.y + (p.iy ?? 0)) * H} r={5} className="pen-handle" />
              </>
            )}
            <rect x={p.x * W - 6} y={p.y * H - 6} width={12} height={12} className={`pen-point ${i === 0 && points.length >= 3 ? 'first' : ''}`} />
          </g>
        ))}
      </svg>
      <div className="pen-bar">
        <span>
          {mode === 'text' ? 'Draw the line your text will follow.' : 'Click to add points, drag to curve.'} {points.length >= 3 ? 'Click the first point to close it.' : ''}
        </span>
        <button onClick={() => setPoints((p) => p.slice(0, -1))} disabled={!points.length}>
          Undo point
        </button>
        <button onClick={() => cancel.current()}>Cancel</button>
        <button className="primary" onClick={() => finish(false)} disabled={points.length < 2}>
          Done
        </button>
      </div>
    </div>
  );
}
