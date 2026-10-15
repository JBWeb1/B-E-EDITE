import { useEffect, useState } from 'react';

/** Number input that commits on blur/Enter so typing doesn't create an undo step per key. */
export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(Number(value.toFixed(2)))), [value]);
  const commit = () => {
    let n = Number(draft);
    if (!Number.isFinite(n) || draft.trim() === '') return setDraft(String(value));
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    if (n !== value) onChange(n);
    else setDraft(String(value));
  };
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        value={draft}
        min={min}
        max={max}
        step={step}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
      />
    </label>
  );
}

/** Slider. `onStart` fires when the user grabs it, so the whole drag becomes one undo step. */
export function RangeField({
  label,
  value,
  onChange,
  onStart,
  min,
  max,
  step,
  format = (v) => String(Math.round(v * 100) / 100),
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  onStart?: () => void;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
}) {
  return (
    <label className="field">
      <span>
        {label} <small>{format(value)}</small>
      </span>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onPointerDown={onStart}
        onKeyDown={onStart}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

/** Color picker. `swatches` shows one-click colors (e.g. ones already used in the design). */
export function ColorField({
  label,
  value,
  onChange,
  onStart,
  swatches,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onStart?: () => void;
  swatches?: string[];
}) {
  const others = swatches?.filter((c) => c.toLowerCase() !== value.toLowerCase()) ?? [];
  return (
    <div className="color-group">
      <label className="field color-field">
        <span>{label}</span>
        <input type="color" value={value} onFocus={onStart} onClick={onStart} onChange={(e) => onChange(e.target.value)} />
      </label>
      {others.length > 0 && (
        <div className="mini-swatches" aria-label={`${label}: colors in this design`}>
          {others.map((c) => (
            <button
              key={c}
              className="mini-swatch"
              style={{ background: c }}
              title={c}
              onClick={() => {
                onStart?.();
                onChange(c);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
