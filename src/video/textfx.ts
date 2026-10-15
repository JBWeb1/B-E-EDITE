/**
 * Text & graphics drawing for the video: letter animators, word-by-word
 * captions, animated title templates and animated shapes. The timing maths
 * (`letterState`, `wordTiming`, …) is pure and unit-tested.
 */
import { ease, transformAt } from './anim';
import { heartPath, starPath } from './particles';
import type { ShapeAnim, ShapeKind, TextAnimator, TextOverlay, TitleTemplate, WordMode } from './types';

export const FONTS: { family: string; label: string }[] = [
  { family: 'Inter, system-ui, sans-serif', label: 'Inter' },
  { family: 'Impact, "Arial Black", sans-serif', label: 'Impact' },
  { family: 'Georgia, "Times New Roman", serif', label: 'Serif' },
  { family: '"Courier New", ui-monospace, monospace', label: 'Typewriter' },
  { family: '"Comic Sans MS", "Comic Neue", cursive', label: 'Comic' },
  { family: '"Brush Script MT", "Segoe Script", cursive', label: 'Script' },
  { family: '"Trebuchet MS", Verdana, sans-serif', label: 'Rounded' },
];

export const ANIMATORS: { value: TextAnimator; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'typewriter', label: 'Typewriter' },
  { value: 'wave', label: 'Wave' },
  { value: 'bounce', label: 'Bounce in' },
  { value: 'glitch', label: 'Glitch' },
  { value: 'fade-letters', label: 'Letter fade' },
  { value: 'rise', label: 'Rise up' },
  { value: 'zoom', label: 'Zoom in' },
  { value: 'flicker', label: 'Flicker' },
  { value: 'rainbow', label: 'Rainbow' },
  { value: 'spin', label: 'Spin in' },
];

export const WORD_MODES: { value: WordMode; label: string; hint: string }[] = [
  { value: 'off', label: 'Off', hint: 'Whole caption at once' },
  { value: 'highlight', label: 'Highlight', hint: 'The word being said lights up' },
  { value: 'single', label: 'One word', hint: 'One big word at a time' },
  { value: 'build', label: 'Build up', hint: 'Words appear one by one' },
];

export const TEMPLATES: { value: TitleTemplate; label: string; patch: Partial<TextOverlay> }[] = [
  { value: 'lower-third-bar', label: 'Name bar', patch: { text: 'Alex Morgan\nCreative Director', x: 0.07, y: 0.8, size: 0.06 } },
  { value: 'lower-third-box', label: 'Name box', patch: { text: 'Jamie Lee\nHost', x: 0.07, y: 0.8, size: 0.055 } },
  { value: 'lower-third-line', label: 'Name line', patch: { text: 'Sam Rivera\nPhotographer', x: 0.07, y: 0.8, size: 0.06 } },
  { value: 'subscribe', label: 'Subscribe', patch: { text: 'SUBSCRIBE', x: 0.5, y: 0.82, size: 0.065, duration: 4 } },
  { value: 'countdown', label: 'Countdown', patch: { text: '3', x: 0.5, y: 0.5, size: 0.3, duration: 3 } },
  { value: 'title-reveal', label: 'Title reveal', patch: { text: 'THE BIG REVEAL', x: 0.5, y: 0.5, size: 0.12 } },
  { value: 'breaking-news', label: 'Breaking news', patch: { text: 'BREAKING NEWS\nSomething amazing just happened — more at eleven', x: 0.5, y: 0.86, size: 0.05, duration: 6 } },
  { value: 'location', label: 'Location', patch: { text: 'Paris, France', x: 0.5, y: 0.78, size: 0.06 } },
  { value: 'quote', label: 'Quote', patch: { text: 'Creativity takes courage.\n— Henri Matisse', x: 0.5, y: 0.5, size: 0.07, duration: 5 } },
  { value: 'social', label: 'Social handle', patch: { text: '@yourname', x: 0.5, y: 0.85, size: 0.06 } },
  { value: 'chapter', label: 'Chapter', patch: { text: 'CHAPTER 1\nThe Beginning', x: 0.5, y: 0.5, size: 0.11 } },
];

