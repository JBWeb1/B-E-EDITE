import { cssFilter, fadeOpacity, locate, projectDuration, textAnimation, textsAt } from './timeline';
import type { MediaAsset, TextOverlay, VideoProject } from './types';

/** Seconds of drift allowed between the clock and a playing media element before re-seeking. */
const DRIFT_TOLERANCE = 0.3;

/**
 * Plays a VideoProject onto a canvas. One engine drives both the live preview
 * and export (export records the canvas + mixed audio while playing).
 */
export class VideoEngine {
  private ctx: CanvasRenderingContext2D;
  private project: VideoProject | null = null;
  private videos = new Map<string, HTMLVideoElement>();
  private images = new Map<string, HTMLImageElement>();
  private audios = new Map<string, HTMLAudioElement>();
  private gains = new Map<HTMLMediaElement, GainNode>();
  private audioCtx: AudioContext | null = null;
  private master: GainNode | null = null;
  private raf = 0;
  private clockStart = 0;
  private timeAtStart = 0;
  private endedListeners = new Set<() => void>();

  time = 0;
  playing = false;
  onTime: ((t: number) => void) | null = null;
  onPlayingChange: ((playing: boolean) => void) | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  get duration() {
    return this.project ? projectDuration(this.project) : 0;
  }

  setProject(p: VideoProject) {
    this.project = p;
    if (this.canvas.width !== p.width || this.canvas.height !== p.height) {
      this.canvas.width = p.width;
      this.canvas.height = p.height;
    }
    this.syncElements(p);
    if (!this.playing) {
      this.time = Math.min(this.time, this.duration);
      this.sync();
      this.draw();
    }
  }

  /** Create/remove media elements so they match the project's assets and audio clips. */
  private syncElements(p: VideoProject) {
    const assetIds = new Set(p.assets.map((a) => a.id));
    for (const asset of p.assets) {
      if (asset.kind === 'video' && !this.videos.has(asset.id)) {
        const v = document.createElement('video');
        v.src = asset.url;
        v.preload = 'auto';
        v.playsInline = true;
        v.addEventListener('seeked', () => !this.playing && this.draw());
        v.addEventListener('loadeddata', () => !this.playing && this.draw());
        this.videos.set(asset.id, v);
        this.connect(v);
      } else if (asset.kind === 'image' && !this.images.has(asset.id)) {
        const img = new Image();
        img.onload = () => !this.playing && this.draw();
        img.src = asset.url;
        this.images.set(asset.id, img);
      }
    }
    for (const [id, v] of this.videos) {
      if (!assetIds.has(id)) {
        v.pause();
        this.videos.delete(id);
      }
    }
    for (const id of this.images.keys()) if (!assetIds.has(id)) this.images.delete(id);

    const audioIds = new Set(p.audio.map((a) => a.id));
    for (const clip of p.audio) {
      if (this.audios.has(clip.id)) continue;
      const asset = p.assets.find((a) => a.id === clip.assetId);
      if (!asset) continue;
      const el = new Audio(asset.url);
      el.preload = 'auto';
      this.audios.set(clip.id, el);
      this.connect(el);
    }
    for (const [id, el] of this.audios) {
      if (!audioIds.has(id)) {
        el.pause();
        this.audios.delete(id);
      }
    }
  }

  /** Route an element through the Web Audio graph (for per-clip volume and export mixing). */
  private connect(el: HTMLMediaElement) {
    if (!this.audioCtx || !this.master || this.gains.has(el)) return;
    const source = this.audioCtx.createMediaElementSource(el);
    const gain = this.audioCtx.createGain();
    source.connect(gain).connect(this.master);
    this.gains.set(el, gain);
  }

  /** Must be called from a user gesture the first time (browser autoplay rules). */
  private ensureAudio() {
    if (!this.audioCtx) {
      this.audioCtx = new AudioContext();
      this.master = this.audioCtx.createGain();
      this.master.connect(this.audioCtx.destination);
      this.videos.forEach((v) => this.connect(v));
      this.audios.forEach((a) => this.connect(a));
    }
    void this.audioCtx.resume();
  }

