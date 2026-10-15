import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { formatTime } from '../lib/download';
import { assignLanes, clipDuration, dropIndex, layoutClips, moveItem, PEAKS_PER_SECOND, projectDuration, trimEnd, trimStart } from './timeline';
import type { AudioClip, Clip, TextOverlay, VideoProject } from './types';

/** Height of one row in the text and audio tracks. */
const LANE = 34;

export type Selection = { kind: 'clip' | 'text' | 'audio'; id: string } | null;

interface Props {
  project: VideoProject;
  time: number;
  pps: number;
  selection: Selection;
  onSelect: (s: Selection) => void;
  onSeek: (t: number) => void;
  /** Start of a drag that should become one undo step. */
  onBegin: () => void;
  /** Live update during a drag. */
  onChange: (fn: (p: VideoProject) => VideoProject) => void;
  /** Discrete, undoable change. */
  onCommit: (fn: (p: VideoProject) => VideoProject) => void;
  /** The transition button between two clips was clicked (id of the incoming clip). */
  onTransitionClick: (clipId: string) => void;
}

type Drag =
  | { kind: 'reorder'; from: number; startX: number; moved: boolean }
  | { kind: 'trim-clip'; edge: 'start' | 'end'; clip: Clip; startX: number }
  | { kind: 'move-text'; item: TextOverlay; startX: number }
  | { kind: 'resize-text'; item: TextOverlay; startX: number }
  | { kind: 'move-audio'; item: AudioClip; startX: number }
  | { kind: 'trim-audio'; edge: 'start' | 'end'; item: AudioClip; startX: number }
  | { kind: 'scrub' };

