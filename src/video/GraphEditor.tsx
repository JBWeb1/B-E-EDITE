/**
 * Keyframe graph editor (like After Effects' value graph): each animated property
 * as a curve over time. Drag a keyframe to change when it happens and its value;
 * drag the two handles of a move to shape how it speeds up and slows down.
 */
import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { DEFAULT_BEZIER, EASINGS, KEY_EPS, valueAt } from './anim';
import type { AnimProp, Bezier, Easing, Keyframe, Keyframes } from './anim';

const LABELS: Partial<Record<AnimProp, string>> = { x: 'Left / right', y: 'Up / down', scale: 'Size', rotation: 'Angle', opacity: 'See-through', volume: 'Volume', maskX: 'Mask X', maskY: 'Mask Y', maskScale: 'Mask size' };
const W = 280;
const H = 150;
const PAD = 12;

/** Value range to show for a list of keys (with a little room; never flat). */
export function graphRange(keys: Keyframe[]): [number, number] {
  const vs = keys.map((k) => k.v);
  let lo = Math.min(...vs);
  let hi = Math.max(...vs);
  if (hi - lo < 1e-6) {
    lo -= 0.5;
    hi += 0.5;
  }
  const pad = (hi - lo) * 0.2;
  return [lo - pad, hi + pad];
}

/** Move keyframe `i` to time `t` and value `v`, staying between its neighbours. */
export function moveKey(keys: Keyframe[], i: number, t: number, v: number): Keyframe[] {
  const lo = i > 0 ? keys[i - 1].t + KEY_EPS : 0;
  const hi = i < keys.length - 1 ? keys[i + 1].t - KEY_EPS : Infinity;
  return keys.map((k, j) => (j === i ? { ...k, t: Math.round(Math.max(lo, Math.min(hi, t)) * 1000) / 1000, v } : k));
}

type Drag = { kind: 'key'; i: number } | { kind: 'handle'; i: number; which: 0 | 1 };

