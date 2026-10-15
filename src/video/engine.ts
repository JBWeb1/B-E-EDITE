import { rampRate, valueAt } from './anim';
import { denoiseFilters, watermarkBox } from './export';
import { gradeFilterMarkup, gradeId, isNeutral } from './grade';
import { ChromaKeyer } from './keyer';
import { blendOp, blurSamples, clipFrame, cropRect, overlayFrame } from './layers';
import type { LayerFrame } from './layers';
import { drawParticles, heartPath, particlesAt, starPath } from './particles';
import { drawTextItem } from './textfx';
import {
  activeAt,
  audioFade,
  clipDuration,
  effectFrame,
  NO_EFFECT,
  computePeaks,
  cssFilter,
  fadeOpacity,
  locate,
  projectDuration,
  textsAt,
  trackOf,
  transitionAt,
} from './timeline';
import type { EffectFrame } from './timeline';
import type { Clip, LayerProps, MediaAsset, OverlayClip, TextOverlay, VideoProject } from './types';

/** Seconds of drift allowed between the clock and a playing media element before re-seeking. */
const DRIFT_TOLERANCE = 0.3;

export interface RecordOptions {
  /** Output size in pixels (defaults to the project size). */
  width?: number;
  height?: number;
  fps: number;
  /** Video bits per second. */
  bitrate: number;
}

