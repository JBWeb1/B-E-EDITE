import { useRef, useState } from 'react';
import { aiProvider, API_VOICES, decodeMono, hasBrowserTranslator, loadAISettings, saveAISettings } from '../lib/aiService';
import type { AISettings } from '../lib/aiService';
import { formatTime } from '../lib/download';
import { Icon } from '../ui/Icon';
import { cutClip, findSilences, LANGUAGES, loudness, motionScore, normalise, pickHighlights, segmentsToCaptions, toProjectTime, totalLength } from './ai';
import type { Range } from './ai';
import { grabGrayFrames } from './grab';
import { autoDuck, dubProject, smartReframe } from './aiTools';
import { TranscriptPanel } from './TranscriptPanel';
import { clipDuration, layoutClips } from './timeline';
import type { Caption } from './timeline';
import type { Clip, MediaAsset, VideoProject } from './types';

const RATE = 16000;
const SHORT_LENGTHS = [15, 30, 60];
const REFRAME = {
  '9:16': { width: 720, height: 1280, label: 'Vertical 9:16 (TikTok, Reels, Shorts)' },
  '1:1': { width: 1080, height: 1080, label: 'Square 1:1' },
  '4:5': { width: 1080, height: 1350, label: 'Portrait 4:5' },
};
const SENSITIVITY = [
  { label: 'Only long pauses', threshold: 0.06, minSilence: 1.2 },
  { label: 'Normal', threshold: 0.1, minSilence: 0.6 },
  { label: 'Tight (fast-paced)', threshold: 0.16, minSilence: 0.35 },
];

/**
 * The AI tab: captions from speech, translated captions, voice-overs, silence removal
 * and auto Shorts. Speech, translation and voices come from `lib/aiService`.
 */