export function GraphEditor({
  keys,
  length,
  local,
  mark,
  onChange,
  onSeekLocal,
}: {
  keys: Keyframes;
  length: number;
  local: number;
  mark: () => void;
  onChange: (keys: Keyframes, live: boolean) => void;
  onSeekLocal: (t: number) => void;
}) {
  const props = (Object.keys(keys) as AnimProp[]).filter((p) => (keys[p]?.length ?? 0) >= 2);
  const [chosen, setChosen] = useState<AnimProp | null>(null);
  const prop = chosen && props.includes(chosen) ? chosen : props[0];
  const [sel, setSel] = useState(0);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  if (!prop) return <p className="hint">Add two or more keyframes to a value to see its curve here.</p>;
  const list = keys[prop]!;
  const selected = Math.min(sel, list.length - 1);
  const span = Math.max(length, list[list.length - 1].t, 0.1);
  const [lo, hi] = graphRange(list);
  const xOf = (t: number) => PAD + (t / span) * (W - 2 * PAD);
  const yOf = (v: number) => H - PAD - ((v - lo) / (hi - lo)) * (H - 2 * PAD);
  const tOf = (x: number) => ((x - PAD) / (W - 2 * PAD)) * span;
  const vOf = (y: number) => lo + ((H - PAD - y) / (H - 2 * PAD)) * (hi - lo);
  const put = (next: Keyframe[], live: boolean) => onChange({ ...keys, [prop]: next }, live);

  // The curve, sampled finely.
  const d = Array.from({ length: 161 }, (_, i) => {
    const t = (i / 160) * span;
    return `${i ? 'L' : 'M'}${xOf(t).toFixed(1)} ${yOf(valueAt(list, t, list[0].v)).toFixed(1)}`;
  }).join('');

  // Handles of the move that starts at the selected key (only for custom curves).
  const a = list[selected];
  const b = list[selected + 1];
  const bez: Bezier = a?.bez ?? DEFAULT_BEZIER;
  const handles =
    a && b && a.ease === 'custom'
      ? ([
          [xOf(a.t + bez[0] * (b.t - a.t)), yOf(a.v + bez[1] * (b.v - a.v))],
          [xOf(a.t + bez[2] * (b.t - a.t)), yOf(a.v + bez[3] * (b.v - a.v))],
        ] as const)
      : null;

  const point = (e: ReactPointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  const onMove = (e: ReactPointerEvent) => {
    const g = drag.current;
    if (!g) return;
    const p = point(e);
    if (g.kind === 'key') {
      put(moveKey(list, g.i, tOf(p.x), Math.round(vOf(p.y) * 1000) / 1000), true);
    } else if (a && b) {
      const dv = b.v - a.v || 1;
      const hx = Math.max(0, Math.min(1, (tOf(p.x) - a.t) / (b.t - a.t)));
      const hy = Math.max(-1, Math.min(2, (vOf(p.y) - a.v) / dv));
      const next = [...bez] as Bezier;
      next[g.which * 2] = Math.round(hx * 100) / 100;
      next[g.which * 2 + 1] = Math.round(hy * 100) / 100;
      put(list.map((k, j) => (j === selected ? { ...k, ease: 'custom' as Easing, bez: next } : k)), true);
    }
  };
  const start = (e: ReactPointerEvent, g: Drag) => {
    e.stopPropagation();
    mark();
    drag.current = g;
    svg.current?.setPointerCapture(e.pointerId);
  };

  return (
    <div className="graph-editor">
      {props.length > 1 && (
        <div className="segmented graph-props" role="group" aria-label="Animated value">
          {props.map((p) => (
            <button key={p} className={p === prop ? 'active' : ''} onClick={() => (setChosen(p), setSel(0))}>
              {LABELS[p] ?? p}
            </button>
          ))}
        </div>
      )}
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        className="graph-canvas"
        role="group"
        aria-label={`${LABELS[prop] ?? prop} over time`}
        onPointerMove={onMove}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onPointerDown={(e) => onSeekLocal(Math.max(0, Math.min(span, tOf(point(e).x))))}
      >
        <line className="graph-now" x1={xOf(local)} x2={xOf(local)} y1={0} y2={H} />
        <path className="graph-curve" d={d} />
        {handles && (
          <g className="graph-handles">
            <line x1={xOf(a.t)} y1={yOf(a.v)} x2={handles[0][0]} y2={handles[0][1]} />
            <line x1={xOf(b.t)} y1={yOf(b.v)} x2={handles[1][0]} y2={handles[1][1]} />
            {handles.map(([hx, hy], which) => (
              <circle key={which} cx={hx} cy={hy} r={5} className="graph-handle" role="slider" aria-label={which ? 'Ease into the next keyframe' : 'Ease out of this keyframe'} aria-valuenow={bez[which * 2 + 1]} onPointerDown={(e) => start(e, { kind: 'handle', i: selected, which: which as 0 | 1 })} />
            ))}
          </g>
        )}
        {list.map((k, i) => (
          <rect
            key={i}
            x={xOf(k.t) - 5}
            y={yOf(k.v) - 5}
            width={10}
            height={10}
            transform={`rotate(45 ${xOf(k.t)} ${yOf(k.v)})`}
            className={`graph-key ${i === selected ? 'selected' : ''}`}
            role="slider"
            aria-label={`Keyframe ${i + 1}`}
            aria-valuenow={Math.round(k.v * 1000) / 1000}
            aria-valuetext={`${k.t.toFixed(2)} s: ${Math.round(k.v * 1000) / 1000}`}
            onPointerDown={(e) => {
              setSel(i);
              start(e, { kind: 'key', i });
            }}
          />
        ))}
      </svg>
      {a && b && (
        <label className="field">
          <span>
            Move from keyframe {selected + 1} to {selected + 2}
          </span>
          <select
            value={a.ease ?? 'smooth'}
            aria-label="Move easing"
            onChange={(e) => {
              const easing = e.target.value as Easing;
              put(list.map((k, j) => (j === selected ? { ...k, ease: easing, bez: easing === 'custom' ? k.bez ?? DEFAULT_BEZIER : k.bez } : k)), false);
            }}
          >
            {EASINGS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
      )}
      <p className="hint">Drag a ◆ to change when it happens and its value. Choose “Custom curve” and drag the round handles to shape the move.</p>
    </div>
  );
}
