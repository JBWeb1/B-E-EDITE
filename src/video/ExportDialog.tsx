import { useEffect, useRef, useState } from 'react';
import { formatTime } from '../lib/download';
import { RangeField } from '../ui/fields';
import { Icon } from '../ui/Icon';
import { availableFormats, DEFAULT_WATERMARK, estimateMB, EXPORT_PRESETS, FPS_CHOICES, outputSize, pickMimeType, presetFits, RESOLUTIONS, suggestedBitrate } from './export';
import type { ExportPreset, Fps, VideoFormat } from './export';
import type { VideoProject, Watermark, WatermarkPosition } from './types';

const QUALITY = [
  { label: 'Smaller file', factor: 0.55 },
  { label: 'Standard', factor: 1 },
  { label: 'Best', factor: 1.7 },
];

const POSITIONS: { value: WatermarkPosition; label: string }[] = [
  { value: 'top-left', label: '↖ Top left' },
  { value: 'top-right', label: '↗ Top right' },
  { value: 'bottom-left', label: '↙ Bottom left' },
  { value: 'bottom-right', label: '↘ Bottom right' },
  { value: 'center', label: 'Centre' },
];

export interface VideoExportChoice {
  width: number;
  height: number;
  fps: Fps;
  bitrate: number;
  format: VideoFormat;
}

const canRecord = (t: string) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t);

