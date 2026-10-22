/**
 * Premiere Pro-style panels: J and L cuts and scene edit detection for a clip,
 * colour match between clips, and the colour scopes (waveform, vectorscope,
 * RGB histogram) read live from the player.
 */
import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { histogram, vectorscope, waveform } from './premiere';
import type { Clip, MediaAsset } from './types';

export function ProEditSection({
  canJ,
  canL,
  isVideo,
  onJ,
  onL,
  onScenes,
}: {
  canJ: boolean;
  canL: boolean;
  isVideo: boolean;
  onJ: (seconds: number) => void;
  onL: (seconds: number) => void;
  onScenes: () => void;
}) {
  const [secs, setSecs] = useState(1);
  return (
    <div className="pro-edit">
      <label className="field">
        <span>Sound overlap {secs.toFixed(1)}s</span>
        <input type="range" min={0.2} max={3} step={0.1} value={secs} onChange={(e) => setSecs(Number(e.target.value))} aria-label="Sound overlap" />
      </label>
      <div className="row">
        <button onClick={() => onJ(secs)} disabled={!canJ} title="Hear this clip before you see it: its sound starts under the end of the clip before">
          J cut
        </button>
        <button onClick={() => onL(secs)} disabled={!canL} title="Keep hearing this clip after it ends: its sound carries on over the next clip">
          L cut
        </button>
      </div>
      {isVideo && (
        <button className="block" onClick={onScenes} title="Find where the camera cuts inside this clip and split it there">
          ✂️ Split at scene changes
        </button>
      )}
    </div>
  );
}

export function ColorMatchSection({ clip, clips, assets, onMatch }: { clip: Clip; clips: Clip[]; assets: MediaAsset[]; onMatch: (referenceId: string) => void }) {
  const others = clips.filter((c) => c.id !== clip.id);
  const [ref, setRef] = useState(others[0]?.id ?? '');
  if (!others.length) return <p className="hint">Add another clip to match this one's colours to it.</p>;
  const name = (c: Clip, i: number) => `${i + 1}. ${assets.find((a) => a.id === c.assetId)?.name ?? 'Clip'}`;
  return (
    <div className="color-match">
      <label className="field">
        <span>Match to</span>
        <select value={ref} onChange={(e) => setRef(e.target.value)} aria-label="Reference clip">
          {clips.map((c, i) => (c.id === clip.id ? null : <option key={c.id} value={c.id}>{name(c, i)}</option>))}
        </select>
      </label>
      <button className="block primary" onClick={() => ref && onMatch(ref)}>
        🎨 Match colour
      </button>
      <p className="hint">Sets brightness, contrast, saturation and a colour tint so this clip looks like the other.</p>
    </div>
  );
}

type ScopeKind = 'waveform' | 'vectorscope' | 'histogram';
const SCOPES: { id: ScopeKind; label: string }[] = [
  { id: 'waveform', label: 'Waveform' },
  { id: 'vectorscope', label: 'Vectorscope' },
  { id: 'histogram', label: 'Histogram' },
];

/** Live colour scopes of the player picture. */
export function Scopes({ source, onClose }: { source: RefObject<HTMLCanvasElement>; onClose: () => void }) {
  const [kind, setKind] = useState<ScopeKind>('waveform');
  const out = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const sample = document.createElement('canvas');
    sample.width = 160;
    sample.height = 90;
    const sctx = sample.getContext('2d', { willReadFrequently: true })!;
    const draw = () => {
      const src = source.current;
      const c = out.current;
      if (!src || !c || !src.width) return;
      sctx.drawImage(src, 0, 0, sample.width, sample.height);
      const px = sctx.getImageData(0, 0, sample.width, sample.height).data;
      const ctx = c.getContext('2d')!;
      const W = c.width;
      const H = c.height;
      ctx.fillStyle = '#0b0f17';
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1;
      if (kind === 'waveform') {
        const cols = 160;
        const levels = 64;
        const w = waveform(px, sample.width, sample.height, cols, levels);
        for (const g of [0.25, 0.5, 0.75]) {
          ctx.beginPath();
          ctx.moveTo(0, H * g);
          ctx.lineTo(W, H * g);
          ctx.stroke();
        }
        for (let x = 0; x < cols; x++) {
          for (let v = 0; v < levels; v++) {
            const n = w[x * levels + v];
            if (!n) continue;
            ctx.fillStyle = `rgba(110,255,160,${Math.min(1, 0.15 + n / 12)})`;
            ctx.fillRect((x / cols) * W, H - ((v + 1) / levels) * H, W / cols + 0.5, H / levels + 0.5);
          }
        }
      } else if (kind === 'vectorscope') {
        const size = 96;
        const v = vectorscope(px, size);
        const S = Math.min(W, H);
        const ox = (W - S) / 2;
        ctx.beginPath();
        ctx.arc(W / 2, H / 2, S / 2 - 2, 0, Math.PI * 2);
        ctx.moveTo(W / 2 - S / 2, H / 2);
        ctx.lineTo(W / 2 + S / 2, H / 2);
        ctx.moveTo(W / 2, 0);
        ctx.lineTo(W / 2, H);
        ctx.stroke();
        // Skin-tone line (about 123°).
        ctx.strokeStyle = 'rgba(255,190,140,0.35)';
        ctx.beginPath();
        ctx.moveTo(W / 2, H / 2);
        ctx.lineTo(W / 2 - Math.cos(0.58) * S * 0.5, H / 2 - Math.sin(0.58) * S * 0.5);
        ctx.stroke();
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            const n = v[y * size + x];
            if (!n) continue;
            ctx.fillStyle = `rgba(255,255,255,${Math.min(1, 0.2 + n / 20)})`;
            ctx.fillRect(ox + (x / size) * S, (y / size) * S + (H - S) / 2, S / size + 0.5, S / size + 0.5);
          }
        }
      } else {
        const h = histogram(px);
        const max = Math.max(1, ...h.flatMap((a) => Array.from(a.slice(2, 254))));
        ctx.globalCompositeOperation = 'lighter';
        (['rgba(255,70,70,0.75)', 'rgba(70,255,90,0.75)', 'rgba(80,130,255,0.75)'] as const).forEach((col, k) => {
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.moveTo(0, H);
          for (let i = 0; i < 256; i++) ctx.lineTo((i / 255) * W, H - Math.min(1, h[k][i] / max) * (H - 4));
          ctx.lineTo(W, H);
          ctx.closePath();
          ctx.fill();
        });
        ctx.globalCompositeOperation = 'source-over';
      }
    };
    draw();
    const timer = setInterval(draw, 200);
    return () => clearInterval(timer);
  }, [kind, source]);
  return (
    <div className="scopes" role="region" aria-label="Colour scopes">
      <div className="scopes-head">
        {SCOPES.map((s) => (
          <button key={s.id} className={kind === s.id ? 'active' : ''} aria-pressed={kind === s.id} onClick={() => setKind(s.id)}>
            {s.label}
          </button>
        ))}
        <button className="scopes-close" onClick={onClose} aria-label="Close scopes">
          ×
        </button>
      </div>
      <canvas ref={out} width={280} height={150} aria-label={`${kind} scope`} data-testid="scope-canvas" />
    </div>
  );
}
