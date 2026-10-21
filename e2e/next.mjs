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
        { start: 0.1, end: 0.9, text: 'Hello and welcome', words: [{ text: 'Hello', start: 0.1, end: 0.3 }, { text: 'um', start: 0.35, end: 0.55 }, { text: 'and', start: 0.6, end: 0.7 }, { text: 'welcome', start: 0.7, end: 0.9 }] },
        { start: 2.6, end: 3.4, text: 'to my channel', words: [{ text: 'to', start: 2.6, end: 2.8 }, { text: 'my', start: 2.8, end: 3 }, { text: 'channel', start: 3, end: 3.4 }] },
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

// ---------- Video templates
await page.goto(BASE);
await page.getByRole('button', { name: 'Video template: Product promo' }).click();
await page.locator('.clip-item').nth(2).waitFor({ timeout: 20000 });
await settle();
const counts = {
  clips: await page.locator('.clip-item').count(),
  texts: await page.locator('.text-item').count(),
  effects: await page.locator('.effect-item').count(),
  sounds: await page.locator('.audio-item').count(),
};
check('home template builds a full video', counts.clips === 3 && counts.texts === 5 && counts.effects === 1 && counts.sounds === 3, JSON.stringify(counts));
const square = await page.locator('canvas.preview').evaluate((c) => c.width / c.height);
check('template sets its shape (square promo)', Math.abs(square - 1) < 0.01, square.toFixed(3));
const centre = await page.locator('canvas.preview').evaluate((c) => Array.from(c.getContext('2d').getImageData(c.width / 2, c.height * 0.2, 1, 1).data));
check('template background is painted', centre[0] + centre[1] + centre[2] > 30, centre.join(','));
// The Media tab is open already.
await page.locator('.cc-library-body').getByRole('button', { name: 'Video template: Vlog intro' }).click();
await page.waitForFunction(() => document.querySelectorAll('.clip-item').length === 2, null, { timeout: 20000 }).catch(() => {});
const wide = await page.locator('canvas.preview').evaluate((c) => c.width / c.height);
check('template from the Media tab replaces the timeline', (await page.locator('.clip-item').count()) === 2 && Math.abs(wide - 16 / 9) < 0.01, `${await page.locator('.clip-item').count()} clips, ${wide.toFixed(3)}`);
await page.keyboard.press('Control+z');
await settle();
check('undo brings the previous video back', (await page.locator('.clip-item').count()) === 3);

// ---------- Guided tour (fresh visitor)
const fresh = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const tp = await fresh.newPage();
tp.on('pageerror', (e) => errors.push('tour pageerror: ' + e.message));
await tp.goto(`${BASE}/?new=video`);
const tour = tp.getByRole('dialog', { name: 'Guided tour' });
await tour.waitFor({ timeout: 5000 }).catch(() => {});
check('tour starts on the first visit', await tour.isVisible());
const total = Number((await tour.locator('.tour-count').innerText()).split('/')[1]);
let pointed = 0;
for (let k = 1; k < total; k++) {
  await tour.getByRole('button', { name: 'Next' }).click();
  if (await tp.locator('.tour-spot').isVisible()) pointed++;
}
check('tour points at each part of the editor', total >= 6 && pointed === total - 1, `${pointed}/${total - 1} highlighted`);
await tour.getByRole('button', { name: 'Start editing' }).click();
check('tour closes when finished', !(await tour.isVisible()));
await tp.goto(`${BASE}/?new=video`);
await tp.locator('canvas.preview').waitFor();
await tp.waitForTimeout(800);
check('tour is not shown again', !(await tour.isVisible()));
await tp.getByRole('button', { name: 'Guided tour' }).click();
check('tour can be replayed from the ? button', await tour.isVisible());
await tp.keyboard.press('Escape');
check('Esc closes the tour', !(await tour.isVisible()));
await tp.goto(`${BASE}/?new=design`);
await tour.waitFor({ timeout: 5000 }).catch(() => {});
check('design editor has its own tour', await tour.isVisible());
await tour.getByRole('button', { name: 'Skip tour' }).click();
await tp.setViewportSize({ width: 390, height: 844 });
await tp.goto(`${BASE}/?new=video`);
await tp.getByRole('button', { name: 'Guided tour' }).click();
const card = await tour.boundingBox();
check('phone: tour card fits the screen', card && card.x >= 0 && card.x + card.width <= 390 && card.y >= 0 && card.y + card.height <= 844, JSON.stringify(card));
await fresh.close();

