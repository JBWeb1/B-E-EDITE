import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { formatTime } from '../lib/download';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/Icon';
import { hasKeys, keyTimes } from './anim';
import type { Keyframes } from './anim';
import {
  assignLanes,
  beatTimes,
  clipDuration,
  dropIndex,
  EFFECTS,
  layoutClips,
  moveItem,
  overlayTracks,
  PEAKS_PER_SECOND,
  projectDuration,
  snapCandidates,
  snapTime,
  trackOf,
  trimEnd,
  trimStart,
} from './timeline';
import { rollEdit, slideClip, slipClip } from './premiere';
import type { AudioClip, Clip, EffectItem, OverlayClip, TextOverlay, TrackState, VideoProject } from './types';

/** Height of one row in the text, effects, overlay and audio tracks. */
const LANE = 30;
/** Width of the track-header column on the left. */
export const HEAD_W = 108;
/** How close (in screen pixels) an edge must get to something before it snaps. */
const SNAP_PX = 8;

/** Timeline editing tool: select (move/trim), roll a cut, slip a clip's footage, slide a clip. */
export type TrimTool = 'select' | 'roll' | 'slip' | 'slide';
export const TRIM_TOOLS: { id: TrimTool; label: string; key: string; tip: string }[] = [
  { id: 'select', label: 'Select', key: 'V', tip: 'Move and trim clips' },
  { id: 'roll', label: 'Roll', key: 'N', tip: 'Drag a cut: one clip gets longer, the next shorter' },
  { id: 'slip', label: 'Slip', key: 'Y', tip: 'Drag a clip to show an earlier or later part of its footage' },
  { id: 'slide', label: 'Slide', key: 'U', tip: 'Drag a clip along between its neighbours' },
];

export type Selection = { kind: 'clip' | 'text' | 'audio' | 'overlay' | 'effect'; id: string } | null;

/** Tracks whose items float freely in time and have source in/out points. */
type FreeKey = 'audio' | 'overlays';
type FreeItem = AudioClip | OverlayClip;
/** Tracks whose items are just a start and a length. */
type RangeKey = 'texts' | 'effects';
type RangeItem = TextOverlay | EffectItem;

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
  /** Editing tool for main-track clips. */
  tool?: TrimTool;
}

type Drag =
  | { kind: 'reorder'; from: number; startX: number; moved: boolean }
  | { kind: 'trim-clip'; edge: 'start' | 'end'; clip: Clip; startX: number }
  | { kind: 'move-range'; key: RangeKey; item: RangeItem; startX: number; cands: number[] }
  | { kind: 'resize-range'; key: RangeKey; item: RangeItem; startX: number; cands: number[] }
  | { kind: 'move-free'; key: FreeKey; item: FreeItem; startX: number; startY: number; cands: number[] }
  | { kind: 'trim-free'; key: FreeKey; edge: 'start' | 'end'; item: FreeItem; startX: number; cands: number[] }
  | { kind: 'roll' | 'slide'; index: number; clips: Clip[]; startX: number }
  | { kind: 'slip'; clip: Clip; startX: number }
  | { kind: 'scrub' };

const effectLabel = (type: EffectItem['type']) => EFFECTS.find((e) => e.type === type)?.label ?? type;
const textLabel = (o: TextOverlay) => (o.shape ? `◆ ${o.shape}` : o.template ? `▣ ${o.text.split('\n')[0]}` : `T ${o.text}`);

