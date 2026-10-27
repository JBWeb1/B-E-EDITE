import { paintScene, templateDuration, VIDEO_TEMPLATES } from './videoTemplates';
import type { VideoTemplate } from './videoTemplates';

const thumbs = new Map<string, string>();

/** Little painted preview of a template's first scene and its title (drawn once, then cached). */
function thumbnail(t: VideoTemplate): string {
  const cached = thumbs.get(t.id);
  if (cached) return cached;
  const scale = 240 / Math.max(t.width, t.height);
  const c = document.createElement('canvas');
  c.width = Math.round(t.width * scale);
  c.height = Math.round(t.height * scale);
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  paintScene(ctx, t.scenes[0], c.width, c.height, 1);
  const lines = t.texts.find((x) => x.patch.text && !x.patch.shape)?.patch.text?.split('\n') ?? [t.name];
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 6;
  let size = Math.min(c.width, c.height) * 0.16;
  const fit = () => {
    ctx.font = `800 ${size}px Inter, sans-serif`;
    return Math.max(...lines.map((l) => ctx.measureText(l).width)) <= c.width * 0.86;
  };
  while (!fit() && size > 6) size -= 1;
  lines.forEach((l, i) => ctx.fillText(l, c.width / 2, c.height * 0.48 + (i - (lines.length - 1) / 2) * size * 1.15));
  const url = c.toDataURL('image/png');
  thumbs.set(t.id, url);
  return url;
}

export function TemplateGallery({ onPick, compact = false }: { onPick: (t: VideoTemplate) => void; compact?: boolean }) {
  return (
    <div className={`vtpl-grid ${compact ? 'compact' : ''}`}>
      {VIDEO_TEMPLATES.map((t) => (
        <button key={t.id} className="vtpl-card" onClick={() => onPick(t)} aria-label={`Video template: ${t.name}`} title={t.blurb}>
          <span className="vtpl-thumb">
            <img src={thumbnail(t)} alt="" />
          </span>
          <strong>{t.name}</strong>
          <small>
            {t.width > t.height ? '16:9' : t.width === t.height ? '1:1' : '9:16'} · {Math.round(templateDuration(t))}s
          </small>
        </button>
      ))}
    </div>
  );
}
