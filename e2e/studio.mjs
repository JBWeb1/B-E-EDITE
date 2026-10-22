// End-to-end checks for the After Effects and Premiere Pro style tools: pen tool,
// trim paths, text on a path, track mattes, audio-reactive animation, new effects,
// screen replacement, pro trimming, adjustment layers, scopes and scene detection.
//
//   npm run build && npm run preview      # serves the production build on :4173
//   npm run test:e2e:studio               # in a second terminal
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const BASE = process.env.BASE_URL ?? 'http://localhost:4173';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
await ctx.addInitScript(() => {
  localStorage.setItem('bee.tips.design', '1');
  localStorage.setItem('bee.tips.video', '1');
  localStorage.setItem('bee.tour.video', '1');
  localStorage.setItem('bee.tour.design', '1');
});
// Stand-in screen share: an animated canvas (headless browsers have no screen to share).
await ctx.addInitScript(() => {
  if (!navigator.mediaDevices) return;
  navigator.mediaDevices.getDisplayMedia = async () => {
    const c = document.createElement('canvas');
    c.width = 640;
    c.height = 360;
    const g = c.getContext('2d');
    let i = 0;
    setInterval(() => {
      g.fillStyle = `hsl(${(i += 7) % 360}, 70%, 50%)`;
      g.fillRect(0, 0, 640, 360);
    }, 33);
    return c.captureStream(30);
  };
});
// Stand-in stock library and picture maker (the real ones are online services).
await ctx.addInitScript(() => {
  const picture = (hue, w = 400, h = 300) =>
    new Promise((resolve) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d');
      g.fillStyle = `hsl(${hue}, 70%, 55%)`;
      g.fillRect(0, 0, w, h);
      c.toBlob(resolve, 'image/png');
    });
  const tone = () => {
    const rate = 16000;
    const n = rate * 2;
    const buf = new ArrayBuffer(44 + n * 2);
    const v = new DataView(buf);
    const str = (o, s) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
    str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin(i / 6) * 6000, true);
    return new Blob([buf], { type: 'audio/wav' });
  };
  window.__beeStock = {
    async search(kind, q) {
      window.__stockQuery = `${kind}:${q}`;
      const thumb = URL.createObjectURL(await picture(200));
      return [1, 2, 3].map((i) => ({ id: `t${i}`, kind, title: `${q} ${i}`, thumb, url: `stub://${i}`, creator: 'Test Maker', license: 'CC BY 4.0', source: 'Openverse', duration: kind === 'image' ? undefined : 2 }));
    },
    async fetch(item) {
      return item.kind === 'audio' ? tone() : picture(120 * Number(item.id.slice(1)));
    },
  };
});
// Stand-in AI engine, so the AI tools can be tested without downloading models.
await ctx.addInitScript(() => {
  window.__beeAI = {
    async transcribe(samples, _lang, onProgress) {
      onProgress?.(1);
      window.__heard = samples.length / 16000;
      return [
        { start: 0.1, end: 0.9, text: 'Hello and welcome', words: [{ text: 'Hello', start: 0.1, end: 0.3 }, { text: 'um', start: 0.35, end: 0.55 }, { text: 'and', start: 0.6, end: 0.7 }, { text: 'welcome', start: 0.7, end: 0.9 }] },
        { start: 2.6, end: 3.4, text: 'to my channel', words: [{ text: 'to', start: 2.6, end: 2.8 }, { text: 'my', start: 2.8, end: 3 }, { text: 'channel', start: 3, end: 3.4 }] },
      ];
    },
    // Stand-in cut-out model: bright pixels are "the person".
    async segment(image, onProgress) {
      onProgress?.(1);
      window.__segmented = (window.__segmented ?? 0) + 1;
      const out = new Uint8Array(image.width * image.height);
      for (let i = 0; i < out.length; i++) {
        const d = image.data;
        out[i] = d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2] > 450 ? 255 : 0;
      }
      return out;
    },
    // Stand-in face detector: the bright box in the test videos is "a face".
    async faces(image) {
      window.__faceCalls = (window.__faceCalls ?? 0) + 1;
      const { width: w, height: h, data: d } = image;
      let x0 = w, y0 = h, x1 = -1, y1 = -1;
      for (let y = 0; y < h; y += 2)
        for (let x = 0; x < w; x += 2) {
          const i = (y * w + x) * 4;
          if (d[i] > 220 && d[i + 1] > 220 && d[i + 2] > 220) {
            x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
          }
        }
      if (x1 < 0) return [{ x: 0.35, y: 0.3, w: 0.3, h: 0.4, score: 0.9 }];
      return [{ x: x0 / w, y: y0 / h, w: (x1 - x0 + 2) / w, h: (y1 - y0 + 2) / h, score: 0.95 }];
    },
    async image(prompt, size) {
      window.__imagePrompt = prompt;
      window.__imageSize = size;
      const [w, h] = size.split('x').map(Number);
      const c = document.createElement('canvas');
      c.width = w / 4;
      c.height = h / 4;
      c.getContext('2d').fillStyle = '#7c3aed';
      c.getContext('2d').fillRect(0, 0, c.width, c.height);
      return new Promise((resolve) => c.toBlob(resolve, 'image/png'));
    },
    async translate(texts, _from, to) {
      return texts.map((t) => `[${to}] ${t}`);
    },
    async speak(text) {
      const rate = 16000;
      const n = rate * 1.5;
      const buf = new ArrayBuffer(44 + n * 2);
      const v = new DataView(buf);
      const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
      str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
      v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
      v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
      str(36, 'data'); v.setUint32(40, n * 2, true);
      for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin(i / 8) * 8000, true);
      window.__spoken = text;
      return new Blob([buf], { type: 'audio/wav' });
    },
  };
});
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
// This test machine can't reach Google Fonts; failed font downloads aren't app errors.
const offline = (m) => /fonts\.(googleapis|gstatic)\.com/.test(m.location()?.url ?? '');
page.on('console', (m) => m.type() === 'error' && !offline(m) && errors.push('console: ' + m.text() + ' @ ' + (m.location()?.url ?? '').slice(0, 60)));
page.on('dialog', (d) => d.accept());

