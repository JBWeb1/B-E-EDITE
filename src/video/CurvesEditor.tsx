/**
 * RGB curves (like Lumetri's): drag points to bend brightness (master) or one colour
 * channel. Click the line to add a point, double-click a point to remove it.
 */
import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { CURVE_PRESETS, curveAt, NEUTRAL_CURVES } from './grade';
import type { Curve, Curves } from './grade';

type Channel = keyof Curves;
const CHANNELS: { id: Channel; label: string; color: string }[] = [
  { id: 'master', label: 'RGB', color: '#e5e7eb' },
  { id: 'r', label: 'Red', color: '#f87171' },
  { id: 'g', label: 'Green', color: '#4ade80' },
  { id: 'b', label: 'Blue', color: '#60a5fa' },
];
const S = 200;

export function CurvesEditor({ curves, mark, onChange }: { curves: Curves | undefined; mark: () => void; onChange: (c: Curves, live: boolean) => void }) {
  const c = curves ?? NEUTRAL_CURVES;
  const [ch, setCh] = useState<Channel>('master');
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<number | null>(null);
  const pts = [...c[ch]].sort((a, b) => a[0] - b[0]);
  const color = CHANNELS.find((x) => x.id === ch)!.color;
  const at = (e: ReactPointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height))] as [number, number];
  };
  const set = (next: Curve, live: boolean) => onChange({ ...c, [ch]: next }, live);
  const path = Array.from({ length: 65 }, (_, i) => {
    const x = i / 64;
    return `${i ? 'L' : 'M'}${x * S},${(1 - curveAt(pts, x)) * S}`;
  }).join('');
  return (
    <div className="curves">
      <div className="segmented" role="group" aria-label="Curve channel">
        {CHANNELS.map((x) => (
          <button key={x.id} className={ch === x.id ? 'active' : ''} aria-pressed={ch === x.id} onClick={() => setCh(x.id)} style={{ color: ch === x.id ? undefined : x.color }}>
            {x.label}
          </button>
        ))}
      </div>
      <svg
        ref={svg}
        className="curves-box"
        viewBox={`0 0 ${S} ${S}`}
        role="application"
        aria-label={`${CHANNELS.find((x) => x.id === ch)!.label} curve`}
        onPointerDown={(e) => {
          // Click near the line: add a point there and start dragging it.
          const [x, y] = at(e);
          if (Math.abs(curveAt(pts, x) - y) > 0.12) return;
          mark();
          const next = [...pts, [x, curveAt(pts, x)] as [number, number]].sort((a, b) => a[0] - b[0]);
          drag.current = next.findIndex((p) => p[0] === x);
          svg.current?.setPointerCapture(e.pointerId);
          set(next, true);
        }}
        onPointerMove={(e) => {
          const i = drag.current;
          if (i === null) return;
          const [x, y] = at(e);
          const next = pts.map((p) => [...p] as [number, number]);
          // End points only move up and down; others stay between their neighbours.
          const lo = i === 0 ? 0 : next[i - 1][0] + 0.02;
          const hi = i === next.length - 1 ? 1 : next[i + 1][0] - 0.02;
          next[i] = [i === 0 ? 0 : i === next.length - 1 ? 1 : Math.max(lo, Math.min(hi, x)), y];
          set(next, true);
        }}
        onPointerUp={() => (drag.current = null)}
      >
        {[0.25, 0.5, 0.75].map((g) => (
          <g key={g} className="curves-grid">
            <line x1={g * S} y1={0} x2={g * S} y2={S} />
            <line x1={0} y1={g * S} x2={S} y2={g * S} />
          </g>
        ))}
        <line className="curves-diag" x1={0} y1={S} x2={S} y2={0} />
        <path d={path} fill="none" stroke={color} strokeWidth={2} />
        {pts.map(([x, y], i) => (
          <circle
            key={i}
            cx={x * S}
            cy={(1 - y) * S}
            r={6}
            fill={color}
            className="curves-point"
            onPointerDown={(e) => {
              e.stopPropagation();
              mark();
              drag.current = i;
              svg.current?.setPointerCapture(e.pointerId);
            }}
            onDoubleClick={() => i > 0 && i < pts.length - 1 && set(pts.filter((_, k) => k !== i), false)}
          />
        ))}
      </svg>
      <div className="grid2">
        {CURVE_PRESETS.map((p) => (
          <button key={p.label} onClick={() => onChange(p.curves, false)}>
            {p.label}
          </button>
        ))}
        <button onClick={() => onChange(NEUTRAL_CURVES, false)}>Straight (reset)</button>
      </div>
      <p className="hint">Drag a point; click the line to add one; double-click a point to remove it.</p>
    </div>
  );
}