export const SHAPES: { value: ShapeKind; label: string; aspect: number }[] = [
  { value: 'rect', label: 'Box', aspect: 1.6 },
  { value: 'circle', label: 'Circle', aspect: 1 },
  { value: 'ring', label: 'Ring', aspect: 1 },
  { value: 'line', label: 'Line', aspect: 6 },
  { value: 'arrow', label: 'Arrow', aspect: 2.5 },
  { value: 'star', label: 'Star', aspect: 1 },
  { value: 'heart', label: 'Heart', aspect: 1 },
  { value: 'burst', label: 'Burst', aspect: 1 },
  { value: 'check', label: 'Tick', aspect: 1.2 },
  { value: 'cross', label: 'Cross', aspect: 1 },
  { value: 'triangle', label: 'Triangle', aspect: 1.15 },
];

export const SHAPE_ANIMS: { value: ShapeAnim; label: string }[] = [
  { value: 'draw', label: 'Draw on' },
  { value: 'pop', label: 'Pop' },
  { value: 'spin', label: 'Spin' },
  { value: 'pulse', label: 'Pulse' },
  { value: 'none', label: 'None' },
];

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

// ---------- Pure timing ----------

export interface LetterState {
  visible: boolean;
  alpha: number;
  /** Offsets in multiples of the font size. */
  dx: number;
  dy: number;
  scale: number;
  /** Radians. */
  rot: number;
  color: string | null;
}

const STILL: LetterState = { visible: true, alpha: 1, dx: 0, dy: 0, scale: 1, rot: 0, color: null };

/** How letter `i` of `n` looks `local` seconds into an item of `duration` seconds. */
export function letterState(animator: TextAnimator | undefined, i: number, n: number, local: number, duration: number): LetterState {
  const stagger = Math.min(0.06, (duration * 0.5) / Math.max(1, n));
  const own = (len: number) => clamp01((local - i * stagger) / len);
  switch (animator) {
    case 'typewriter': {
      const typing = Math.min(duration * 0.7, Math.max(0.3, n * 0.06));
      return { ...STILL, visible: i < Math.floor((local / typing) * n) + (local >= typing ? n : 0) };
    }
    case 'wave':
      return { ...STILL, dy: 0.18 * Math.sin(local * 6 - i * 0.55) };
    case 'bounce': {
      const p = own(0.55);
      return { ...STILL, visible: p > 0, dy: -(1 - ease('bounce', p)) * 1.2 };
    }
    case 'glitch': {
      // Jumps 12 times a second; settles after the first second, then glitches now and then.
      const step = Math.floor(local * 12);
      const r = (k: number) => {
        const h = Math.sin((i + 1) * 12.9898 + (step + k) * 78.233) * 43758.5453;
        return h - Math.floor(h);
      };
      const active = local < 0.8 || r(9) > 0.93;
      if (!active) return STILL;
      return { ...STILL, dx: (r(1) - 0.5) * 0.25, dy: (r(2) - 0.5) * 0.2, color: r(3) > 0.7 ? (r(4) > 0.5 ? '#22d3ee' : '#f0abfc') : null, alpha: r(5) > 0.15 ? 1 : 0.2 };
    }
    case 'fade-letters':
      return { ...STILL, alpha: own(0.3) };
    case 'rise': {
      const p = ease('ease-out', own(0.4));
      return { ...STILL, alpha: p, dy: (1 - p) * 0.8 };
    }
    case 'zoom': {
      const p = ease('ease-out', own(0.35));
      return { ...STILL, alpha: p, scale: 1 + (1 - p) * 1.8 };
    }
    case 'flicker': {
      if (local > 0.9) return STILL;
      const on = Math.sin((i + 3) * 91.7 + Math.floor(local * 20) * 17.3) > -0.2;
      return { ...STILL, alpha: on ? 1 : 0.1 };
    }
    case 'rainbow':
      return { ...STILL, color: `hsl(${Math.round((i * 28 + local * 160) % 360)}, 90%, 62%)` };
    case 'spin': {
      const p = ease('ease-out', own(0.45));
      return { ...STILL, alpha: p, rot: (1 - p) * Math.PI * 1.5, scale: 0.4 + 0.6 * p };
    }
    default:
      return STILL;
  }
}

export interface TimedWord {
  word: string;
  start: number;
  end: number;
}