export function Timeline({ project, time, pps, selection, onSelect, onSeek, onBegin, onChange, onCommit, onTransitionClick }: Props) {
  const innerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);

  const duration = projectDuration(project);
  const width = Math.max(duration + 10, 30) * pps;
  const placed = layoutClips(project.clips);
  const assetOf = (id: string) => project.assets.find((a) => a.id === id);
  const textLanes = assignLanes(project.texts, (o) => o.start, (o) => o.start + o.duration);
  const audioLanes = assignLanes(project.audio, (a) => a.start, (a) => a.start + a.out - a.in);
  const laneHeight = (count: number) => Math.max(1, count) * LANE;

  const timeAt = (clientX: number) => {
    const rect = innerRef.current!.getBoundingClientRect();
    return Math.max(0, (clientX - rect.left) / pps);
  };

  const begin = (e: ReactPointerEvent, drag: Drag, select?: Selection) => {
    e.stopPropagation();
    if (select !== undefined) onSelect(select);
    dragRef.current = drag;
    if (drag.kind !== 'scrub' && drag.kind !== 'reorder') onBegin();
    innerRef.current!.setPointerCapture(e.pointerId);
  };

  const onMove = (e: ReactPointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (d.kind === 'scrub') return onSeek(timeAt(e.clientX));
    const dt = (e.clientX - d.startX) / pps;
    switch (d.kind) {
      case 'reorder':
        if (Math.abs(e.clientX - d.startX) > 4) d.moved = true;
        if (d.moved) setDropAt(dropIndex(project.clips, timeAt(e.clientX)));
        break;
      case 'trim-clip': {
        const asset = assetOf(d.clip.assetId);
        const next =
          d.edge === 'start'
            ? trimStart(d.clip, d.clip.in + dt * d.clip.speed)
            : trimEnd(d.clip, d.clip.out + dt * d.clip.speed, asset?.duration ?? Infinity);
        onChange((p) => ({ ...p, clips: p.clips.map((c) => (c.id === next.id ? next : c)) }));
        break;
      }
      case 'move-text':
        onChange((p) => ({
          ...p,
          texts: p.texts.map((o) => (o.id === d.item.id ? { ...o, start: Math.max(0, d.item.start + dt) } : o)),
        }));
        break;
      case 'resize-text':
        onChange((p) => ({
          ...p,
          texts: p.texts.map((o) => (o.id === d.item.id ? { ...o, duration: Math.max(0.2, d.item.duration + dt) } : o)),
        }));
        break;
      case 'move-audio':
        onChange((p) => ({
          ...p,
          audio: p.audio.map((a) => (a.id === d.item.id ? { ...a, start: Math.max(0, d.item.start + dt) } : a)),
        }));
        break;
      case 'trim-audio': {
        const a = d.item;
        const len = assetOf(a.assetId)?.duration ?? Infinity;
        let next: AudioClip;
        if (d.edge === 'start') {
          const shift = Math.max(-a.in, -a.start, Math.min(dt, a.out - a.in - 0.1));
          next = { ...a, in: a.in + shift, start: a.start + shift };
        } else {
          next = { ...a, out: Math.min(len, Math.max(a.in + 0.1, a.out + dt)) };
        }
        onChange((p) => ({ ...p, audio: p.audio.map((x) => (x.id === a.id ? next : x)) }));
        break;
      }
    }
  };

  const onUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d?.kind === 'reorder' && d.moved && dropAt !== null) {
      const to = dropAt > d.from ? dropAt - 1 : dropAt;
      if (to !== d.from) onCommit((p) => ({ ...p, clips: moveItem(p.clips, d.from, to) }));
    }
    setDropAt(null);
  };

  // Ruler tick spacing that stays readable at any zoom.
  const step = [0.5, 1, 2, 5, 10, 15, 30, 60].find((s) => s * pps >= 60) ?? 120;
  const ticks = Array.from({ length: Math.ceil(width / pps / step) + 1 }, (_, i) => i * step);

  return (
    <div className="timeline">
      <div
        className="timeline-inner"
        ref={innerRef}
        style={{ width }}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerDown={(e) => {
          onSelect(null);
          onSeek(timeAt(e.clientX));
          begin(e, { kind: 'scrub' });
        }}
      >
        <div className="ruler">
          {ticks.map((t) => (
            <span key={t} className="tick" style={{ left: t * pps }}>
              {formatTime(t).replace(/\.0$/, '')}
            </span>
          ))}
        </div>

        <div className="track text-track" style={{ height: laneHeight(Math.max(0, ...textLanes) + 1) }}>
          <span className="track-label">Text</span>
          {project.texts.map((o) => (
            <div
              key={o.id}
              className={`item text-item ${selection?.id === o.id ? 'selected' : ''}`}
              style={{ left: o.start * pps, width: o.duration * pps, top: textLanes[project.texts.indexOf(o)] * LANE, height: LANE - 4, bottom: 'auto' }}
              onPointerDown={(e) => begin(e, { kind: 'move-text', item: o, startX: e.clientX }, { kind: 'text', id: o.id })}
            >
              <span className="item-label">T {o.text}</span>
              <span
                className="edge end"
                onPointerDown={(e) => begin(e, { kind: 'resize-text', item: o, startX: e.clientX }, { kind: 'text', id: o.id })}
              />
            </div>
          ))}
        </div>

        <div className="track main-track">
          <span className="track-label">Video</span>
          {placed.map(({ clip, index, start }) => {
            const asset = assetOf(clip.assetId);
            return (
              <div
                key={clip.id}
                className={`item clip-item ${selection?.id === clip.id ? 'selected' : ''}`}
                style={{
                  left: start * pps,
                  width: clipDuration(clip) * pps,
                  backgroundImage: asset?.thumbnail ? `url(${asset.thumbnail})` : undefined,
                }}
                onPointerDown={(e) =>
                  begin(e, { kind: 'reorder', from: index, startX: e.clientX, moved: false }, { kind: 'clip', id: clip.id })
                }
              >
                <span
                  className="edge start"
                  onPointerDown={(e) =>
                    begin(e, { kind: 'trim-clip', edge: 'start', clip, startX: e.clientX }, { kind: 'clip', id: clip.id })
                  }
                />
                <span className="item-label">
                  {clip.speed !== 1 && <b>{clip.speed}× </b>}
                  {asset?.name} · {clipDuration(clip).toFixed(1)}s
                </span>
                <span
                  className="edge end"
                  onPointerDown={(e) =>
                    begin(e, { kind: 'trim-clip', edge: 'end', clip, startX: e.clientX }, { kind: 'clip', id: clip.id })
                  }
                />
              </div>
            );
          })}
          {placed.slice(1).map(({ clip, start }) => (
            <button
              key={`tr-${clip.id}`}
              className={`transition-chip ${clip.transition ? 'on' : ''}`}
              style={{ left: start * pps }}
              title={clip.transition ? 'Edit transition' : 'Add a transition'}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onTransitionClick(clip.id)}
            >
              ⇄
            </button>
          ))}
          {dropAt !== null && (
            <div className="drop-marker" style={{ left: (placed[dropAt]?.start ?? duration) * pps }} />
          )}
          {project.clips.length === 0 && <span className="track-empty">Import media and it will appear here</span>}
        </div>

        <div className="track audio-track" style={{ height: laneHeight(Math.max(0, ...audioLanes) + 1) }}>
          <span className="track-label">Audio</span>
          {project.audio.map((a) => (
            <div
              key={a.id}
              className={`item audio-item ${selection?.id === a.id ? 'selected' : ''}`}
              style={{ left: a.start * pps, width: (a.out - a.in) * pps, top: audioLanes[project.audio.indexOf(a)] * LANE, height: LANE - 4, bottom: 'auto' }}
              onPointerDown={(e) => begin(e, { kind: 'move-audio', item: a, startX: e.clientX }, { kind: 'audio', id: a.id })}
            >
              <span
                className="edge start"
                onPointerDown={(e) =>
                  begin(e, { kind: 'trim-audio', edge: 'start', item: a, startX: e.clientX }, { kind: 'audio', id: a.id })
                }
              />
              <Waveform peaks={assetOf(a.assetId)?.peaks} from={a.in} to={a.out} />
              <span className="item-label">♪ {assetOf(a.assetId)?.name}</span>
              <span
                className="edge end"
                onPointerDown={(e) =>
                  begin(e, { kind: 'trim-audio', edge: 'end', item: a, startX: e.clientX }, { kind: 'audio', id: a.id })
                }
              />
            </div>
          ))}
        </div>

        <div className="playhead" style={{ left: time * pps }} />
      </div>
    </div>
  );
}

/** Bars showing loudness for the visible part [from, to] (seconds) of an audio file. */
function Waveform({ peaks, from, to }: { peaks?: number[]; from: number; to: number }) {
  if (!peaks?.length) return null;
  const slice = peaks.slice(Math.floor(from * PEAKS_PER_SECOND), Math.ceil(to * PEAKS_PER_SECOND));
  if (slice.length === 0) return null;
  const d = slice.map((p, i) => `M${i + 0.5} ${50 - p * 48}V${50 + p * 48}`).join('');
  return (
    <svg className="waveform" viewBox={`0 0 ${slice.length} 100`} preserveAspectRatio="none" aria-hidden>
      <path d={d} stroke="#a7f3d0" strokeWidth="0.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
