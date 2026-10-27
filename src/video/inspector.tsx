/**
 * Inspector building blocks for the pro tools: keyframe sliders, animation
 * presets, crop, green screen, masks, blend modes, colour wheels and looks,
 * speed ramps and volume keyframes. Shared by clips, layers and text.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import type { Filters } from '../lib/filters';
import { ColorField, RangeField } from '../ui/fields';
import { Icon } from '../ui/Icon';
import {
  ANIM_PRESETS,
  applyPreset,
  curveSpeeds,
  DEFAULT_CURVE,
  EASINGS,
  keyAt,
  loopOf,
  neighbourKey,
  presetKeys,
  RAMPS,
  removeKey,
  setAllEasing,
  setKey,
  setLoop,
  transformAt,
  valueAt,
} from './anim';
import type { AnimPreset, AnimProp, Easing, KeyLoop, Keyframes, Ramp } from './anim';
import { CurvesEditor } from './CurvesEditor';
import { LOOKS, NEUTRAL_GRADE, NEUTRAL_WHEEL, wheelColor } from './grade';
import type { ColorGrade, LookId, Wheel } from './grade';
import { DEFAULT_KEY } from './keyer';
import { GraphEditor } from './GraphEditor';
import { BLEND_MODES, MASK_SHAPES, NO_CROP } from './layers';
import type { BlendMode, Crop, LayerProps, Mask, MaskShape, TextOverlay } from './types';
import { MATTE_MODES, REACT_PROPS } from './react';
import type { Matte, React } from './react';

/** Something with animatable properties: a clip, a layer or a text item. */
interface Animatable {
  keys?: Keyframes;
  wiggle?: { amount: number; speed: number } | null;
  motionBlur?: boolean;
}

type Update<T> = (patch: Partial<T>, live?: boolean) => void;

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function Section({ title, children, defaultOpen = false }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  // Opens when it gains a setting, but never snaps shut under the user (e.g. when turning a tool off).
  const ref = useRef<HTMLDetailsElement>(null);
  useLayoutEffect(() => {
    if (defaultOpen && ref.current) ref.current.open = true;
  }, [defaultOpen]);
  return (
    <details className="insp-section" ref={ref}>
      <summary>{title}</summary>
      <div className="insp-body">{children}</div>
    </details>
  );
}

/**
 * A slider that can be animated. With no keyframes it edits the plain value;
 * once the property has keyframes, moving it sets a keyframe at the playhead.
 */
export function AnimField({
  label,
  prop,
  base,
  keys,
  local,
  min,
  max,
  step,
  format,
  mark,
  onBase,
  onKeys,
}: {
  label: string;
  prop: AnimProp;
  base: number;
  keys: Keyframes | undefined;
  local: number;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  mark: () => void;
  onBase: (v: number, live: boolean) => void;
  onKeys: (k: Keyframes, live: boolean) => void;
}) {
  const list = keys?.[prop];
  const animated = (list?.length ?? 0) > 0;
  const value = valueAt(list, local, base);
  const here = keyAt(list, local);
  const toggleKey = () => {
    const next = { ...keys, [prop]: here ? removeKey(list, local) : setKey(list, local, value) };
    if (next[prop]?.length === 0) delete next[prop];
    onKeys(next, false);
  };
  return (
    <div className={`anim-field ${animated ? 'animated' : ''}`}>
      <RangeField
        label={label}
        value={value}
        min={min}
        max={max}
        step={step}
        format={format}
        onStart={mark}
        onChange={(v) => (animated ? onKeys({ ...keys, [prop]: setKey(list, local, v) }, true) : onBase(v, true))}
      />
      <button
        className={`key-btn ${here ? 'on' : ''}`}
        onClick={toggleKey}
        title={here ? 'Remove the keyframe at the playhead' : 'Add a keyframe at the playhead'}
        aria-label={`${here ? 'Remove' : 'Add'} ${label} keyframe`}
        aria-pressed={!!here}
      >
        ◆
      </button>
    </div>
  );
}

