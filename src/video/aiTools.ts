/**
 * AI tools that work on the whole project: get a transcript, smart reframe to a
 * new shape (following the action), and auto-duck music under speech. They read the
 * media in the browser and return a new project; the maths lives in `transcript.ts`.
 */
import { aiProvider, decodeMono, loadAISettings } from '../lib/aiService';
import { loudness } from './ai';
import type { Range } from './ai';
import { grabGrayFrames } from './grab';
import { grabFrames } from './faceRun';
import { faceFocus } from './faces';
import { simplifyPath } from './tracker';
import { duckKeys, focusX, reframe, smooth, toTranscriptLines, transcriptView } from './transcript';
import { layoutClips } from './timeline';
import type { AudioClip, MediaAsset, TranscriptLine, VideoProject } from './types';
import { uid } from '../lib/id';

/** Transcribe every video and voice file used in the project (whole files, so later trims stay covered). */
export async function getTranscript(p: VideoProject, language: string, onProgress: (f: number, label: string) => void): Promise<TranscriptLine[]> {
  const provider = aiProvider(loadAISettings());
  const used = new Set([...p.clips.map((c) => c.assetId), ...p.audio.map((a) => a.assetId)]);
  const assets = p.assets.filter((a) => used.has(a.id) && (a.kind === 'video' || (a.kind === 'audio' && !a.sfxId && (a.name.startsWith('Voice-over') || a.name.startsWith('AI voice')))));
  const lines: TranscriptLine[] = [];
  for (let i = 0; i < assets.length; i++) {
    const a = assets[i];
    onProgress(i / assets.length, `Listening to ${a.name}…`);
    const samples = await decodeMono(a.url, 16000);
    if (!samples) continue;
    // Long files go in 10-minute pieces so progress keeps moving and memory stays low.
    const piece = 600 * 16000;
    for (let at = 0; at < samples.length; at += piece) {
      const segs = await provider.transcribe(samples.subarray(at, at + piece), language, (f) => onProgress((i + (at + f * Math.min(piece, samples.length - at)) / samples.length) / assets.length, `Listening to ${a.name}…`));
      lines.push(...toTranscriptLines(a.id, segs, at / 16000));
    }
  }
  onProgress(1, 'Done');
  return lines;
}

/** Speech in the project, in project time (from the clips' sound and voice-overs). */
export async function findSpeech(p: VideoProject, onProgress?: (f: number) => void): Promise<Range[]> {
  const sources = [
    ...layoutClips(p.clips).map((pc) => ({ assetId: pc.clip.assetId, start: pc.start, in: pc.clip.in, out: pc.clip.out, speed: pc.clip.speed, muted: pc.clip.volume === 0 })),
    ...p.audio
      .filter((a) => {
        const asset = p.assets.find((x) => x.id === a.assetId);
        return asset && (asset.name.startsWith('Voice-over') || asset.name.startsWith('AI voice'));
      })
      .map((a) => ({ assetId: a.assetId, start: a.start, in: a.in, out: a.out, speed: 1, muted: a.volume === 0 })),
  ].filter((s) => !s.muted);
  const env = new Map<string, number[]>();
  const out: Range[] = [];
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    const asset = p.assets.find((a) => a.id === s.assetId);
    if (!asset || asset.kind === 'image') continue;
    if (!env.has(asset.id)) {
      const samples = await decodeMono(asset.url, 8000);
      env.set(asset.id, samples ? loudness(samples, 8000, 10) : []);
    }
    const e = env.get(asset.id)!;
    const sorted = [...e].sort((a, b) => a - b);
    const limit = (sorted[Math.floor(sorted.length * 0.95)] ?? 0) * 0.15;
    let from = -1;
    for (let k = Math.floor(s.in * 10); k <= Math.ceil(s.out * 10); k++) {
      const loud = (e[k] ?? 0) > limit && limit > 1e-4;
      if (loud && from < 0) from = k;
      if ((!loud || k === Math.ceil(s.out * 10)) && from >= 0) {
        out.push({ start: s.start + (from / 10 - s.in) / s.speed, end: s.start + (k / 10 - s.in) / s.speed });
        from = -1;
      }
    }
    onProgress?.((i + 1) / sources.length);
  }
  return out;
}

/** Lower every music clip while people talk. Returns the number of music clips changed. */
export async function autoDuck(p: VideoProject, low = 0.25, onProgress?: (f: number) => void): Promise<{ project: VideoProject; changed: number }> {
  const speech = await findSpeech(p, onProgress);
  let changed = 0;
  const audio = p.audio.map((a) => {
    const asset = p.assets.find((x) => x.id === a.assetId);
    const isMusic = asset?.kind === 'audio' && !asset.sfxId && !asset.name.startsWith('Voice-over') && !asset.name.startsWith('AI voice');
    if (!isMusic) return a;
    const len = a.out - a.in;
    const local = speech.map((r) => ({ start: r.start - a.start, end: r.end - a.start })).filter((r) => r.end > 0 && r.start < len);
    if (!local.length) return a;
    changed++;
    return { ...a, keys: { ...a.keys, volume: duckKeys(local, len, low) } };
  });
  return { project: { ...p, audio }, changed };
}

/**
 * Change the video's shape and keep the action in frame: each clip fills the new
 * frame and pans to follow what moves (like a camera operator).
 */
