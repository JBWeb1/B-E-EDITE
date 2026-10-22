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
// Open a library tab (clicking the tab that is already open would fold the panel away).
const openLib = async (name) => {
  const tab = page.locator('.cc-tabs').getByRole('button', { name, exact: true });
  if (!(await tab.evaluate((b) => b.classList.contains('active')))) await tab.click();
  else if ((await page.locator('.cc-library-body').count()) === 0) await tab.click();
};
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
await page.getByRole('application', { name: /Pen tool/ }).waitFor();
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

// ---------- New effects, track mattes, audio-reactive ----------
const snap = () => page.locator('canvas.preview').evaluate((c) => Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data.filter((_, i) => i % 4 !== 3 && i % 64 === 0)));
const diff = (a, b) => a.reduce((n, v, i) => n + (Math.abs(v - b[i]) > 12 ? 1 : 0), 0);
await page.goto(`${BASE}/?new=video`);
await page.locator('.panel input[type=file]').setInputFiles([path.join(FIX, 'talk.webm')]);
await page.locator('.main-track .clip-item').first().waitFor();
await seekTo(2);
await settle();
const plain = await snap();
for (const name of ['Light rays', 'Turbulent warp', 'Fractal fog']) {
  await openLib('Effects');
  await seekTo(1); // effects start at the playhead
  await page.locator('.fx-card', { hasText: name }).click();
  // Effects ease in over their first moments: look a second later.
  await seekTo(2);
  await settle();
  const after = await snap();
  check(`effect: ${name} changes the picture`, diff(plain, after) > 30, `${diff(plain, after)} samples changed`);
  await page.locator('.effect-item').last().click();
  await page.keyboard.press('Delete');
  await settle();
}

// Echo trails need movement and real frames: play the moving checkerboard clip.
{
  await openLib('Media');
  await page.locator('.panel input[type=file]').setInputFiles([path.join(FIX, 'moving.webm')]);
  await page.locator('.main-track .clip-item').nth(1).waitFor();
  await seekTo(8.4);
  await openLib('Effects');
  await page.locator('.fx-card', { hasText: 'Echo trails' }).click();
  await seekTo(8.6);
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press(' ');
  await page.waitForTimeout(800);
  await page.keyboard.press(' ');
  await page.waitForTimeout(200);
  const full = () => page.locator('canvas.preview').evaluate((c) => Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data.filter((_, i) => i % 4 !== 3)));
  const trails = await full();
  await page.locator('.effect-item').last().click();
  await page.keyboard.press('Delete');
  await settle();
  const still = await full();
  check('effect: Echo trails leaves ghosts behind moving things', diff(still, trails) > 30, `${diff(still, trails)} pixels changed`);
}

// Track matte: video inside big letters.
await openLib('Media');
await page.locator('.asset', { hasText: 'moving' }).getByRole('button', { name: 'Add as picture-in-picture' }).click();
await page.locator('.overlay-item').first().waitFor();
await subTab('Layer');
await details.getByRole('slider', { name: /Size/ }).first().fill('1').catch(() => {});
await openLib('Text');
await page.locator('.cc-library-body button', { hasText: 'Title' }).first().click();
await page.locator('.text-item').first().waitFor();
await settle();
const withText = await snap();
await page.locator('.overlay-item').first().click();
await subTab('Cutout');
await details.locator('summary', { hasText: 'Track matte' }).click();
const matteSelect = details.getByRole('combobox', { name: 'Track matte' });
await matteSelect.selectOption({ index: 1 });
await settle();
const matted = await snap();
check('a track matte shows the layer only through the text', diff(withText, matted) > 50, `${diff(withText, matted)} samples changed`);
await details.getByRole('group', { name: 'Matte mode' }).getByRole('button', { name: 'Outside' }).click();
await settle();
check('the matte can be inverted', diff(matted, await snap()) > 50);

// Audio-reactive text on black, driven by the 120 BPM test song.
await page.goto(`${BASE}/?new=video`);
await page.locator('.panel input[type=file]').setInputFiles([path.join(FIX, 'beat120.wav')]);
await page.locator('.audio-item').first().waitFor();
await openLib('Text');
await page.locator('.cc-library-body button', { hasText: 'Title' }).first().click();
await page.locator('.text-item').first().waitFor();
await subTab('Animate');
await details.getByRole('group', { name: 'Move with the music' }).getByRole('button', { name: 'Pulse' }).click();
const sizes = [];
for (const t of [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.25]) {
  await seekTo(t);
  await page.waitForTimeout(250);
  sizes.push(await lit());
}
const spread = Math.max(...sizes) / Math.max(1, Math.min(...sizes));
check('audio-reactive text pulses with the beat', spread > 1.15, sizes.join(', '));

// ---------- Screen replacement (corner pin) ----------
await page.goto(`${BASE}/?new=video`);
await page.locator('.panel input[type=file]').setInputFiles([path.join(FIX, 'moving.webm')]);
await page.locator('.main-track .clip-item').first().waitFor();
// The yellow/white checker square in this clip plays the part of a phone screen.
const square = () =>
  page.locator('canvas.preview').evaluate((c) => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
    for (let y = 0; y < c.height; y++)
      for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        if (d[i] > 200 && d[i + 1] > 170) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      }
    return { x0: x0 / c.width, y0: y0 / c.height, x1: x1 / c.width, y1: y1 / c.height };
  });