export function AIPanel({
  project,
  time,
  set,
  setProgress,
  addCaptions,
  addAudioFile,
  makeAsset,
  onAutoEdit,
  seek,
}: {
  /** Store a media file and describe it (without placing it anywhere). */
  makeAsset?: (file: File) => Promise<MediaAsset>;
  /** Open the Auto edit dialog. */
  onAutoEdit?: () => void;
  /** Jump the player to a time (for the transcript). */
  seek?: (t: number) => void;
  project: VideoProject;
  time: number;
  set: (fn: (p: VideoProject) => VideoProject) => void;
  setProgress: (p: { label: string; value: number } | null) => void;
  addCaptions: (c: Caption[]) => void;
  addAudioFile: (file: File, at: number) => Promise<void>;
}) {
  const [settings, setSettings] = useState<AISettings>(loadAISettings);
  const [showSettings, setShowSettings] = useState(false);
  const [speechLang, setSpeechLang] = useState('');
  const [target, setTarget] = useState('es');
  const [voiceText, setVoiceText] = useState('');
  const [voiceLang, setVoiceLang] = useState('en');
  const [dubTo, setDubTo] = useState('es');
  const [dubKeep, setDubKeep] = useState(true);
  const [dubCaptions, setDubCaptions] = useState(false);
  const [sensitivity, setSensitivity] = useState(1);
  const [shortLength, setShortLength] = useState(30);
  const [message, setMessage] = useState('');
  const [reframeTo, setReframeTo] = useState<keyof typeof REFRAME>('9:16');
  const sounds = useRef(new Map<string, Promise<Float32Array | null>>());

  const update = (patch: Partial<AISettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveAISettings(next);
  };
  const assetOf = (id: string) => project.assets.find((a) => a.id === id);
  /** Sound of an asset as 16 kHz mono samples (decoded once). */
  const soundOf = (assetId: string) => {
    if (!sounds.current.has(assetId)) {
      const a = assetOf(assetId);
      sounds.current.set(assetId, a && a.kind !== 'image' ? decodeMono(a.url, RATE) : Promise.resolve(null));
    }
    return sounds.current.get(assetId)!;
  };
  const engineNote = settings.engine === 'api' && settings.apiKey ? 'Using your AI service' : 'Runs on this device (free, private)';

  /** Run a job with the progress bar; errors become a friendly message. */
  const run = async (label: string, job: (progress: (f: number) => void) => Promise<string | void>) => {
    setMessage('');
    setProgress({ label, value: 0 });
    try {
      const done = await job((value) => setProgress({ label, value }));
      if (done) setMessage(done);
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      setMessage(/fetch|import|network|load/i.test(text) && settings.engine === 'device' ? `Could not download the AI model (${text}). Check your internet connection, or add an API key in AI settings.` : text);
    } finally {
      setProgress(null);
    }
  };

  const spoken = () => {
    const placed = layoutClips(project.clips).filter((p) => assetOf(p.clip.assetId)?.kind === 'video');
    const voice = project.audio.filter((a) => assetOf(a.assetId)?.kind === 'audio' && !assetOf(a.assetId)?.sfxId);
    return { placed, voice };
  };

  const autoCaptions = () =>
    run('Listening for speech…', async (progress) => {
      const { placed, voice } = spoken();
      const parts = [
        ...placed.map((p) => ({ assetId: p.clip.assetId, clip: p.clip as Pick<Clip, 'in' | 'out' | 'speed'>, start: p.start })),
        // Voice-overs and other sounds on the audio track, when the clips have no speech.
        ...voice.map((a) => ({ assetId: a.assetId, clip: { in: a.in, out: a.out, speed: 1 }, start: a.start })),
      ];
      if (parts.length === 0) throw new Error('Add a video or a voice-over with speech first.');
      const provider = aiProvider(settings);
      const all: Caption[] = [];
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const samples = await soundOf(part.assetId);
        if (!samples) continue;
        const slice = samples.subarray(Math.floor(part.clip.in * RATE), Math.ceil(part.clip.out * RATE));
        const segments = await provider.transcribe(slice, speechLang, (f) => progress((i + f) / parts.length));
        const source = segmentsToCaptions(segments).map((c) => ({ ...c, start: c.start + part.clip.in, end: c.end + part.clip.in }));
        all.push(...toProjectTime(source, part.clip, part.start));
      }
      if (all.length === 0) return 'No speech found.';
      addCaptions(all.sort((a, b) => a.start - b.start));
      return `Added ${all.length} captions. Change their look in the Text tab, or translate them below.`;
    });

  const captionItems = project.texts.filter((t) => !t.shape && !t.template && t.text.trim());
  const translate = () =>
    run('Translating captions…', async (progress) => {
      if (captionItems.length === 0) throw new Error('Add captions first (Auto captions, or the Text tab).');
      const lines = await aiProvider(settings).translate(captionItems.map((t) => t.text), speechLang || 'en', target, progress);
      const byId = new Map(captionItems.map((t, i) => [t.id, lines[i]]));
      set((p) => ({ ...p, texts: p.texts.map((t) => (byId.has(t.id) ? { ...t, text: byId.get(t.id) ?? t.text } : t)) }));
      return `Translated ${lines.length} captions to ${LANGUAGES.find((l) => l.code === target)?.label}. Undo brings the originals back.`;
    });

  const voiceOver = () =>
    run('Creating voice-over…', async (progress) => {
      const blob = await aiProvider(settings).speak(voiceText.trim(), voiceLang, progress);
      const n = project.assets.filter((a) => a.name.startsWith('AI voice')).length + 1;
      const ext = blob.type.includes('mpeg') ? 'mp3' : 'wav';
      await addAudioFile(new File([blob], `AI voice ${n}.${ext}`, { type: blob.type }), time);
      setVoiceText('');
      return 'Voice-over added to the audio track at the playhead.';
    });

  const dub = () =>
    run('Dubbing…', async (progress) => {
      if (!makeAsset) return;
      const label = LANGUAGES.find((l) => l.code === dubTo)?.label ?? dubTo;
      const r = await dubProject(project, { from: speechLang, to: dubTo, keep: dubKeep ? 0.15 : 0 }, makeAsset, (f, l) => setProgress({ label: l, value: f }));
      set(() => r.project);
      if (dubCaptions) addCaptions(r.lines.map((l) => ({ start: l.at, end: l.at + Math.max(0.8, l.length), text: l.text })));
      progress(1);
      return `Dubbed ${r.lines.length} line${r.lines.length === 1 ? '' : 's'} into ${label}${dubKeep ? '; the original voice plays quietly underneath' : ''}. Undo takes it back.`;
    });

  const removeSilences = () =>
    run('Finding pauses…', async (progress) => {
      const s = SENSITIVITY[sensitivity];
      const clips: Clip[] = [];
      let removed = 0;
      let pauses = 0;
      for (let i = 0; i < project.clips.length; i++) {
        const clip = project.clips[i];
        const samples = assetOf(clip.assetId)?.kind === 'video' && !clip.reverse && !clip.ramp ? await soundOf(clip.assetId) : null;
        progress((i + 1) / project.clips.length);
        if (!samples) {
          clips.push(clip);
          continue;
        }
        const env = loudness(samples, RATE, 50);
        const cuts = findSilences(env, 50, { threshold: s.threshold, minSilence: s.minSilence }).filter((r) => r.end > clip.in && r.start < clip.out);
        const inside: Range[] = cuts.map((r) => ({ start: Math.max(r.start, clip.in), end: Math.min(r.end, clip.out) }));
        const pieces = cutClip(clip, inside);
        removed += (clip.out - clip.in - pieces.reduce((t, c) => t + c.out - c.in, 0)) / clip.speed;
        pauses += inside.length;
        clips.push(...pieces);
      }
      if (removed < 0.05) return 'No pauses found. Try "Tight" to cut shorter pauses.';
      set((p) => ({ ...p, clips }));
      return `Removed ${pauses} pause${pauses === 1 ? '' : 's'} (${removed.toFixed(1)} s). Undo puts them back.`;
    });

  const makeShort = () =>
    run('Finding the best moments…', async (progress) => {
      const placed = layoutClips(project.clips);
      const total = placed.length ? placed[placed.length - 1].end : 0;
      if (total <= 0) throw new Error('Add a video first.');
      if (!confirm(`Make a ${shortLength}-second vertical Short from the best moments? Your timeline is replaced (Undo brings it back).`)) return;
      // Score every 0.2 s of the timeline by loudness and movement.
      const PER = 5;
      const score = new Array(Math.ceil(total * PER)).fill(0);
      for (let k = 0; k < placed.length; k++) {
        const p = placed[k];
        const asset = assetOf(p.clip.assetId);
        const from = Math.floor(p.start * PER);
        const to = Math.min(score.length, Math.ceil(p.end * PER));
        const srcAt = (i: number) => p.clip.in + (i / PER - p.start) * p.clip.speed;
        const samples = asset?.kind === 'video' ? await soundOf(p.clip.assetId) : null;
        const env = samples ? normalise(loudness(samples, RATE, PER)) : [];
        let motion: number[] = [];
        if (asset?.kind === 'video' && to - from <= 900) {
          const times = Array.from({ length: to - from }, (_, j) => srcAt(from + j));
          const frames = await grabGrayFrames(asset.url, times, 64, 36, (f) => progress((k + f) / placed.length));
          motion = normalise(motionScore(frames));
        }
        for (let i = from; i < to; i++) score[i] = (env[Math.floor(srcAt(i) * PER)] ?? 0.3) + (motion[i - from] ?? 0.3);
        progress((k + 1) / placed.length);
      }
      const picks = pickHighlights(score, PER, shortLength, 3);
      const clips: Clip[] = [];
      for (const r of picks) {
        for (const p of placed) {
          const a = Math.max(r.start, p.start);
          const b = Math.min(r.end, p.end);
          if (b - a < 0.2) continue;
          const len = clipDuration(p.clip);
          const srcIn = p.clip.in + ((a - p.start) / len) * (p.clip.out - p.clip.in);
          const srcOut = p.clip.in + ((b - p.start) / len) * (p.clip.out - p.clip.in);
          clips.push({ ...p.clip, id: `${p.clip.id}-s${clips.length}`, in: srcIn, out: srcOut, transition: clips.length ? { type: 'fade', duration: 0.2 } : undefined, keys: undefined, ramp: undefined, fadeIn: 0, fadeOut: 0 });
        }
      }
      const length = totalLength(picks);
      const vertical = project.height > project.width;
      set((p) => ({
        ...p,
        width: vertical ? p.width : 720,
        height: vertical ? p.height : 1280,
        fill: 'blur',
        clips,
        texts: p.texts.filter((t) => t.start < length),
        overlays: p.overlays.filter((o) => o.start < length),
        effects: p.effects.filter((e) => e.start < length),
      }));
      return `Made a ${formatTime(length)} vertical Short from ${picks.length} moment${picks.length === 1 ? '' : 's'}. Export it with the TikTok or Shorts preset.`;
    });

  const doReframe = () =>
    run('Following the action…', async (progress) => {
      const target = REFRAME[reframeTo];
      const next = await smartReframe(project, target.width, target.height, progress);
      set(() => next);
      return `Reframed to ${target.label}. Each clip now pans to follow the action (Undo goes back).`;
    });

  const doDuck = () =>
    run('Listening for speech…', async (progress) => {
      const { project: next, changed } = await autoDuck(project, 0.25, progress);
      if (!changed) return 'No music playing under speech was found.';
      set(() => next);
      return `Music now dips under speech in ${changed} clip${changed === 1 ? '' : 's'} (see the volume keyframes on the audio track).`;
    });

  return (
    <>
      {onAutoEdit && (
        <button className="autoedit-card" onClick={onAutoEdit}>
          <span className="emoji">✨</span>
          <strong>Auto edit</strong>
          <small>Raw clips in, finished video out: best moments, cut to the beat, styled for you.</small>
        </button>
      )}
      <p className="hint ai-engine">
        <Icon name="wand" size={14} /> {engineNote} ·{' '}
        <button className="link" onClick={() => setShowSettings((s) => !s)} aria-expanded={showSettings}>
          AI settings
        </button>
      </p>
      {showSettings && (
        <div className="ai-settings">
          <div className="segmented" role="group" aria-label="AI engine">
            <button className={settings.engine === 'device' ? 'active' : ''} onClick={() => update({ engine: 'device' })}>
              On this device
            </button>
            <button className={settings.engine === 'api' ? 'active' : ''} onClick={() => update({ engine: 'api' })}>
              My API key
            </button>
          </div>
          {settings.engine === 'device' ? (
            <p className="hint">Free and private: your video never leaves this computer. The first use downloads the AI models (about 40–80 MB), then they are cached. Translation needs Chrome{hasBrowserTranslator() ? ' (available here)' : ' — not available in this browser'}.</p>
          ) : (
            <>
              <label className="field">
                <span>API key</span>
                <input type="password" value={settings.apiKey} placeholder="sk-…" onChange={(e) => update({ apiKey: e.target.value.trim() })} aria-label="API key" autoComplete="off" />
              </label>
              <label className="field">
                <span>Service address</span>
                <input value={settings.baseUrl} onChange={(e) => update({ baseUrl: e.target.value.trim() })} aria-label="Service address" />
              </label>
              <label className="field">
                <span>Voice</span>
                <select value={settings.voice} onChange={(e) => update({ voice: e.target.value })} aria-label="API voice">
                  {API_VOICES.map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Picture model</span>
                <input value={settings.imageModel} onChange={(e) => update({ imageModel: e.target.value.trim() })} aria-label="Picture model" placeholder="gpt-image-1" />
              </label>
              <p className="hint">Works with OpenAI or any OpenAI-compatible service. The key is stored only in this browser and sent only to the address above.</p>
            </>
          )}
        </div>
      )}

      <h4>Edit by transcript</h4>
      <TranscriptPanel project={project} language={speechLang} set={set} seek={seek ?? (() => {})} setProgress={setProgress} addCaptions={addCaptions} />

      <h4>Auto captions</h4>
      <p className="hint">Listens to your video and writes timed captions (uses the caption style picked in the Text tab).</p>
      <label className="field">
        <span>Spoken language</span>
        <select value={speechLang} onChange={(e) => setSpeechLang(e.target.value)} aria-label="Spoken language">
          <option value="">Detect automatically</option>
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>{l.label}</option>
          ))}
        </select>
      </label>
      <button className="block primary" onClick={autoCaptions} disabled={project.clips.length + project.audio.length === 0}>
        <Icon name="text" size={15} /> Auto captions from speech
      </button>

      <h4>Translate captions</h4>
      <div className="row">
        <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Translate to">
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>{l.label}</option>
          ))}
        </select>
        <button onClick={translate} disabled={captionItems.length === 0}>
          {captionItems.length ? `Translate ${captionItems.length} caption${captionItems.length === 1 ? '' : 's'}` : 'Translate'}
        </button>
      </div>

      <h4>AI voice-over</h4>
      <textarea rows={3} value={voiceText} onChange={(e) => setVoiceText(e.target.value)} placeholder="Type what the voice should say…" aria-label="Voice-over text" />
      <div className="row">
        <select value={voiceLang} onChange={(e) => setVoiceLang(e.target.value)} aria-label="Voice language">
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>{l.label}</option>
          ))}
        </select>
        <button onClick={voiceOver} disabled={!voiceText.trim()}>
          <Icon name="mic" size={15} /> Create voice-over
        </button>
      </div>

      <h4>AI dubbing</h4>
      <p className="hint">Says everything in another language, in time with the video: it transcribes, translates and speaks each line.</p>
      <div className="row">
        <select value={dubTo} onChange={(e) => setDubTo(e.target.value)} aria-label="Dub into">
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>{l.label}</option>
          ))}
        </select>
        <button onClick={dub} disabled={!makeAsset || project.clips.length === 0}>
          <Icon name="mic" size={15} /> Dub the video
        </button>
      </div>
      <label className="check">
        <input type="checkbox" checked={dubKeep} onChange={(e) => setDubKeep(e.target.checked)} />
        Keep the original voice quietly underneath
      </label>
      <label className="check">
        <input type="checkbox" checked={dubCaptions} onChange={(e) => setDubCaptions(e.target.checked)} />
        Add captions in that language
      </label>

      <h4>Remove silences</h4>
      <p className="hint">Cuts the pauses out of talking videos, so they feel snappy.</p>
      <div className="row">
        <select value={sensitivity} onChange={(e) => setSensitivity(Number(e.target.value))} aria-label="Pause length">
          {SENSITIVITY.map((s, i) => (
            <option key={s.label} value={i}>{s.label}</option>
          ))}
        </select>
        <button onClick={removeSilences} disabled={project.clips.length === 0}>
          <Icon name="scissors" size={15} /> Remove silences
        </button>
      </div>

      <h4>Smart reframe</h4>
      <p className="hint">Change the shape and keep the action in frame: every clip fills the screen and pans to follow what moves.</p>
      <div className="row">
        <select value={reframeTo} onChange={(e) => setReframeTo(e.target.value as keyof typeof REFRAME)} aria-label="Reframe to">
          {Object.entries(REFRAME).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <button onClick={doReframe} disabled={project.clips.length === 0}>
          <Icon name="crop" size={15} /> Reframe
        </button>
      </div>

      <h4>Auto-duck music</h4>
      <p className="hint">Turns the music down whenever someone talks, and back up in between.</p>
      <button className="block" onClick={doDuck} disabled={!project.audio.length}>
        <Icon name="volume" size={15} /> Duck music under speech
      </button>

      <h4>Auto Shorts</h4>
      <p className="hint">Picks the loudest, most lively moments and makes a vertical clip for TikTok, Reels or Shorts.</p>
      <div className="row">
        <div className="segmented" role="group" aria-label="Short length">
          {SHORT_LENGTHS.map((s) => (
            <button key={s} className={shortLength === s ? 'active' : ''} onClick={() => setShortLength(s)}>
              {s}s
            </button>
          ))}
        </div>
        <button onClick={makeShort} disabled={project.clips.length === 0}>
          <Icon name="sparkles" size={15} /> Make a Short
        </button>
      </div>
      {message && (
        <p className="ai-message" role="status">
          {message}
        </p>
      )}
    </>
  );
}