/** ◀ ◆ ▶ keyframe navigation, easing and one-click animations. */
export function KeyframeTools({
  item,
  local,
  length,
  base,
  mark,
  onSeekLocal,
  update,
  motionBlur = true,
}: {
  item: Animatable;
  local: number;
  length: number;
  /** Offer the motion blur switch (layers that can draw it). */
  motionBlur?: boolean;
  base: { x: number; y: number; scale: number; rotation: number; opacity: number };
  mark: () => void;
  onSeekLocal: (t: number) => void;
  update: Update<Animatable>;
}) {
  const prev = neighbourKey(item.keys, local, -1);
  const next = neighbourKey(item.keys, local, 1);
  const anyKeys = Object.values(item.keys ?? {}).some((l) => l?.length);
  const easing = Object.values(item.keys ?? {}).flatMap((l) => l ?? [])[0]?.ease ?? 'smooth';
  return (
    <>
      <div className="key-nav">
        <button className="icon-btn" disabled={prev === null} onClick={() => prev !== null && onSeekLocal(prev)} title="Previous keyframe" aria-label="Previous keyframe">
          <Icon name="chevronLeft" size={16} />
        </button>
        <span className="hint">{anyKeys ? 'Keyframes: ◆ marks one at the playhead' : 'Press ◆ to animate a value'}</span>
        <button className="icon-btn" disabled={next === null} onClick={() => next !== null && onSeekLocal(next)} title="Next keyframe" aria-label="Next keyframe">
          <Icon name="chevronRight" size={16} />
        </button>
      </div>
      {anyKeys && (
        <div className="row">
          <label className="field grow">
            <span>Easing</span>
            <select value={easing} onChange={(e) => update({ keys: setAllEasing(item.keys, e.target.value as Easing) })} aria-label="Easing">
              {EASINGS.map((e) => (
                <option key={e.value} value={e.value}>{e.label}</option>
              ))}
            </select>
          </label>
          <button onClick={() => update({ keys: undefined })} title="Remove all keyframes">Clear</button>
        </div>
      )}
      {anyKeys && (
        <label className="field">
          <span>After the last keyframe</span>
          <select value={loopOf(item.keys) ?? ''} onChange={(e) => update({ keys: setLoop(item.keys, (e.target.value || undefined) as KeyLoop | undefined) })} aria-label="Loop keyframes">
            <option value="">Stop (hold the last value)</option>
            <option value="cycle">Loop (repeat)</option>
            <option value="pingpong">Ping-pong (back and forth)</option>
          </select>
        </label>
      )}
      {anyKeys && (
        <Section title="Graph editor">
          <GraphEditor keys={item.keys ?? {}} length={length} local={local} mark={mark} onChange={(keys, live) => update({ keys }, live)} onSeekLocal={onSeekLocal} />
        </Section>
      )}
      <h4>One-click animations</h4>
      <div className="grid3 anim-presets">
        {ANIM_PRESETS.map((p) => (
          <button
            key={p.value}
            onClick={() => {
              mark();
              const t0 = transformAt({ ...base, keys: undefined }, 0);
              update({ keys: applyPreset(item.keys, presetKeys(p.value as AnimPreset, length, t0)) });
            }}
          >
            {p.label}
          </button>
        ))}
      </div>
      <h4>Movement</h4>
      <div className="row">
        {motionBlur && (
          <button className={item.motionBlur ? 'active' : ''} onClick={() => update({ motionBlur: !item.motionBlur })} aria-pressed={!!item.motionBlur} title="Smooth, natural blur on fast movement">
            Motion blur
          </button>
        )}
        <button
          className={item.wiggle ? 'active' : ''}
          onClick={() => update({ wiggle: item.wiggle ? null : { amount: 0.5, speed: 2 } })}
          aria-pressed={!!item.wiggle}
          title="Handheld camera wobble"
        >
          Wiggle
        </button>
      </div>
      {item.wiggle && (
        <>
          <RangeField label="Wiggle amount" value={item.wiggle.amount} min={0.05} max={2} step={0.05} onStart={mark} onChange={(v) => update({ wiggle: { ...item.wiggle!, amount: v } }, true)} format={pct} />
          <RangeField label="Wiggle speed" value={item.wiggle.speed} min={0.2} max={10} step={0.1} onStart={mark} onChange={(v) => update({ wiggle: { ...item.wiggle!, speed: v } }, true)} format={(v) => `${v.toFixed(1)}/s`} />
        </>
      )}
    </>
  );
}