export async function smartReframe(p: VideoProject, width: number, height: number, onProgress?: (f: number) => void, opts: { faces?: boolean } = {}): Promise<VideoProject> {
  const ai = aiProvider();
  // If the face detector can't load (offline), follow the movement instead.
  let facesOk = !!opts.faces;
  const frameAspect = width / height;
  const clips = [];
  for (let i = 0; i < p.clips.length; i++) {
    const c = p.clips[i];
    const asset: MediaAsset | undefined = p.assets.find((a) => a.id === c.assetId);
    if (asset?.kind !== 'video' || !asset.width || !asset.height || asset.width / asset.height <= frameAspect + 0.01) {
      clips.push(c);
      continue;
    }
    const len = c.out - c.in;
    const n = Math.max(2, Math.min(120, Math.ceil(len * 2)));
    const times = Array.from({ length: n }, (_, k) => c.in + (len * k) / (n - 1));
    const frames = await grabGrayFrames(asset.url, times, 64, 36, (f) => onProgress?.((i + f * (opts.faces ? 0.5 : 1)) / p.clips.length));
    let raw = frames.map((f, k) => focusX(f, frames[k - 1]));
    if (facesOk) {
      // Keep the biggest face centred where there is one; follow the movement elsewhere.
      const pictures = await grabFrames(asset.url, 'video', times, 320, (f) => onProgress?.((i + 0.5 + f * 0.25) / p.clips.length));
      const found: (number | null)[] = [];
      for (let k = 0; k < pictures.length; k++) {
        try {
          found.push(faceFocus(await ai.faces(pictures[k])));
        } catch {
          facesOk = false;
          break;
        }
        onProgress?.((i + 0.75 + ((k + 1) / pictures.length) * 0.25) / p.clips.length);
      }
      raw = raw.map((v, k) => found[k] ?? v);
    }
    const focus = smooth(raw, 3);
    const sourceAspect = asset.width / asset.height;
    const xs = focus.map((fx) => reframe(sourceAspect, frameAspect, fx));
    const scale = xs[0].scale;
    // A gentle pan: only the moves that matter become keyframes.
    const path = simplifyPath(xs.map((r, k) => ({ t: ((times[k] - c.in) / c.speed), x: r.x, y: 0.5 })), 0.01);
    clips.push({
      ...c,
      scale,
      x: xs[0].x,
      keys: {
        ...c.keys,
        // Zoom animations keep working on top of the new size.
        scale: c.keys?.scale?.map((k) => ({ ...k, v: (k.v / (c.scale ?? 1)) * scale })),
        x: path.length > 1 ? path.map((pt) => ({ t: pt.t, v: pt.x, ease: 'smooth' as const })) : undefined,
      },
    });
  }
  onProgress?.(1);
  return { ...p, width, height, fill: 'color', clips };
}

export interface DubLine {
  /** Project seconds where the line is said, and for how long. */
  at: number;
  length: number;
  text: string;
}

/** What is said in the edited video (lines that were cut are left out), in project time. */
export function dubLines(p: Pick<VideoProject, 'clips' | 'transcript'>): DubLine[] {
  return transcriptView(p)
    .filter((v) => v.at !== null && v.kept > 0.3 && v.line.text.trim())
    .map((v) => ({ at: Math.round(v.at! * 1000) / 1000, length: Math.round((v.line.end - v.line.start) * v.kept * 1000) / 1000, text: v.line.text.trim() }));
}

/**
 * AI dubbing: transcribe (if needed), translate every line and speak it in the new
 * language at the moment it was said; the original voice is turned down to `keep`.
 * `makeAsset` stores each spoken line as a media file. Returns the new project and
 * the translated lines (for captions).
 */
export async function dubProject(
  p: VideoProject,
  opts: { from: string; to: string; keep: number },
  makeAsset: (file: File) => Promise<MediaAsset>,
  onProgress: (f: number, label: string) => void,
): Promise<{ project: VideoProject; lines: DubLine[] }> {
  const ai = aiProvider();
  let project = p;
  if (!project.transcript?.length) {
    const transcript = await getTranscript(project, opts.from, (f, label) => onProgress(f * 0.3, label));
    project = { ...project, transcript };
  }
  const lines = dubLines(project);
  if (!lines.length) throw new Error('No speech found to dub.');
  onProgress(0.3, 'Translating…');
  const translated = await ai.translate(lines.map((l) => l.text), opts.from || 'en', opts.to, (f) => onProgress(0.3 + f * 0.1, 'Translating…'));
  const assets: MediaAsset[] = [];
  const audio: AudioClip[] = [];
  for (let i = 0; i < lines.length; i++) {
    onProgress(0.4 + (i / lines.length) * 0.58, `Speaking line ${i + 1} of ${lines.length}…`);
    const blob = await ai.speak(translated[i] ?? lines[i].text, opts.to);
    const ext = blob.type.includes('mpeg') ? 'mp3' : 'wav';
    const asset = await makeAsset(new File([blob], `AI voice ${opts.to.toUpperCase()} ${i + 1}.${ext}`, { type: blob.type }));
    assets.push(asset);
    audio.push({ id: uid('audio'), assetId: asset.id, start: lines[i].at, in: 0, out: asset.duration, volume: 1 });
  }
  onProgress(1, 'Done');
  return {
    project: {
      ...project,
      assets: [...project.assets, ...assets],
      audio: [...project.audio, ...audio],
      clips: project.clips.map((c) => ({ ...c, volume: Math.round(c.volume * opts.keep * 100) / 100 })),
    },
    lines: lines.map((l, i) => ({ ...l, text: translated[i] ?? l.text })),
  };
}
