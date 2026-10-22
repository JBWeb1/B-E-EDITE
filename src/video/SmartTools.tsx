/**
 * Detail-panel sections for the smart tools: AI background removal (people), the
 * stabiliser, studio sound and the face tools. Shared by main-track clips, layers and audio clips.
 */
import { useRef, useState } from 'react';
import { decodeMono } from '../lib/aiService';
import { putMedia } from '../lib/projects';
import { RangeField } from '../ui/fields';
import { Icon } from '../ui/Icon';
import { CUTOUT_FPS, runCutout } from './cutout';
import { loudnessBoost } from './export';
import { grabGrayFrames } from './grab';
import { planStabilize } from './stabilize';
import type { GrayFrame } from './tracker';
import type { Cutout, MediaAsset, Stabilize } from './types';
import { NO_FACE_LOOK } from './faces';
import type { FaceLook, FaceScan } from './faces';
import { scanFaces } from './faceRun';

interface Range {
  in: number;
  out: number;
}

function Progress({ value, label, onCancel }: { value: number; label: string; onCancel?: () => void }) {
  return (
    <div className="smart-progress" role="status">
      <div className="progress">
        <div style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
      <p className="hint">
        {label} {Math.round(value * 100)}%
      </p>
      {onCancel && <button onClick={onCancel}>Cancel</button>}
    </div>
  );
}

