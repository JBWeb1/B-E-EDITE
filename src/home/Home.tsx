import { useMemo } from 'react';
import type { Screen } from '../App';
import { AUTOSAVE_KEY } from '../design/DesignEditor';
import { createDoc, isDesignDoc } from '../design/model';
import { SIZE_PRESETS, TEMPLATES } from '../design/templates';
import type { DesignDoc } from '../design/types';
import { ASPECTS } from '../video/timeline';

function loadAutosave(): DesignDoc | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return isDesignDoc(parsed) && parsed.elements.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

export function Home({ onOpen }: { onOpen: (s: Screen) => void }) {
  const autosave = useMemo(loadAutosave, []);

  return (
    <div className="home">
      <header className="home-hero">
        <h1>
          <span className="logo">B-E</span> EDITE
        </h1>
        <p>Make designs and edit videos right in your browser. No sign-up, nothing to install.</p>
      </header>

      {autosave && (
        <section>
          <button className="primary" onClick={() => onOpen({ kind: 'design', doc: autosave })}>
            Continue “{autosave.name}”
          </button>
        </section>
      )}

      <section>
        <h2>🎬 Edit a video</h2>
        <div className="home-grid">
          {ASPECTS.map((a) => (
            <button key={a.label} className="home-card" onClick={() => onOpen({ kind: 'video', width: a.width, height: a.height })}>
              <span className="ratio-box" style={{ aspectRatio: `${a.width} / ${a.height}` }} />
              <strong>{a.label}</strong>
              <small>{a.width}×{a.height}</small>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2>🎨 Create a design</h2>
        <div className="home-grid">
          {SIZE_PRESETS.map((s) => (
            <button key={s.label} className="home-card" onClick={() => onOpen({ kind: 'design', doc: createDoc(s.width, s.height, s.label) })}>
              <span className="ratio-box design" style={{ aspectRatio: `${s.width} / ${s.height}` }} />
              <strong>{s.label}</strong>
              <small>{s.width}×{s.height}</small>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2>✨ Start from a template</h2>
        <div className="home-grid">
          {TEMPLATES.map((t) => (
            <button key={t.label} className="home-card" onClick={() => onOpen({ kind: 'design', doc: t.build() })}>
              <strong>{t.label}</strong>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