  play() {
    if (this.playing || !this.project) return;
    this.ensureAudio();
    if (this.time >= this.duration - 0.05) this.time = 0;
    this.playing = true;
    this.clockStart = performance.now();
    this.timeAtStart = this.time;
    this.onPlayingChange?.(true);
    const loop = () => {
      if (!this.playing) return;
      const t = this.timeAtStart + (performance.now() - this.clockStart) / 1000;
      if (t >= this.duration) {
        this.time = this.duration;
        this.pause();
        this.endedListeners.forEach((fn) => fn());
        return;
      }
      this.time = t;
      this.sync();
      this.draw();
      this.onTime?.(t);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.videos.forEach((v) => v.pause());
    this.audios.forEach((a) => a.pause());
    this.onTime?.(this.time);
    this.onPlayingChange?.(false);
    this.draw();
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  seek(t: number) {
    this.time = Math.max(0, Math.min(t, this.duration));
    if (this.playing) {
      this.clockStart = performance.now();
      this.timeAtStart = this.time;
    }
    this.sync();
    this.draw();
    this.onTime?.(this.time);
  }

  /** Put every media element at the right position / play state for the current time. */
  private sync() {
    const p = this.project;
    if (!p) return;
    const hit = locate(p.clips, this.time);
    for (const [assetId, v] of this.videos) {
      if (hit && hit.clip.assetId === assetId) {
        v.playbackRate = hit.clip.speed;
        this.setVolume(v, hit.clip.volume * fadeOpacity(hit.clip, this.time - hit.start));
        this.align(v, hit.sourceTime);
      } else if (!v.paused) {
        v.pause();
      }
    }
    for (const clip of p.audio) {
      const el = this.audios.get(clip.id);
      if (!el) continue;
      const local = this.time - clip.start;
      if (local >= 0 && local < clip.out - clip.in) {
        this.setVolume(el, clip.volume);
        this.align(el, clip.in + local);
      } else if (!el.paused) {
        el.pause();
      }
    }
  }

  private align(el: HTMLMediaElement, target: number) {
    if (this.playing) {
      if (el.paused) {
        el.currentTime = target;
        void el.play().catch(() => {});
      } else if (Math.abs(el.currentTime - target) > DRIFT_TOLERANCE) {
        el.currentTime = target;
      }
    } else {
      if (!el.paused) el.pause();
      if (Math.abs(el.currentTime - target) > 0.01) el.currentTime = target;
    }
  }

  private setVolume(el: HTMLMediaElement, volume: number) {
    const gain = this.gains.get(el);
    if (gain) gain.gain.value = volume;
    else el.volume = Math.max(0, Math.min(1, volume));
  }

  draw() {
    const p = this.project;
    const ctx = this.ctx;
    if (!p) return;
    const W = p.width;
    const H = p.height;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.filter = 'none';
    ctx.fillStyle = p.background;
    ctx.fillRect(0, 0, W, H);

    const hit = locate(p.clips, this.time);
    if (hit) {
      const asset = p.assets.find((a) => a.id === hit.clip.assetId);
      const source: CanvasImageSource | null =
        asset?.kind === 'video'
          ? (this.videos.get(asset.id)?.readyState ?? 0) >= 2 ? this.videos.get(asset.id)! : null
          : asset?.kind === 'image'
            ? this.images.get(asset.id)?.complete ? this.images.get(asset.id)! : null
            : null;
      if (source && asset) {
        const sw = asset.width ?? W;
        const sh = asset.height ?? H;
        const scale = Math.min(W / sw, H / sh);
        const dw = sw * scale;
        const dh = sh * scale;
        ctx.globalAlpha = fadeOpacity(hit.clip, this.time - hit.start);
        ctx.filter = cssFilter(hit.clip.filters);
        ctx.drawImage(source, (W - dw) / 2, (H - dh) / 2, dw, dh);
        ctx.filter = 'none';
        ctx.globalAlpha = 1;
      }
    }

    // Animations only run during playback so paused frames always show text clearly.
    for (const o of textsAt(p.texts, this.time)) drawText(ctx, o, this.time, W, H, this.playing);
    ctx.restore();
  }

  onEnded(fn: () => void) {
    this.endedListeners.add(fn);
    return () => this.endedListeners.delete(fn);
  }

  /** Record the whole project in real time. Resolves with a WebM (or MP4 on Safari) blob. */
  async record(onProgress?: (fraction: number) => void): Promise<Blob> {
    if (!this.project || this.duration <= 0) throw new Error('Nothing to export yet');
    this.pause();
    this.ensureAudio();
    const audioCtx = this.audioCtx!;
    const dest = audioCtx.createMediaStreamDestination();
    this.master!.connect(dest);
    const stream = new MediaStream([
      ...this.canvas.captureStream(30).getVideoTracks(),
      ...dest.stream.getAudioTracks(),
    ]);
    const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find((m) =>
      MediaRecorder.isTypeSupported(m),
    );
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);

    this.seek(0);
    await new Promise((r) => setTimeout(r, 400)); // let the first frame decode

    const done = new Promise<void>((resolve) => {
      const off = this.onEnded(() => {
        off();
        resolve();
      });
    });
    const prevOnTime = this.onTime;
    this.onTime = (t) => {
      prevOnTime?.(t);
      onProgress?.(t / this.duration);
    };
    recorder.start(250);
    this.play();
    await done;
    this.onTime = prevOnTime;
    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.stop();
    });
    this.master!.disconnect(dest);
    stream.getTracks().forEach((t) => t.stop());
    return new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
  }

  destroy() {
    this.pause();
    this.videos.forEach((v) => {
      v.pause();
      v.removeAttribute('src');
    });
    this.audios.forEach((a) => a.pause());
    void this.audioCtx?.close();
  }
}

