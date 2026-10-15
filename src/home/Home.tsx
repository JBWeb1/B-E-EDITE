import { useEffect, useMemo, useState } from 'react';
import type { Screen } from '../App';
import { AUTOSAVE_KEY } from '../design/DesignEditor';
import { createDoc, isDesignDoc } from '../design/model';
import { designThumbnail } from '../design/render';
import { SIZE_PRESETS, TEMPLATES } from '../design/templates';
import type { DesignDoc } from '../design/types';
import { getSavedVideoInfo, loadVideoProject } from '../video/storage';
import type { SavedVideoInfo } from '../video/storage';
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
  const designPreview = useMemo(() => (autosave ? designThumbnail(autosave) : null), [autosave]);
  const templates = useMemo(() => TEMPLATES.map((t) => ({ ...t, thumb: designThumbnail(t.build()) })), []);
  const [savedVideo, setSavedVideo] = useState<SavedVideoInfo | null>(null);
  const [filter, setFilter] = useState<string>('All');

  useEffect(() => {
    void getSavedVideoInfo().then(setSavedVideo);
  }, []);

  const openSavedVideo = async () => {
    try {
      const project = await loadVideoProject();
      if (project) onOpen({ kind: 'video', width: project.width, height: project.height, project });
    } catch {
      alert('Could not open the saved video.');
    }
  };

  const categories = ['All', ...new Set(TEMPLATES.map((t) => t.category))];

  return (
    <div className="home">
      <header className="home-hero">
        <h1>
          <span className="logo">B-E</span> EDITE
        </h1>
        <p>Make designs and edit videos right in your browser. No sign-up, nothing to install.</p>
      </header>

      {(autosave || savedVideo) && (
        <section>
          <h2>⏯ Continue where you left off</h2>
          <div className="home-grid">
            {autosave && (
              <button className="home-card continue" onClick={() => onOpen({ kind: 'design', doc: autosave })}>
                {designPreview && <img src={designPreview} alt="" />}
                <strong>{autosave.name}</strong>
                <small>Design · {autosave.width}×{autosave.height}</small>
              </button>
            )}
            {savedVideo && (
              <button className="home-card continue" onClick={openSavedVideo}>
                {savedVideo.thumbnail && <img src={savedVideo.thumbnail} alt="" />}
                <strong>{savedVideo.name}</strong>
                <small>Video · {savedVideo.clipCount} clip{savedVideo.clipCount === 1 ? '' : 's'}</small>
              </button>
            )}
          </div>
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
        <div className="row">
          {categories.map((c) => (
            <button key={c} className={filter === c ? 'active' : ''} onClick={() => setFilter(c)} style={{ flex: 'none' }}>
              {c}
            </button>
          ))}
        </div>
        <div className="home-grid">
          {templates
            .filter((t) => filter === 'All' || t.category === filter)
            .map((t) => (
              <button key={t.label} className="home-card" onClick={() => onOpen({ kind: 'design', doc: t.build() })}>
                <img src={t.thumb} alt="" />
                <strong>{t.label}</strong>
                <small>{t.category}</small>
              </button>
            ))}
        </div>
      </section>
    </div>
  );
}