/** Spread a caption's words over its length; longer words get a bit more time. */
export function wordTiming(text: string, duration: number): TimedWord[] {
  const words = text.split(/\s+/).filter(Boolean);
  const weights = words.map((w) => w.length + 2);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let t = 0;
  return words.map((word, i) => {
    const len = (weights[i] / total) * duration;
    const item = { word, start: t, end: t + len };
    t += len;
    return item;
  });
}

/** Index of the word being said at `local` seconds (the last one once it ends). */
export function currentWord(words: TimedWord[], local: number): number {
  const i = words.findIndex((w) => local >= w.start && local < w.end);
  return i >= 0 ? i : local < 0 ? 0 : words.length - 1;
}

/** Split words into lines no wider than `maxWidth` (measured with `measure`). */
export function wrapWords(words: string[], maxWidth: number, measure: (s: string) => number): number[][] {
  const lines: number[][] = [];
  let line: number[] = [];
  for (let i = 0; i < words.length; i++) {
    const next = [...line, i];
    if (line.length > 0 && measure(next.map((j) => words[j]).join(' ')) > maxWidth) {
      lines.push(line);
      line = [i];
    } else {
      line = next;
    }
  }
  if (line.length) lines.push(line);
  return lines;
}

/** Entrance / exit of the whole item from its `animation` setting. */
export function textAnimation(o: TextOverlay, t: number): { alpha: number; scale: number; dy: number } {
  const local = t - o.start;
  const remaining = o.start + o.duration - t;
  const d = Math.min(0.4, o.duration / 3);
  const inP = Math.min(1, local / d);
  const outP = Math.min(1, remaining / d);
  switch (o.animation) {
    case 'fade':
      return { alpha: Math.min(inP, outP), scale: 1, dy: 0 };
    case 'pop': {
      const e = 1 - Math.pow(1 - inP, 3);
      return { alpha: Math.min(1, inP * 2, outP), scale: 0.5 + 0.5 * e + Math.sin(inP * Math.PI) * 0.1, dy: 0 };
    }
    case 'slide':
      return { alpha: Math.min(inP, outP), scale: 1, dy: (1 - inP) * 0.08 };
    default:
      return { alpha: 1, scale: 1, dy: 0 };
  }
}

// ---------- Drawing ----------

export const fontOf = (o: TextOverlay, px: number) =>
  `${o.italic ? 'italic ' : ''}${o.bold ? 'bold ' : ''}${Math.max(1, px)}px ${o.font ?? 'Inter, system-ui, sans-serif'}`;

/**
 * Draw a text item (plain text, word captions, a title template or a shape)
 * at time `t`. `animate` is false while paused so text is always readable.
 */
export function drawTextItem(ctx: CanvasRenderingContext2D, o: TextOverlay, t: number, W: number, H: number, animate = true) {
  const local = t - o.start;
  const tr = transformAt(o, local, hashId(o.id), { x: o.x, y: o.y, scale: 1, rotation: 0, opacity: 1 });
  const anim = animate && !o.template ? textAnimation(o, t) : { alpha: 1, scale: 1, dy: 0 };
  const alpha = anim.alpha * tr.opacity;
  if (alpha <= 0.001) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(tr.x * W, (tr.y + anim.dy) * H);
  if (tr.rotation) ctx.rotate((tr.rotation * Math.PI) / 180);
  ctx.scale(anim.scale * tr.scale, anim.scale * tr.scale);
  // While paused, letter animators and templates show their finished state.
  const at = animate ? local : Math.max(local, o.duration * 0.75);
  if (o.shape) drawShape(ctx, o, animate ? local : o.duration, H);
  else if (o.template) drawTemplate(ctx, o, at, W, H);
  else if (o.words && o.words !== 'off') drawWordCaption(ctx, o, local, W, H);
  else drawPlainText(ctx, o, animate ? local : o.duration, H);
  ctx.restore();
}

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h % 1000);
}