export function Timeline({ project, time, pps, selection, onSelect, onSeek, onBegin, onChange, onCommit, onTransitionClick, tool = 'select' }: Props) {
  const innerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [snapAt, setSnapAt] = useState<number | null>(null);

  const tracks = project.tracks ?? {};
  const duration = projectDuration(project);
  const width = HEAD_W + Math.max(duration + 10, 30) * pps;
  const placed = layoutClips(project.clips);
  const beats = beatTimes(project);
  const assetOf = (id: string) => project.assets.find((a) => a.id === id);
  const textLanes = assignLanes(project.texts, (o) => o.start, (o) => o.start + o.duration);
  const effectLanes = assignLanes(project.effects, (o) => o.start, (o) => o.start + o.duration);
  const audioLanes = assignLanes(project.audio, (a) => a.start, (a) => a.start + a.out - a.in);
  const videoTracks = overlayTracks(project.overlays);
  const laneHeight = (lanes: number[]) => (Math.max(0, ...lanes) + 1) * LANE + 4;
  /** Screen x (inside the timeline) of a time. */
  const xOf = (t: number) => HEAD_W + t * pps;

  const timeAt = (clientX: number) => {
    const rect = innerRef.current!.getBoundingClientRect();
    return Math.max(0, (clientX - rect.left - HEAD_W) / pps);
  };

  /** A touch that may turn out to be a tap (select or seek) or a swipe (the timeline scrolls). */
  const tapRef = useRef<{ x: number; y: number; select?: Selection } | null>(null);

  const begin = (e: ReactPointerEvent, drag: Drag, select?: Selection) => {
    e.stopPropagation();
    // Touch: swiping over a clip scrolls the timeline; a tap picks it, and only a picked
    // clip (or any trim handle) drags.
    const handle = (e.target as Element).closest?.('.edge');
    if (e.pointerType === 'touch' && select && selection?.id !== select.id && !handle) {
      tapRef.current = { x: e.clientX, y: e.clientY, select };
      return;
    }
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
  const updateRange = (key: RangeKey, id: string, patch: Partial<RangeItem>) =>
    onChange((p) => ({ ...p, [key]: (p[key] as RangeItem[]).map((x) => (x.id === id ? { ...x, ...patch } : x)) }));

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
      case 'roll':
        onChange((p) => ({ ...p, clips: rollEdit(d.clips, d.index, dt, p.assets) }));
        break;
      case 'slide':
        onChange((p) => ({ ...p, clips: slideClip(d.clips, d.index, dt, p.assets) }));
        break;
      case 'slip': {
        const next = slipClip(d.clip, -dt, assetOf(d.clip.assetId)?.duration ?? d.clip.out);
        onChange((p) => ({ ...p, clips: p.clips.map((c) => (c.id === next.id ? next : c)) }));
        break;
      }
      case 'move-range': {
        const r = snapRange(Math.max(0, d.item.start + dt), d.item.duration, d.cands, e.altKey);
        setSnapAt(r.at);
        updateRange(d.key, d.item.id, { start: Math.max(0, r.start) });
        break;
      }
      case 'resize-range': {
        const end = snapOne(d.item.start + d.item.duration + dt, d.cands, e.altKey);
        setSnapAt(end.snapped);
        updateRange(d.key, d.item.id, { duration: Math.max(0.2, end.value - d.item.start) });
        break;
      }
      case 'move-free': {
        const r = snapRange(Math.max(0, d.item.start + dt), d.item.out - d.item.in, d.cands, e.altKey);
        setSnapAt(r.at);
        if (d.key === 'overlays') {
          // Drag up or down to move a layer to another video track (up = higher track).
          const o = d.item as OverlayClip;
          const shift = Math.round(-(e.clientY - d.startY) / (LANE + 8));
          const track = Math.max(2, Math.min(Math.max(...videoTracks, 2) + 1, trackOf(o) + shift));
          updateFree(d.key, { ...o, start: Math.max(0, r.start), track });
        } else {
          updateFree(d.key, { ...d.item, start: Math.max(0, r.start) });
        }
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

  const toggle = (key: keyof TrackState) => onCommit((p) => ({ ...p, tracks: { ...p.tracks, [key]: !p.tracks?.[key] } }));

  /** Sticky header at the left of a track: icon, name and a hide/mute switch. */
  const head = (icon: IconName, label: string, key?: keyof TrackState, kind: 'eye' | 'mute' = 'eye') => {
    const off = key ? !!tracks[key] : false;
    return (
      <div className="track-head" onPointerDown={(e) => e.stopPropagation()}>
        <Icon name={icon} size={14} />
        <span>{label}</span>
        {key && (
          <button
            className={`track-toggle ${off ? 'off' : ''}`}
            title={kind === 'mute' ? (off ? 'Unmute track' : 'Mute track') : off ? 'Show track' : 'Hide track'}
            aria-label={`${kind === 'mute' ? (off ? 'Unmute' : 'Mute') : off ? 'Show' : 'Hide'} ${label}`}
            aria-pressed={off}
            onClick={() => toggle(key)}
          >
            <Icon name={kind === 'mute' ? (off ? 'volumeOff' : 'volume') : off ? 'eyeOff' : 'eye'} size={14} />
          </button>
        )}
      </div>
    );
  };

  /** Keyframe diamonds on the selected item (click one to jump the playhead to it). */
  const diamonds = (id: string, keys: Keyframes | undefined, start: number, offset = 0) =>
    selection?.id === id && hasKeys(keys)
      ? keyTimes(keys).map((t) => (
          <button
            key={t}
            className="kf-diamond"
            style={{ left: t * pps + offset }}
            title={`Keyframe at ${formatTime(start + t)}`}
            aria-label="Keyframe"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onSeek(start + t);
            }}
          />
        ))
      : null;

  // Ruler tick spacing that stays readable at any zoom.
  const step = [0.5, 1, 2, 5, 10, 15, 30, 60].find((s) => s * pps >= 70) ?? 120;
  const ticks = Array.from({ length: Math.ceil((width - HEAD_W) / pps / step) + 1 }, (_, i) => i * step);

  const rangeTrack = (key: RangeKey, items: RangeItem[], lanes: number[], kind: 'text' | 'effect', icon: IconName, label: string, toggleKey: keyof TrackState) => (
    <div className={`track ${kind}-track ${tracks[toggleKey] ? 'track-off' : ''}`} style={{ height: laneHeight(lanes) }}>
      {head(icon, label, toggleKey)}
      {items.map((o, i) => (
        <div
          key={o.id}
          className={`item ${kind}-item ${selection?.id === o.id ? 'selected' : ''}`}
          style={{ left: xOf(o.start), width: o.duration * pps, top: 2 + lanes[i] * LANE, height: LANE - 4, bottom: 'auto' }}
          onPointerDown={(e) => begin(e, { kind: 'move-range', key, item: o, startX: e.clientX, cands: cands(o.id) }, { kind, id: o.id })}
        >
          <span className="item-label">{kind === 'text' ? textLabel(o as TextOverlay) : <>✦ {effectLabel((o as EffectItem).type)}</>}</span>
          {kind === 'text' && diamonds(o.id, (o as TextOverlay).keys, o.start)}
          <span
            className="edge end"
            onPointerDown={(e) => begin(e, { kind: 'resize-range', key, item: o, startX: e.clientX, cands: cands(o.id) }, { kind, id: o.id })}
          />
        </div>
      ))}
    </div>
  );

  const freeTrack = (key: FreeKey, items: FreeItem[], lanes: number[], kind: 'audio' | 'overlay', icon: IconName, label: string, toggleKey: keyof TrackState) => (
    <div key={label} className={`track ${kind}-track ${tracks[toggleKey] ? 'track-off' : ''}`} style={{ height: laneHeight(lanes) }}>
      {head(icon, label, toggleKey, kind === 'audio' ? 'mute' : 'eye')}
      {items.map((a, i) => {
        const asset = assetOf(a.assetId);
        const select = { kind, id: a.id } as const;
        return (
          <div
            key={a.id}
            className={`item ${kind}-item ${selection?.id === a.id ? 'selected' : ''}`}
            style={{
              left: xOf(a.start),
              width: (a.out - a.in) * pps,
              top: 2 + lanes[i] * LANE,
              height: LANE - 4,
              bottom: 'auto',
              backgroundImage: kind === 'overlay' && asset?.thumbnail ? `url(${asset.thumbnail})` : undefined,
            }}
            onPointerDown={(e) => begin(e, { kind: 'move-free', key, item: a, startX: e.clientX, startY: e.clientY, cands: cands(a.id) }, select)}
          >
            <span
              className="edge start"
              onPointerDown={(e) =>
                begin(e, { kind: 'trim-free', key, edge: 'start', item: a, startX: e.clientX, cands: cands(a.id) }, select)
              }
            />
            {kind === 'audio' && <Waveform peaks={asset?.peaks} from={a.in} to={a.out} />}
            <span className="item-label">
              {kind === 'audio' ? '♪' : '⧉'} {(a as OverlayClip).chroma ? '🟩 ' : ''}
              {(a as OverlayClip).reverse ? '⟲ ' : ''}
              {asset?.name}
            </span>
            {diamonds(a.id, a.keys, a.start)}
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
        onPointerUp={(e) => {
          const tap = tapRef.current;
          tapRef.current = null;
          if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 10) {
            if (tap.select) onSelect(tap.select);
            else {
              onSelect(null);
              onSeek(timeAt(e.clientX));
            }
          }
          onUp();
        }}
        onPointerCancel={() => {
          tapRef.current = null;
          onUp();
        }}
        onPointerDown={(e) => {
          // On touch screens the empty timeline scrolls; a tap moves the playhead. The ruler scrubs.
          if (e.pointerType === 'touch' && !(e.target as Element).closest('.ruler')) {
            tapRef.current = { x: e.clientX, y: e.clientY };
            return;
          }
          onSelect(null);
          onSeek(timeAt(e.clientX));
          begin(e, { kind: 'scrub' });
        }}
      >
        <div className="ruler">
          <div className="ruler-corner" onPointerDown={(e) => e.stopPropagation()} />
          {ticks.map((t) => (
            <span key={t} className="tick" style={{ left: xOf(t) }}>
              {formatTime(t).replace(/\.0$/, '')}
            </span>
          ))}
          {beats.map((b) => (
            <span key={`b${b}`} className="beat-mark" style={{ left: xOf(b) }} aria-hidden />
          ))}
          {(project.markers ?? []).map((m) => (
            <button
              key={`m${m}`}
              className="marker"
              style={{ left: xOf(m) }}
              title={`Marker at ${formatTime(m)} (double-click to remove)`}
              aria-label={`Marker at ${formatTime(m)}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onSeek(m)}
              onDoubleClick={() => onCommit((p) => ({ ...p, markers: (p.markers ?? []).filter((x) => x !== m) }))}
            />
          ))}
        </div>
        {beats.length > 0 && (
          <div className="beat-lines" aria-hidden>
            {beats.map((b) => (
              <span key={b} style={{ left: xOf(b) }} />
            ))}
          </div>
        )}

        {project.effects.length > 0 && rangeTrack('effects', project.effects, effectLanes, 'effect', 'sparkles', 'Effects', 'effectsHidden')}
        {rangeTrack('texts', project.texts, textLanes, 'text', 'text', 'Text', 'textHidden')}
        {[...videoTracks].reverse().map((n) => {
          const items = project.overlays.filter((o) => trackOf(o) === n);
          const lanes = assignLanes(items, (a) => a.start, (a) => a.start + a.out - a.in);
          return freeTrack('overlays', items, lanes, 'overlay', 'pip', `V${n}`, 'overlayHidden');
        })}

        <div className={`track main-track ${tracks.mainMuted ? 'muted' : ''}`}>
          {head('film', 'Main', 'mainMuted', 'mute')}
          {placed.map(({ clip, index, start }) => {
            const asset = assetOf(clip.assetId);
            return (
              <div
                key={clip.id}
                className={`item clip-item ${selection?.id === clip.id ? 'selected' : ''}`}
                style={{
                  left: xOf(start),
                  width: clipDuration(clip) * pps,
                  backgroundImage: asset?.thumbnail ? `url(${asset.thumbnail})` : undefined,
                }}
                data-tool={tool}
                onPointerDown={(e) => {
                  const sel = { kind: 'clip' as const, id: clip.id };
                  if (tool === 'slip') begin(e, { kind: 'slip', clip, startX: e.clientX }, sel);
                  else if (tool === 'slide' && index > 0 && index < project.clips.length - 1)
                    begin(e, { kind: 'slide', index, clips: project.clips, startX: e.clientX }, sel);
                  else if (tool === 'roll') e.stopPropagation();
                  else begin(e, { kind: 'reorder', from: index, startX: e.clientX, moved: false }, sel);
                }}
              >
                <span
                  className="edge start"
                  onPointerDown={(e) =>
                    tool === 'roll' && index > 0
                      ? begin(e, { kind: 'roll', index, clips: project.clips, startX: e.clientX }, { kind: 'clip', id: clip.id })
                      : begin(e, { kind: 'trim-clip', edge: 'start', clip, startX: e.clientX }, { kind: 'clip', id: clip.id })
                  }
                />
                <span className="clip-meta">
                  <span className="clip-name">
                    {clip.speed !== 1 && <b>{clip.speed}× </b>}
                    {clip.reverse && <b>⟲ </b>}
                    {clip.ramp && clip.ramp !== 'none' && <b>⤳ </b>}
                    {clip.chroma && <b>🟩 </b>}
                    {clip.motion && clip.motion !== 'none' && <b>⤢ </b>}
                    {clip.mirror && <b>⇋ </b>}
                    {asset?.name}
                  </span>
                  <span className="clip-len">{clipDuration(clip).toFixed(1)}s</span>
                </span>
                {diamonds(clip.id, clip.keys, start)}
                <span
                  className="edge end"
                  onPointerDown={(e) =>
                    tool === 'roll' && index < project.clips.length - 1
                      ? begin(e, { kind: 'roll', index: index + 1, clips: project.clips, startX: e.clientX }, { kind: 'clip', id: clip.id })
                      : begin(e, { kind: 'trim-clip', edge: 'end', clip, startX: e.clientX }, { kind: 'clip', id: clip.id })
                  }
                />
              </div>
            );
          })}
          {placed.slice(1).map(({ clip, start }) => (
            <button
              key={`tr-${clip.id}`}
              className={`transition-chip ${clip.transition ? 'on' : ''}`}
              style={{ left: xOf(start) }}
              title={clip.transition ? 'Edit transition' : 'Add a transition'}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onTransitionClick(clip.id)}
            >
              ⇄
            </button>
          ))}
          {dropAt !== null && <div className="drop-marker" style={{ left: xOf(placed[dropAt]?.start ?? duration) }} />}
          {project.clips.length === 0 && <span className="track-empty">Drag media here or click ＋ on a file to start</span>}
        </div>

        {freeTrack('audio', project.audio, audioLanes, 'audio', 'music', 'Audio', 'audioMuted')}

        {snapAt !== null && <div className="snap-line" style={{ left: xOf(snapAt) }} />}
        <div className="playhead" style={{ left: xOf(time) }} />
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
