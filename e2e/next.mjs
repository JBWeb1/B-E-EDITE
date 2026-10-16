// End-to-end checks for MP4 export, motion tracking, AI tools, the guided tour,
// video templates and the design editor upgrades.
//
//   npm run build && npm run preview      # serves the production build on :4173
//   npm run test:e2e:next                 # in a second terminal
import { chromium } from 'playwright';
import fs from 'fs';
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
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
await ctx.addInitScript(() => {
  localStorage.setItem('bee.tips.design', '1');
  localStorage.setItem('bee.tips.video', '1');
  localStorage.setItem('bee.tour.video', '1');
  localStorage.setItem('bee.tour.design', '1');
});
// Stand-in AI engine, so the AI tools can be tested without downloading models.
await ctx.addInitScript(() => {
  window.__beeAI = {
    async transcribe(samples, _lang, onProgress) {
      onProgress?.(1);
      window.__heard = samples.length / 16000;
      return [
        { start: 0.1, end: 0.9, text: 'Hello and welcome' },
        { start: 2.6, end: 3.4, text: 'to my channel' },
      ];
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
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
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
const fieldValue = (label) => details.locator('.anim-field', { hasText: label }).locator('input[type=range]').inputValue().then(Number);

// ---------- Motion tracking
await page.goto(`${BASE}/?new=video`);
await page.locator('.panel input[type=file]').setInputFiles([`${FIX}/moving.webm`]);
await page.locator('.clip-item').first().waitFor();
await page.keyboard.press('Home');
await libTab('Titles');
await page.getByRole('button', { name: 'Shape: Star' }).click();
await page.locator('.text-item').first().click();
await subTab('Animate');
await details.getByRole('button', { name: 'Track motion' }).click();
check('tracking asks for a click on the player', (await page.locator('.pick-hint', { hasText: 'follow' }).count()) === 1);
// The checkered square starts with its centre at (90, 130) in a 640×360 video.
const box = await page.locator('canvas.preview').boundingBox();
await page.mouse.click(box.x + box.width * (90 / 640), box.y + box.height * (130 / 360));
await page.waitForFunction(() => !document.querySelector('.pick-hint'), null, { timeout: 30000 });
await page.waitForTimeout(500);
await details.getByRole('button', { name: 'Remove tracking' }).waitFor({ timeout: 30000 }).catch(() => {});
check('tracking writes position keyframes', (await details.getByRole('button', { name: 'Remove tracking' }).count()) === 1);
const x0 = await fieldValue('Left / right');
const y0 = await fieldValue('Up / down');
await seekTo(2.5);
await settle();
const x1 = await fieldValue('Left / right');
const y1 = await fieldValue('Up / down');
// At 2.5 s the square's centre is near (457, 230) → 71%, 64% of the frame; the star started 50/50
// (offset from the square by +0.36, +0.14), so it should be near 1.07, 0.78.
const sx = 90 / 640, sy = 130 / 360;
const ex = (60 + (2.5 / 3) * 440 + 30) / 640, ey = (100 + (2.5 / 3) * 120 + 30) / 360;
check('tracked shape follows the moving square', Math.abs(x1 - x0 - (ex - sx)) < 0.08 && Math.abs(y1 - y0 - (ey - sy)) < 0.08, `moved ${(x1 - x0).toFixed(3)}, ${(y1 - y0).toFixed(3)} (want ${(ex - sx).toFixed(3)}, ${(ey - sy).toFixed(3)})`);
await details.getByRole('button', { name: 'Remove tracking' }).click();
check('remove tracking clears the path', (await details.getByRole('button', { name: 'Remove tracking' }).count()) === 0);

// ---------- MP4 export
await page.evaluate(() => document.activeElement?.blur?.());
await page.getByRole('button', { name: 'Export', exact: true }).click();
const modal = page.locator('.export-modal');
const fileType = modal.getByRole('group', { name: 'File type' });
check('export offers MP4 and WebM', (await fileType.getByRole('button', { name: 'MP4' }).isEnabled()) && (await fileType.getByRole('button', { name: 'WebM' }).isEnabled()));
await fileType.getByRole('button', { name: 'MP4' }).click();
await modal.getByRole('group', { name: 'Resolution' }).getByRole('button', { name: '720p' }).click();
const mp4Dl = page.waitForEvent('download', { timeout: 60000 });
await modal.getByRole('button', { name: 'Export video' }).click();
const mp4 = await mp4Dl;
const mp4Bytes = fs.readFileSync(await mp4.path());
check('MP4 export downloads an .mp4 file', mp4.suggestedFilename().endsWith('.mp4') && mp4Bytes.toString('ascii', 4, 8) === 'ftyp', `${mp4.suggestedFilename()} ${mp4Bytes.length} bytes`);

await page.keyboard.press('Escape');

// ---------- AI tools
await page.goto(`${BASE}/?new=video`);
await page.locator('.panel input[type=file]').setInputFiles([`${FIX}/talk.webm`]);
await page.locator('.clip-item').first().waitFor();
await libTab('AI');
const lib = page.locator('.cc-library-body');
const aiStatus = lib.locator('.ai-message');
await lib.getByRole('button', { name: 'Auto captions from speech' }).click();
await aiStatus.waitFor({ timeout: 30000 });
check('auto captions from speech', (await page.locator('.text-item').count()) === 2, await aiStatus.innerText());
check('speech engine gets the clip sound', Math.abs((await page.evaluate(() => window.__heard)) - 8) < 0.6, String(await page.evaluate(() => window.__heard)));
await lib.getByRole('combobox', { name: 'Translate to' }).selectOption('fr');
await lib.getByRole('button', { name: /^Translate/ }).click();
await page.waitForFunction(() => document.querySelector('.ai-message')?.textContent?.includes('Translated'));
await page.locator('.text-item').first().click();
const translated = await details.locator('textarea').first().inputValue();
check('captions translated', translated === '[fr] Hello and welcome', translated);
await lib.getByRole('textbox', { name: 'Voice-over text' }).fill('Welcome to the show');
await lib.getByRole('button', { name: 'Create voice-over' }).click();
await page.waitForFunction(() => document.querySelector('.ai-message')?.textContent?.includes('Voice-over added'), null, { timeout: 30000 });
check('AI voice-over added to the audio track', (await page.locator('.audio-item').count()) === 1 && (await page.evaluate(() => window.__spoken)) === 'Welcome to the show');
const timeText = async () => (await page.locator('.timecode').innerText()).split('/').pop().trim();
const lenBefore = await timeText();
await lib.getByRole('button', { name: 'Remove silences' }).click();
await page.waitForFunction(() => /Removed|No pauses/.test(document.querySelector('.ai-message')?.textContent ?? ''), null, { timeout: 30000 });
const clipsAfter = await page.locator('.clip-item').count();
check('remove silences cuts the pauses', clipsAfter === 3, `${clipsAfter} clips; ${lenBefore} → ${await timeText()}; ${await aiStatus.innerText()}`);
await page.keyboard.press('Control+z');
await settle();
check('undo puts the pauses back', (await page.locator('.clip-item').count()) === 1);
await lib.getByRole('group', { name: 'Short length' }).getByRole('button', { name: '15s' }).click();
await lib.getByRole('button', { name: 'Make a Short' }).click();
await page.waitForFunction(() => /Made a/.test(document.querySelector('.ai-message')?.textContent ?? ''), null, { timeout: 60000 }).catch(() => {});
const shortRatio = await page.locator('canvas.preview').evaluate((c) => c.height / c.width);
check('auto Short is vertical', Math.abs(shortRatio - 16 / 9) < 0.02, `${shortRatio.toFixed(3)}; ${await aiStatus.innerText().catch(() => '')}`);

// MORE CHECKS BELOW

check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);
