import {
  activeAt,
  audioFade,
  clipDuration,
  computePeaks,
  cssFilter,
  fadeOpacity,
  locate,
  motionTransform,
  projectDuration,
  textAnimation,
  textsAt,
  transitionAt,
} from './timeline';
import type { ExportOptions } from './timeline';
import type { Clip, MediaAsset, OverlayClip, TextOverlay, VideoProject } from './types';

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
  /** One <video> per overlay clip, so an overlay can show a file that is also on the main track. */
  private overlayVideos = new Map<string, HTMLVideoElement>();
  private blurCanvas = document.createElement('canvas');
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
        this.videos.set(asset.id, this.createVideo(asset.url));
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

    const overlayIds = new Set(p.overlays.map((o) => o.id));
    for (const o of p.overlays) {
      const asset = p.assets.find((a) => a.id === o.assetId);
      if (asset?.kind !== 'video' || this.overlayVideos.has(o.id)) continue;
      this.overlayVideos.set(o.id, this.createVideo(asset.url));
    }
    for (const [id, v] of this.overlayVideos) {
      if (!overlayIds.has(id)) {
        v.pause();
        this.overlayVideos.delete(id);
      }
    }
  }

  private createVideo(url: string): HTMLVideoElement {
    const v = document.createElement('video');
    v.src = url;
    v.preload = 'auto';
    v.playsInline = true;
    v.addEventListener('seeked', () => !this.playing && this.draw());
    v.addEventListener('loadeddata', () => !this.playing && this.draw());
    this.connect(v);
    return v;
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
      this.overlayVideos.forEach((v) => this.connect(v));
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
    this.overlayVideos.forEach((v) => v.pause());
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
        this.setVolume(el, clip.volume * audioFade(clip, local));
        this.align(el, clip.in + local);
      } else if (!el.paused) {
        el.pause();
      }
    }
    const active = new Set(activeAt(p.overlays, this.time).map((o) => o.id));
    for (const o of p.overlays) {
      const v = this.overlayVideos.get(o.id);
      if (!v) continue;
      if (active.has(o.id)) {
        this.setVolume(v, o.volume);
        this.align(v, o.in + (this.time - o.start));
      } else if (!v.paused) {
        v.pause();
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
      const source = asset ? this.sourceFor(asset) : null;
      const alpha = fadeOpacity(hit.clip, this.time - hit.start);
      const progress = (this.time - hit.start) / clipDuration(hit.clip);
      const tr = transitionAt(hit, this.time);
      // The outgoing clip is shown as its last drawn frame, so transitions work even
      // between two halves of the same video (which share one <video> element).
      const prevId = p.clips[hit.index - 1]?.id;
      if (tr && this.snapshotClipId === prevId) {
        const q = tr.progress;
        const snap = this.snapshot;
        const current = (a: number, transform?: () => void) => {
          if (!source || !asset) return;
          ctx.save();
          transform?.();
          this.drawClip(source, asset, hit.clip, alpha * a, progress);
          ctx.restore();
        };
        switch (tr.type) {
          case 'fade':
            ctx.drawImage(snap, 0, 0);
            current(q);
            break;
          case 'black':
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, W, H);
            if (q < 0.5) {
              ctx.globalAlpha = 1 - q * 2;
              ctx.drawImage(snap, 0, 0);
              ctx.globalAlpha = 1;
            } else {
              current(q * 2 - 1);
            }
            break;
          case 'slide':
            ctx.drawImage(snap, -q * W, 0);
            current(1, () => ctx.translate((1 - q) * W, 0));
            break;
          case 'zoom':
            ctx.drawImage(snap, 0, 0);
            current(q, () => {
              const z = 1 + 0.35 * (1 - q);
              ctx.translate(W / 2, H / 2);
              ctx.scale(z, z);
              ctx.translate(-W / 2, -H / 2);
            });
            break;
          case 'wipe':
            ctx.drawImage(snap, 0, 0);
            current(1, () => {
              ctx.beginPath();
              ctx.rect(0, 0, q * W, H);
              ctx.clip();
            });
            break;
        }
      } else if (source && asset) {
        this.drawClip(source, asset, hit.clip, alpha, progress);
        if (!tr) this.takeSnapshot(hit.clip.id, W, H);
      }
    }

    for (const o of activeAt(p.overlays, this.time)) this.drawOverlay(o, p);

    // Animations only run during playback so paused frames always show text clearly.
    for (const o of textsAt(p.texts, this.time)) drawText(ctx, o, this.time, W, H, this.playing);
    ctx.restore();
  }

  private snapshot = document.createElement('canvas');
  private snapshotClipId: string | null = null;

  /** Remember the frame just drawn (without text) as the outgoing frame for a transition. */
  private takeSnapshot(clipId: string, W: number, H: number) {
    if (this.snapshot.width !== W || this.snapshot.height !== H) {
      this.snapshot.width = W;
      this.snapshot.height = H;
    }
    this.snapshot.getContext('2d')!.drawImage(this.canvas, 0, 0);
    this.snapshotClipId = clipId;
  }

  private sourceFor(asset: MediaAsset): CanvasImageSource | null {
    if (asset.kind === 'video') {
      const v = this.videos.get(asset.id);
      return v && v.readyState >= 2 ? v : null;
    }
    if (asset.kind === 'image') {
      const img = this.images.get(asset.id);
      return img?.complete && img.naturalWidth > 0 ? img : null;
    }
    return null;
  }

  /** Draw a clip's frame letterboxed into the canvas, with its filters, motion and background fill. */
  private drawClip(source: CanvasImageSource, asset: MediaAsset, clip: Clip, alpha: number, progress: number) {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const sw = asset.width ?? W;
    const sh = asset.height ?? H;
    const scale = Math.min(W / sw, H / sh);
    const dw = sw * scale;
    const dh = sh * scale;
    ctx.save();
    ctx.globalAlpha = alpha;
    if (this.project?.fill === 'blur' && (dw < W - 1 || dh < H - 1)) this.drawBlurredFill(source, sw, sh, W, H);
    const m = motionTransform(clip.motion, progress);
    if (m.scale !== 1 || m.dx !== 0) {
      ctx.translate(W / 2 + m.dx * W, H / 2);
      ctx.scale(m.scale, m.scale);
      ctx.translate(-W / 2, -H / 2);
    }
    ctx.filter = cssFilter(clip.filters);
    ctx.drawImage(source, (W - dw) / 2, (H - dh) / 2, dw, dh);
    ctx.restore();
  }

  /** Fill the frame with a soft, darkened, zoomed copy of the clip (cheap blur via downscaling). */
  private drawBlurredFill(source: CanvasImageSource, sw: number, sh: number, W: number, H: number) {
    const small = this.blurCanvas;
    small.width = 48;
    small.height = Math.max(1, Math.round((48 * H) / W));
    const sctx = small.getContext('2d')!;
    const cover = Math.max(small.width / sw, small.height / sh);
    sctx.drawImage(source, (small.width - sw * cover) / 2, (small.height - sh * cover) / 2, sw * cover, sh * cover);
    const ctx = this.ctx;
    ctx.save();
    ctx.imageSmoothingQuality = 'high';
    ctx.filter = 'blur(12px) brightness(0.7)';
    ctx.drawImage(small, -W * 0.05, -H * 0.05, W * 1.1, H * 1.1);
    ctx.restore();
  }

  private drawOverlay(o: OverlayClip, p: VideoProject) {
    const asset = p.assets.find((a) => a.id === o.assetId);
    if (!asset) return;
    let source: CanvasImageSource | null = null;
    if (asset.kind === 'video') {
      const v = this.overlayVideos.get(o.id);
      source = v && v.readyState >= 2 ? v : null;
    } else {
      source = this.sourceFor(asset);
    }
    if (!source) return;
    const box = overlayBox(o, asset, p.width, p.height);
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = o.opacity;
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.roundRect(box.x, box.y, box.w, box.h, o.rounded * Math.min(box.w, box.h));
    ctx.fillStyle = '#000';
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.clip();
    ctx.drawImage(source, box.x, box.y, box.w, box.h);
    ctx.restore();
  }

  onEnded(fn: () => void) {
    this.endedListeners.add(fn);
    return () => this.endedListeners.delete(fn);
  }

  /** Record the whole project in real time. Resolves with a WebM (or MP4 on Safari) blob. */
  async record(onProgress?: (fraction: number) => void, opts: ExportOptions = { fps: 30, bitrate: 8_000_000 }): Promise<Blob> {
    if (!this.project || this.duration <= 0) throw new Error('Nothing to export yet');
    this.pause();
    this.ensureAudio();
    const audioCtx = this.audioCtx!;
    const dest = audioCtx.createMediaStreamDestination();
    this.master!.connect(dest);
    const stream = new MediaStream([
      ...this.canvas.captureStream(opts.fps).getVideoTracks(),
      ...dest.stream.getAudioTracks(),
    ]);
    const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find((m) =>
      MediaRecorder.isTypeSupported(m),
    );
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: opts.bitrate });
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
    this.overlayVideos.forEach((v) => v.pause());
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
  const decoded = kind === 'audio' ? await decodeAudio(file) : null;
  // Some WebM files (e.g. from MediaRecorder) report Infinity until you seek past the end.
  if (!Number.isFinite(el.duration) && !decoded) {
    el.currentTime = 1e9;
    await Promise.race([new Promise((r) => (el.ondurationchange = r)), new Promise((r) => setTimeout(r, 3000))]);
  }
  const duration = Number.isFinite(el.duration) ? el.duration : decoded?.duration ?? 0;
  const asset: MediaAsset = { ...base, duration };
  if (decoded) asset.peaks = computePeaks(decoded.getChannelData(0), decoded.sampleRate);
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


async function decodeAudio(file: File): Promise<AudioBuffer | null> {
  try {
    const ctx = new OfflineAudioContext(1, 1, 44100);
    return await ctx.decodeAudioData(await file.arrayBuffer());
  } catch {
    return null; // Waveform is optional.
  }
}

/** Where an overlay is drawn, in project pixels. */
export function overlayBox(o: OverlayClip, asset: MediaAsset, W: number, H: number) {
  const aspect = (asset.height ?? 9) / (asset.width ?? 16);
  const w = o.scale * W;
  const h = w * aspect;
  return { x: o.x * W - w / 2, y: o.y * H - h / 2, w, h };
}