const redBox = () =>
  page.locator('canvas.preview').evaluate((c) => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0, sx = 0, sy = 0;
    for (let y = 0; y < c.height; y++)
      for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        if (d[i] > 150 && d[i + 1] < 80 && d[i + 2] < 80) { n++; sx += x; sy += y; }
      }
    return n ? { n, cx: sx / n / c.width, cy: sy / n / c.height } : { n: 0, cx: -1, cy: -1 };
  });
await seekTo(2.2);
await settle();
const later = await square();
await seekTo(0.5);
await settle();
const here = await square();
check('the test "screen" moves during the clip', Math.hypot((later.x0 + later.x1) / 2 - (here.x0 + here.x1) / 2, (later.y0 + later.y1) / 2 - (here.y0 + here.y1) / 2) > 0.05, `${JSON.stringify(here)} → ${JSON.stringify(later)}`);
await page.locator('.panel input[type=file]').setInputFiles([path.join(FIX, 'red.webm')]);
await page.locator('.asset', { hasText: 'red' }).waitFor();
await page.locator('.asset', { hasText: 'red' }).getByRole('button', { name: 'Add as picture-in-picture' }).click();
await page.locator('.overlay-item').first().waitFor();
await subTab('Cutout');
await details.locator('summary', { hasText: 'Screen replacement' }).click();
await details.getByRole('button', { name: '📱 Place on 4 corners' }).click();
await page.getByRole('application', { name: /four corners/ }).waitFor();
for (const [x, y] of [[here.x0, here.y0], [here.x1, here.y0], [here.x1, here.y1], [here.x0, here.y1]]) await clickAt(x, y);
await settle();
const placed = await redBox();
check('a layer can be placed on four corners', placed.n > 200 && Math.abs(placed.cx - (here.x0 + here.x1) / 2) < 0.02 && Math.abs(placed.cy - (here.y0 + here.y1) / 2) < 0.03, JSON.stringify(placed));
await details.getByRole('button', { name: 'Track the screen' }).click();
await details.getByText(/Tracked through/).waitFor({ timeout: 60000 });
await seekTo(2.2);
await settle();
const followed = await redBox();
const target = { cx: (later.x0 + later.x1) / 2, cy: (later.y0 + later.y1) / 2 };
check('the layer stays on the moving screen (tracked)', Math.hypot(followed.cx - target.cx, followed.cy - target.cy) < 0.03, `${JSON.stringify(followed)} vs ${JSON.stringify(target)}`);
await details.getByRole('button', { name: 'Adjust corners' }).click();
const corner = page.getByRole('slider', { name: 'Bottom right corner' });
const cb = await corner.boundingBox();
await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
await page.mouse.down();
await page.mouse.move(cb.x + cb.width / 2 + 40, cb.y + cb.height / 2 + 30, { steps: 4 });
await page.mouse.up();
await page.getByRole('button', { name: 'Done', exact: true }).click();
await settle();
check('corners can be fine-tuned by dragging', (await redBox()).n > followed.n * 1.2, `${followed.n} → ${(await redBox()).n} red pixels`);

// ---------- Premiere tools: scene detection, roll/slip/slide, J/L cuts, adjustment layers, scopes, colour match ----------
await page.goto(`${BASE}/?new=video`);
await page.locator('.panel input[type=file]').setInputFiles([path.join(FIX, 'scenes.webm')]);
await page.locator('.main-track .clip-item').first().waitFor();
const clipBoxes = async () => {
  const out = [];
  for (const b of await page.locator('.main-track .clip-item').all()) out.push(await b.boundingBox());
  return out;
};
await page.locator('.main-track .clip-item').first().click();
await details.locator('summary', { hasText: 'Pro edit' }).click();
await details.getByRole('button', { name: '✂️ Split at scene changes' }).click();
await page.locator('.main-track .clip-item').nth(2).waitFor({ timeout: 60000 });
const scenes = await clipBoxes();
check('scene edit detection splits at the camera cuts', scenes.length === 3 && Math.abs(scenes[0].width - scenes[1].width) < 6, scenes.map((b) => Math.round(b.width)).join(','));

// Ruler click = seek; returns the colour in the middle-left of the picture.
const seekX = async (x) => {
  const r = await page.locator('.ruler').boundingBox();
  await page.mouse.click(x, r.y + r.height / 2);
  await settle();
  return px(0.1, 0.85);
};
const total = (bs) => bs.reduce((s, b) => s + b.width, 0);

