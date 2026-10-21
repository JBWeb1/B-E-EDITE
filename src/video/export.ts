/**
 * Export settings (platform presets, resolution, frame rate, watermark) and the
 * soundtrack mixer used for "Save audio as WAV". The planning maths is pure and
 * unit-tested; `mixSoundtrack` runs it through an OfflineAudioContext.
 */
import { rampRate, valueAt } from './anim';
import { audioFade, clipDuration, fadeOpacity, layoutClips, projectDuration } from './timeline';
import type { VideoProject, Watermark, WatermarkPosition } from './types';

export type Fps = 24 | 25 | 30 | 50 | 60;
export const FPS_CHOICES: Fps[] = [24, 25, 30, 50, 60];

/** Output heights (for landscape; portrait uses the same number as its width). */
export const RESOLUTIONS = [
  { label: '720p', short: 720 },
  { label: '1080p', short: 1080 },
  { label: '1440p', short: 1440 },
  { label: '4K', short: 2160 },
];

export interface ExportSettings {
  /** Shorter side of the output, in pixels. */
  short: number;
  fps: Fps;
  /** Video bits per second. */
  bitrate: number;
  watermark: boolean;
}

export interface ExportPreset {
  id: string;
  label: string;
  platform: string;
  width: number;
  height: number;
  fps: Fps;
  bitrate: number;
}

export const EXPORT_PRESETS: ExportPreset[] = [
  { id: 'yt-1080', label: 'YouTube 1080p', platform: 'YouTube', width: 1920, height: 1080, fps: 30, bitrate: 12_000_000 },
  { id: 'yt-4k', label: 'YouTube 4K', platform: 'YouTube', width: 3840, height: 2160, fps: 30, bitrate: 40_000_000 },
  { id: 'yt-shorts', label: 'YouTube Shorts', platform: 'YouTube', width: 1080, height: 1920, fps: 30, bitrate: 12_000_000 },
  { id: 'tiktok', label: 'TikTok', platform: 'TikTok', width: 1080, height: 1920, fps: 30, bitrate: 10_000_000 },
  { id: 'ig-reels', label: 'Instagram Reels', platform: 'Instagram', width: 1080, height: 1920, fps: 30, bitrate: 10_000_000 },
  { id: 'ig-post', label: 'Instagram post', platform: 'Instagram', width: 1080, height: 1080, fps: 30, bitrate: 8_000_000 },
  { id: 'ig-portrait', label: 'Instagram portrait', platform: 'Instagram', width: 1080, height: 1350, fps: 30, bitrate: 8_000_000 },
  { id: 'smooth-60', label: 'Smooth 1080p60', platform: 'Any', width: 1920, height: 1080, fps: 60, bitrate: 16_000_000 },
];

/** Output pixel size for a project at a given shorter side (always even numbers, as encoders need). */
export function outputSize(project: { width: number; height: number }, short: number): { width: number; height: number } {
  const portrait = project.height > project.width;
  const ratio = Math.max(project.width, project.height) / Math.min(project.width, project.height);
  const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
  const long = even(short * ratio);
  return portrait ? { width: even(short), height: long } : { width: long, height: even(short) };
}

/** True when the preset's shape matches the project (so no aspect change is needed). */
export function presetFits(p: ExportPreset, project: { width: number; height: number }): boolean {
  return Math.abs(p.width / p.height - project.width / project.height) < 0.01;
}

/** Suggested bitrate for an output size and frame rate (bits per second). */
export function suggestedBitrate(width: number, height: number, fps: number): number {
  const bpp = 0.1; // bits per pixel per frame: good quality for VP9/H.264 web exports
  return Math.round(Math.min(60_000_000, Math.max(2_000_000, width * height * fps * bpp)) / 500_000) * 500_000;
}

export function estimateMB(seconds: number, bitrate: number, audioBitrate = 128_000): number {
  return ((bitrate + audioBitrate) * seconds) / 8 / 1_000_000;
}

// ---------- Watermark ----------

export const DEFAULT_WATERMARK: Watermark = { text: 'Made with B-E Motion', position: 'bottom-right', opacity: 0.7, size: 0.16 };