// ---------- Design editor: keyframes, photo tools, templates
await page.goto(`${BASE}/?new=design`);
await page.getByRole('button', { name: /Elements/ }).click();
await page.getByTitle('rect').click();
const right = page.locator('.panel.right');
const art = page.locator('.artboard canvas');
const artPixel = (fx, fy) =>
  art.evaluate((c, [x, y]) => Array.from(c.getContext('2d').getImageData(Math.round(x * (c.width - 1)), Math.round(y * (c.height - 1)), 1, 1).data), [fx, fy]);
const purple = (px) => px[2] > 180 && px[1] < 120;
check('design element offers keyframes', (await right.getByRole('button', { name: 'Add Left / right keyframe' }).count()) === 1);
await right.getByRole('button', { name: 'Add Left / right keyframe' }).click();
const timeSlider = right.locator('.motion-time input[type=range]');
await timeSlider.fill('2');
await right.locator('.anim-field', { hasText: 'Left / right' }).locator('input[type=range]').fill('0.8');
await settle();
const at2 = [await artPixel(0.8, 0.5), await artPixel(0.5, 0.5)];
await timeSlider.fill('0');
await settle();
const at0 = [await artPixel(0.8, 0.5), await artPixel(0.5, 0.5)];
check('keyframes move the design element over time', purple(at2[0]) && !purple(at2[1]) && purple(at0[1]) && !purple(at0[0]), `t2 ${at2.map((p) => p.join(',')).join(' / ')}; t0 ${at0.map((p) => p.join(',')).join(' / ')}`);
await right.getByRole('button', { name: 'Done' }).click();
await right.locator('.anim-presets button').first().click();
check('one-click animations work in the design editor', (await right.locator('.anim-field.animated').count()) >= 1);
await page.getByRole('button', { name: /Uploads/ }).click();
await page.locator('.panel input[type=file][accept="image/*"]').first().setInputFiles(`${FIX}/greenscreen.png`);
await right.getByRole('button', { name: 'Golden hour' }).waitFor({ timeout: 10000 });
const photoBefore = await artPixel(0.5, 0.5);
await right.getByRole('button', { name: 'Golden hour' }).click();
await settle();
const photoAfter = await artPixel(0.5, 0.5);
check('photo look warms the picture', photoAfter[0] - photoAfter[2] > photoBefore[0] - photoBefore[2] + 10, `${photoBefore.join(',')} → ${photoAfter.join(',')}`);
await right.locator('.photo-tools .anim-field, .photo-tools .field', { hasText: 'Exposure' }).locator('input[type=range]').fill('1');
await settle();
const brighter = await artPixel(0.5, 0.5);
check('exposure slider brightens the photo', Math.max(...brighter.slice(0, 3)) > Math.max(...photoAfter.slice(0, 3)) + 20, `${photoAfter.join(',')} → ${brighter.join(',')}`);
await right.getByRole('button', { name: 'Reset photo' }).click();
await settle();
const reset = await artPixel(0.5, 0.5);
check('reset photo restores it', Math.abs(reset[2] - photoBefore[2]) < 6 && Math.abs(reset[0] - photoBefore[0]) < 6, reset.join(','));
await page.goto(BASE);
const designTemplates = await page.locator('section', { has: page.getByRole('heading', { name: 'Start from a template' }) }).locator('.home-card').count();
check('more design templates', designTemplates >= 15, String(designTemplates));
await page.locator('.home-card', { hasText: 'Animated Launch' }).click();
await page.locator('.artboard canvas').waitFor();
check('animated template plays its keyframes', await page.getByRole('button', { name: '▶ Preview animation' }).isEnabled());