/** Position, size, angle and opacity, all animatable. */
export function TransformFields({
  item,
  base,
  local,
  mark,
  onBase,
  update,
  sizeLabel = 'Size',
  sizeRange = [0.05, 4],
}: {
  item: Animatable;
  base: { x: number; y: number; scale: number; rotation: number; opacity: number };
  local: number;
  mark: () => void;
  onBase: (patch: Partial<{ x: number; y: number; scale: number; rotation: number; opacity: number }>, live: boolean) => void;
  update: Update<Animatable>;
  sizeLabel?: string;
  sizeRange?: [number, number];
}) {
  const field = (label: string, prop: 'x' | 'y' | 'scale' | 'rotation' | 'opacity', min: number, max: number, step: number, format: (v: number) => string) => (
    <AnimField
      label={label}
      prop={prop}
      base={base[prop]}
      keys={item.keys}
      local={local}
      min={min}
      max={max}
      step={step}
      format={format}
      mark={mark}
      onBase={(v, live) => onBase({ [prop]: v }, live)}
      onKeys={(keys, live) => update({ keys }, live)}
    />
  );
  return (
    <>
      {field('Left / right', 'x', -0.5, 1.5, 0.005, pct)}
      {field('Up / down', 'y', -0.5, 1.5, 0.005, pct)}
      {field(sizeLabel, 'scale', sizeRange[0], sizeRange[1], 0.01, pct)}
      {field('Rotate', 'rotation', -360, 360, 1, (v) => `${Math.round(v)}°`)}
      {field('Opacity', 'opacity', 0, 1, 0.01, pct)}
    </>
  );
}

const CROP_PRESETS: { label: string; aspect: number | null }[] = [
  { label: 'Free', aspect: null },
  { label: '16:9', aspect: 16 / 9 },
  { label: '9:16', aspect: 9 / 16 },
  { label: '1:1', aspect: 1 },
  { label: '4:5', aspect: 4 / 5 },
];

/** Centred crop that gives a source of sw×sh the wanted aspect. */
export function cropToAspect(sw: number, sh: number, aspect: number): Crop {
  const src = sw / sh;
  if (src > aspect) {
    const cut = (1 - aspect / src) / 2;
    return { left: cut, right: cut, top: 0, bottom: 0 };
  }
  const cut = (1 - src / aspect) / 2;
  return { left: 0, right: 0, top: cut, bottom: cut };
}

export function CropSection({ crop, size, mark, update }: { crop: Crop | null | undefined; size: { w: number; h: number }; mark: () => void; update: Update<LayerProps> }) {
  const c = crop ?? NO_CROP;
  const set = (patch: Partial<Crop>) => update({ crop: { ...c, ...patch } }, true);
  return (
    <>
      <div className="row wrap">
        {CROP_PRESETS.map((p) => (
          <button key={p.label} onClick={() => update({ crop: p.aspect ? cropToAspect(size.w, size.h, p.aspect) : NO_CROP })}>
            {p.label}
          </button>
        ))}
      </div>
      <RangeField label="Left" value={c.left} min={0} max={0.45} step={0.005} onStart={mark} onChange={(v) => set({ left: v })} format={pct} />
      <RangeField label="Right" value={c.right} min={0} max={0.45} step={0.005} onStart={mark} onChange={(v) => set({ right: v })} format={pct} />
      <RangeField label="Top" value={c.top} min={0} max={0.45} step={0.005} onStart={mark} onChange={(v) => set({ top: v })} format={pct} />
      <RangeField label="Bottom" value={c.bottom} min={0} max={0.45} step={0.005} onStart={mark} onChange={(v) => set({ bottom: v })} format={pct} />
    </>
  );
}

export function GreenScreenSection({
  layer,
  picking,
  mark,
  update,
  onPick,
}: {
  layer: LayerProps;
  picking: boolean;
  mark: () => void;
  update: Update<LayerProps>;
  onPick: () => void;
}) {
  const k = layer.chroma;
  return (
    <>
      <div className="row">
        <button className={k ? 'active' : ''} onClick={() => update({ chroma: k ? null : DEFAULT_KEY })} aria-pressed={!!k}>
          {k ? 'Background removed' : 'Remove green screen'}
        </button>
        <button className={picking ? 'active' : ''} onClick={onPick} title="Then click the background colour on the player">
          <Icon name="droplet" size={15} /> {picking ? 'Click the player…' : 'Pick colour'}
        </button>
      </div>
      {k && (
        <>
          <div className="row">
            <button onClick={() => update({ chroma: { ...k, color: '#00b140' } })}>Green</button>
            <button onClick={() => update({ chroma: { ...k, color: '#0047bb' } })}>Blue</button>
            <span className="key-swatch" style={{ background: k.color }} title={k.color} />
          </div>
          <RangeField label="Strength" value={k.similarity} min={0.02} max={0.8} step={0.01} onStart={mark} onChange={(v) => update({ chroma: { ...k, similarity: v } }, true)} format={pct} />
          <RangeField label="Soft edge" value={k.smoothness} min={0} max={0.5} step={0.01} onStart={mark} onChange={(v) => update({ chroma: { ...k, smoothness: v } }, true)} format={pct} />
          <RangeField label="Remove green glow" value={k.spill} min={0} max={1} step={0.01} onStart={mark} onChange={(v) => update({ chroma: { ...k, spill: v } }, true)} format={pct} />
        </>
      )}
    </>
  );
}

