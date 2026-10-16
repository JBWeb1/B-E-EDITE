import { useEffect, useRef, useState } from 'react';
import { Icon } from '../ui/Icon';
import { SAFE_ZONES, scoreLabel } from './preflight';
import type { Finding, FixId, Platform } from './preflight';
import { runPreflight } from './preflightRun';
import type { PreflightReport } from './preflightRun';
import type { VideoProject } from './types';

const ICONS: Record<Finding['severity'], string> = { ok: '✓', tip: '💡', warn: '!', danger: '⚠' };

/**
 * "Will this video work?" — hook score, accessibility and safe zones in one place,
 * each with a jump-to button and a one-click fix where we know how.
 */
export function PreflightDialog({
  project,
  platform,
  onPlatform,
  showZones,
  onShowZones,
  onClose,
  onSeek,
  onFix,
  onExport,
}: {
  project: VideoProject;
  platform: Platform;
  onPlatform: (p: Platform) => void;
  showZones: boolean;
  onShowZones: (on: boolean) => void;
  onClose: () => void;
  onSeek: (t: number) => void;
  onFix: (fix: FixId, ids: string[]) => void;
  onExport?: () => void;
}) {
  const [report, setReport] = useState<PreflightReport | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [run, setRun] = useState(0);
  const projectRef = useRef(project);
  projectRef.current = project;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    let cancelled = false;
    setReport(null);
    setError('');
    setProgress(0);
    runPreflight(projectRef.current, platform, (f) => !cancelled && setProgress(f)).then(
      (r) => !cancelled && setReport(r),
      (e) => !cancelled && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [platform, run]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCloseRef.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const fix = (f: Finding) => {
    if (!f.fix || !report) return;
    onFix(f.fix, report.targets[f.id] ?? []);
    // Check again once the change is in.
    setTimeout(() => setRun((n) => n + 1), 50);
  };

  const list = (items: Finding[]) => (
    <ul className="pf-list">
      {items.map((f) => (
        <li key={f.id} className={`pf-item ${f.severity}`}>
          <span className="pf-icon" aria-hidden>
            {ICONS[f.severity]}
          </span>
          <div>
            <strong>{f.title}</strong>
            <p>{f.detail}</p>
          </div>
          <div className="pf-actions">
            {f.at !== undefined && f.severity !== 'ok' && (
              <button className="icon-btn" onClick={() => onSeek(f.at!)} title="Show me" aria-label={`Show ${f.title}`}>
                <Icon name="eye" size={15} />
              </button>
            )}
            {f.fix && f.fix !== 'add-captions' && (
              <button className="primary" onClick={() => fix(f)}>
                Fix
              </button>
            )}
            {f.fix === 'add-captions' && <button onClick={() => (onFix('add-captions', []), onClose())}>Add captions</button>}
          </div>
        </li>
      ))}
    </ul>
  );

  const problems = report ? [...report.hookFindings, ...report.access, ...report.safe].filter((f) => f.severity === 'warn' || f.severity === 'danger').length : 0;
  const ring = report ? report.hook : 0;
  return (
    <div className="modal-backdrop" data-modal onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal preflight-modal" role="dialog" aria-label="Pre-flight check">
        <div className="look-head">
          <h3>Pre-flight check</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close" title="Close (Esc)">
            <Icon name="x" />
          </button>
        </div>
        <p className="hint">Checks your video the way viewers and platforms will see it, before you post.</p>
        <div className="row pf-platform">
          <label className="field grow">
            <span>Posting to</span>
            <select value={platform} onChange={(e) => onPlatform(e.target.value as Platform)} aria-label="Posting to">
              {SAFE_ZONES.map((z) => (
                <option key={z.id} value={z.id}>{z.label}</option>
              ))}
            </select>
          </label>
          <button className={showZones ? 'active' : ''} aria-pressed={showZones} onClick={() => onShowZones(!showZones)} title="Show where the app's buttons cover your video">
            <Icon name="layout" size={15} /> Safe zones on player
          </button>
        </div>
        {!report && !error && (
          <div className="pf-running" role="status">
            <div className="progress">
              <div style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <span>Watching your video… {Math.round(progress * 100)}%</span>
          </div>
        )}
        {error && <p className="ai-message">Could not check the video: {error}</p>}
        {report && (
          <>
            <div className="pf-summary">
              <div className={`pf-score ${ring >= 80 ? 'great' : ring >= 60 ? 'good' : ring >= 40 ? 'fair' : 'weak'}`} style={{ ['--score' as string]: ring }} aria-label={`Hook score ${ring} out of 100`}>
                <span>{ring}</span>
              </div>
              <div>
                <strong>{scoreLabel(ring)}</strong>
                <p className="hint">{problems === 0 ? 'Ready to post 🚀' : `${problems} thing${problems === 1 ? '' : 's'} to look at before posting`}</p>
              </div>
            </div>
            <h4>Hook (first 3 seconds)</h4>
            {list(report.hookFindings)}
            <h4>Accessibility & safety</h4>
            {list(report.access)}
            <h4>Safe zones</h4>
            {list(report.safe)}
            <div className="row">
              <button onClick={() => setRun((n) => n + 1)}>Check again</button>
              {onExport && (
                <button className="primary" onClick={onExport}>
                  <Icon name="download" size={15} /> Export
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Translucent boxes over the player where the app's buttons and captions go. */
export function SafeZoneOverlay({ platform }: { platform: Platform }) {
  const zone = SAFE_ZONES.find((z) => z.id === platform)!;
  return (
    <div className="safe-zones" aria-hidden>
      {zone.covered.map((c) => (
        <div key={c.label} className="safe-zone" style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: `${c.w * 100}%`, height: `${c.h * 100}%` }}>
          <span>{c.label}</span>
        </div>
      ))}
      <span className="safe-zone-name">{zone.label} safe zones</span>
    </div>
  );
}