/** Fill (and outline / glow) one string at x,y using the item's style. */
function paintString(ctx: CanvasRenderingContext2D, o: TextOverlay, s: string, x: number, y: number, size: number, color = o.color) {
  if (o.glow) {
    ctx.save();
    ctx.shadowColor = o.glow;
    ctx.shadowBlur = size * 0.45;
    ctx.fillStyle = o.glow;
    ctx.fillText(s, x, y);
    ctx.fillText(s, x, y);
    ctx.restore();
  }
  if (o.stroke) {
    ctx.save();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = o.stroke;
    ctx.lineWidth = size * 0.14;
    ctx.lineJoin = 'round';
    ctx.strokeText(s, x, y);
    ctx.restore();
  }
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
}

function drawPlainText(ctx: CanvasRenderingContext2D, o: TextOverlay, local: number, H: number) {
  const size = o.size * H;
  const lines = o.text.split('\n');
  ctx.font = fontOf(o, size);
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
  } else if (!o.glow) {
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = size * 0.15;
  }
  const yOf = (i: number) => -totalH / 2 + lh * (i + 0.5);
  const animator = o.animator && o.animator !== 'none' ? o.animator : null;
  if (!animator) {
    lines.forEach((line, i) => paintString(ctx, o, line, 0, yOf(i), size));
    return;
  }
  // Letter by letter: place each character where it would sit in the line.
  const n = o.text.replace(/\n/g, '').length;
  let index = 0;
  ctx.textAlign = 'left';
  lines.forEach((line, li) => {
    const lineW = ctx.measureText(line).width;
    let x = -lineW / 2;
    for (const ch of line) {
      const w = ctx.measureText(ch).width;
      const st = letterState(animator, index++, n, local, o.duration);
      if (st.visible && st.alpha > 0.01) {
        ctx.save();
        ctx.globalAlpha *= st.alpha;
        ctx.translate(x + w / 2 + st.dx * size, yOf(li) + st.dy * size);
        if (st.rot) ctx.rotate(st.rot);
        if (st.scale !== 1) ctx.scale(st.scale, st.scale);
        if (animator === 'glitch' && st.color) {
          // RGB split: two coloured ghosts either side.
          ctx.globalAlpha *= 0.7;
          ctx.fillStyle = '#22d3ee';
          ctx.fillText(ch, -w / 2 - size * 0.05, 0);
          ctx.fillStyle = '#f0abfc';
          ctx.fillText(ch, -w / 2 + size * 0.05, 0);
          ctx.globalAlpha /= 0.7;
        }
        paintString(ctx, o, ch, -w / 2, 0, size, st.color && animator !== 'glitch' ? st.color : o.color);
        ctx.restore();
      }
      x += w;
    }
  });
}

function drawWordCaption(ctx: CanvasRenderingContext2D, o: TextOverlay, local: number, W: number, H: number) {
  const size = o.size * H;
  const words = wordTiming(o.text.replace(/\n/g, ' '), o.duration);
  if (!words.length) return;
  const cur = currentWord(words, local);
  const accent = o.accent ?? '#facc15';
  ctx.font = fontOf(o, size);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (!o.glow && !o.background) {
    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    ctx.shadowBlur = size * 0.2;
  }
  if (o.words === 'single') {
    const w = words[cur];
    const p = clamp01((local - w.start) / 0.12);
    const s = 0.7 + 0.3 * ease('elastic', p);
    ctx.scale(s, s);
    paintString(ctx, o, w.word, 0, 0, size, accent);
    return;
  }
  const list = words.map((w) => w.word);
  const space = ctx.measureText(' ').width;
  const lines = wrapWords(list, W * 0.86, (s) => ctx.measureText(s).width);
  const lh = size * 1.25;
  lines.forEach((line, li) => {
    const widths = line.map((i) => ctx.measureText(list[i]).width);
    const total = widths.reduce((a, b) => a + b, 0) + space * (line.length - 1);
    let x = -total / 2;
    const y = (li - (lines.length - 1) / 2) * lh;
    line.forEach((i, k) => {
      const w = widths[k];
      const shown = o.words !== 'build' || i <= cur;
      if (shown) {
        const active = i === cur;
        ctx.save();
        ctx.translate(x + w / 2, y);
        if (active) {
          const p = clamp01((local - words[i].start) / 0.1);
          const s = 1 + 0.12 * Math.sin(p * Math.PI) + 0.06;
          ctx.scale(s, s);
          if (o.background) {
            ctx.fillStyle = accent;
            ctx.beginPath();
            ctx.roundRect(-w / 2 - size * 0.12, -size * 0.62, w + size * 0.24, size * 1.24, size * 0.18);
            ctx.fill();
          }
        }
        paintString(ctx, o, list[i], 0, 0, size, active && !o.background ? accent : o.color);
        ctx.restore();
      }
      x += w + space;
    });
  });
}