// ---------- Edit by transcript, filler words, smart reframe, auto-duck, long-form
await page.goto(`${BASE}/?new=video`);
await page.locator('.panel input[type=file]').setInputFiles([`${FIX}/talk.webm`, `${FIX}/beat120.wav`]);
await page.locator('.clip-item').first().waitFor();
await page.locator('.audio-item').first().waitFor();
await libTab('AI');
const ai = page.locator('.cc-library-body');
await ai.getByRole('button', { name: 'Get transcript' }).click();
await ai.locator('.transcript-lines li').first().waitFor({ timeout: 30000 });
check('transcript lists what is said', (await ai.locator('.transcript-lines li').count()) === 2, (await ai.locator('.transcript-text').allInnerTexts()).join(' | '));
const fillerBtn = ai.getByRole('button', { name: /Remove 1 filler word/ });
check('finds the filler word', (await fillerBtn.count()) === 1);
await fillerBtn.click();
await settle();
check('removing filler words cuts the clip around them', (await page.locator('.clip-item').count()) === 2, `${await page.locator('.clip-item').count()} clips`);
check('no filler words left', (await ai.getByRole('button', { name: /Remove 0 filler words/ }).count()) === 1);
await ai.getByRole('button', { name: 'Cut: to my channel' }).click();
await settle();
check('cutting a line cuts the video and marks it', (await ai.locator('.transcript-lines li.cut').count()) === 1 && (await page.locator('.clip-item').count()) === 3, `${await page.locator('.clip-item').count()} clips`);
await ai.getByRole('button', { name: 'Make captions from it' }).click();
check('captions from the transcript (only what is left)', (await page.locator('.text-item').count()) === 1);
await page.keyboard.press('Control+z');
await page.keyboard.press('Control+z');
await settle();
await ai.getByRole('button', { name: 'Duck music under speech' }).click();
await ai.locator('.ai-message', { hasText: /dips under speech|No music/ }).waitFor({ timeout: 30000 });
check('auto-duck lowers the music under speech', /dips under speech/.test(await ai.locator('.ai-message').last().innerText()), await ai.locator('.ai-message').last().innerText());
await ai.getByRole('combobox', { name: 'Reframe to' }).selectOption('9:16');
await ai.getByRole('button', { name: 'Reframe' }).click();
await ai.locator('.ai-message', { hasText: /Reframed/ }).waitFor({ timeout: 30000 });
const ratioNow = await page.locator('canvas.preview').evaluate((c) => c.height / c.width);
const fillPixels = await page.locator('canvas.preview').evaluate((c) => {
  // The picture fills the frame: no black bars at the top or bottom.
  const g = c.getContext('2d');
  const top = g.getImageData(c.width / 2, 4, 1, 1).data;
  const bottom = g.getImageData(c.width / 2, c.height - 5, 1, 1).data;
  return [...top.slice(0, 3), ...bottom.slice(0, 3)];
});
check('smart reframe makes it vertical and fills the frame', Math.abs(ratioNow - 16 / 9) < 0.02 && fillPixels.some((v) => v > 20), `${ratioNow.toFixed(2)}; ${fillPixels.join(',')}`);
await ai.locator('.autoedit-card').click();
const aed = page.getByRole('dialog', { name: 'Auto edit' });
await aed.waitFor();
await aed.getByRole('radio', { name: /Long-form/ }).click();
check('long-form style offers teaser and chapters', (await aed.getByRole('checkbox', { name: 'Teaser at the start' }).isChecked()) && (await aed.getByRole('checkbox', { name: 'Chapters' }).isChecked()));
await aed.getByRole('checkbox', { name: /Captions from speech/ }).uncheck();
await aed.getByRole('button', { name: /Auto edit 1 clip/ }).click();
const aer = page.getByRole('dialog', { name: 'Auto edit result' });
await aer.waitFor({ timeout: 60000 });
check('long-form auto edit runs', /long-form/i.test(await aer.innerText()) && (await page.locator('.clip-item').count()) >= 2, (await aer.innerText()).replace(/\n/g, ' ').slice(0, 140));
await aer.getByRole('button', { name: 'Keep it' }).click();

// MORE CHECKS BELOW

check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);
