import { useEffect, useMemo, useState } from 'react';
import type { Screen } from '../App';
import { createDoc } from '../design/model';
import { toFile } from '../design/pages';
import { designThumbnail } from '../design/render';
import { SIZE_PRESETS, TEMPLATES } from '../design/templates';
import { deleteProject, listProjects, loadDesignProject, loadVideoProject, newProjectId, putMedia, saveVideoProject } from '../lib/projects';
import { attachMedia, unpackProject } from '../lib/bundle';
import type { ProjectSummary } from '../lib/projects';
import { Icon } from '../ui/Icon';
import { useInstall } from '../lib/install';
import { lookAttributes, lookStyle, useLook } from '../lib/look';
import { LookSettings } from '../ui/LookSettings';
import { APP_NAME, Logo } from '../ui/Logo';
import { ASPECTS } from '../video/timeline';
import { TemplateGallery } from '../video/TemplateGallery';

/** Size of a little preview of a w×h frame that fits in a 120×64 box. */
function fitBox(w: number, h: number, maxW = 120, maxH = 64) {
  const k = Math.min(maxW / w, maxH / h);
  return { width: Math.round(w * k), height: Math.round(h * k) };
}

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
  const [showLook, setShowLook] = useState(false);
  const look = useLook();

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

  const openProjectFile = async (f: File) => {
    try {
      const { project, files } = await unpackProject(f);
      const id = newProjectId();
      for (const [assetId, blob] of files) await putMedia(assetId, blob);
      const opened = attachMedia(project, files);
      await saveVideoProject(id, opened);
      onOpen({ kind: 'video', width: opened.width, height: opened.height, project: opened, projectId: id });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not open that file');
    }
  };
  const categories = ['All', ...new Set(TEMPLATES.map((t) => t.category))];
  const shown = (projects ?? []).filter((p) => p.name.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <div className="home cc" style={lookStyle(look)} {...lookAttributes(look)}>
      <header className="home-hero">
        <div className="home-top">
          <div className="brand">
            <Logo height={30} />
            <span>{APP_NAME}</span>
          </div>
          <div className="home-top-actions">
            <button className="icon-btn" onClick={() => setShowLook(true)} title="Editor look: themes and layout" aria-label="Editor look">
              <Icon name="palette" />
            </button>
            <InstallButton />
          </div>
        </div>
        <span className="eyebrow">
          <span className="eyebrow-dot" /> Free · No sign-up · Works offline
        </span>
        <h1>
          Create something <span className="gradient-text">amazing</span>
        </h1>
        <p>Edit videos and design graphics right in your browser — with the power tools of a pro editor and the ease of an app.</p>
        <ul className="feature-pills" aria-label="Highlights">
          {['Keyframes', 'Green screen', 'Animated titles', 'Colour grading', 'Sound effects', '4K export'].map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
        <div className="hero-actions">
          <button className="hero-card video" onClick={() => onOpen({ kind: 'video', width: 1280, height: 720, projectId: newProjectId() })}>
            <span className="hero-icon">
              <Icon name="film" size={26} />
            </span>
            <span>
              <strong>Edit a video</strong>
              <small>Multi-track timeline, keyframes, titles, effects & 4K export</small>
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
              <small>Posts, thumbnails, presentations — animate & export as video</small>
            </span>
          </button>
        </div>
        <label className="open-file link">
          <Icon name="folder" size={15} /> Open a project file (.bemotion)
          <input
            type="file"
            accept=".bemotion,application/x-bemotion"
            hidden
            aria-label="Open a project file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void openProjectFile(f);
            }}
          />
        </label>
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
        <h2>Video templates</h2>
        <TemplateGallery onPick={(t) => onOpen({ kind: 'video', width: t.width, height: t.height, projectId: newProjectId(), template: t.id })} />
      </section>

      <section>
        <h2>Video sizes</h2>
        <div className="home-grid">
          {ASPECTS.map((a) => (
            <button
              key={a.label}
              className="home-card"
              onClick={() => onOpen({ kind: 'video', width: a.width, height: a.height, projectId: newProjectId() })}
            >
              <span className="ratio-wrap">
                <span className="ratio-box" style={fitBox(a.width, a.height)} />
              </span>
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
              <span className="ratio-wrap">
                <span className="ratio-box design" style={fitBox(s.width, s.height)} />
              </span>
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
      <footer className="home-footer">
        <span>{APP_NAME}</span> · Your projects stay private, on this device.
      </footer>
      {showLook && <LookSettings onClose={() => setShowLook(false)} />}
    </div>
  );
}

/** "Install app" button: one click where the browser supports it, instructions on iPhone/iPad. */
function InstallButton() {
  const { installed, canPrompt, ios, install } = useInstall();
  const [showIosHelp, setShowIosHelp] = useState(false);
  if (installed || (!canPrompt && !ios)) return null;
  return (
    <div className="install">
      <button className="secondary" onClick={() => (canPrompt ? void install() : setShowIosHelp((v) => !v))}>
        <Icon name="download" /> Install app
      </button>
      {showIosHelp && (
        <div className="install-help" role="note">
          Tap <strong>Share</strong> <span aria-hidden>⎋</span> in Safari, then <strong>Add to Home Screen</strong>.
        </div>
      )}
    </div>
  );
}