// ---------- Title templates ----------

function drawTemplate(ctx: CanvasRenderingContext2D, o: TextOverlay, local: number, W: number, H: number) {
  const size = o.size * H;
  const [line1 = '', ...rest] = o.text.split('\n');
  const line2 = rest.join(' ');
  const accent = o.accent ?? '#00c8d2';
  const inP = clamp01(local / 0.7);
  const outP = clamp01((o.duration - local) / 0.45);
  const e = ease('ease-out', inP);
  ctx.textBaseline = 'middle';
  ctx.globalAlpha *= Math.min(1, outP * 1.5);
  const font = (px: number, bold = true) => (ctx.font = fontOf({ ...o, bold }, px));

  switch (o.template) {
    case 'lower-third-bar': {
      font(size);
      const w1 = ctx.measureText(line1).width;
      font(size * 0.6, false);
      const w2 = ctx.measureText(line2).width;
      const w = Math.max(w1, w2) + size * 0.6;
      const barH = size * 2.1 * e;
      ctx.fillStyle = accent;
      ctx.fillRect(0, -barH / 2, size * 0.14, barH);
      ctx.save();
      ctx.beginPath();
      ctx.rect(size * 0.14, -size * 1.2, w * e + size * 0.3, size * 2.4);
      ctx.clip();
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(size * 0.14, -size * 1.05, w + size * 0.3, size * 2.1);
      ctx.textAlign = 'left';
      font(size);
      paintString(ctx, o, line1, size * 0.45 - (1 - e) * w * 0.3, -size * 0.38, size);
      font(size * 0.6, false);
      ctx.globalAlpha *= clamp01((local - 0.3) / 0.4);
      paintString(ctx, o, line2, size * 0.45, size * 0.48, size * 0.6, accent);
      ctx.restore();
      break;
    }
    case 'lower-third-box': {
      ctx.textAlign = 'left';
      font(size);
      const w1 = ctx.measureText(line1).width + size;
      font(size * 0.62);
      const w2 = ctx.measureText(line2).width + size * 0.8;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, -size * 1.5, Math.max(w1, w2) * e + 2, size * 3);
      ctx.clip();
      ctx.fillStyle = accent;
      ctx.fillRect(0, -size * 1.1, w1, size * 1.3);
      font(size);
      paintString(ctx, o, line1, size * 0.5, -size * 0.45, size);
      if (line2) {
        const p2 = ease('ease-out', clamp01((local - 0.25) / 0.5));
        ctx.fillStyle = '#111827';
        ctx.fillRect(0, size * 0.2, w2 * p2, size * 0.9);
        font(size * 0.62);
        ctx.globalAlpha *= p2;
        paintString(ctx, o, line2, size * 0.4, size * 0.65, size * 0.62);
      }
      ctx.restore();
      break;
    }
    case 'lower-third-line': {
      ctx.textAlign = 'left';
      font(size);
      const w = Math.max(ctx.measureText(line1).width, size * 4);
      ctx.save();
      ctx.globalAlpha *= e;
      paintString(ctx, o, line1, (1 - e) * -size, -size * 0.45, size);
      ctx.restore();
      ctx.strokeStyle = accent;
      ctx.lineWidth = Math.max(2, size * 0.08);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, size * 0.18);
      ctx.lineTo(w * ease('ease-out', clamp01((local - 0.1) / 0.6)), size * 0.18);
      ctx.stroke();
      font(size * 0.58, false);
      ctx.globalAlpha *= clamp01((local - 0.4) / 0.4);
      paintString(ctx, o, line2, 0, size * 0.72, size * 0.58);
      break;
    }
    case 'subscribe': {
      const done = local > o.duration * 0.55;
      const label = done ? 'SUBSCRIBED' : line1 || 'SUBSCRIBE';
      font(size * 0.7);
      const tw = ctx.measureText(label).width;
      const bw = tw + size * 1.4;
      const pop = ease('elastic', clamp01(local / 0.6));
      ctx.scale(pop, pop);
      ctx.fillStyle = done ? '#4b5563' : '#ef4444';
      ctx.beginPath();
      ctx.roundRect(-bw / 2, -size * 0.6, bw, size * 1.2, size * 0.25);
      ctx.fill();
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, 0, 0);
      // The bell, ringing after the click.
      ctx.save();
      ctx.translate(bw / 2 + size * 0.75, 0);
      ctx.rotate(done ? 0.35 * Math.sin(local * 25) * Math.max(0, 1 - (local - o.duration * 0.55) * 1.5) : 0);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(-size * 0.35, size * 0.25);
      ctx.quadraticCurveTo(-size * 0.3, -size * 0.45, 0, -size * 0.45);
      ctx.quadraticCurveTo(size * 0.3, -size * 0.45, size * 0.35, size * 0.25);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, size * 0.33, size * 0.09, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      // A pointer that "clicks" the button.
      const cp = clamp01((local - o.duration * 0.35) / (o.duration * 0.2));
      if (cp > 0 && cp < 1.2 && local < o.duration * 0.75) {
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#111111';
        ctx.lineWidth = size * 0.05;
        ctx.save();
        ctx.translate(bw * 0.25 + (1 - ease('ease-out', cp)) * size * 1.5, size * 0.3 + (1 - ease('ease-out', cp)) * size);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, size * 0.8);
        ctx.lineTo(size * 0.22, size * 0.6);
        ctx.lineTo(size * 0.42, size * 0.95);
        ctx.lineTo(size * 0.52, size * 0.9);
        ctx.lineTo(size * 0.33, size * 0.55);
        ctx.lineTo(size * 0.6, size * 0.55);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
      break;
    }
    case 'countdown': {
      const from = Math.max(1, parseInt(line1, 10) || 3);
      const per = o.duration / from;
      const k = Math.min(from - 1, Math.floor(Math.max(0, local) / per));
      const p = clamp01((local - k * per) / per);
      const n = from - k;
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = size * 0.06;
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.75, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = accent;
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.75, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
      ctx.stroke();
      const s = 1.4 - 0.4 * ease('ease-out', clamp01(p / 0.3));
      ctx.scale(s, s);
      ctx.textAlign = 'center';
      font(size);
      ctx.globalAlpha *= clamp01(p / 0.15);
      paintString(ctx, o, String(n), 0, size * 0.04, size);
      break;
    }
    case 'title-reveal': {
      font(size);
      ctx.textAlign = 'center';
      const w = ctx.measureText(line1).width + size * 0.6;
      const p = clamp01(local / 0.9);
      // A colour block sweeps in, then slides away leaving the title behind it.
      const left = p < 0.5 ? -w / 2 : -w / 2 + ease('ease-out', (p - 0.5) * 2) * w;
      const right = p < 0.5 ? -w / 2 + ease('ease-in', p * 2) * w : w / 2;
      if (p >= 0.5) paintString(ctx, o, line1, 0, 0, size);
      if (right > left) {
        ctx.fillStyle = accent;
        ctx.fillRect(left, -size * 0.65, right - left, size * 1.3);
      }
      if (line2) {
        font(size * 0.4, false);
        ctx.globalAlpha *= clamp01((local - 0.8) / 0.4);
        paintString(ctx, o, line2, 0, size * 0.9, size * 0.4);
      }
      break;
    }
    case 'breaking-news': {
      const bandH = size * 1.6;
      // Full width, whatever the item's position.
      ctx.translate(-o.x * W, 0);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, -bandH / 2, W * e, bandH);
      font(size * 0.8);
      const label = line1 || 'BREAKING NEWS';
      const lw = ctx.measureText(label).width + size;
      ctx.fillStyle = '#dc2626';
      ctx.fillRect(0, -bandH / 2 - size * 0.9, lw * e, size * 0.95);
      ctx.textAlign = 'left';
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, -bandH / 2 - size * 0.9, lw * e, size * 0.95);
      ctx.clip();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, size * 0.5, -bandH / 2 - size * 0.42);
      ctx.restore();
      // Scrolling ticker.
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, -bandH / 2, W * e, bandH);
      ctx.clip();
      font(size * 0.75, true);
      const tw = ctx.measureText(line2).width;
      const x = W - ((local * W * 0.18) % (tw + W));
      ctx.fillStyle = '#111827';
      ctx.fillText(line2, x, 0);
      ctx.restore();
      break;
    }
    case 'location': {
      const pop = ease('elastic', clamp01(local / 0.6));
      ctx.save();
      ctx.translate(0, -size * 1.1);
      ctx.scale(pop, pop);
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(0, -size * 0.25, size * 0.42, Math.PI, 0);
      ctx.lineTo(0, size * 0.55);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, -size * 0.25, size * 0.16, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      font(size);
      ctx.textAlign = 'center';
      ctx.globalAlpha *= clamp01((local - 0.25) / 0.4);
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = size * 0.2;
      paintString(ctx, o, line1, 0, (1 - ease('ease-out', clamp01((local - 0.25) / 0.5))) * size * 0.5, size);
      break;
    }
    case 'quote': {
      ctx.textAlign = 'center';
      font(size * 3);
      ctx.fillStyle = accent;
      ctx.globalAlpha *= e;
      ctx.fillText('“', 0, -size * 1.6);
      font(size, false);
      ctx.font = `italic ${ctx.font}`;
      const words = line1.split(' ');
      const lines = wrapWords(words, W * 0.75, (s) => ctx.measureText(s).width);
      lines.forEach((l, i) => {
        ctx.save();
        ctx.globalAlpha *= clamp01((local - 0.2 - i * 0.25) / 0.4);
        paintString(ctx, o, l.map((j) => words[j]).join(' '), 0, (i - (lines.length - 1) / 2) * size * 1.3, size);
        ctx.restore();
      });
      if (line2) {
        font(size * 0.55, false);
        ctx.globalAlpha *= clamp01((local - 0.8) / 0.4);
        paintString(ctx, o, line2, 0, (lines.length / 2) * size * 1.3 + size * 0.5, size * 0.55, accent);
      }
      break;
    }
    case 'social': {
      font(size * 0.8);
      const tw = ctx.measureText(line1).width;
      const pw = tw + size * 2.1;
      const pop = ease('elastic', clamp01(local / 0.6));
      ctx.scale(pop, pop);
      ctx.fillStyle = 'rgba(17,24,39,0.85)';
      ctx.beginPath();
      ctx.roundRect(-pw / 2, -size * 0.65, pw, size * 1.3, size * 0.65);
      ctx.fill();
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(-pw / 2 + size * 0.65, 0, size * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      font(size * 0.55);
      ctx.fillText('@', -pw / 2 + size * 0.65, size * 0.02);
      font(size * 0.8);
      ctx.textAlign = 'left';
      paintString(ctx, o, line1, -pw / 2 + size * 1.35, size * 0.02, size * 0.8);
      break;
    }
    case 'chapter': {
      ctx.textAlign = 'center';
      font(size * 0.35);
      ctx.fillStyle = accent;
      ctx.globalAlpha *= e;
      ctx.fillText(line1, 0, -size * 0.85);
      ctx.strokeStyle = accent;
      ctx.lineWidth = Math.max(2, size * 0.03);
      const half = W * 0.18 * ease('ease-out', clamp01((local - 0.15) / 0.6));
      ctx.beginPath();
      ctx.moveTo(-half, -size * 0.55);
      ctx.lineTo(half, -size * 0.55);
      ctx.stroke();
      font(size);
      const p = ease('ease-out', clamp01((local - 0.3) / 0.6));
      ctx.globalAlpha *= p;
      paintString(ctx, o, line2 || line1, 0, size * 0.15 + (1 - p) * size * 0.4, size);
      break;
    }
  }
}

