/**
 * Measures a project for the pre-flight check: plays it frame by frame in a hidden
 * engine (no sound, nothing on screen), mixes its soundtrack offline, then hands the
 * numbers to the pure checks in `preflight.ts`.
 */
import { decodeMono } from '../lib/aiService';
import { loudness } from './ai';
import { VideoEngine } from './engine';
import { mixSoundtrack } from './export';
import {
  charsPerSecond,
  contrastRatio,
  findFlashes,
  hasBacking,
  hexLuminance,
  hookScore,
  isCaption,
  luminance,
  MAX_CPS,
  MIN_TEXT_SIZE,
  overlap,
  SAFE_ZONES,
  slowStartLength,
  textBox,
} from './preflight';
import type { Finding, Platform } from './preflight';
import { layoutClips, projectDuration } from './timeline';
import type { VideoProject } from './types';

export interface PreflightReport {
  hook: number;
  hookFindings: Finding[];
  access: Finding[];
  safe: Finding[];
  platform: Platform;
  /** Ids of items each fix applies to. */
  targets: Record<string, string[]>;
}

const SMALL_W = 64;

export const defaultPlatform = (p: { width: number; height: number }): Platform => (p.height > p.width ? 'tiktok' : 'youtube');

export async function runPreflight(project: VideoProject, platform: Platform, onProgress?: (f: number) => void): Promise<PreflightReport> {
  const duration = projectDuration(project);
  const W = project.width;
  const H = project.height;
  const smallH = Math.max(2, Math.round((SMALL_W * H) / W));
  // Texts are left out of the picture so caption contrast is measured against what is behind them.
  const view: VideoProject = { ...project, texts: [], watermark: null };
  const canvas = document.createElement('canvas');
  const engine = new VideoEngine(canvas);
  engine.setProject(view);
  const small = document.createElement('canvas');
  small.width = SMALL_W;
  small.height = smallH;
  const sctx = small.getContext('2d', { willReadFrequently: true })!;

  const fps = duration <= 20 ? 15 : duration <= 60 ? 10 : Math.max(2, 600 / duration);
  const count = Math.max(1, Math.floor(duration * fps));
  const lum: number[] = [];
  const frames: Uint8ClampedArray[] = [];
  try {
    for (let i = 0; i < count; i++) {
      const c = await engine.renderAt(Math.min(duration - 0.001, i / fps));
      sctx.drawImage(c, 0, 0, SMALL_W, smallH);
      const px = sctx.getImageData(0, 0, SMALL_W, smallH).data;
      frames.push(px);
      let sum = 0;
      for (let k = 0; k < px.length; k += 4) sum += luminance(px[k], px[k + 1], px[k + 2]);
      lum.push(sum / (px.length / 4));
      onProgress?.(((i + 1) / count) * 0.85);
    }
  } finally {
    engine.destroy();
  }

  // Picture change between samples (0..1).
  const motion = frames.map((f, i) => {
    if (i === 0) return 0;
    const p = frames[i - 1];
    let d = 0;
    for (let k = 0; k < f.length; k += 4) d += Math.abs(f[k] - p[k]) + Math.abs(f[k + 1] - p[k + 1]) + Math.abs(f[k + 2] - p[k + 2]);
    return d / (f.length * 0.75) / 255;
  });

  // Soundtrack loudness at the same rate, relative to the loud parts.
  let loud: number[] = new Array(count).fill(0);
  let soundShare = 0;
  if (project.clips.length + project.audio.length > 0) {
    try {
      const mix = await mixSoundtrack(project);
      const url = URL.createObjectURL(mix);
      const samples = await decodeMono(url, 8000);
      URL.revokeObjectURL(url);
      if (samples) {
        const env = loudness(samples, 8000, fps);
        const sorted = [...env].sort((a, b) => a - b);
        const top = sorted[Math.floor(sorted.length * 0.95)] || 1e-6;
        loud = env.slice(0, count).map((v) => Math.min(1, top > 1e-4 ? v / top : 0));
        soundShare = env.filter((v) => v > Math.max(1e-3, top * 0.15)).length / Math.max(1, env.length);
      }
    } catch {
      /* no sound: leave silent */
    }
  }
  onProgress?.(0.95);

  // ---------- Hook ----------
  const first3 = Math.max(1, Math.round(3 * fps));
  const placed = layoutClips(project.clips);
  const words = project.texts.filter((t) => !t.shape);
  const hook = hookScore({
    motion: motion.slice(1, first3).reduce((a, b) => a + b, 0) / Math.max(1, Math.min(first3, motion.length) - 1),
    firstText: words.length ? Math.min(...words.map((t) => t.start)) : null,
    openingLoudness: loud.slice(0, Math.round(2 * fps)).reduce((a, b) => a + b, 0) / Math.max(1, Math.min(loud.length, Math.round(2 * fps))),
    firstCut: placed.length > 1 ? placed[1].start : null,
    firstFrameLuminance: lum[0] ?? 0,
    slowStart: slowStartLength(motion.slice(1), loud.slice(1), fps),
    duration,
    vertical: H > W,
  });

  // ---------- Accessibility ----------
  const access: Finding[] = [];
  // For the slow-start fix: how many seconds to trim.
  const targets: Record<string, string[]> = { 'hook-start': [String(slowStartLength(motion.slice(1), loud.slice(1), fps))] };
  const flashes = findFlashes(lum, fps);
  for (const f of flashes) {
    const fx = project.effects.filter((e) => ['flash', 'glitch', 'vhs'].includes(e.type) && e.start < f.end + 0.2 && e.start + e.duration > f.start - 0.2);
    const id = `flash-${f.start.toFixed(1)}`;
    if (fx.length) targets[id] = fx.map((e) => e.id);
    access.push({
      id,
      severity: 'danger',
      title: `Flashing at ${f.start.toFixed(1)}s (${f.flashes} a second)`,
      detail: 'More than 3 flashes a second can trigger seizures in people with photosensitive epilepsy, and platforms may limit the video. Slow it down or remove it.',
      at: f.start,
      fix: fx.length ? 'remove-flashes' : undefined,
    });
  }
  const captions = project.texts.filter(isCaption);
  const fast = captions.filter((t) => !t.words || t.words === 'off').filter((t) => charsPerSecond(t) > MAX_CPS);
  if (fast.length) {
    targets['captions-fast'] = fast.map((t) => t.id);
    access.push({
      id: 'captions-fast',
      severity: 'warn',
      title: `${fast.length} caption${fast.length === 1 ? ' is' : 's are'} too fast to read`,
      detail: `Keep captions under ${MAX_CPS} characters a second. The fix makes them stay on screen longer (without overlapping the next one).`,
      at: fast[0].start,
      fix: 'slow-captions',
    });
  }
  const tiny = project.texts.filter((t) => !t.shape && t.size * (t.scale ?? 1) < MIN_TEXT_SIZE);
  if (tiny.length) {
    targets['text-small'] = tiny.map((t) => t.id);
    access.push({ id: 'text-small', severity: 'warn', title: `${tiny.length} text${tiny.length === 1 ? ' is' : 's are'} very small`, detail: 'Small text is hard to read on a phone. The fix makes it at least 4.5% of the screen height.', at: tiny[0].start, fix: 'bigger-captions' });
  }
  const lowContrast: string[] = [];
  let worst = 21;
  let worstAt = 0;
  for (const t of project.texts.filter((x) => !x.shape && !x.template && !hasBacking(x))) {
    const box = textBox(t, W, H);
    const x0 = Math.max(0, Math.floor(box.x * SMALL_W));
    const x1 = Math.min(SMALL_W, Math.ceil((box.x + box.w) * SMALL_W));
    const y0 = Math.max(0, Math.floor(box.y * smallH));
    const y1 = Math.min(smallH, Math.ceil((box.y + box.h) * smallH));
    if (x1 <= x0 || y1 <= y0) continue;
    const textLum = hexLuminance(t.color);
    let ratio = 21;
    for (let i = Math.floor(t.start * fps); i < Math.min(frames.length, Math.ceil((t.start + t.duration) * fps)); i++) {
      const f = frames[i];
      let sum = 0;
      let n = 0;
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const k = (y * SMALL_W + x) * 4;
          sum += luminance(f[k], f[k + 1], f[k + 2]);
          n++;
        }
      ratio = Math.min(ratio, contrastRatio(textLum, sum / n));
    }
    if (ratio < 3) {
      lowContrast.push(t.id);
      if (ratio < worst) {
        worst = ratio;
        worstAt = t.start;
      }
    }
  }
  if (lowContrast.length) {
    targets['text-contrast'] = lowContrast;
    access.push({ id: 'text-contrast', severity: 'warn', title: `${lowContrast.length} text${lowContrast.length === 1 ? ' is' : 's are'} hard to see (contrast ${worst.toFixed(1)}:1)`, detail: 'Text needs at least 3:1 contrast with the picture behind it. The fix adds a dark outline so it reads on any background.', at: worstAt, fix: 'caption-box' });
  }
  if (captions.length === 0 && soundShare > 0.3 && project.clips.some((c) => project.assets.find((a) => a.id === c.assetId)?.kind === 'video')) {
    access.push({ id: 'captions-missing', severity: 'tip', title: 'No captions', detail: 'If people talk in this video, captions help viewers who are deaf, hard of hearing or watching on mute — about 4 in 5 people scroll with the sound off.', fix: 'add-captions' });
  }
  if (access.length === 0) access.push({ id: 'access-ok', severity: 'ok', title: 'No accessibility problems found', detail: 'No dangerous flashing, and all text is readable.' });

  // ---------- Safe zones ----------
  const safe: Finding[] = [];
  const zone = SAFE_ZONES.find((z) => z.id === platform)!;
  if (zone.vertical !== H > W) {
    safe.push({ id: 'safe-shape', severity: 'tip', title: `${zone.label} expects a ${zone.vertical ? 'vertical (9:16)' : 'landscape (16:9)'} video`, detail: 'Change the shape with the size menu under the player, or pick a preset in Export.' });
  }
  const hidden: string[] = [];
  let firstHidden: { at: number; label: string; what: string } | null = null;
  for (const t of project.texts) {
    const box = textBox(t, W, H);
    const hit = zone.covered.find((c) => overlap(box, c) > 0.3);
    if (hit) {
      hidden.push(t.id);
      firstHidden ??= { at: t.start, label: hit.label, what: t.shape ? 'A shape' : `"${t.text.split('\n')[0].slice(0, 24)}"` };
    }
  }
  if (hidden.length) {
    targets['safe-zone'] = hidden;
    safe.push({ id: 'safe-zone', severity: 'warn', title: `${hidden.length} item${hidden.length === 1 ? '' : 's'} under ${zone.label}'s buttons`, detail: `${firstHidden!.what} is covered by ${firstHidden!.label.toLowerCase()}. The fix moves things into the clear area.`, at: firstHidden!.at, fix: 'move-into-safe-zone' });
  }
  if (safe.length === 0) safe.push({ id: 'safe-ok', severity: 'ok', title: `Nothing hidden by ${zone.label}`, detail: 'All text and graphics are clear of the app buttons and captions.' });
  onProgress?.(1);
  return { hook: hook.score, hookFindings: hook.findings, access, safe, platform, targets };
}
