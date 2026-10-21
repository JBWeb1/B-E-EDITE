/**
 * Multicam: pick the cameras, line them up by sound, then cut between them, live
 * (press 1–9 or click an angle while it plays) or automatically (whoever is talking).
 */
import { useEffect, useRef, useState } from 'react';
import { decodeMono } from '../lib/aiService';
import { formatTime } from '../lib/download';
import { Icon } from '../ui/Icon';
import { loudness } from './ai';
import { alignEnvelope, autoSwitch, buildMulticam, syncOffset, tidyCuts } from './multicam';
import type { Angle, Cut } from './multicam';
import type { AudioClip, Clip, VideoProject } from './types';

const RATE = 100;

export function MulticamDialog({ project, onApply, onClose }: { project: VideoProject; onApply: (r: { clips: Clip[]; audio: AudioClip[] }) => void; onClose: () => void }) {
  const videos = project.assets.filter((a) => a.kind === 'video');
  const [picked, setPicked] = useState<string[]>(() => videos.slice(0, 4).map((a) => a.id));
  const [angles, setAngles] = useState<(Angle & { confidence: number; env: number[] })[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [cuts, setCuts] = useState<Cut[]>([{ t: 0, angle: 0 }]);
  const [live, setLive] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [now, setNow] = useState(0);
  const refs = useRef<(HTMLVideoElement | null)[]>([]);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const asset = (id: string) => videos.find((a) => a.id === id)!;
  // Times are on the first (reference) camera's clock, so it decides the length.
  const length = angles ? Math.max(0.1, asset(angles[0].assetId).duration) : 0;

  const sync = async () => {
    const list: (Angle & { confidence: number; env: number[] })[] = [];
    for (let i = 0; i < picked.length; i++) {
      const a = asset(picked[i]);
      setBusy(`Listening to ${a.name} (${i + 1} of ${picked.length})…`);
      const samples = await decodeMono(a.url, 8000);
      const env = samples ? loudness(samples, 8000, RATE) : [];
      if (i === 0 || !env.length || !list[0].env.length) list.push({ assetId: a.id, offset: 0, confidence: env.length ? 1 : 0, env });
      else {
        const r = syncOffset(list[0].env, env, RATE, 60);
        list.push({ assetId: a.id, offset: r.offset, confidence: r.confidence, env });
      }
    }
    setBusy(null);
    setAngles(list);
    setCuts([{ t: 0, angle: 0 }]);
  };

  // Keep every angle in step with the first one while previewing.
  useEffect(() => {
    if (!angles) return;
    let raf = 0;
    const tick = () => {
      const ref = refs.current[0];
      if (ref) {
        const t = ref.currentTime;
        setNow(t);
        refs.current.forEach((v, k) => {
          if (!v || k === 0) return;
          const target = t + angles[k].offset;
          if (Math.abs(v.currentTime - target) > 0.15) v.currentTime = Math.max(0, target);
        });
        if (t >= length - 0.05 && playing) pause();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  });

  const play = () => {
    refs.current.forEach((v) => void v?.play().catch(() => {}));
    setPlaying(true);
  };
  const pause = () => {
    refs.current.forEach((v) => v?.pause());
    setPlaying(false);
  };
  const seekTo = (t: number) => {
    refs.current.forEach((v, k) => v && angles && (v.currentTime = Math.max(0, t + angles[k].offset)));
    setNow(t);
  };
  const switchTo = (k: number) => {
    setLive(k);
    setCuts((c) => tidyCuts([...c.filter((x) => x.t < now - 1e-3), { t: Math.max(0, now), angle: k }]));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCloseRef.current();
      if (!angles) return;
      const n = Number(e.key);
      if (n >= 1 && n <= angles.length) {
        e.preventDefault();
        switchTo(n - 1);
      } else if (e.key === ' ' && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        if (playing) pause();
        else play();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const auto = () => {
    if (!angles) return;
    const envs = angles.map((a) => alignEnvelope(a.env, a.offset, RATE, length));
    setCuts(autoSwitch(envs, RATE));
  };
  const finish = () => {
    if (!angles) return;
    pause();
    onApply(buildMulticam(videos, angles, cuts, length));
  };

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id].slice(0, 9)));
  const activeAt = (t: number) => tidyCuts(cuts).filter((c) => c.t <= t + 1e-3).pop()?.angle ?? 0;

  return (
    <div className="modal-backdrop" data-modal onPointerDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal multicam-modal" role="dialog" aria-label="Multicam">
        <div className="look-head">
          <h3>
            <Icon name="film" /> Multicam
          </h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close" title="Close (Esc)">
            <Icon name="x" />
          </button>
        </div>
        {!angles ? (
          <>
            <p className="hint">Filmed the same moment with several cameras or phones? Pick them; they are lined up by their sound, then you cut between them.</p>
            <div className="multicam-pick">
              {videos.map((a) => (
                <label key={a.id} className={`card multicam-cam ${picked.includes(a.id) ? 'on' : ''}`}>
                  <input type="checkbox" checked={picked.includes(a.id)} onChange={() => toggle(a.id)} aria-label={`Use ${a.name}`} />
                  {a.thumbnail && <img src={a.thumbnail} alt="" />}
                  <span>{a.name}</span>
                  <small>{formatTime(a.duration)}</small>
                </label>
              ))}
            </div>
            {videos.length < 2 && <p className="hint">Import at least two videos first.</p>}
            {busy ? (
              <p className="hint" role="status">
                {busy}
              </p>
            ) : (
              <button className="primary block" disabled={picked.length < 2} onClick={() => void sync()}>
                Line up {picked.length} cameras by sound
              </button>
            )}
          </>
        ) : (
          <>
            <div className="multicam-sync">
              {angles.map((a, k) => (
                <span key={a.assetId} className={a.confidence < 0.25 && k > 0 ? 'weak' : ''}>
                  {k + 1}. {asset(a.assetId).name}: {k === 0 ? 'reference' : `${a.offset >= 0 ? '+' : ''}${a.offset.toFixed(2)} s`}
                  {k > 0 && a.confidence < 0.25 ? ' (unsure: no clear shared sound)' : ''}
                </span>
              ))}
            </div>
            <div className={`multicam-grid n${Math.min(4, angles.length)}`}>
              {angles.map((a, k) => (
                <button key={a.assetId} className={`multicam-angle ${activeAt(now) === k ? 'live' : ''}`} onClick={() => switchTo(k)} aria-label={`Switch to camera ${k + 1}`} aria-pressed={activeAt(now) === k}>
                  <video
                    ref={(v) => {
                      refs.current[k] = v;
                    }}
                    src={asset(a.assetId).url}
                    muted={k !== 0}
                    playsInline
                    preload="auto"
                    onLoadedMetadata={(e) => (e.currentTarget.currentTime = Math.max(0, a.offset + now))}
                  />
                  <span className="multicam-num">{k + 1}</span>
                </button>
              ))}
            </div>
            <div className="multicam-bar" aria-label="Cuts">
              {tidyCuts(cuts).map((c, i, list) => (
                <span key={i} className={`multicam-seg a${c.angle % 4}`} style={{ left: `${(c.t / length) * 100}%`, width: `${(((list[i + 1]?.t ?? length) - c.t) / length) * 100}%` }}>
                  {c.angle + 1}
                </span>
              ))}
              <span className="multicam-now" style={{ left: `${(now / length) * 100}%` }} />
            </div>
            <div className="row">
              <button onClick={() => (playing ? pause() : play())} aria-label={playing ? 'Pause' : 'Play'}>
                <Icon name={playing ? 'pause' : 'play'} size={15} /> {playing ? 'Pause' : 'Play'}
              </button>
              <button onClick={() => seekTo(0)}>From the start</button>
              <span className="hint">
                {formatTime(now)} / {formatTime(length)} · live: camera {live + 1}
              </span>
            </div>
            <p className="hint">While it plays, press 1–{angles.length} (or click a camera) to cut to it. Or let it pick:</p>
            <div className="row">
              <button onClick={auto}>✨ Auto switch (whoever is talking)</button>
              <button onClick={() => setCuts([{ t: 0, angle: 0 }])}>Clear cuts</button>
            </div>
            <p className="hint">
              {tidyCuts(cuts).length} shot{tidyCuts(cuts).length === 1 ? '' : 's'}. The sound of camera 1 plays all the way through, so it never jumps.
            </p>
            <button className="primary block" onClick={finish}>
              Put the multicam edit on the timeline
            </button>
          </>
        )}
      </div>
    </div>
  );
}
