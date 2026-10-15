import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { formatTime } from '../lib/download';
import {
  assignLanes,
  clipDuration,
  dropIndex,
  layoutClips,
  moveItem,
  PEAKS_PER_SECOND,
  projectDuration,
  snapCandidates,
  snapTime,
  trimEnd,
  trimStart,
} from './timeline';
import type { AudioClip, Clip, OverlayClip, TextOverlay, VideoProject } from './types';

/** Height of one row in the text, overlay and audio tracks. */
const LANE = 34;
/** How close (in screen pixels) an edge must get to something before it snaps. */
const SNAP_PX = 8;

export type Selection = { kind: 'clip' | 'text' | 'audio' | 'overlay'; id: string } | null;

/** Tracks whose items float freely in time and have source in/out points. */
type FreeKey = 'audio' | 'overlays';
type FreeItem = AudioClip | OverlayClip;

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
  | { kind: 'move-text'; item: TextOverlay; startX: number; cands: number[] }
  | { kind: 'resize-text'; item: TextOverlay; startX: number; cands: number[] }
  | { kind: 'move-free'; key: FreeKey; item: FreeItem; startX: number; cands: number[] }
  | { kind: 'trim-free'; key: FreeKey; edge: 'start' | 'end'; item: FreeItem; startX: number; cands: number[] }
  | { kind: 'scrub' };