/** Box of a watermark of aspect `aspect` (w/h) inside a W×H frame, with a margin. */
export function watermarkBox(pos: WatermarkPosition, w: number, h: number, W: number, H: number): { x: number; y: number } {
  const m = Math.round(Math.min(W, H) * 0.035);
  switch (pos) {
    case 'top-left':
      return { x: m, y: m };
    case 'top-right':
      return { x: W - w - m, y: m };
    case 'bottom-left':
      return { x: m, y: H - h - m };
    case 'center':
      return { x: (W - w) / 2, y: (H - h) / 2 };
    case 'bottom-right':
    default:
      return { x: W - w - m, y: H - h - m };
  }
}

// ---------- Soundtrack mix ----------

/** One piece of sound to place in the mix. Times are project seconds. */
export interface AudioSegment {
  assetId: string;
  at: number;
  /** Where in the source file to start (in the reversed file when `reverse`). */
  offset: number;
  /** Length in the project (output seconds). */
  duration: number;
  reverse: boolean;
  /** Gain over time, [project time, gain]. */
  gain: [number, number][];
  /** Playback rate over time, [project time, rate]. */
  rate: [number, number][];
  denoise: number;
}

const STEP = 0.05;

function samples(from: number, len: number, fn: (local: number) => number): [number, number][] {
  const out: [number, number][] = [];
  const n = Math.max(1, Math.ceil(len / STEP));
  for (let i = 0; i <= n; i++) {
    const local = Math.min(len, i * STEP);
    out.push([from + local, fn(local)]);
  }
  return out;
}

/** Every sound in the project, ready to be scheduled. */
export function audioPlan(p: VideoProject): AudioSegment[] {
  const out: AudioSegment[] = [];
  const kind = (id: string) => p.assets.find((a) => a.id === id)?.kind;
  if (!p.tracks?.mainMuted) {
    for (const { clip, start } of layoutClips(p.clips)) {
      if (kind(clip.assetId) !== 'video' || clip.volume <= 0) continue;
      const len = clipDuration(clip);
      const assetLen = p.assets.find((a) => a.id === clip.assetId)?.duration ?? clip.out;
      out.push({
        assetId: clip.assetId,
        at: start,
        offset: clip.reverse ? Math.max(0, assetLen - clip.out) : clip.in,
        duration: len,
        reverse: !!clip.reverse,
        gain: samples(start, len, (l) => clip.volume * fadeOpacity(clip, l) * valueAt(clip.keys?.volume, l, 1)),
        rate: samples(start, len, (l) => clip.speed * rampRate(clip.ramp, len > 0 ? l / len : 0, clip.curve)),
        denoise: clip.denoise ?? 0,
      });
    }
  }
  if (!p.tracks?.audioMuted) {
    for (const a of p.audio) {
      const len = a.out - a.in;
      out.push({
        assetId: a.assetId,
        at: a.start,
        offset: a.in,
        duration: len,
        reverse: false,
        gain: samples(a.start, len, (l) => a.volume * audioFade(a, l) * valueAt(a.keys?.volume, l, 1)),
        rate: [[a.start, 1]],
        denoise: a.denoise ?? 0,
      });
    }
  }
  if (!p.tracks?.overlayHidden) {
    for (const o of p.overlays) {
      if (kind(o.assetId) !== 'video' || o.volume <= 0) continue;
      const len = o.out - o.in;
      out.push({
        assetId: o.assetId,
        at: o.start,
        offset: o.in,
        duration: len,
        reverse: false,
        gain: samples(o.start, len, (l) => o.volume * valueAt(o.keys?.volume, l, 1)),
        rate: [[o.start, 1]],
        denoise: o.denoise ?? 0,
      });
    }
  }
  return out;
}

/** Filter settings for noise reduction level 0..3 (high-pass / low-pass cut-offs in Hz). */
export function denoiseFilters(level: number): { highpass: number; lowpass: number } {
  const l = Math.max(0, Math.min(3, Math.round(level)));
  return [
    { highpass: 10, lowpass: 22000 },
    { highpass: 80, lowpass: 10000 },
    { highpass: 120, lowpass: 7500 },
    { highpass: 170, lowpass: 5500 },
  ][l];
}

/** 16-bit PCM WAV with any number of channels. */
export function encodeWavChannels(channels: Float32Array[], sampleRate: number): ArrayBuffer {
  const n = channels.length;
  const len = channels[0]?.length ?? 0;
  const bytes = len * n * 2;
  const buf = new ArrayBuffer(44 + bytes);
  const v = new DataView(buf);
  const text = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  v.setUint32(4, 36 + bytes, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, n, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * n * 2, true);
  v.setUint16(32, n * 2, true);
  v.setUint16(34, 16, true);
  text(36, 'data');
  v.setUint32(40, bytes, true);
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < n; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return buf;
}