export function ExportDialog({
  project,
  duration,
  onClose,
  onExport,
  onSaveFrame,
  onSaveAudio,
  onWatermark,
  onLogo,
  onAspect,
  onPreflight,
}: {
  project: VideoProject;
  duration: number;
  onClose: () => void;
  onExport: (c: VideoExportChoice) => void;
  onSaveFrame: (type: 'image/png' | 'image/jpeg', width: number, height: number) => void;
  onSaveAudio: () => void;
  onWatermark: (w: Watermark | null, live?: boolean) => void;
  onLogo: (file: File) => void;
  onAspect: (width: number, height: number) => void;
  onPreflight?: () => void;
}) {
  const [short, setShort] = useState(1080);
  const [fps, setFps] = useState<Fps>(30);
  const [quality, setQuality] = useState(1);
  const [presetId, setPresetId] = useState<string | null>(null);
  const formats = availableFormats(canRecord);
  const [format, setFormat] = useState<VideoFormat>(formats[0] ?? 'webm');
  const mp4IsH264 = /avc1/.test(pickMimeType('mp4', canRecord) ?? '');
  const logoInput = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCloseRef.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const size = outputSize(project, short);
  const bitrate = Math.round(suggestedBitrate(size.width, size.height, fps) * QUALITY[quality].factor);
  const wm = project.watermark;
  const logoAsset = wm?.assetId ? project.assets.find((a) => a.id === wm.assetId) : undefined;

  const pickPreset = (p: ExportPreset) => {
    if (!presetFits(p, project)) {
      const shape = p.height > p.width ? 'vertical (9:16)' : p.width === p.height ? 'square (1:1)' : p.width / p.height > 1.5 ? 'landscape (16:9)' : 'portrait (4:5)';
      if (!confirm(`${p.label} is ${shape}. Change your video to that shape? (You can undo this.)`)) return;
      // Keep the project at an editing-friendly size with the preset's shape.
      const scale = 1280 / Math.max(p.width, p.height);
      onAspect(Math.round((p.width * scale) / 2) * 2, Math.round((p.height * scale) / 2) * 2);
    }
    setPresetId(p.id);
    setShort(Math.min(p.width, p.height));
    setFps(p.fps);
    setQuality(1);
  };

  const setWm = (patch: Partial<Watermark>, live = false) => onWatermark({ ...(wm ?? DEFAULT_WATERMARK), ...patch }, live);

  return (
    <div className="modal-backdrop" data-modal onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal export-modal" role="dialog" aria-label="Export video">
        <div className="look-head">
          <h3>Export</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close" title="Close (Esc)">
            <Icon name="x" />
          </button>
        </div>
        {onPreflight && (
          <button className="pf-cta" onClick={onPreflight}>
            <Icon name="check" size={15} /> Run the pre-flight check first <small>hook score · safe zones · accessibility</small>
          </button>
        )}
        <p className="hint">
          {formatTime(duration)} · output {size.width} × {size.height} · {fps} fps · about {estimateMB(duration, bitrate).toFixed(1)} MB
        </p>

        <h4>One-click presets</h4>
        <div className="preset-grid">
          {EXPORT_PRESETS.map((p) => (
            <button key={p.id} className={`preset-card ${presetId === p.id ? 'active' : ''}`} onClick={() => pickPreset(p)} aria-label={p.label}>
              <span className={`preset-shape ${p.height > p.width ? 'tall' : p.width === p.height ? 'square' : p.height / p.width > 0.7 ? 'portrait' : 'wide'}`} />
              <strong>{p.label}</strong>
              <small>
                {p.width}×{p.height} · {p.fps}fps
              </small>
            </button>
          ))}
        </div>

        <h4>Resolution</h4>
        <div className="segmented" role="group" aria-label="Resolution">
          {RESOLUTIONS.map((r) => (
            <button key={r.label} className={short === r.short ? 'active' : ''} onClick={() => (setShort(r.short), setPresetId(null))}>
              {r.label}
            </button>
          ))}
        </div>
        <h4>Smoothness (frames per second)</h4>
        <div className="segmented" role="group" aria-label="Frame rate">
          {FPS_CHOICES.map((f) => (
            <button key={f} className={fps === f ? 'active' : ''} onClick={() => (setFps(f), setPresetId(null))}>
              {f}
            </button>
          ))}
        </div>
        <h4>Quality</h4>
        <div className="segmented" role="group" aria-label="Quality">
          {QUALITY.map((q, i) => (
            <button key={q.label} className={quality === i ? 'active' : ''} onClick={() => setQuality(i)}>
              {q.label}
            </button>
          ))}
        </div>
        {short >= 2160 && <p className="hint">4K takes a powerful computer; if the export stutters, try 1440p.</p>}

        <h4>File type</h4>
        <div className="segmented" role="group" aria-label="File type">
          {(['mp4', 'webm'] as const).map((f) => (
            <button key={f} className={format === f ? 'active' : ''} disabled={!formats.includes(f)} onClick={() => setFormat(f)}>
              {f === 'mp4' ? 'MP4' : 'WebM'}
            </button>
          ))}
        </div>
        <p className="hint">
          {!formats.includes('mp4')
            ? 'This browser can only make WebM. For MP4, use Chrome, Edge or Safari.'
            : format === 'mp4'
              ? mp4IsH264
                ? 'MP4 (H.264) plays on every phone, computer and social site.'
                : 'MP4 file. For the widest support (H.264), export from Chrome, Edge or Safari.'
              : 'WebM: smaller files; YouTube, TikTok and Instagram accept it.'}
        </p>

        <h4>Watermark</h4>
        <div className="row">
          <button className={wm ? 'active' : ''} onClick={() => onWatermark(wm ? null : DEFAULT_WATERMARK)} aria-pressed={!!wm}>
            {wm ? 'Watermark on' : 'Add watermark'}
          </button>
          <button onClick={() => logoInput.current?.click()}>
            <Icon name="upload" size={15} /> {logoAsset ? 'Change logo' : 'Use a logo'}
          </button>
          <input
            ref={logoInput}
            type="file"
            accept="image/*"
            hidden
            aria-label="Watermark logo"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) onLogo(f);
            }}
          />
        </div>
        {wm && (
          <>
            {logoAsset ? (
              <div className="row">
                <img className="wm-logo" src={logoAsset.url} alt="" />
                <button onClick={() => setWm({ assetId: undefined })}>Use text instead</button>
              </div>
            ) : (
              <label className="field">
                <span>Text</span>
                <input value={wm.text} onChange={(e) => setWm({ text: e.target.value }, true)} aria-label="Watermark text" />
              </label>
            )}
            <label className="field">
              <span>Position</span>
              <select value={wm.position} onChange={(e) => setWm({ position: e.target.value as WatermarkPosition })} aria-label="Watermark position">
                {POSITIONS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </label>
            <RangeField label="Size" value={wm.size} min={0.05} max={0.5} step={0.01} onChange={(v) => setWm({ size: v }, true)} format={(v) => `${Math.round(v * 100)}%`} />
            <RangeField label="Opacity" value={wm.opacity} min={0.1} max={1} step={0.01} onChange={(v) => setWm({ opacity: v }, true)} format={(v) => `${Math.round(v * 100)}%`} />
          </>
        )}

        <div className="export-actions">
          <button className="primary block" onClick={() => onExport({ ...size, fps, bitrate, format })} disabled={duration <= 0}>
            <Icon name="film" /> Export video
          </button>
          <div className="row">
            <button onClick={() => onSaveFrame('image/png', size.width, size.height)} title="This frame at the chosen resolution">
              <Icon name="image" size={15} /> Frame PNG
            </button>
            <button onClick={() => onSaveFrame('image/jpeg', size.width, size.height)}>
              <Icon name="image" size={15} /> Frame JPEG
            </button>
            <button onClick={onSaveAudio} disabled={duration <= 0}>
              <Icon name="music" size={15} /> Audio WAV
            </button>
          </div>
          <p className="hint">The video plays through once while it records. Keep this tab open.</p>
        </div>
      </div>
    </div>
  );
}
