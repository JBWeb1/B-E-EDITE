import { useMemo, useState } from 'react';
import { formatTime } from '../lib/download';
import { Icon } from '../ui/Icon';
import { getTranscript } from './aiTools';
import { cutFillers, cutLines, findFillers, transcriptView } from './transcript';
import type { Caption } from './timeline';
import type { VideoProject } from './types';

const SHOW = 200;

/**
 * Edit by transcript: everything that is said, as text. Click a line to jump to it,
 * cut lines (or filler words) and the video is cut to match.
 */
export function TranscriptPanel({
  project,
  language,
  set,
  seek,
  setProgress,
  addCaptions,
}: {
  project: VideoProject;
  language: string;
  set: (fn: (p: VideoProject) => VideoProject) => void;
  seek: (t: number) => void;
  setProgress: (p: { label: string; value: number } | null) => void;
  addCaptions: (c: Caption[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [soft, setSoft] = useState(false);
  const [message, setMessage] = useState('');
  const [limit, setLimit] = useState(SHOW);
  const view = useMemo(() => transcriptView(project), [project]);
  const fillers = useMemo(() => {
    const kept = view.filter((v) => v.kept > 0).map((v) => v.line);
    // Only fillers that are still in the video.
    return findFillers(kept, soft).filter((f) => project.clips.some((c) => c.assetId === f.assetId && f.start >= c.in && f.end <= c.out));
  }, [view, soft, project.clips]);
  const shown = view.filter((v) => !query.trim() || v.line.text.toLowerCase().includes(query.trim().toLowerCase()));
  const hasWords = (project.transcript ?? []).some((l) => l.words?.length);

  const transcribe = async () => {
    setMessage('');
    try {
      const lines = await getTranscript(project, language, (value, label) => setProgress({ label, value }));
      if (!lines.length) setMessage('No speech found.');
      set((p) => ({ ...p, transcript: lines }));
      setLimit(SHOW);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
    }
  };

  if (!project.transcript?.length) {
    return (
      <>
        <p className="hint">Get the words spoken in your video as text. Then cut the video by deleting lines, remove “um” and “uh” in one click, and turn it into captions.</p>
        <button className="block" onClick={() => void transcribe()} disabled={project.clips.length === 0}>
          <Icon name="text" size={15} /> Get transcript
        </button>
        {message && <p className="ai-message">{message}</p>}
      </>
    );
  }

  return (
    <div className="transcript">
      <div className="row">
        <input className="grow" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find words…" aria-label="Find in transcript" />
        <button className="icon-btn" onClick={() => void transcribe()} title="Listen again (after adding clips)" aria-label="Refresh transcript">
          <Icon name="undo" size={15} />
        </button>
      </div>
      <div className="transcript-fillers">
        <button
          onClick={() => {
            set((p) => cutFillers(p, fillers));
            setMessage(`Removed ${fillers.length} filler word${fillers.length === 1 ? '' : 's'}. Undo brings them back.`);
          }}
          disabled={fillers.length === 0}
        >
          ✂ Remove {fillers.length} filler word{fillers.length === 1 ? '' : 's'}
        </button>
        <label className="check">
          <input type="checkbox" checked={soft} onChange={(e) => setSoft(e.target.checked)} />
          <span>
            also “like”, “you know”… <small>check before cutting</small>
          </span>
        </label>
        {!hasWords && <p className="hint">Word timings are missing, so filler words can't be found. Use an API key, or Refresh with the on-device engine.</p>}
        {fillers.length > 0 && (
          <div className="chips" aria-label="Filler words found">
            {fillers.slice(0, 12).map((f, i) => (
              <button key={i} className="chip" onClick={() => seek(transcriptAt(project, f.assetId, f.start))} title="Show me">
                {f.text}
              </button>
            ))}
            {fillers.length > 12 && <span className="hint">+{fillers.length - 12} more</span>}
          </div>
        )}
      </div>
      <ul className="transcript-lines" aria-label="Transcript">
        {shown.slice(0, limit).map((v) => (
          <li key={v.line.id} className={v.kept < 0.5 ? 'cut' : ''}>
            <input type="checkbox" checked={picked.includes(v.line.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, v.line.id] : picked.filter((x) => x !== v.line.id))} aria-label={`Select: ${v.line.text}`} disabled={v.kept < 0.5} />
            <button className="transcript-time" onClick={() => v.at !== null && seek(v.at + 0.02)} disabled={v.at === null}>
              {v.at === null ? 'cut' : formatTime(v.at).replace(/\.\d$/, '')}
            </button>
            <span className="transcript-text">{v.line.text}</span>
            {v.kept >= 0.5 && (
              <button className="icon-btn" onClick={() => set((p) => cutLines(p, [v.line.id]))} title="Cut this line from the video" aria-label={`Cut: ${v.line.text}`}>
                <Icon name="scissors" size={14} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {shown.length > limit && <button className="link" onClick={() => setLimit(limit + SHOW)}>Show more ({shown.length - limit} left)</button>}
      <div className="row">
        <button onClick={() => (set((p) => cutLines(p, picked)), setPicked([]))} disabled={picked.length === 0}>
          ✂ Cut {picked.length || ''} selected
        </button>
        <button
          onClick={() =>
            addCaptions(
              view
                .filter((v) => v.at !== null && v.kept > 0.5)
                .map((v) => ({ start: v.at!, end: v.at! + (v.line.end - v.line.start), text: v.line.text })),
            )
          }
        >
          Make captions from it
        </button>
      </div>
      {message && <p className="ai-message">{message}</p>}
    </div>
  );
}

function transcriptAt(p: VideoProject, assetId: string, source: number): number {
  for (const v of transcriptView(p)) if (v.line.assetId === assetId && v.at !== null && source >= v.line.start && source <= v.line.end) return v.at + (source - v.line.start);
  return 0;
}