export const DEFAULT_MASK: Mask = { shape: 'ellipse', x: 0.5, y: 0.5, w: 0.7, h: 0.7, feather: 0.06, invert: false };

export function MaskSection({ layer, local, mark, update }: { layer: LayerProps; local: number; mark: () => void; update: Update<LayerProps> }) {
  const m = layer.mask;
  const set = (patch: Partial<Mask>, live = true) => update({ mask: { ...(m ?? DEFAULT_MASK), ...patch } }, live);
  const animField = (label: string, prop: 'maskX' | 'maskY' | 'maskScale', baseVal: number, min: number, max: number, onBase: (v: number) => void) => (
    <AnimField
      label={label}
      prop={prop}
      base={baseVal}
      keys={layer.keys}
      local={local}
      min={min}
      max={max}
      step={0.005}
      format={pct}
      mark={mark}
      onBase={onBase}
      onKeys={(keys, live) => update({ keys }, live)}
    />
  );
  return (
    <>
      <label className="field">
        <span>Shape</span>
        <select value={m?.shape ?? 'none'} onChange={(e) => (e.target.value === 'none' ? update({ mask: null }) : set({ shape: e.target.value as MaskShape }, false))} aria-label="Mask shape">
          {MASK_SHAPES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </label>
      {m && (
        <>
          {animField('Mask left / right', 'maskX', m.x, 0, 1, (v) => set({ x: v }))}
          {animField('Mask up / down', 'maskY', m.y, 0, 1, (v) => set({ y: v }))}
          {animField('Mask size', 'maskScale', m.scale ?? 1, 0.05, 3, (v) => set({ scale: v }))}
          <RangeField label="Mask width" value={m.w} min={0.05} max={1.5} step={0.01} onStart={mark} onChange={(v) => set({ w: v })} format={pct} />
          <RangeField label="Mask height" value={m.h} min={0.05} max={1.5} step={0.01} onStart={mark} onChange={(v) => set({ h: v })} format={pct} />
          <RangeField label="Soft edge" value={m.feather} min={0} max={0.5} step={0.01} onStart={mark} onChange={(v) => set({ feather: v })} format={pct} />
          <button className={m.invert ? 'active block' : 'block'} onClick={() => set({ invert: !m.invert }, false)} aria-pressed={m.invert}>
            Invert (cut the shape out)
          </button>
        </>
      )}
    </>
  );
}

export function BlendField({ value, onChange }: { value: BlendMode | undefined; onChange: (v: BlendMode) => void }) {
  return (
    <label className="field">
      <span>Blend mode</span>
      <select value={value ?? 'normal'} onChange={(e) => onChange(e.target.value as BlendMode)} aria-label="Blend mode">
        {BLEND_MODES.map((b) => (
          <option key={b.value} value={b.value}>{b.label}</option>
        ))}
      </select>
    </label>
  );
}

/** A colour wheel: drag the dot to tint, slider for darker/brighter. */
export function ColorWheel({ label, wheel, mark, onChange }: { label: string; wheel: Wheel; mark: () => void; onChange: (w: Wheel, live: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(false);
  const fromPointer = (e: ReactPointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const dx = (e.clientX - r.left) / r.width - 0.5;
    const dy = (e.clientY - r.top) / r.height - 0.5;
    const amount = Math.min(1, Math.hypot(dx, dy) * 2);
    // 0° (red) at the top, going clockwise like most grading tools.
    const hue = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
    onChange({ ...wheel, hue: Math.round(hue), amount: Math.round(amount * 100) / 100 }, true);
  };
  const a = (wheel.hue * Math.PI) / 180;
  return (
    <div className="wheel-field">
      <span className="wheel-label">{label}</span>
      <div
        ref={ref}
        className="color-wheel"
        role="slider"
        aria-label={`${label} colour`}
        aria-valuenow={Math.round(wheel.amount * 100)}
        onPointerDown={(e) => {
          mark();
          setDrag(true);
          e.currentTarget.setPointerCapture(e.pointerId);
          fromPointer(e);
        }}
        onPointerMove={(e) => drag && fromPointer(e)}
        onPointerUp={() => setDrag(false)}
        onDoubleClick={() => onChange({ ...wheel, hue: 0, amount: 0 }, false)}
        title="Drag to tint · double-click to reset"
      >
        <span className="wheel-dot" style={{ left: `${50 + Math.sin(a) * wheel.amount * 50}%`, top: `${50 - Math.cos(a) * wheel.amount * 50}%`, background: wheelColor(wheel) }} />
      </div>
      <input
        type="range"
        min={-1}
        max={1}
        step={0.01}
        value={wheel.luma}
        onPointerDown={mark}
        onChange={(e) => onChange({ ...wheel, luma: Number(e.target.value) }, true)}
        aria-label={`${label} brightness`}
        title="Darker / brighter"
      />
    </div>
  );
}

export function ColorSection({ grade, mark, onChange }: { grade: ColorGrade | null | undefined; mark: () => void; onChange: (g: ColorGrade | null, live: boolean) => void }) {
  const g = grade ?? NEUTRAL_GRADE;
  return (
    <>
      <h4>Looks (LUTs)</h4>
      <div className="grid3 looks-grid">
        {LOOKS.map((l) => (
          <button key={l.id} className={g.look === l.id ? 'active' : ''} onClick={() => onChange({ ...g, look: l.id as LookId }, false)}>
            {l.label}
          </button>
        ))}
      </div>
      {g.look !== 'none' && (
        <RangeField label="Look strength" value={g.lookAmount} min={0} max={1} step={0.01} onStart={mark} onChange={(v) => onChange({ ...g, lookAmount: v }, true)} format={pct} />
      )}
      <h4>Colour wheels</h4>
      <div className="wheels">
        <ColorWheel label="Shadows" wheel={g.shadows} mark={mark} onChange={(w, live) => onChange({ ...g, shadows: w }, live)} />
        <ColorWheel label="Midtones" wheel={g.midtones} mark={mark} onChange={(w, live) => onChange({ ...g, midtones: w }, live)} />
        <ColorWheel label="Highlights" wheel={g.highlights} mark={mark} onChange={(w, live) => onChange({ ...g, highlights: w }, live)} />
      </div>
      <Section title="RGB curves">
        <CurvesEditor curves={g.curves} mark={mark} onChange={(curves, live) => onChange({ ...g, curves }, live)} />
      </Section>
      <button className="block" onClick={() => onChange(null, false)} disabled={!grade}>
        Reset colour
      </button>
    </>
  );
}

export function SpeedRampSection({
  ramp,
  curve,
  reverse,
  mark,
  update,
}: {
  ramp: Ramp | undefined;
  curve?: number[];
  reverse: boolean | undefined;
  mark?: () => void;
  update: (patch: { ramp?: Ramp; curve?: number[]; reverse?: boolean }, live?: boolean) => void;
}) {
  return (
    <>
      <h4>Speed ramp</h4>
      <div className="grid3">
        {RAMPS.map((r) => (
          <button
            key={r.value}
            className={(ramp ?? 'none') === r.value ? 'active' : ''}
            onClick={() => update(r.value === 'custom' && !curve ? { ramp: r.value, curve: DEFAULT_CURVE } : { ramp: r.value })}
            title={r.hint}
          >
            {r.label}
          </button>
        ))}
      </div>
      {ramp === 'custom' && <SpeedCurve curve={curve ?? DEFAULT_CURVE} mark={mark} onChange={(c, live) => update({ curve: c }, live)} />}
      <h4>Direction</h4>
      <button className={reverse ? 'active block' : 'block'} onClick={() => update({ reverse: !reverse })} aria-pressed={!!reverse}>
        <Icon name="undo" size={15} /> {reverse ? 'Playing backwards' : 'Play backwards'}
      </button>
      {reverse && <p className="hint">Reversed clips play without their sound.</p>}
    </>
  );
}

const CURVE_MIN = 0.1;
const CURVE_MAX = 10;
const toY = (v: number) => 1 - (Math.log10(Math.max(CURVE_MIN, Math.min(CURVE_MAX, v))) + 1) / 2;
const fromY = (y: number) => Math.pow(10, (1 - Math.max(0, Math.min(1, y))) * 2 - 1);

/** CapCut-style speed curve: drag each point up (faster) or down (slow motion). */
function SpeedCurve({ curve, mark, onChange }: { curve: number[]; mark?: () => void; onChange: (curve: number[], live: boolean) => void }) {
  const ref = useRef<SVGSVGElement>(null);
  const drag = useRef<number | null>(null);
  const W = 240;
  const H = 110;
  const speeds = curveSpeeds(curve);
  const xOf = (i: number) => 10 + (i / (curve.length - 1)) * (W - 20);
  const yOf = (v: number) => 8 + toY(v) * (H - 16);
  const move = (e: ReactPointerEvent) => {
    if (drag.current === null || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const y = ((e.clientY - r.top) / r.height) * H;
    const v = Math.round(fromY((y - 8) / (H - 16)) * 100) / 100;
    onChange(curve.map((c, i) => (i === drag.current ? v : c)), true);
  };
  const d = curve.map((v, i) => `${i ? 'L' : 'M'}${xOf(i)} ${yOf(v)}`).join('');
  return (
    <div className="speed-curve">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        role="group"
        aria-label="Speed curve"
        onPointerMove={move}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        <line x1={0} x2={W} y1={yOf(1)} y2={yOf(1)} className="speed-curve-mid" />
        <path d={d} className="speed-curve-line" />
        {curve.map((v, i) => (
          <circle
            key={i}
            cx={xOf(i)}
            cy={yOf(v)}
            r={7}
            className="speed-curve-point"
            role="slider"
            aria-label={`Speed point ${i + 1}`}
            aria-valuenow={Math.round(speeds[i] * 100) / 100}
            aria-valuemin={CURVE_MIN}
            aria-valuemax={CURVE_MAX}
            tabIndex={0}
            onPointerDown={(e) => {
              mark?.();
              drag.current = i;
              (e.currentTarget.ownerSVGElement as SVGSVGElement).setPointerCapture(e.pointerId);
            }}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
              e.preventDefault();
              const next = Math.min(CURVE_MAX, Math.max(CURVE_MIN, Math.round(v * (e.key === 'ArrowUp' ? 1.25 : 0.8) * 100) / 100));
              onChange(curve.map((c, j) => (j === i ? next : c)), false);
            }}
          >
            <title>{`${speeds[i].toFixed(2)}×`}</title>
          </circle>
        ))}
      </svg>
      <div className="speed-curve-labels">
        {speeds.map((v, i) => (
          <span key={i}>{v >= 10 ? Math.round(v) : v.toFixed(1)}×</span>
        ))}
      </div>
      <div className="row">
        <button onClick={() => onChange(DEFAULT_CURVE, false)}>Reset curve</button>
      </div>
      <p className="hint">Drag a point up to speed up, down for slow motion. The clip keeps its length, so speeding up one part slows the rest.</p>
    </div>
  );
}

export function AudioTools({
  volume,
  keys,
  local,
  denoise,
  mark,
  onVolume,
  onKeys,
  onDenoise,
}: {
  volume: number;
  keys: Keyframes | undefined;
  local: number;
  denoise: number | undefined;
  mark: () => void;
  onVolume: (v: number, live: boolean) => void;
  onKeys: (k: Keyframes, live: boolean) => void;
  onDenoise: (v: number) => void;
}) {
  return (
    <>
      <RangeField label="Volume" value={volume} min={0} max={2} step={0.05} onStart={mark} onChange={(v) => onVolume(v, true)} format={pct} />
      <AnimField
        label="Volume over time"
        prop="volume"
        base={1}
        keys={keys}
        local={local}
        min={0}
        max={2}
        step={0.05}
        format={pct}
        mark={mark}
        // Moving it before there are keyframes starts the automation at the playhead.
        onBase={(v, live) => onKeys({ ...keys, volume: setKey(undefined, local, v) }, live)}
        onKeys={onKeys}
      />
      <p className="hint">Press ◆, move the playhead, change the level and press ◆ again to make the sound rise or fall.</p>
      <label className="field">
        <span>Noise reduction</span>
        <select value={denoise ?? 0} onChange={(e) => onDenoise(Number(e.target.value))} aria-label="Noise reduction">
          <option value={0}>Off</option>
          <option value={1}>Light (hum &amp; hiss)</option>
          <option value={2}>Medium</option>
          <option value={3}>Strong (voice focus)</option>
        </select>
      </label>
    </>
  );
}

// ---------- Saved looks ("my presets") ----------

export interface SavedLook {
  name: string;
  filters?: Filters;
  grade?: ColorGrade | null;
}

const LOOKS_KEY = 'bee.myLooks';

export function loadSavedLooks(): SavedLook[] {
  try {
    const list = JSON.parse(localStorage.getItem(LOOKS_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((l) => l && typeof l.name === 'string') : [];
  } catch {
    return [];
  }
}

export function saveLooks(list: SavedLook[]) {
  try {
    localStorage.setItem(LOOKS_KEY, JSON.stringify(list));
  } catch {
    // Storage full or blocked: presets just aren't kept.
  }
}

export { NEUTRAL_WHEEL, ColorField };

/** "Follow something in the video": pick a point on the player and the item follows it. */
export function MotionTrackSection({ waiting, tracked, onStart, onClear }: { waiting: boolean; tracked: boolean; onStart: () => void; onClear: () => void }) {
  return (
    <>
      <h4>Motion tracking</h4>
      <p className="hint">Make this follow something that moves in the video: put the playhead where it starts, press the button, then click the thing to follow on the player.</p>
      <div className="row">
        <button className={waiting ? 'active' : ''} onClick={onStart} aria-pressed={waiting}>
          <Icon name="zoomIn" size={15} /> {waiting ? 'Click the player…' : 'Track motion'}
        </button>
        {tracked && <button onClick={onClear}>Remove tracking</button>}
      </div>
    </>
  );
}

/** Audio-reactive: the layer pulses, bounces, flickers, shakes or glows with the music. */
export function ReactSection({ react, update }: { react: React | null | undefined; update: (patch: { react: React | null }, live?: boolean) => void }) {
  return (
    <>
      <h4>Move with the music</h4>
      <div className="grid3" role="group" aria-label="Move with the music">
        <button className={!react ? 'active' : ''} onClick={() => update({ react: null })}>
          Off
        </button>
        {REACT_PROPS.map((r) => (
          <button key={r.value} className={react?.prop === r.value ? 'active' : ''} title={r.hint} onClick={() => update({ react: { prop: r.value, amount: react?.amount ?? 0.7 } })}>
            {r.label}
          </button>
        ))}
      </div>
      {react && <RangeField label="Strength" value={react.amount} min={0.05} max={1} step={0.05} onChange={(v) => update({ react: { ...react, amount: v } }, true)} format={(v) => `${Math.round(v * 100)}%`} />}
      {react && <p className="hint">Follows the music on the audio track (or the clip's own sound when there is no music).</p>}
    </>
  );
}

/** Track matte: show this layer only through a text or shape (video inside letters). */
export function MatteSection({ matte, texts, update }: { matte: Matte | null | undefined; texts: TextOverlay[]; update: (patch: { matte: Matte | null }) => void }) {
  const usable = texts.filter((t) => t.text.trim() || t.shape);
  return (
    <>
      <label className="field">
        <span>Matte (text or shape)</span>
        <select value={matte?.textId ?? ''} onChange={(e) => update({ matte: e.target.value ? { textId: e.target.value, mode: matte?.mode ?? 'alpha' } : null })} aria-label="Track matte">
          <option value="">None</option>
          {usable.map((t) => (
            <option key={t.id} value={t.id}>
              {t.shape ? `Shape: ${t.shape}` : t.text.split('\n')[0].slice(0, 30)}
            </option>
          ))}
        </select>
      </label>
      {matte && (
        <div className="grid2" role="group" aria-label="Matte mode">
          {MATTE_MODES.map((m) => (
            <button key={m.value} className={matte.mode === m.value ? 'active' : ''} title={m.hint} onClick={() => update({ matte: { ...matte, mode: m.value } })}>
              {m.label}
            </button>
          ))}
        </div>
      )}
      <p className="hint">{usable.length ? 'Shows this layer only through the chosen text or shape (which is then hidden). Try big bold text for video inside letters.' : 'Add a big text or shape first, then pick it here.'}</p>
    </>
  );
}
