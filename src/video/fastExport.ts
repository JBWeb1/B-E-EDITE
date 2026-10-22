/**
 * Fast export: decode every video file in order with the browser's decoder (WebCodecs),
 * draw each output frame from those decoded frames, encode it and pack it into an MP4
 * or WebM file. No real-time playback and no seeking, so it is usually several times
 * faster than recording, never drops a frame and keeps working in a background tab.
 *
 * The planning (which source frame each output frame needs) is pure and unit-tested;
 * reading and writing files uses mediabunny.
 */
import {
  ALL_FORMATS,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  WebMOutputFormat,
} from 'mediabunny';
import type { AudioCodec, VideoCodec, WrappedCanvas } from 'mediabunny';
import type { VideoEngine } from './engine';
import { mixSoundtrackBuffer } from './export';
import type { VideoFormat } from './export';
import { activeAt, locate } from './timeline';
import type { VideoProject } from './types';

/** Number of frames for a video of `duration` seconds. */
export const frameCount = (duration: number, fps: number) => Math.max(1, Math.round(duration * fps));

/** One decoded picture an output frame needs: `key` is `asset:<id>` (main track) or `overlay:<id>`. */
export interface FrameNeed {
  key: string;
  assetId: string;
  /** Seconds into the source file. */
  t: number;
}

/** For every output frame, the source frames on screen (main clip and video layers). */
export function framePlan(p: VideoProject, duration: number, fps: number): FrameNeed[][] {
  const isVideo = (id: string) => p.assets.find((a) => a.id === id)?.kind === 'video';
  const n = frameCount(duration, fps);
  const out: FrameNeed[][] = [];
  for (let i = 0; i < n; i++) {
    const t = Math.min(i / fps, Math.max(0, duration - 1e-3));
    const needs: FrameNeed[] = [];
    const hit = locate(p.clips, t);
    if (hit && isVideo(hit.clip.assetId)) needs.push({ key: `asset:${hit.clip.assetId}`, assetId: hit.clip.assetId, t: hit.sourceTime });
    for (const o of activeAt(p.overlays, t)) {
      if (!isVideo(o.assetId)) continue;
      const local = t - o.start;
      needs.push({ key: `overlay:${o.id}`, assetId: o.assetId, t: o.reverse ? o.out - local : o.in + local });
    }
    out.push(needs);
  }
  return out;
}

/**
 * The source times each key is asked for, split into runs that only go forwards
 * (a decoder can read a run in one pass; going backwards starts a new run).
 */
export function decodeRuns(plan: FrameNeed[][]): Map<string, number[][]> {
  const runs = new Map<string, number[][]>();
  for (const frame of plan) {
    for (const need of frame) {
      const list = runs.get(need.key) ?? [];
      const last = list[list.length - 1];
      if (last && need.t >= last[last.length - 1] - 1e-6) last.push(need.t);
      else list.push([need.t]);
      runs.set(need.key, list);
    }
  }
  return runs;
}

/** Reads one key's frames in the planned order, one forward pass per run. */
class FrameReader {
  private run = 0;
  private iter: AsyncGenerator<WrappedCanvas | null, void, unknown> | null = null;
  private left = 0;
  private last: WrappedCanvas | null = null;

  constructor(private sink: CanvasSink, private runs: number[][]) {}

  async next(): Promise<CanvasImageSource | null> {
    if (this.left === 0) {
      await this.iter?.return();
      const times = this.runs[this.run++] ?? [];
      this.iter = this.sink.canvasesAtTimestamps(times);
      this.left = times.length;
    }
    this.left--;
    const r = await this.iter!.next();
    // Before the first frame of a file there is nothing yet: keep the frame we had.
    if (!r.done && r.value) this.last = r.value;
    return this.last?.canvas ?? null;
  }

  async close() {
    await this.iter?.return();
  }
}

const VIDEO_CODECS: Record<VideoFormat, VideoCodec[]> = { mp4: ['avc', 'hevc', 'vp9', 'av1'], webm: ['vp9', 'vp8', 'av1'] };
const AUDIO_CODECS: Record<VideoFormat, AudioCodec[]> = { mp4: ['aac', 'opus'], webm: ['opus', 'vorbis'] };

/** True when this browser has the encoders fast export needs. */
export const canFastExport = () => typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';

/**
 * Encode the whole project to a file. Returns null when this browser can't do fast
 * export (no WebCodecs, or no encoder for that file type), so the caller can record instead.
 */