// ---------- Shapes ----------

function shapePath(ctx: CanvasRenderingContext2D, shape: ShapeKind, w: number, h: number) {
  ctx.beginPath();
  switch (shape) {
    case 'rect':
      ctx.roundRect(-w / 2, -h / 2, w, h, Math.min(w, h) * 0.08);
      break;
    case 'circle':
    case 'ring':
      ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
      break;
    case 'line':
      ctx.moveTo(-w / 2, 0);
      ctx.lineTo(w / 2, 0);
      break;
    case 'arrow':
      ctx.moveTo(-w / 2, 0);
      ctx.lineTo(w / 2, 0);
      ctx.moveTo(w / 2 - h * 0.45, -h * 0.4);
      ctx.lineTo(w / 2, 0);
      ctx.lineTo(w / 2 - h * 0.45, h * 0.4);
      break;
    case 'star':
      starPath(ctx, h / 2, 5, 0.45);
      break;
    case 'heart':
      heartPath(ctx, h);
      break;
    case 'burst':
      starPath(ctx, h / 2, 12, 0.6);
      break;
    case 'check':
      ctx.moveTo(-w * 0.4, 0);
      ctx.lineTo(-w * 0.1, h * 0.3);
      ctx.lineTo(w * 0.42, -h * 0.35);
      break;
    case 'cross':
      ctx.moveTo(-w * 0.35, -h * 0.35);
      ctx.lineTo(w * 0.35, h * 0.35);
      ctx.moveTo(w * 0.35, -h * 0.35);
      ctx.lineTo(-w * 0.35, h * 0.35);
      break;
    case 'triangle':
      ctx.moveTo(0, -h / 2);
      ctx.lineTo(w / 2, h / 2);
      ctx.lineTo(-w / 2, h / 2);
      ctx.closePath();
      break;
  }
}

