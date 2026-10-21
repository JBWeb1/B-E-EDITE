import { RangeField } from '../ui/fields';
import { Icon } from '../ui/Icon';
import { setKey } from '../video/anim';
import { AnimField, KeyframeTools } from '../video/inspector';
import { hasMotion, motionBase } from './motion';
import { isNeutralPhoto, NEUTRAL_PHOTO, PHOTO_PRESETS } from './photo';
import type { PhotoAdjust } from './photo';
import type { DesignElement, ImageElement } from './types';

const pct = (v: number) => `${Math.round(v * 100)}%`;
const signed = (v: number) => (v > 0 ? `+${Math.round(v)}` : `${Math.round(v)}`);

/** Keyframes for one design element: scrub the page time, then set values with ◆. */
export function MotionSection({
  el,
  page,
  time,
  duration,
  mark,
  onTime,
  onPlay,
  update,
}: {
  el: DesignElement;
  page: { width: number; height: number };
  time: number | null;
  duration: number;
  mark: () => void;
  onTime: (t: number | null) => void;
  onPlay: () => void;
  update: (patch: Partial<DesignElement>, live?: boolean) => void;
}) {
  const local = time ?? 0;
  const base = motionBase(el, page);
  // The resting values (no keyframes) live in the element itself.
  const onBase = (patch: Partial<typeof base>, live: boolean) => {
    const next: Partial<DesignElement> = {};
    if (patch.x !== undefined) next.x = Math.round(patch.x * page.width - el.width / 2);
    if (patch.y !== undefined) next.y = Math.round(patch.y * page.height - el.height / 2);
    if (patch.rotation !== undefined) next.rotation = patch.rotation;
    if (patch.opacity !== undefined) next.opacity = patch.opacity;
    // Size has no resting value of its own (width/height are that), so it is always a keyframe.
    if (patch.scale !== undefined) next.keys = { ...el.keys, scale: setKey(el.keys?.scale, local, patch.scale) };
    update(next, live);
  };
  const field = (label: string, prop: 'x' | 'y' | 'scale' | 'rotation' | 'opacity', min: number, max: number, step: number, format: (v: number) => string) => (
    <AnimField
      label={label}
      prop={prop}
      base={base[prop]}
      keys={el.keys}
      local={local}
      min={min}
      max={max}
      step={step}
      format={format}
      mark={mark}
      onBase={(v, live) => onBase({ [prop]: v }, live)}
      onKeys={(keys, live) => {
        if (time === null) onTime(0);
        update({ keys }, live);
      }}
    />
  );
  return (
    <div className="design-motion">
      <h4>Keyframes</h4>
      <div className="motion-time">
        <RangeField
          label="Time on page"
          value={local}
          min={0}
          max={duration}
          step={0.05}
          onChange={(v) => onTime(v)}
          format={(v) => `${v.toFixed(2)}s`}
        />
        <button className="icon-btn" onClick={onPlay} title="Play the page" aria-label="Play the page">
          ▶
        </button>
      </div>
      {time !== null && (
        <p className="hint motion-note">
          Showing the page at {local.toFixed(2)}s.{' '}
          <button className="link" onClick={() => onTime(null)}>
            Done
          </button>
        </p>
      )}
      {field('Left / right', 'x', -0.5, 1.5, 0.002, pct)}
      {field('Up / down', 'y', -0.5, 1.5, 0.002, pct)}
      {field('Size', 'scale', 0.05, 4, 0.01, pct)}
      {field('Rotate', 'rotation', -360, 360, 1, (v) => `${Math.round(v)}°`)}
      {field('Opacity', 'opacity', 0, 1, 0.01, pct)}
      <KeyframeTools
        item={el}
        local={local}
        length={duration}
        base={base}
        mark={mark}
        motionBlur={false}
        onSeekLocal={(t) => onTime(t)}
        update={(patch, live) => {
          update(patch as Partial<DesignElement>, live);
          // Replay once a change is finished (not on every step of a drag).
          if (!live && hasMotion({ ...el, ...patch } as DesignElement) && patch.keys) onPlay();
        }}
      />
    </div>
  );
}

/** Photo editing: exposure, white balance, light and detail, with one-click looks. */
export function PhotoTools({ el, mark, onChange }: { el: ImageElement; mark: () => void; onChange: (p: PhotoAdjust | undefined, live?: boolean) => void }) {
  const p = { ...NEUTRAL_PHOTO, ...el.photo };
  const set = (patch: Partial<PhotoAdjust>) => onChange({ ...p, ...patch }, true);
  return (
    <div className="photo-tools">
      <h4>
        <Icon name="image" size={13} /> Photo
      </h4>
      <div className="grid3">
        {PHOTO_PRESETS.map((x) => (
          <button key={x.label} onClick={() => onChange({ ...NEUTRAL_PHOTO, ...x.photo })}>
            {x.label}
          </button>
        ))}
      </div>
      <RangeField label="Exposure" value={p.exposure} min={-2} max={2} step={0.05} onStart={mark} onChange={(v) => set({ exposure: v })} format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(2)} EV`} />
      <RangeField label="Temperature" value={p.temperature} min={-100} max={100} step={1} onStart={mark} onChange={(v) => set({ temperature: v })} format={signed} />
      <RangeField label="Tint" value={p.tint} min={-100} max={100} step={1} onStart={mark} onChange={(v) => set({ tint: v })} format={signed} />
      <RangeField label="Highlights" value={p.highlights} min={-100} max={100} step={1} onStart={mark} onChange={(v) => set({ highlights: v })} format={signed} />
      <RangeField label="Shadows" value={p.shadows} min={-100} max={100} step={1} onStart={mark} onChange={(v) => set({ shadows: v })} format={signed} />
      <RangeField label="Sharpen" value={p.sharpen} min={0} max={1} step={0.01} onStart={mark} onChange={(v) => set({ sharpen: v })} format={pct} />
      <RangeField label="Vignette" value={p.vignette} min={0} max={1} step={0.01} onStart={mark} onChange={(v) => set({ vignette: v })} format={pct} />
      {!isNeutralPhoto(el.photo) && (
        <button className="block" onClick={() => onChange(undefined)}>
          Reset photo
        </button>
      )}
    </div>
  );
}