await page.evaluate(() => document.activeElement?.blur?.());
await page.keyboard.press('y');
check('Y picks the slip tool', (await page.getByRole('group', { name: 'Timeline tool' }).getByRole('button', { name: 'Slip' }).getAttribute('aria-pressed')) === 'true');
const startColour = await seekX(scenes[1].x + 3);
await page.mouse.move(scenes[1].x + scenes[1].width / 2, scenes[1].y + scenes[1].height / 2);
await page.mouse.down();
await page.mouse.move(scenes[1].x + scenes[1].width / 2 + 40, scenes[1].y + scenes[1].height / 2, { steps: 5 });
await page.mouse.up();
const slipped = await clipBoxes();
const slipColour = await seekX(slipped[1].x + 3);
check('slip shows other footage without moving the clip', Math.abs(slipped[1].x - scenes[1].x) < 1 && Math.abs(slipped[1].width - scenes[1].width) < 1 && startColour.join() !== slipColour.join(), `${startColour} → ${slipColour}`);
await page.keyboard.press('Control+z');
await settle();

await page.getByRole('group', { name: 'Timeline tool' }).getByRole('button', { name: 'Roll' }).click();
{
  const b = (await clipBoxes())[0];
  // Grab the edge near its top: the transition button sits over the middle of the cut.
  await page.mouse.move(b.x + b.width - 3, b.y + 5);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width + 20, b.y + 5, { steps: 5 });
  await page.mouse.up();
}
const rolled = await clipBoxes();
check('roll moves a cut and keeps the length', rolled[0].width > scenes[0].width + 10 && rolled[1].width < scenes[1].width - 10 && Math.abs(total(rolled) - total(scenes)) < 2, rolled.map((b) => Math.round(b.width)).join(','));
await page.keyboard.press('Control+z');
await settle();

await page.keyboard.press('u');
{
  const b = (await clipBoxes())[1];
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 20, b.y + b.height / 2, { steps: 5 });
  await page.mouse.up();
}
const slid = await clipBoxes();
check('slide moves a clip between its neighbours', slid[1].x > scenes[1].x + 10 && Math.abs(slid[1].width - scenes[1].width) < 1 && slid[2].width < scenes[2].width - 10 && Math.abs(total(slid) - total(scenes)) < 2, slid.map((b) => Math.round(b.width)).join(','));
await page.keyboard.press('Control+z');
await page.keyboard.press('v');
await settle();

await page.locator('.main-track .clip-item').nth(1).click();
await subTab('Video');
await details.locator('summary', { hasText: 'Pro edit' }).click().catch(() => {});
await details.getByRole('button', { name: 'J cut' }).click();
await page.locator('.audio-item').first().waitFor();
{
  const a = await page.locator('.audio-item').first().boundingBox();
  const c = (await clipBoxes())[1];
  check('a J cut starts the next sound early', a.x < c.x - 10, `audio at ${Math.round(a.x)}, picture at ${Math.round(c.x)}`);
}
await page.keyboard.press('Control+z');

// Adjustment layer over the second (orange) scene.
const mid = await clipBoxes();
const unadjusted = await seekX(mid[1].x + mid[1].width / 2);
await openLib('Effects');
await page.locator('.fx-card', { hasText: 'Adjustment layer' }).click();
await settle();
const adjusted = await px(0.1, 0.85);
check('an adjustment layer recolours what is under it', adjusted.join() !== unadjusted.join(), `${unadjusted} → ${adjusted}`);
await details.getByRole('button', { name: 'Mono', exact: true }).click();
await settle();
const mono = await px(0.1, 0.85);
check('adjustment layer filters (Mono)', Math.abs(mono[0] - mono[1]) < 12 && Math.abs(mono[1] - mono[2]) < 12, mono.join(','));
await page.keyboard.press('Delete');
await settle();

await page.getByRole('button', { name: 'Colour scopes' }).click();
const scopes = page.getByRole('region', { name: 'Colour scopes' });
await scopes.waitFor();
await page.waitForTimeout(500);
const scopeInk = () =>
  page.getByTestId('scope-canvas').evaluate((c) => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 200) n++;
    return n;
  });
const wave = await scopeInk();
await scopes.getByRole('button', { name: 'Vectorscope' }).click();
await page.waitForTimeout(450);
const vec = await scopeInk();
await scopes.getByRole('button', { name: 'Histogram' }).click();
await page.waitForTimeout(450);
const hist = await scopeInk();
check('colour scopes draw (waveform, vectorscope, histogram)', wave > 20 && vec > 5 && hist > 20, `${wave}/${vec}/${hist}`);
await scopes.getByRole('button', { name: 'Close scopes' }).click();

// Colour match the blue first scene to the green last one.
const blueBefore = await seekX(mid[0].x + mid[0].width / 2);
await page.locator('.main-track .clip-item').first().click();
await subTab('Color');
await details.locator('summary', { hasText: 'Colour match' }).click();
await details.getByRole('combobox', { name: 'Reference clip' }).selectOption({ index: 1 });
await details.getByRole('button', { name: '🎨 Match colour' }).click();
await page.waitForTimeout(1500);
const blueAfter = await seekX(mid[0].x + mid[0].width / 2);
const greenness = (c) => c[1] / Math.max(1, c[0] + c[1] + c[2]);
check('colour match moves a clip towards the other clip', greenness(blueAfter) > greenness(blueBefore) + 0.05, `${blueBefore} → ${blueAfter}`);

// MORE CHECKS BELOW

check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);