/** Remove the background behind a person, in a photo or a whole video clip. */
export function SmartCutoutSection({
  layer,
  asset,
  update,
  onReady,
}: {
  layer: Range & { cutout?: Cutout | null; chroma?: unknown };
  asset: MediaAsset;
  update: (patch: { cutout?: Cutout | null }) => void;
  onReady: (c: Cutout, data: Uint8Array) => void;
}) {
  const [busy, setBusy] = useState<{ value: number; label: string } | null>(null);
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);
  const isVideo = asset.kind === 'video';
  if (asset.kind === 'audio') return null;
  const c = layer.cutout;
  const covers = !c || !isVideo || (c.from <= layer.in + 1e-3 && c.from + (c.count - 1) / c.fps >= layer.out - 0.1);
  const seconds = layer.out - layer.in;

  const run = async () => {
    setError('');
    const ctrl = new AbortController();
    abort.current = ctrl;
    setBusy({ value: 0, label: 'Starting…' });
    try {
      const { cutout, data } = await runCutout({ url: asset.url, kind: isVideo ? 'video' : 'image' }, isVideo ? layer.in : 0, isVideo ? layer.out : 0, putMedia, (value, label) => setBusy({ value, label }), ctrl.signal);
      onReady(cutout, data);
      update({ cutout });
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) setError(err instanceof Error ? `Could not cut out: ${err.message}` : 'Could not cut out this clip.');
    } finally {
      abort.current = null;
      setBusy(null);
    }
  };

  return (
    <div className="smart-cutout">
      <p className="hint">Cuts the person out of any background (no green screen needed). Runs on this device; the model downloads once.</p>
      {busy ? (
        <Progress value={busy.value} label={busy.label} onCancel={() => abort.current?.abort()} />
      ) : c ? (
        <>
          <p className="hint smart-done">✓ Background removed{isVideo ? ` (${c.count} frames)` : ''}.</p>
          {!covers && <p className="hint">You trimmed the clip past the cut-out. Press Redo to cover the new part.</p>}
          <div className="row">
            <button onClick={() => update({ cutout: null })}>Restore background</button>
            <button onClick={() => void run()}>Redo</button>
          </div>
        </>
      ) : (
        <>
          <button className="primary block" onClick={() => void run()}>
            ✨ Remove background (AI)
          </button>
          {isVideo && seconds > 20 && <p className="hint">About {Math.ceil(seconds * CUTOUT_FPS)} frames to process; this can take a few minutes. Trim the clip first to go faster.</p>}
        </>
      )}
      {error && (
        <p className="hint error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

const STRENGTHS = [
  { label: 'Light', value: 0.35 },
  { label: 'Medium', value: 0.7 },
  { label: 'Locked', value: 1 },
];

/** Steady a shaky video clip. */
export function StabilizeSection({ layer, asset, update }: { layer: Range & { stabilize?: Stabilize | null }; asset: MediaAsset; update: (patch: { stabilize?: Stabilize | null }) => void }) {
  const [busy, setBusy] = useState<number | null>(null);
  const cache = useRef<{ key: string; frames: GrayFrame[]; rate: number } | null>(null);
  if (asset.kind !== 'video') return null;
  const s = layer.stabilize;

  const run = async (strength: number) => {
    const key = `${asset.id}:${layer.in}:${layer.out}`;
    if (cache.current?.key !== key) {
      // About 10 looks a second (fewer for long clips) at a small size is enough to see the shake.
      const len = layer.out - layer.in;
      const rate = Math.max(2, Math.min(10, Math.floor(600 / Math.max(len, 0.1))));
      const n = Math.max(2, Math.round(len * rate) + 1);
      const times = Array.from({ length: n }, (_, i) => layer.in + i / rate);
      setBusy(0);
      try {
        const frames = await grabGrayFrames(asset.url, times, 96, Math.max(8, Math.round((96 * (asset.height ?? 9)) / (asset.width ?? 16))), (f) => setBusy(f));
        cache.current = { key, frames, rate };
      } finally {
        setBusy(null);
      }
    }
    const { frames, rate } = cache.current!;
    update({ stabilize: planStabilize(frames, rate, layer.in, strength) });
  };

  return (
    <div className="stabilize">
      {busy !== null ? (
        <Progress value={busy} label="Measuring the shake…" />
      ) : (
        <>
          <div className="segmented" role="group" aria-label="Stabilise">
            <button className={!s ? 'active' : ''} onClick={() => update({ stabilize: null })}>
              Off
            </button>
            {STRENGTHS.map((o) => (
              <button key={o.label} className={s && Math.abs(s.strength - o.value) < 0.01 ? 'active' : ''} onClick={() => void run(o.value)}>
                {o.label}
              </button>
            ))}
          </div>
          <p className="hint">
            {s
              ? `Steadied. Zoomed in ${Math.round((s.zoom - 1) * 100)}% to hide the moving edges.`
              : 'Smooths out handheld shake. Stronger settings hold the camera stiller but zoom in more.'}
          </p>
        </>
      )}
    </div>
  );
}

/** Clear, even voice in one tap: rumble and mud out, presence in, loudness evened out. */
export function StudioSoundSection({
  item,
  asset,
  update,
}: {
  item: Range & { studio?: boolean; boost?: number };
  asset: MediaAsset;
  update: (patch: { studio?: boolean; boost?: number }) => void;
}) {
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    if (item.studio) return update({ studio: false });
    setBusy(true);
    try {
      const rate = 16000;
      const samples = await decodeMono(asset.url, rate);
      const part = samples ? samples.subarray(Math.floor(item.in * rate), Math.ceil(item.out * rate)) : null;
      update({ studio: true, boost: part ? loudnessBoost(part, rate) : 0 });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="studio-sound">
      <button className={`block ${item.studio ? 'active' : ''}`} onClick={() => void toggle()} aria-pressed={!!item.studio} disabled={busy}>
        <Icon name="mic" size={15} /> {busy ? 'Listening…' : item.studio ? 'Studio sound on' : 'Studio sound'}
      </button>
      <p className="hint">
        {item.studio
          ? `Rumble and mud removed, voice made clearer and evened out${item.boost ? ` (${item.boost > 0 ? '+' : ''}${item.boost} dB to reach a steady level)` : ''}.`
          : 'Makes voices clear and even, like a studio microphone.'}
      </p>
      {item.studio && (
        <RangeField label="Level" value={item.boost ?? 0} min={-6} max={12} step={0.5} onChange={(v) => update({ boost: v })} format={(v) => `${v > 0 ? '+' : ''}${v} dB`} />
      )}
    </div>
  );
}

/**
 * Face tools for a clip or layer: find the faces, then blur chosen ones for privacy,
 * smooth skin, brighten and sharpen faces, or add a sticker / label that follows one.
 */
export function FacesSection({
  layer,
  asset,
  update,
  onFollow,
}: {
  layer: Range & { faces?: FaceScan | null; faceLook?: FaceLook | null };
  asset: MediaAsset;
  update: (patch: { faces?: FaceScan | null; faceLook?: FaceLook | null }, live?: boolean) => void;
  /** Add a sticker or name label that follows a face (main-track clips only). */
  onFollow?: (trackId: string, kind: 'sticker' | 'label') => void;
}) {
  const [busy, setBusy] = useState<{ value: number; label: string } | null>(null);
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);
  if (asset.kind === 'audio') return null;
  const scan = layer.faces;
  const look = { ...NO_FACE_LOOK, ...layer.faceLook };
  const setLook = (patch: Partial<FaceLook>, live = false) => update({ faceLook: { ...look, ...patch } }, live);
  const covers = !scan || asset.kind === 'image' || (scan.from <= layer.in + 1e-3 && scan.from + (Math.max(...scan.tracks.map((t) => t.boxes.length), 1) - 1) / scan.rate >= layer.out - 0.2);

  const find = async () => {
    setError('');
    const ctrl = new AbortController();
    abort.current = ctrl;
    setBusy({ value: 0, label: 'Starting…' });
    try {
      const result = await scanFaces({ url: asset.url, kind: asset.kind === 'image' ? 'image' : 'video' }, asset.kind === 'image' ? 0 : layer.in, asset.kind === 'image' ? 0 : layer.out, (value, label) => setBusy({ value, label }), ctrl.signal);
      update({ faces: result, faceLook: { ...look, blur: look.blur.filter((id) => result.tracks.some((t) => t.id === id)) } });
      if (!result.tracks.length) setError('No faces found in this clip.');
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) setError(err instanceof Error ? `Could not look for faces: ${err.message}` : 'Could not look for faces.');
    } finally {
      abort.current = null;
      setBusy(null);
    }
  };

  if (busy) return <Progress value={busy.value} label={busy.label} onCancel={() => abort.current?.abort()} />;
  return (
    <div className="faces-section">
      {!scan ? (
        <>
          <p className="hint">Finds every face so you can blur strangers, smooth skin, brighten and sharpen faces, or add a sticker that follows someone. Runs on this device.</p>
          <button className="primary block" onClick={() => void find()}>
            🙂 Find faces
          </button>
        </>
      ) : (
        <>
          <p className="hint">
            {scan.tracks.length ? `${scan.tracks.length} face${scan.tracks.length === 1 ? '' : 's'} found.` : 'No faces found.'}{' '}
            <button className="link" onClick={() => void find()}>
              Look again
            </button>
          </p>
          {!covers && <p className="hint">You trimmed past the part that was checked. Press Look again.</p>}
          {scan.tracks.length > 0 && (
            <>
              <h4>Privacy blur</h4>
              <div className="face-list">
                {scan.tracks.map((t, i) => {
                  const seen = Math.round((t.boxes.filter(Boolean).length / Math.max(1, t.boxes.length)) * 100);
                  return (
                    <div key={t.id} className="face-row">
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={look.blur.includes(t.id)}
                          onChange={(e) => setLook({ blur: e.target.checked ? [...look.blur, t.id] : look.blur.filter((x) => x !== t.id) })}
                          aria-label={`Blur face ${i + 1}`}
                        />
                        Face {i + 1} <small>· on screen {seen}%</small>
                      </label>
                      {onFollow && (
                        <span className="face-follow">
                          <button onClick={() => onFollow(t.id, 'sticker')} title="A sticker that stays on this face" aria-label={`Sticker on face ${i + 1}`}>
                            😎
                          </button>
                          <button onClick={() => onFollow(t.id, 'label')} title="A name label that follows this face" aria-label={`Label under face ${i + 1}`}>
                            Aa
                          </button>
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="row">
                <button onClick={() => setLook({ blur: scan.tracks.map((t) => t.id) })}>Blur all</button>
                <button onClick={() => setLook({ blur: [] })} disabled={!look.blur.length}>
                  Blur none
                </button>
              </div>
              {look.blur.length > 0 && (
                <>
                  <div className="segmented" role="group" aria-label="Blur style">
                    {(['blur', 'pixelate', 'box'] as const).map((m) => (
                      <button key={m} className={look.mode === m ? 'active' : ''} onClick={() => setLook({ mode: m })}>
                        {m === 'blur' ? 'Blur' : m === 'pixelate' ? 'Pixelate' : 'Black box'}
                      </button>
                    ))}
                  </div>
                  {look.mode !== 'box' && <RangeField label="Strength" value={look.strength} min={0.1} max={1} step={0.05} onChange={(v) => setLook({ strength: v }, true)} format={(v) => `${Math.round(v * 100)}%`} />}
                </>
              )}
              <h4>Retouch</h4>
              <RangeField label="Smooth skin" value={look.smooth} min={0} max={1} step={0.05} onChange={(v) => setLook({ smooth: v }, true)} format={(v) => `${Math.round(v * 100)}%`} />
              <RangeField label="Brighten faces" value={look.brighten} min={0} max={1} step={0.05} onChange={(v) => setLook({ brighten: v }, true)} format={(v) => `${Math.round(v * 100)}%`} />
              <RangeField label="Enhance detail" value={look.enhance} min={0} max={1} step={0.05} onChange={(v) => setLook({ enhance: v }, true)} format={(v) => `${Math.round(v * 100)}%`} />
              <p className="hint">Retouch applies to every face that isn't blurred.</p>
            </>
          )}
        </>
      )}
      {error && (
        <p className="hint" role="status">
          {error}
        </p>
      )}
    </div>
  );
}