export function Timeline({ project, time, pps, selection, onSelect, onSeek, onBegin, onChange, onCommit, onTransitionClick }: Props) {
  const innerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [snapAt, setSnapAt] = useState<number | null>(null);

  const duration = projectDuration(project);
  const width = Math.max(duration + 10, 30) * pps;
  const placed = layoutClips(project.clips);
  const assetOf = (id: string) => project.assets.find((a) => a.id === id);
  const textLanes = assignLanes(project.texts, (o) => o.start, (o) => o.start + o.duration);
  const audioLanes = assignLanes(project.audio, (a) => a.start, (a) => a.start + a.out - a.in);
  const overlayLanes = assignLanes(project.overlays, (a) => a.start, (a) => a.start + a.out - a.in);
  const laneHeight = (lanes: number[]) => (Math.max(0, ...lanes) + 1) * LANE;

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

  const cands = (excludeId: string) => snapCandidates(project, time, excludeId);

  /** Snap a single time; Alt turns snapping off. */
  const snapOne = (t: number, list: number[], alt: boolean) => {
    if (alt) return { value: t, snapped: null };
    return snapTime(t, list, SNAP_PX / pps);
  };

  /** Snap an item of length `len` by whichever of its edges is closest to something. */
  const snapRange = (start: number, len: number, list: number[], alt: boolean) => {
    const a = snapOne(start, list, alt);
    const b = snapOne(start + len, list, alt);
    if (a.snapped !== null && (b.snapped === null || Math.abs(a.value - start) <= Math.abs(b.value - start - len))) {
      return { start: a.value, at: a.snapped };
    }
    if (b.snapped !== null) return { start: b.value - len, at: b.snapped };
    return { start, at: null };
  };

  const updateFree = (key: FreeKey, next: FreeItem) =>
    onChange((p) => ({ ...p, [key]: (p[key] as FreeItem[]).map((x) => (x.id === next.id ? next : x)) }));

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
      case 'move-text': {
        const r = snapRange(Math.max(0, d.item.start + dt), d.item.duration, d.cands, e.altKey);
        setSnapAt(r.at);
        onChange((p) => ({ ...p, texts: p.texts.map((o) => (o.id === d.item.id ? { ...o, start: Math.max(0, r.start) } : o)) }));
        break;
      }
      case 'resize-text': {
        const end = snapOne(d.item.start + d.item.duration + dt, d.cands, e.altKey);
        setSnapAt(end.snapped);
        const dur = Math.max(0.2, end.value - d.item.start);
        onChange((p) => ({ ...p, texts: p.texts.map((o) => (o.id === d.item.id ? { ...o, duration: dur } : o)) }));
        break;
      }
      case 'move-free': {
        const r = snapRange(Math.max(0, d.item.start + dt), d.item.out - d.item.in, d.cands, e.altKey);
        setSnapAt(r.at);
        updateFree(d.key, { ...d.item, start: Math.max(0, r.start) });
        break;
      }
      case 'trim-free': {
        const a = d.item;
        const len = assetOf(a.assetId)?.duration ?? Infinity;
        if (d.edge === 'start') {
          const target = snapOne(a.start + dt, d.cands, e.altKey);
          setSnapAt(target.snapped);
          const shift = Math.max(-a.in, -a.start, Math.min(target.value - a.start, a.out - a.in - 0.1));
          updateFree(d.key, { ...a, in: a.in + shift, start: a.start + shift });
        } else {
          const target = snapOne(a.start + (a.out - a.in) + dt, d.cands, e.altKey);
          setSnapAt(target.snapped);
          const out = Math.min(len, Math.max(a.in + 0.1, a.in + (target.value - a.start)));
          updateFree(d.key, { ...a, out });
        }
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
    setSnapAt(null);
  };

  // Ruler tick spacing that stays readable at any zoom.
  const step = [0.5, 1, 2, 5, 10, 15, 30, 60].find((s) => s * pps >= 60) ?? 120;
  const ticks = Array.from({ length: Math.ceil(width / pps / step) + 1 }, (_, i) => i * step);

  const freeTrack = (key: FreeKey, items: FreeItem[], lanes: number[], kind: 'audio' | 'overlay', label: string) => (
    <div className={`track ${kind}-track`} style={{ height: laneHeight(lanes) }}>
      <span className="track-label">{label}</span>
      {items.map((a, i) => {
        const asset = assetOf(a.assetId);
        const select = { kind, id: a.id } as const;
        return (
          <div
            key={a.id}
            className={`item ${kind}-item ${selection?.id === a.id ? 'selected' : ''}`}
            style={{
              left: a.start * pps,
              width: (a.out - a.in) * pps,
              top: lanes[i] * LANE,
              height: LANE - 4,
              bottom: 'auto',
              backgroundImage: kind === 'overlay' && asset?.thumbnail ? `url(${asset.thumbnail})` : undefined,
            }}
            onPointerDown={(e) => begin(e, { kind: 'move-free', key, item: a, startX: e.clientX, cands: cands(a.id) }, select)}
          >
            <span
              className="edge start"
              onPointerDown={(e) =>
                begin(e, { kind: 'trim-free', key, edge: 'start', item: a, startX: e.clientX, cands: cands(a.id) }, select)
              }
            />
            {kind === 'audio' && <Waveform peaks={asset?.peaks} from={a.in} to={a.out} />}
            <span className="item-label">
              {kind === 'audio' ? '♪' : '⧉'} {asset?.name}
            </span>
            <span
              className="edge end"
              onPointerDown={(e) =>
                begin(e, { kind: 'trim-free', key, edge: 'end', item: a, startX: e.clientX, cands: cands(a.id) }, select)
              }
            />
          </div>
        );
      })}
    </div>
  );

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

        <div className="track text-track" style={{ height: laneHeight(textLanes) }}>
          <span className="track-label">Text</span>
          {project.texts.map((o, i) => (
            <div
              key={o.id}
              className={`item text-item ${selection?.id === o.id ? 'selected' : ''}`}
              style={{ left: o.start * pps, width: o.duration * pps, top: textLanes[i] * LANE, height: LANE - 4, bottom: 'auto' }}
              onPointerDown={(e) =>
                begin(e, { kind: 'move-text', item: o, startX: e.clientX, cands: cands(o.id) }, { kind: 'text', id: o.id })
              }
            >
              <span className="item-label">T {o.text}</span>
              <span
                className="edge end"
                onPointerDown={(e) =>
                  begin(e, { kind: 'resize-text', item: o, startX: e.clientX, cands: cands(o.id) }, { kind: 'text', id: o.id })
                }
              />
            </div>
          ))}
        </div>

        {project.overlays.length > 0 && freeTrack('overlays', project.overlays, overlayLanes, 'overlay', 'Overlay')}

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
                  {clip.motion && clip.motion !== 'none' && <b>⤢ </b>}
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

        {freeTrack('audio', project.audio, audioLanes, 'audio', 'Audio')}

        {snapAt !== null && <div className="snap-line" style={{ left: snapAt * pps }} />}
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