export async function fastExport(
  engine: VideoEngine,
  project: VideoProject,
  opts: { width: number; height: number; fps: number; bitrate: number; format: VideoFormat },
  onProgress?: (f: number, label: string) => void,
  signal?: AbortSignal,
): Promise<Blob | null> {
  if (!canFastExport()) return null;
  const { width, height, fps, format } = opts;
  const videoCodec = await getFirstEncodableVideoCodec(VIDEO_CODECS[format], { width, height, bitrate: opts.bitrate });
  if (!videoCodec) return null;
  const audioCodec = await getFirstEncodableAudioCodec(AUDIO_CODECS[format], { numberOfChannels: 2, sampleRate: 48000 });

  await engine.prepare();
  const duration = engine.duration;
  const plan = framePlan(project, duration, fps);
  const runs = decodeRuns(plan);

  // Open every video file once and check the browser can decode it.
  const inputs = new Map<string, Input>();
  const readers = new Map<string, FrameReader>();
  const cleanup = async () => {
    for (const r of readers.values()) await r.close().catch(() => {});
    for (const i of inputs.values()) i.dispose?.();
  };
  try {
    for (const [key, keyRuns] of runs) {
      const assetId = plan.flat().find((n) => n.key === key)!.assetId;
      const asset = project.assets.find((a) => a.id === assetId)!;
      let input = inputs.get(assetId);
      if (!input) {
        input = new Input({ source: new BlobSource(await (await fetch(asset.url)).blob()), formats: ALL_FORMATS });
        inputs.set(assetId, input);
      }
      const track = await input.getPrimaryVideoTrack().catch(() => null);
      if (!track || !(await track.canDecode())) {
        await cleanup();
        return null; // A file the decoder can't read: record in real time instead.
      }
      readers.set(key, new FrameReader(new CanvasSink(track, { poolSize: 3 }), keyRuns));
    }

    onProgress?.(0, 'Mixing the sound…');
    const sound = audioCodec ? await mixSoundtrackBuffer(project, 48000, (f) => onProgress?.(f * 0.04, 'Mixing the sound…')) : null;

    return await engine.atSize(width, async () => {
      const canvas = engine.outputCanvas;
      const output = new Output({
        format: format === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
        target: new BufferTarget(),
      });
      const video = new CanvasSource(canvas, { codec: videoCodec, bitrate: opts.bitrate || QUALITY_HIGH, keyFrameInterval: 2, latencyMode: 'quality' });
      output.addVideoTrack(video, { frameRate: fps });
      const audio = sound && audioCodec ? new AudioBufferSource({ codec: audioCodec, bitrate: 160_000 }) : null;
      if (audio) output.addAudioTrack(audio);
      await output.start();

      // Sound goes in one-second pieces just ahead of the pictures, so the file interleaves well.
      let soundAt = 0;
      const addSound = async (until: number) => {
        if (!sound || !audio) return;
        while (soundAt < sound.length && soundAt < until * 48000) {
          const len = Math.min(48000, sound.length - soundAt);
          const piece = new AudioBuffer({ length: len, numberOfChannels: 2, sampleRate: 48000 });
          for (let c = 0; c < 2; c++) piece.copyToChannel(sound.getChannelData(c).subarray(soundAt, soundAt + len), c);
          await audio.add(piece);
          soundAt += len;
        }
      };

      const frames = new Map<string, CanvasImageSource>();
      engine.frameOverride = frames;
      const n = plan.length;
      try {
        for (let i = 0; i < n; i++) {
          if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
          frames.clear();
          for (const need of plan[i]) {
            const f = await readers.get(need.key)!.next();
            if (f) frames.set(need.key, f);
          }
          engine.drawFrameAt(plan.length > 1 ? Math.min(i / fps, Math.max(0, duration - 1e-3)) : 0);
          await addSound(i / fps + 1);
          await video.add(i / fps, 1 / fps);
          if (i % 3 === 0 || i === n - 1) onProgress?.(0.04 + ((i + 1) / n) * 0.94, `Exporting frame ${i + 1} of ${n}…`);
        }
        await addSound(Infinity);
        onProgress?.(0.99, 'Finishing the file…');
        await output.finalize();
      } catch (err) {
        await output.cancel().catch(() => {});
        throw err;
      }
      return new Blob([output.target.buffer!], { type: format === 'mp4' ? 'video/mp4' : 'video/webm' });
    });
  } finally {
    await cleanup();
  }
}