/** Everything `paintLayer` needs to draw one clip or layer. */
interface PaintJob {
  source: CanvasImageSource;
  src: { sx: number; sy: number; sw: number; sh: number };
  layer: LayerProps & { filters?: Parameters<typeof cssFilter>[0] };
  /** Where the layer is at a local time (several times for motion blur). */
  frameAt: (local: number) => LayerFrame;
  local: number;
  alpha: number;
  rounded?: number;
  shadow?: boolean;
  /** Flip the picture left-to-right (in place). */
  mirror?: boolean;
}

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
  private denoisers = new Map<HTMLMediaElement, { hp: BiquadFilterNode; lp: BiquadFilterNode }>();
  private audioCtx: AudioContext | null = null;
  private master: GainNode | null = null;
  private raf = 0;
  private clockStart = 0;
  private timeAtStart = 0;
  private endedListeners = new Set<() => void>();
  private keyer = new ChromaKeyer();
  /** Pixels per project pixel (above 1 while exporting at a higher resolution). */
  private scale = 1;
  /** Frame rate used for motion blur. */
  private fps = 30;

  time = 0;
  playing = false;
  /** Turn green-screen removal off (while the user picks the key colour). */
  keyingOff = false;
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
    this.resize();
    this.syncElements(p);
    if (!this.playing) {
      this.time = Math.min(this.time, this.duration);
      this.sync();
      this.draw();
    }
  }

  private resize() {
    const p = this.project;
    if (!p) return;
    const w = Math.round(p.width * this.scale);
    const h = Math.round(p.height * this.scale);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
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

  /** Route an element through Web Audio: noise-reduction filters, then a per-clip volume. */
  private connect(el: HTMLMediaElement) {
    if (!this.audioCtx || !this.master || this.gains.has(el)) return;
    const source = this.audioCtx.createMediaElementSource(el);
    const hp = this.audioCtx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 10;
    const lp = this.audioCtx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 22000;
    const gain = this.audioCtx.createGain();
    source.connect(hp).connect(lp).connect(gain).connect(this.master);
    this.gains.set(el, gain);
    this.denoisers.set(el, { hp, lp });
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
        const clip = hit.clip;
        const local = this.time - hit.start;
        const len = clipDuration(clip);
        const muted = p.tracks?.mainMuted || clip.reverse ? 0 : 1;
        this.setVolume(v, muted * clip.volume * fadeOpacity(clip, local) * valueAt(clip.keys?.volume, local, 1));
        this.setDenoise(v, clip.denoise);
        if (clip.reverse) {
          // Browsers can't play video backwards, so step through it frame by frame.
          if (!v.paused) v.pause();
          if (Math.abs(v.currentTime - hit.sourceTime) > 0.03) v.currentTime = hit.sourceTime;
        } else {
          v.playbackRate = Math.max(0.0625, Math.min(16, clip.speed * rampRate(clip.ramp, len > 0 ? local / len : 0)));
          this.align(v, hit.sourceTime);
        }
      } else if (!v.paused) {
        v.pause();
      }
    }
    for (const clip of p.audio) {
      const el = this.audios.get(clip.id);
      if (!el) continue;
      const local = this.time - clip.start;
      if (local >= 0 && local < clip.out - clip.in) {
        this.setVolume(el, (p.tracks?.audioMuted ? 0 : 1) * clip.volume * audioFade(clip, local) * valueAt(clip.keys?.volume, local, 1));
        this.setDenoise(el, clip.denoise);
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
        const local = this.time - o.start;
        this.setVolume(v, p.tracks?.overlayHidden ? 0 : o.volume * valueAt(o.keys?.volume, local, 1));
        this.setDenoise(v, o.denoise);
        if (o.reverse) {
          if (!v.paused) v.pause();
          const target = o.out - local;
          if (Math.abs(v.currentTime - target) > 0.03) v.currentTime = target;
        } else {
          this.align(v, o.in + local);
        }
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

  private setDenoise(el: HTMLMediaElement, level = 0) {
    const f = this.denoisers.get(el);
    if (!f) return;
    const d = denoiseFilters(level);
    if (f.hp.frequency.value !== d.highpass) f.hp.frequency.value = d.highpass;
    if (f.lp.frequency.value !== d.lowpass) f.lp.frequency.value = d.lowpass;
  }

  /** Draw the frame at the current time. */
  draw() {
    const p = this.project;
    const ctx = this.ctx;
    if (!p) return;
    const W = p.width;
    const H = p.height;
    ctx.save();
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    ctx.globalAlpha = 1;
    ctx.filter = 'none';
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = p.background;
    ctx.fillRect(0, 0, W, H);

    // Effects that move the picture (shake, zoom pulse) wrap the clips and layers;
    // the rest are painted over the finished frame below.
    const fx = p.tracks?.effectsHidden ? NO_EFFECT : effectFrame(p.effects ?? [], this.time);
    ctx.save();
    if (fx.dx || fx.dy || fx.scale !== 1) {
      // Zoom in a little extra while shaking, so the frame edges never show.
      const cover = fx.scale * (1 + 2 * Math.max(Math.abs(fx.dx), Math.abs(fx.dy)));
      ctx.translate(W / 2 + fx.dx * W, H / 2 + fx.dy * H);
      ctx.scale(cover, cover);
      ctx.translate(-W / 2, -H / 2);
    }

    const hit = locate(p.clips, this.time);
    if (hit) {
      const asset = p.assets.find((a) => a.id === hit.clip.assetId);
      const source = asset ? this.sourceFor(asset) : null;
      const alpha = fadeOpacity(hit.clip, this.time - hit.start);
      const local = this.time - hit.start;
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
          this.drawMainClip(source, asset, hit.clip, alpha * a, local);
          ctx.restore();
        };
        switch (tr.type) {
          case 'fade':
            ctx.drawImage(snap, 0, 0, W, H);
            current(q);
            break;
          case 'black':
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, W, H);
            if (q < 0.5) {
              ctx.globalAlpha = 1 - q * 2;
              ctx.drawImage(snap, 0, 0, W, H);
              ctx.globalAlpha = 1;
            } else {
              current(q * 2 - 1);
            }
            break;
          case 'slide':
            ctx.drawImage(snap, -q * W, 0, W, H);
            current(1, () => ctx.translate((1 - q) * W, 0));
            break;
          case 'zoom':
            ctx.drawImage(snap, 0, 0, W, H);
            current(q, () => {
              const z = 1 + 0.35 * (1 - q);
              ctx.translate(W / 2, H / 2);
              ctx.scale(z, z);
              ctx.translate(-W / 2, -H / 2);
            });
            break;
          case 'wipe':
            ctx.drawImage(snap, 0, 0, W, H);
            current(1, () => {
              ctx.beginPath();
              ctx.rect(0, 0, q * W, H);
              ctx.clip();
            });
            break;
        }
      } else if (source && asset) {
        this.drawMainClip(source, asset, hit.clip, alpha, local);
        if (!tr) this.takeSnapshot(hit.clip.id);
      }
    }

    // Upper video tracks, lowest first, so higher tracks cover lower ones.
    if (!p.tracks?.overlayHidden) {
      const layers = activeAt(p.overlays, this.time).sort((a, b) => trackOf(a) - trackOf(b));
      for (const o of layers) this.drawOverlay(o, p);
    }
    ctx.restore();
    this.drawEffects(fx);

    // Animations only run during playback so paused frames always show text clearly.
    if (!p.tracks?.textHidden) for (const o of textsAt(p.texts, this.time)) this.drawTextLayer(o, W, H);
    if (p.watermark) this.drawWatermark(W, H);
    ctx.restore();
  }

  private drawTextLayer(o: TextOverlay, W: number, H: number) {
    const ctx = this.ctx;
    if (!o.motionBlur || !this.playing || !o.keys) {
      drawTextItem(ctx, o, this.time, W, H, this.playing);
      return;
    }
    const times = blurSamples(this.time, this.fps);
    this.accumulate(times.length, (c, i) => drawTextItem(c, o, times[i], W, H, true));
  }

  /**
   * Motion blur: draw something several times into a scratch canvas, adding the copies
   * together at 1/n strength each, then put the averaged result on the frame.
   */
  private accumulate(n: number, drawCopy: (ctx: CanvasRenderingContext2D, i: number) => void, blend: GlobalCompositeOperation = 'source-over') {
    const acc = this.scratch('acc', this.canvas.width, this.canvas.height);
    const a = acc.getContext('2d')!;
    a.setTransform(1, 0, 0, 1, 0, 0);
    a.clearRect(0, 0, acc.width, acc.height);
    for (let i = 0; i < n; i++) {
      a.save();
      a.setTransform(this.scale, 0, 0, this.scale, 0, 0);
      a.globalCompositeOperation = 'lighter';
      a.globalAlpha = 1 / n;
      drawCopy(a, i);
      a.restore();
    }
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = blend;
    ctx.drawImage(acc, 0, 0);
    ctx.restore();
  }

  private scratchCanvases = new Map<string, HTMLCanvasElement>();
  private scratch(name: string, w: number, h: number): HTMLCanvasElement {
    let c = this.scratchCanvases.get(name);
    if (!c) {
      c = document.createElement('canvas');
      this.scratchCanvases.set(name, c);
    }
    if (c.width !== w || c.height !== h) {
      c.width = Math.max(1, w);
      c.height = Math.max(1, h);
    }
    return c;
  }

  /** Make sure an SVG filter for a colour grade exists in the page; returns its CSS reference. */
  private gradeFilter(layer: LayerProps): string {
    const g = layer.grade;
    if (!g || isNeutral(g)) return '';
    const id = gradeId(g);
    if (!document.getElementById(id)) {
      let host: Element | null = document.getElementById('bem-grade-defs');
      if (!host) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '0');
        svg.setAttribute('height', '0');
        svg.setAttribute('aria-hidden', 'true');
        svg.style.position = 'absolute';
        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        defs.id = 'bem-grade-defs';
        svg.appendChild(defs);
        document.body.appendChild(svg);
        host = defs;
      }
      host.insertAdjacentHTML('beforeend', gradeFilterMarkup(g));
    }
    return `url(#${id})`;
  }

  /**
   * Draw one clip/layer: crop → colour → green screen → mask, then place it with
   * its position, angle, opacity, blend mode and (optionally) motion blur.
   */
  private paintLayer(job: PaintJob) {
    const ctx = this.ctx;
    const { layer, src } = job;
    const filter = [this.gradeFilter(layer), cssFilter(layer.filters)].filter((f) => f && f !== 'none').join(' ') || 'none';
    const keyed = !!layer.chroma && !this.keyingOff;
    const masked = !!layer.mask && layer.mask.shape !== 'none';
    const f0 = job.frameAt(job.local);

    let image: CanvasImageSource = job.source;
    let rect = src;
    if (keyed || masked) {
      // Work at the size the layer is drawn (capped), so keying stays fast.
      const px = Math.min(1, 2560 / Math.max(f0.w * this.scale, f0.h * this.scale, 1));
      const bw = Math.max(2, Math.round(f0.w * this.scale * px));
      const bh = Math.max(2, Math.round(f0.h * this.scale * px));
      const buf = this.scratch('layer', bw, bh);
      const b = buf.getContext('2d')!;
      b.setTransform(1, 0, 0, 1, 0, 0);
      b.globalCompositeOperation = 'source-over';
      b.clearRect(0, 0, bw, bh);
      b.filter = filter;
      b.drawImage(job.source, src.sx, src.sy, src.sw, src.sh, 0, 0, bw, bh);
      b.filter = 'none';
      let out: HTMLCanvasElement = buf;
      if (keyed) {
        const k = this.keyer.process(buf, layer.chroma!);
        if (k !== buf) {
          b.clearRect(0, 0, bw, bh);
          b.drawImage(k, 0, 0);
        }
        out = buf;
      }
      if (masked) {
        const m = layer.mask!;
        const k = layer.keys;
        const ms = valueAt(k?.maskScale, job.local, m.scale ?? 1);
        this.applyMask(b, bw, bh, { ...m, x: valueAt(k?.maskX, job.local, m.x), y: valueAt(k?.maskY, job.local, m.y), w: m.w * ms, h: m.h * ms });
      }
      image = out;
      rect = { sx: 0, sy: 0, sw: bw, sh: bh };
    }

    const drawAt = (c: CanvasRenderingContext2D, f: LayerFrame, alpha: number) => {
      c.save();
      c.globalAlpha *= alpha * f.opacity;
      c.translate(f.cx, f.cy);
      if (f.rotation) c.rotate((f.rotation * Math.PI) / 180);
      if (job.mirror) c.scale(-1, 1);
      const x = -f.w / 2;
      const y = -f.h / 2;
      if (job.shadow && !keyed && !masked) {
        c.save();
        c.shadowColor = 'rgba(0,0,0,0.4)';
        c.shadowBlur = 20;
        c.fillStyle = '#000';
        c.beginPath();
        c.roundRect(x, y, f.w, f.h, (job.rounded ?? 0) * Math.min(f.w, f.h));
        c.fill();
        c.restore();
      }
      if (job.rounded && !keyed && !masked) {
        c.beginPath();
        c.roundRect(x, y, f.w, f.h, job.rounded * Math.min(f.w, f.h));
        c.clip();
      }
      if (image === job.source) c.filter = filter;
      c.drawImage(image, rect.sx, rect.sy, rect.sw, rect.sh, x, y, f.w, f.h);
      c.restore();
    };

    const blend = blendOp(layer.blend);
    if (layer.motionBlur && this.playing) {
      const times = blurSamples(job.local, this.fps);
      const frames = times.map((t) => job.frameAt(t));
      const moved = frames.some((f) => Math.abs(f.cx - f0.cx) > 0.5 || Math.abs(f.cy - f0.cy) > 0.5 || Math.abs(f.w - f0.w) > 0.5 || Math.abs(f.rotation - f0.rotation) > 0.2);
      if (moved) {
        this.accumulate(frames.length, (c, i) => drawAt(c, frames[i], job.alpha), blend);
        return;
      }
    }
    ctx.save();
    ctx.globalCompositeOperation = blend;
    drawAt(ctx, f0, job.alpha);
    ctx.restore();
  }

  /** Keep only the mask shape (or everything but it), with a soft edge. */
  private applyMask(b: CanvasRenderingContext2D, w: number, h: number, m: NonNullable<LayerProps['mask']>) {
    const mask = this.scratch('mask', w, h);
    const mc = mask.getContext('2d')!;
    mc.setTransform(1, 0, 0, 1, 0, 0);
    mc.clearRect(0, 0, w, h);
    const feather = Math.max(0, m.feather) * Math.min(w, h);
    mc.filter = feather > 0.5 ? `blur(${feather / 2}px)` : 'none';
    mc.fillStyle = '#fff';
    mc.translate(m.x * w, m.y * h);
    const mw = m.w * w;
    const mh = m.h * h;
    mc.beginPath();
    switch (m.shape) {
      case 'rect':
        mc.rect(-mw / 2, -mh / 2, mw, mh);
        mc.fill();
        break;
      case 'ellipse':
        mc.ellipse(0, 0, mw / 2, mh / 2, 0, 0, Math.PI * 2);
        mc.fill();
        break;
      case 'diamond':
        mc.moveTo(0, -mh / 2);
        mc.lineTo(mw / 2, 0);
        mc.lineTo(0, mh / 2);
        mc.lineTo(-mw / 2, 0);
        mc.closePath();
        mc.fill();
        break;
      case 'star':
        mc.scale(mw / mh, 1);
        starPath(mc, mh / 2, 5, 0.45);
        mc.fill();
        break;
      case 'heart':
        mc.scale(mw / mh, 1);
        mc.translate(0, mh * 0.08);
        heartPath(mc, mh * 1.1);
        mc.fill();
        break;
    }
    mc.filter = 'none';
    b.save();
    b.setTransform(1, 0, 0, 1, 0, 0);
    b.globalCompositeOperation = m.invert ? 'destination-out' : 'destination-in';
    b.drawImage(mask, 0, 0);
    b.restore();
  }

  private fxCanvas = document.createElement('canvas');
  private tmpCanvas = document.createElement('canvas');
  private grainCanvas: HTMLCanvasElement | null = null;
  private scanCanvas: HTMLCanvasElement | null = null;

  /** Copy of the frame so far, in device pixels. */
  private copyFrame(): HTMLCanvasElement {
    const c = this.fxCanvas;
    if (c.width !== this.canvas.width || c.height !== this.canvas.height) {
      c.width = this.canvas.width;
      c.height = this.canvas.height;
    }
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(this.canvas, 0, 0);
    return c;
  }

  /** Paint the frame-wide effects. Works in device pixels. */
  private drawEffects(fx: EffectFrame) {
    const ctx = this.ctx;
    const PW = this.canvas.width;
    const PH = this.canvas.height;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (fx.blur > 0) {
      const c = this.copyFrame();
      ctx.filter = `blur(${Math.max(1, fx.blur * PW)}px)`;
      ctx.drawImage(c, 0, 0);
      ctx.filter = 'none';
    }
    if (fx.glitch > 0) {
      const c = this.copyFrame();
      const rnd = (k: number) => Math.abs(Math.sin(fx.glitchSeed * 91.3 + k * 17.7) * 43758.5453) % 1;
      const slices = 3 + Math.floor(rnd(1) * 6);
      for (let i = 0; i < slices; i++) {
        const y = rnd(i + 2) * PH;
        const h = (0.01 + rnd(i + 30) * 0.08) * PH;
        const dx = (rnd(i + 60) - 0.5) * 0.12 * PW * fx.glitch;
        ctx.drawImage(c, 0, y, PW, h, dx, y, PW, h);
      }
    }
    if (fx.chromatic > 0) {
      const c = this.copyFrame();
      const t = this.tmpCanvas;
      if (t.width !== PW || t.height !== PH) {
        t.width = PW;
        t.height = PH;
      }
      const tc = t.getContext('2d')!;
      const d = fx.chromatic * PW;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, PW, PH);
      for (const [color, off] of [['#ff0000', -d], ['#00ff00', 0], ['#0000ff', d]] as const) {
        tc.globalCompositeOperation = 'source-over';
        tc.drawImage(c, 0, 0);
        tc.globalCompositeOperation = 'multiply';
        tc.fillStyle = color;
        tc.fillRect(0, 0, PW, PH);
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(t, off, 0);
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    if (fx.glow > 0) {
      const c = this.copyFrame();
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = 0.55 * fx.glow;
      ctx.filter = `blur(${Math.round(PW / 90)}px) brightness(1.15)`;
      ctx.drawImage(c, 0, 0);
      ctx.restore();
    }
    if (fx.leak > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      const cx = (-0.2 + 1.4 * fx.leakPos) * PW;
      const g = ctx.createRadialGradient(cx, PH * 0.3, 0, cx, PH * 0.3, PW * 0.6);
      g.addColorStop(0, `rgba(255,170,90,${0.75 * fx.leak})`);
      g.addColorStop(0.45, `rgba(255,90,120,${0.35 * fx.leak})`);
      g.addColorStop(1, 'rgba(255,60,120,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, PW, PH);
      ctx.restore();
    }
    if (fx.flare > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      const fx0 = fx.flareX * PW;
      const fy0 = fx.flareY * PH;
      const r = Math.min(PW, PH);
      const sun = ctx.createRadialGradient(fx0, fy0, 0, fx0, fy0, r * 0.35);
      sun.addColorStop(0, `rgba(255,255,240,${0.95 * fx.flare})`);
      sun.addColorStop(0.15, `rgba(255,220,160,${0.55 * fx.flare})`);
      sun.addColorStop(1, 'rgba(255,200,120,0)');
      ctx.fillStyle = sun;
      ctx.fillRect(0, 0, PW, PH);
      // Ghosts along the line through the centre of the frame.
      const ghosts = [
        [0.4, 0.06, '120,200,255'],
        [0.7, 0.03, '255,160,220'],
        [1.2, 0.09, '160,255,200'],
        [1.5, 0.045, '255,220,140'],
      ] as const;
      for (const [k, size, rgb] of ghosts) {
        const gx = fx0 + (PW / 2 - fx0) * k * 2;
        const gy = fy0 + (PH / 2 - fy0) * k * 2;
        const gg = ctx.createRadialGradient(gx, gy, 0, gx, gy, r * size);
        gg.addColorStop(0, `rgba(${rgb},${0.35 * fx.flare})`);
        gg.addColorStop(1, `rgba(${rgb},0)`);
        ctx.fillStyle = gg;
        ctx.beginPath();
        ctx.arc(gx, gy, r * size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    if (fx.vignette > 0) {
      const r = Math.hypot(PW, PH) / 2;
      const grad = ctx.createRadialGradient(PW / 2, PH / 2, r * 0.35, PW / 2, PH / 2, r);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, `rgba(0,0,0,${0.85 * fx.vignette})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, PW, PH);
    }
    if (fx.grain > 0) {
      if (!this.grainCanvas) {
        const n = document.createElement('canvas');
        n.width = n.height = 256;
        const nctx = n.getContext('2d')!;
        const img = nctx.createImageData(256, 256);
        for (let i = 0; i < img.data.length; i += 4) {
          const v = Math.random() * 255;
          img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
          img.data[i + 3] = 255;
        }
        nctx.putImageData(img, 0, 0);
        this.grainCanvas = n;
      }
      const pattern = ctx.createPattern(this.grainCanvas, 'repeat');
      if (pattern) {
        // A new random offset each frame makes the grain dance like real film.
        pattern.setTransform(new DOMMatrix().translate(Math.random() * 256, Math.random() * 256).scale(this.scale));
        ctx.save();
        ctx.globalCompositeOperation = 'overlay';
        ctx.globalAlpha = 0.45 * fx.grain;
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, PW, PH);
        ctx.restore();
      }
    }
    if (fx.scanlines > 0) {
      if (!this.scanCanvas) {
        const sc = document.createElement('canvas');
        sc.width = 1;
        sc.height = 4;
        const sctx = sc.getContext('2d')!;
        sctx.fillStyle = 'rgba(0,0,0,0.55)';
        sctx.fillRect(0, 0, 1, 2);
        this.scanCanvas = sc;
      }
      const pattern = ctx.createPattern(this.scanCanvas, 'repeat');
      if (pattern) {
        pattern.setTransform(new DOMMatrix().scale(this.scale));
        ctx.save();
        ctx.globalAlpha = fx.scanlines;
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, PW, PH);
        // A warm/cool colour cast, like worn tape.
        ctx.globalCompositeOperation = 'soft-light';
        ctx.globalAlpha = 0.35 * fx.scanlines;
        ctx.fillStyle = '#ff2fa0';
        ctx.fillRect(0, 0, PW, PH);
        ctx.restore();
      }
    }
    for (const part of fx.particles) drawParticles(ctx, particlesAt(part.kind, part.local, part.intensity, part.speed), PW, PH);
    if (fx.flash > 0.01) {
      ctx.save();
      ctx.globalAlpha = fx.flash;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, PW, PH);
      ctx.restore();
    }
    if (fx.bars > 0) {
      ctx.fillStyle = '#000';
      const h = fx.bars * PH;
      ctx.fillRect(0, 0, PW, h);
      ctx.fillRect(0, PH - h, PW, h);
    }
    ctx.restore();
  }

  private drawWatermark(W: number, H: number) {
    const p = this.project!;
    const wm = p.watermark!;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, wm.opacity));
    const logo = wm.assetId ? this.images.get(wm.assetId) : undefined;
    if (logo?.complete && logo.naturalWidth > 0) {
      const w = wm.size * W;
      const h = (w * logo.naturalHeight) / logo.naturalWidth;
      const { x, y } = watermarkBox(wm.position, w, h, W, H);
      ctx.drawImage(logo, x, y, w, h);
    } else if (wm.text) {
      const size = Math.max(10, wm.size * 0.22 * H);
      ctx.font = `600 ${size}px Inter, system-ui, sans-serif`;
      ctx.textBaseline = 'top';
      const w = ctx.measureText(wm.text).width;
      const { x, y } = watermarkBox(wm.position, w, size * 1.2, W, H);
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = size * 0.3;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(wm.text, x, y);
    }
    ctx.restore();
  }

  /** PNG of the clip frame at the playhead (without text), for "freeze frame". */
  captureClipFrame(): Promise<Blob | null> {
    this.draw();
    const hit = this.project ? locate(this.project.clips, this.time) : null;
    const source = hit && this.snapshotClipId === hit.clip.id ? this.snapshot : this.canvas;
    return new Promise((resolve) => source.toBlob((b) => resolve(b), 'image/png'));
  }

  /** The whole frame at the playhead as PNG or JPEG, at `width`×`height` (defaults to the project size). */
  async captureFrame(type: 'image/png' | 'image/jpeg', width?: number, height?: number): Promise<Blob | null> {
    const p = this.project;
    if (!p) return null;
    const prev = this.scale;
    if (width && height) {
      this.scale = width / p.width;
      this.resize();
    }
    this.draw();
    const blob = await new Promise<Blob | null>((resolve) => this.canvas.toBlob((b) => resolve(b), type, 0.92));
    this.scale = prev;
    this.resize();
    this.draw();
    return blob;
  }

  /** Colour of the picture under a point (fractions of the frame), ignoring green-screen removal. */
  sampleColor(fx: number, fy: number): string {
    const prev = this.keyingOff;
    this.keyingOff = true;
    this.draw();
    const x = Math.max(0, Math.min(this.canvas.width - 1, Math.round(fx * this.canvas.width)));
    const y = Math.max(0, Math.min(this.canvas.height - 1, Math.round(fy * this.canvas.height)));
    const d = this.ctx.getImageData(x, y, 1, 1).data;
    this.keyingOff = prev;
    this.draw();
    return '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
  }

  private snapshot = document.createElement('canvas');
  private snapshotClipId: string | null = null;

  /** Remember the frame just drawn (without text) as the outgoing frame for a transition. */
  private takeSnapshot(clipId: string) {
    if (this.snapshot.width !== this.canvas.width || this.snapshot.height !== this.canvas.height) {
      this.snapshot.width = this.canvas.width;
      this.snapshot.height = this.canvas.height;
    }
    const s = this.snapshot.getContext('2d')!;
    s.clearRect(0, 0, this.snapshot.width, this.snapshot.height);
    s.drawImage(this.canvas, 0, 0);
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

  /** Draw a main-track clip: background fill, then the picture with all its layer settings. */
  private drawMainClip(source: CanvasImageSource, asset: MediaAsset, clip: Clip, alpha: number, local: number) {
    const ctx = this.ctx;
    const p = this.project!;
    const W = p.width;
    const H = p.height;
    const len = clipDuration(clip);
    const progress = len > 0 ? local / len : 0;
    const sw = asset.width ?? W;
    const sh = asset.height ?? H;
    const f0 = clipFrame(clip, asset, W, H, local, progress);
    if (p.fill === 'blur' && (f0.w < W - 1 || f0.h < H - 1 || f0.rotation !== 0)) {
      ctx.save();
      ctx.globalAlpha = alpha;
      this.drawBlurredFill(source, sw, sh, W, H);
      ctx.restore();
    }
    this.paintLayer({
      source,
      src: cropRect(sw, sh, clip.crop),
      layer: clip,
      frameAt: (t) => clipFrame(clip, asset, W, H, t, len > 0 ? t / len : 0),
      local,
      alpha,
      mirror: clip.mirror,
    });
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
    ctx.filter = `blur(${12 * this.scale}px) brightness(0.7)`;
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
    const sw = asset.width ?? p.width;
    const sh = asset.height ?? p.height;
    this.paintLayer({
      source,
      src: cropRect(sw, sh, o.crop),
      layer: o,
      frameAt: (t) => overlayFrame(o, asset, p.width, p.height, t),
      local: this.time - o.start,
      alpha: 1,
      rounded: o.rounded,
      shadow: o.shadow ?? true,
    });
  }

  onEnded(fn: () => void) {
    this.endedListeners.add(fn);
    return () => this.endedListeners.delete(fn);
  }

  /** Record the whole project in real time. Resolves with a WebM (or MP4 on Safari) blob. */
  async record(onProgress?: (fraction: number) => void, opts: RecordOptions = { fps: 30, bitrate: 8_000_000 }): Promise<Blob> {
    const p = this.project;
    if (!p || this.duration <= 0) throw new Error('Nothing to export yet');
    this.pause();
    this.ensureAudio();
    const prevScale = this.scale;
    const prevFps = this.fps;
    if (opts.width && opts.height) {
      this.scale = opts.width / p.width;
      this.resize();
    }
    this.fps = opts.fps;
    const audioCtx = this.audioCtx!;
    const dest = audioCtx.createMediaStreamDestination();
    this.master!.connect(dest);
    const stream = new MediaStream([...this.canvas.captureStream(opts.fps).getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find((m) =>
      MediaRecorder.isTypeSupported(m),
    );
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: opts.bitrate });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);

    try {
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
    } finally {
      this.master!.disconnect(dest);
      stream.getTracks().forEach((t) => t.stop());
      this.scale = prevScale;
      this.fps = prevFps;
      this.resize();
      this.draw();
    }
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

/** Load an uploaded font file so text can use it. Returns the family name. */
export async function loadFont(family: string, url: string): Promise<string> {
  const face = new FontFace(family, `url(${url})`);
  await face.load();
  document.fonts.add(face);
  return family;
}