const details = page.locator('.cc-details-body');
const subTab = (name) => details.locator('.cc-subtabs').getByRole('tab', { name, exact: true }).click();
const libTab = (name) => page.locator('.cc-tabs').getByRole('button', { name, exact: true }).click();
const settle = () => page.waitForTimeout(350);
const seekTo = async (s) => {
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('Home');
  for (let i = 0; i < Math.floor(s); i++) await page.keyboard.press('Shift+ArrowRight');
  for (let i = 0; i < Math.round((s - Math.floor(s)) * 30); i++) await page.keyboard.press('ArrowRight');
};


const px = (fx, fy) => page.locator('canvas.preview').evaluate((c, [x, y]) => Array.from(c.getContext('2d').getImageData(Math.round(x * (c.width - 1)), Math.round(y * (c.height - 1)), 1, 1).data), [fx, fy]);
const lit = () =>
  page.locator('canvas.preview').evaluate((c) => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 300) n++;
    return n;
  });
const canvasBox = async () => page.locator('canvas.preview').boundingBox();
const clickAt = async (fx, fy) => {
  const b = await canvasBox();
  await page.mouse.click(b.x + fx * b.width, b.y + fy * b.height);
};

// ---------- Pen tool, trim paths, text on a path ----------
await page.goto(`${BASE}/?new=video`);
await libTab('Titles');
await page.getByRole('button', { name: '✒️ Draw a shape' }).click();
await page.getByRole('application', { name: /Pen tool/ }).waitFor();
await clickAt(0.3, 0.3);
// Drag out a curve on the second point.
{
  const b = await canvasBox();
  await page.mouse.move(b.x + 0.7 * b.width, b.y + 0.3 * b.height);
  await page.mouse.down();
  await page.mouse.move(b.x + 0.8 * b.width, b.y + 0.45 * b.height, { steps: 4 });
  await page.mouse.up();
}
await clickAt(0.6, 0.75);
await clickAt(0.3, 0.3); // the first point: closes the shape
await page.locator('.text-item').first().waitFor();
check('the pen tool makes a closed shape layer', (await page.getByRole('application', { name: /Pen tool/ }).count()) === 0 && (await details.getByText('Trim paths').count()) === 1);
await seekTo(0);
await settle();
const atStart = await lit();
await seekTo(2);
await settle();
const drawn = await lit();
check('the shape draws itself on (trim paths)', atStart < 50 && drawn > 2000, `${atStart} → ${drawn} lit pixels`);
await details.getByRole('button', { name: 'Whole line' }).click();
await seekTo(0);
await settle();
check('trim paths can be turned off', (await lit()) > 2000);
const insideFill = await px(0.5, 0.45);
check('closed shapes are filled', insideFill[2] > 150 && insideFill[0] < 120, insideFill.join(','));

await page.keyboard.press('Escape');
await page.getByRole('button', { name: '✒️ Draw a text path' }).click();
await clickAt(0.15, 0.6);
await clickAt(0.5, 0.35);
await clickAt(0.85, 0.6);
await page.getByRole('button', { name: 'Done', exact: true }).click();
await page.locator('.text-item').nth(1).waitFor();
check('text can follow a drawn path', (await details.getByRole('textbox', { name: 'Text content' }).inputValue()) === 'Your text along the path' && (await details.getByText('Text on a path').count()) >= 1);
const before = await lit();
await details.getByRole('button', { name: 'Circle' }).click();
await settle();
check('text on a path can switch to a circle', (await lit()) !== before);
await details.getByRole('button', { name: 'Travel along' }).click();
check('text can travel along its path', (await page.locator('.text-item').nth(1).locator('.kf-diamond').count()) >= 2);
// The Titles tab is still open (clicking it again would fold the panel away).
await page.getByRole('button', { name: 'Text on a path: Wave' }).click();
check('one-click text on a wave', (await page.locator('.text-item').count()) === 3);

// MORE CHECKS BELOW

check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);
