import { useEffect, useRef } from 'react';
import { isCustomized, LOOK_TEMPLATES, lookFromTemplate, setLook, templateById, useLook } from '../lib/look';
import type { Look, LookTemplate } from '../lib/look';
import { Icon } from './Icon';

const ACCENTS = ['#00c8d2', '#8b5cf6', '#2d8ceb', '#f2c94c', '#e8833a', '#ef4444', '#ec4899', '#22c55e'];

/** Tiny drawing of an editor in the template's colours. */
function Preview({ t }: { t: LookTemplate }) {
  const p = t.palette;
  const r = t.layout.corners === 'square' ? 1 : 3;
  const panel = { background: p.surface, borderRadius: r };
  return (
    <div className="look-preview" style={{ background: p.bg }} aria-hidden>
      <div className="lp-top" style={{ background: p.surface }}>
        <span style={{ background: p.accent }} />
      </div>
      <div className="lp-main">
        <div style={panel} />
        <div className="lp-player" style={panel}>
          <span style={{ background: p.light ? '#1b1b1f' : '#050506' }} />
        </div>
        <div style={panel} />
      </div>
      <div className="lp-timeline" style={{ ...panel, height: t.layout.timeline === 'large' ? '42%' : '34%' }}>
        <span style={{ background: p.textClip, width: '30%', marginLeft: '8%' }} />
        <span style={{ background: p.clip, width: '70%' }} />
        <span style={{ background: p.audioClip, width: '55%' }} />
        <i style={{ background: p.playhead }} />
      </div>
    </div>
  );
}

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="look-option">
      <span>{label}</span>
      <div className="segmented" role="group" aria-label={label}>
        {options.map(([v, text]) => (
          <button key={v} className={value === v ? 'active' : ''} aria-pressed={value === v} onClick={() => onChange(v)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

/** "Editor look" dialog: pick a template, then tweak layout and colour. Changes apply live. */
export function LookSettings({ onClose }: { onClose: () => void }) {
  const look = useLook();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCloseRef.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const update = (patch: Partial<Look>) => setLook({ ...look, ...patch });
  const accent = look.accent ?? templateById(look.template).palette.accent;

  return (
    <div className="modal-backdrop" data-modal onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal look-modal" role="dialog" aria-label="Editor look">
        <div className="look-head">
          <h3>Editor look</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close" title="Close (Esc)">
            <Icon name="x" />
          </button>
        </div>
        <p className="hint">Pick a template inspired by other editing apps, then fine-tune it. Your choice is saved on this device and used in both editors.</p>

        <div className="look-grid">
          {LOOK_TEMPLATES.map((t) => (
            <button
              key={t.id}
              className={`look-card ${look.template === t.id ? 'active' : ''}`}
              aria-pressed={look.template === t.id}
              aria-label={t.name}
              onClick={() => setLook(lookFromTemplate(t.id))}
            >
              <Preview t={t} />
              <strong>{t.name}</strong>
              <small>{t.note}</small>
            </button>
          ))}
        </div>

        <h4>Layout</h4>
        <Segmented label="Library panel" value={look.library} options={[['left', 'Left'], ['right', 'Right']]} onChange={(library) => update({ library })} />
        <Segmented label="Timeline" value={look.timeline} options={[['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']]} onChange={(timeline) => update({ timeline })} />
        <Segmented label="Corners" value={look.corners} options={[['round', 'Rounded'], ['square', 'Square']]} onChange={(corners) => update({ corners })} />
        <Segmented label="Spacing" value={look.density} options={[['comfortable', 'Roomy'], ['compact', 'Compact']]} onChange={(density) => update({ density })} />

        <h4>Highlight colour</h4>
        <div className="look-accents">
          {ACCENTS.map((c) => (
            <button key={c} className={`swatch ${accent === c ? 'active' : ''}`} style={{ background: c }} onClick={() => update({ accent: c })} aria-label={`Highlight ${c}`} title={c} />
          ))}
          <label className="swatch custom-swatch" title="Any colour">
            <input type="color" value={accent} onChange={(e) => update({ accent: e.target.value })} aria-label="Custom highlight colour" />
          </label>
        </div>

        <div className="look-actions">
          <button onClick={() => setLook(lookFromTemplate(look.template))} disabled={!isCustomized(look)}>
            Reset to template
          </button>
          <button className="primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