/** Shapes drawn as lines rather than filled areas. */
const LINE_SHAPES: ShapeKind[] = ['line', 'arrow', 'check', 'cross', 'ring'];

function drawShape(ctx: CanvasRenderingContext2D, o: TextOverlay, local: number, H: number) {
  const shape = o.shape!;
  const h = o.size * H;
  const w = h * (o.aspect ?? SHAPES.find((s) => s.value === shape)?.aspect ?? 1);
  const anim = o.shapeAnim ?? 'draw';
  const p = clamp01(local / 0.7);
  if (anim === 'pop') {
    const s = ease('elastic', p);
    ctx.scale(s, s);
  } else if (anim === 'spin') {
    ctx.rotate(local * Math.PI);
  } else if (anim === 'pulse') {
    const s = 1 + 0.08 * Math.sin(local * Math.PI * 2 * 1.5);
    ctx.scale(s, s);
  }
  const stroked = o.outline || LINE_SHAPES.includes(shape);
  shapePath(ctx, shape, w, h);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (o.glow) {
    ctx.shadowColor = o.glow;
    ctx.shadowBlur = h * 0.3;
  }
  if (stroked) {
    ctx.strokeStyle = o.color;
    ctx.lineWidth = Math.max(2, h * (shape === 'line' || shape === 'arrow' ? 0.18 : 0.1));
    if (anim === 'draw' && p < 1) {
      const len = (w + h) * 2.5;
      ctx.setLineDash([len * ease('ease-out', p), len]);
    }
    ctx.stroke();
  } else {
    ctx.fillStyle = o.color;
    if (anim === 'draw' && p < 1) {
      // Filled shapes "draw on" by wiping in from the left.
      ctx.save();
      ctx.clip();
      ctx.fillRect(-w / 2 - 2, -h / 2 - 2, (w + 4) * ease('ease-out', p), h + 4);
      ctx.restore();
    } else {
      ctx.fill();
    }
    if (o.stroke) {
      ctx.strokeStyle = o.stroke;
      ctx.lineWidth = Math.max(2, h * 0.05);
      ctx.stroke();
    }
  }
}

/** Rough on-screen size of a text item (fractions of the frame), for clicking it on the player. */
export function textBounds(ctx: CanvasRenderingContext2D, o: TextOverlay, W: number, H: number): { w: number; h: number } {
  const size = o.size * H;
  if (o.shape) {
    const aspect = o.aspect ?? SHAPES.find((s) => s.value === o.shape)?.aspect ?? 1;
    return { w: (size * aspect) / W, h: size / H };
  }
  ctx.font = fontOf(o, size);
  const lines = o.text.split('\n');
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) / W;
  const h = (lines.length * size * 1.2) / H;
  if (o.template?.startsWith('lower-third')) return { w: w * 2, h: h * 1.4 };
  if (o.template === 'breaking-news') return { w: 2, h: h * 1.5 };
  return { w, h };
}