export function drawText(ctx: CanvasRenderingContext2D, o: TextOverlay, t: number, W: number, H: number, animate = true) {
  const { alpha, scale, dy } = animate ? textAnimation(o, t) : { alpha: 1, scale: 1, dy: 0 };
  if (alpha <= 0) return;
  const size = o.size * H;
  const lines = o.text.split('\n');
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(o.x * W, (o.y + dy) * H);
  ctx.scale(scale, scale);
  ctx.font = `${o.bold ? 'bold ' : ''}${size}px Inter, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lh = size * 1.2;
  const totalH = lh * lines.length;
  if (o.background) {
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width));
    const pad = size * 0.3;
    ctx.fillStyle = o.background;
    ctx.beginPath();
    ctx.roundRect(-w / 2 - pad, -totalH / 2 - pad / 2, w + pad * 2, totalH + pad, pad);
    ctx.fill();
  } else {
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = size * 0.15;
  }
  ctx.fillStyle = o.color;
  lines.forEach((line, i) => ctx.fillText(line, 0, -totalH / 2 + lh * (i + 0.5)));
  ctx.restore();
}

/** Read duration, size and a thumbnail for an imported file. */
export async function probeMedia(file: File, id: string): Promise<MediaAsset> {
  const url = URL.createObjectURL(file);
  const kind = file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : 'image';
  const base = { id, kind, name: file.name, url } as const;

  if (kind === 'image') {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { ...base, duration: Infinity, width: img.naturalWidth, height: img.naturalHeight, thumbnail: url };
  }

  const el = document.createElement(kind === 'video' ? 'video' : 'audio');
  el.preload = 'metadata';
  el.src = url;
  await new Promise<void>((resolve, reject) => {
    el.onloadedmetadata = () => resolve();
    el.onerror = () => reject(new Error(`Could not read ${file.name}`));
  });
  // Some WebM files report Infinity until you seek past the end.
  if (!Number.isFinite(el.duration)) {
    el.currentTime = 1e9;
    await new Promise((r) => (el.ondurationchange = r));
  }
  const asset: MediaAsset = { ...base, duration: el.duration };
  if (el instanceof HTMLVideoElement) {
    asset.width = el.videoWidth;
    asset.height = el.videoHeight;
    el.currentTime = Math.min(1, el.duration / 2);
    await new Promise((r) => (el.onseeked = r));
    const c = document.createElement('canvas');
    c.width = 160;
    c.height = Math.round((160 * el.videoHeight) / Math.max(1, el.videoWidth));
    c.getContext('2d')!.drawImage(el, 0, 0, c.width, c.height);
    asset.thumbnail = c.toDataURL('image/jpeg', 0.7);
  }
  el.removeAttribute('src');
  return asset;
}