function reversed(ctx: BaseAudioContext, b: AudioBuffer): AudioBuffer {
  const r = ctx.createBuffer(b.numberOfChannels, b.length, b.sampleRate);
  for (let c = 0; c < b.numberOfChannels; c++) {
    const src = b.getChannelData(c);
    const dst = r.getChannelData(c);
    for (let i = 0, j = src.length - 1; i < src.length; i++, j--) dst[i] = src[j];
  }
  return r;
}

/** Render the whole soundtrack to a stereo WAV blob. */
export async function mixSoundtrack(p: VideoProject, onProgress?: (f: number) => void): Promise<Blob> {
  const out = await mixSoundtrackBuffer(p, 44100, onProgress);
  return new Blob([encodeWavChannels([out.getChannelData(0), out.getChannelData(1)], out.sampleRate)], { type: 'audio/wav' });
}

/** The whole soundtrack, mixed to a stereo buffer at `rate`. */
export async function mixSoundtrackBuffer(p: VideoProject, rate = 44100, onProgress?: (f: number) => void): Promise<AudioBuffer> {
  const seconds = Math.max(0.1, projectDuration(p));
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * rate), rate);
  const plan = audioPlan(p);
  const decoded = new Map<string, AudioBuffer | null>();
  let done = 0;
  for (const seg of plan) {
    if (!decoded.has(seg.assetId)) {
      const asset = p.assets.find((a) => a.id === seg.assetId);
      let buffer: AudioBuffer | null = null;
      try {
        if (asset) buffer = await ctx.decodeAudioData(await (await fetch(asset.url)).arrayBuffer());
      } catch {
        buffer = null; // A file without a sound track (or one the browser can't decode) is skipped.
      }
      decoded.set(seg.assetId, buffer);
    }
    onProgress?.((++done / Math.max(1, plan.length)) * 0.5);
  }
  for (const seg of plan) {
    let buffer = decoded.get(seg.assetId);
    if (!buffer) continue;
    if (seg.reverse) buffer = reversed(ctx, buffer);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    const f = denoiseFilters(seg.denoise);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = f.highpass;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = f.lowpass;
    src.connect(hp).connect(lp).connect(gain).connect(ctx.destination);
    gain.gain.setValueAtTime(seg.gain[0][1], seg.at);
    for (const [t, g] of seg.gain.slice(1)) gain.gain.linearRampToValueAtTime(g, t);
    src.playbackRate.setValueAtTime(seg.rate[0][1], seg.at);
    for (const [t, r] of seg.rate.slice(1)) src.playbackRate.linearRampToValueAtTime(r, t);
    src.start(seg.at, Math.min(seg.offset, buffer.duration), seg.duration * Math.max(...seg.rate.map(([, r]) => r)));
    src.stop(seg.at + seg.duration);
  }
  const out = await ctx.startRendering();
  onProgress?.(1);
  return out;
}

// ---------- Container / codec choice ----------

export type VideoFormat = 'mp4' | 'webm';

const MIME_PREFERENCES: Record<VideoFormat, string[]> = {
  // H.264 + AAC plays everywhere (phones, Windows, Mac, every social site).
  mp4: ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a', 'video/mp4;codecs=avc1', 'video/mp4'],
  webm: ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'],
};

/** The best recording type the browser supports for a format, or null if it can't make that format. */
export function pickMimeType(format: VideoFormat, isSupported: (type: string) => boolean): string | null {
  return MIME_PREFERENCES[format].find((t) => isSupported(t)) ?? null;
}

/** Formats this browser can record, best first (MP4 with H.264 is preferred when available). */
export function availableFormats(isSupported: (type: string) => boolean): VideoFormat[] {
  const out: VideoFormat[] = [];
  if (pickMimeType('mp4', isSupported)) out.push('mp4');
  if (pickMimeType('webm', isSupported)) out.push('webm');
  return out;
}

/** File extension for a recorded blob type. */
export const extensionFor = (mime: string) => (mime.includes('mp4') ? 'mp4' : 'webm');
