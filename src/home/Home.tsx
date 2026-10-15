import { useEffect, useMemo, useState } from 'react';
import type { Screen } from '../App';
import { createDoc } from '../design/model';
import { toFile } from '../design/pages';
import { designThumbnail } from '../design/render';
import { SIZE_PRESETS, TEMPLATES } from '../design/templates';
import { deleteProject, listProjects, loadDesignProject, loadVideoProject, newProjectId } from '../lib/projects';
import type { ProjectSummary } from '../lib/projects';
import { Icon } from '../ui/Icon';
import { APP_NAME, Logo } from '../ui/Logo';
import { ASPECTS } from '../video/timeline';

function timeAgo(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

export function Home({ onOpen }: { onOpen: (s: Screen) => void }) {
  const templates = useMemo(() => TEMPLATES.map((t) => ({ ...t, thumb: designThumbnail(t.build()) })), []);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [filter, setFilter] = useState<string>('All');
  const [search, setSearch] = useState('');

  const refresh = () => listProjects().then(setProjects, () => setProjects([]));
  useEffect(() => {
    void refresh();
  }, []);

  const open = async (p: ProjectSummary) => {
    try {
      if (p.kind === 'design') {
        const file = await loadDesignProject(p.id);
        if (file) onOpen({ kind: 'design', file, projectId: p.id });
      } else {
        const project = await loadVideoProject(p.id);
        if (project) onOpen({ kind: 'video', width: project.width, height: project.height, project, projectId: p.id });
      }
    } catch {
      alert('Could not open that project.');
    }
  };

  const remove = async (p: ProjectSummary) => {
    if (!confirm(`Delete “${p.name}”? This cannot be undone.`)) return;
    await deleteProject(p.id);
    await refresh();
  };

  const categories = ['All', ...new Set(TEMPLATES.map((t) => t.category))];
  const shown = (projects ?? []).filter((p) => p.name.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <div className="home">
      <header className="home-hero">
        <div className="brand">
          <Logo height={30} />
          <span>{APP_NAME}</span>
        </div>
        <h1>
          Create something <span className="gradient-text">amazing</span>
        </h1>
        <p>Design graphics and edit videos right in your browser. No sign-up, nothing to install.</p>
        <div className="hero-actions">
          <button className="hero-card video" onClick={() => onOpen({ kind: 'video', width: 1280, height: 720, projectId: newProjectId() })}>
            <span className="hero-icon">
              <Icon name="film" size={26} />
            </span>
            <span>
              <strong>Edit a video</strong>
              <small>Trim clips, add music, captions, transitions & effects</small>
            </span>
          </button>
          <button
            className="hero-card design"
            onClick={() => onOpen({ kind: 'design', file: toFile(createDoc(1080, 1080, 'Instagram Post')), projectId: newProjectId() })}
          >
            <span className="hero-icon">
              <Icon name="sparkles" size={26} />
            </span>
            <span>
              <strong>Create a design</strong>
              <small>Posts, posters, thumbnails, presentations & more</small>
            </span>
          </button>
        </div>
      </header>

      {projects && projects.length > 0 && (
        <section>
          <div className="section-head">
            <h2>Your projects</h2>
            {projects.length > 4 && (
              <label className="search">
                <Icon name="search" size={16} />
                <input placeholder="Search projects…" value={search} onChange={(e) => setSearch(e.target.value)} />
              </label>
            )}
          </div>
          <div className="home-grid">
            {shown.map((p) => (
              <div key={p.id} className="project-card">
                <button className="home-card continue" onClick={() => void open(p)}>
                  {p.thumbnail ? <img src={p.thumbnail} alt="" /> : <span className="thumb-empty"><Icon name={p.kind === 'video' ? 'film' : 'image'} size={28} /></span>}
                  <span className={`kind-badge ${p.kind}`}>{p.kind === 'video' ? 'Video' : 'Design'}</span>
                  <strong>{p.name || 'Untitled'}</strong>
                  <small>
                    {p.detail} · {timeAgo(p.updatedAt)}
                  </small>
                </button>
                <button className="project-delete" title="Delete project" aria-label={`Delete ${p.name}`} onClick={() => void remove(p)}>
                  <Icon name="trash" size={15} />
                </button>
              </div>
            ))}
            {shown.length === 0 && <p className="hint">No projects match “{search}”.</p>}
          </div>
        </section>
      )}

      <section>
        <h2>Video sizes</h2>
        <div className="home-grid">
          {ASPECTS.map((a) => (
            <button
              key={a.label}
              className="home-card"
              onClick={() => onOpen({ kind: 'video', width: a.width, height: a.height, projectId: newProjectId() })}
            >
              <span className="ratio-box" style={{ aspectRatio: `${a.width} / ${a.height}` }} />
              <strong>{a.label}</strong>
              <small>{a.width}×{a.height}</small>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2>Design sizes</h2>
        <div className="home-grid">
          {SIZE_PRESETS.map((s) => (
            <button
              key={s.label}
              className="home-card"
              onClick={() => onOpen({ kind: 'design', file: toFile(createDoc(s.width, s.height, s.label)), projectId: newProjectId() })}
            >
              <span className="ratio-box design" style={{ aspectRatio: `${s.width} / ${s.height}` }} />
              <strong>{s.label}</strong>
              <small>{s.width}×{s.height}</small>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2>Start from a template</h2>
        <div className="chips">
          {categories.map((c) => (
            <button key={c} className={`chip ${filter === c ? 'active' : ''}`} onClick={() => setFilter(c)}>
              {c}
            </button>
          ))}
        </div>
        <div className="home-grid">
          {templates
            .filter((t) => filter === 'All' || t.category === filter)
            .map((t) => (
              <button key={t.label} className="home-card" onClick={() => onOpen({ kind: 'design', file: toFile(t.build()), projectId: newProjectId() })}>
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
