// End-to-end checks for fast export, beat markers, speed curves, the smart background
// remover, stabiliser, studio sound, design upgrades, multicam, dubbing, the screen
// recorder, the graph editor, AI images and the stock library.
//
//   npm run build && npm run preview      # serves the production build on :4173
//   npm run test:e2e:more                 # in a second terminal
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
page.on('console', (m) => m.type() === 'error' && !offline(m) && errors.push('console: ' + m.text()));
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

// ---------- Fast export ----------
await page.goto(`${BASE}/?new=video`);
await page.locator('.panel input[type=file]').setInputFiles([path.join(FIX, 'talk.webm'), path.join(FIX, 'moving.webm'), path.join(FIX, 'beat120.wav')]);
// Importing puts the videos on the main track and the song on the audio track.
await page.locator('.main-track .clip-item').nth(1).waitFor();
await page.locator('.audio-item').first().waitFor();
await settle();

const exportWith = async (speed, format = 'WebM') => {
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const m = page.locator('.export-modal');
  await m.waitFor();
  await m.getByRole('button', { name: '720p' }).click();
  await m.getByRole('button', { name: format, exact: true }).click();
  await m.getByRole('button', { name: speed }).click();
  return m;
};
let m = await exportWith('⚡ Fast');
check('fast export is offered', await m.getByRole('button', { name: '⚡ Fast' }).evaluate((b) => b.classList.contains('active')));
let t0 = Date.now();
let dl = page.waitForEvent('download', { timeout: 120000 });
await m.getByRole('button', { name: 'Export video' }).click();
let d = await dl;
const fastSeconds = (Date.now() - t0) / 1000;
const fastFile = await d.path();
const fs = await import('fs');
const fastBytes = fs.statSync(fastFile).size;
const head4 = fs.readFileSync(fastFile).subarray(0, 4).toString('hex');
check('fast export makes a WebM file', d.suggestedFilename().endsWith('.webm') && head4 === '1a45dfa3' && fastBytes > 50000, `${fastBytes} bytes, ${head4}`);
check('fast export is faster than real time', fastSeconds < 9, `${fastSeconds.toFixed(1)} s for an 11 s video`);

m = await exportWith('⚡ Fast', 'MP4');
dl = page.waitForEvent('download', { timeout: 120000 });
await m.getByRole('button', { name: 'Export video' }).click();
d = await dl;
const mp4 = fs.readFileSync(await d.path());
check('fast export makes an MP4 file', d.suggestedFilename().endsWith('.mp4') && mp4.subarray(4, 8).toString() === 'ftyp', mp4.subarray(4, 8).toString());

m = await exportWith('⚡ Fast');
let downloads = 0;
const countDl = () => downloads++;
page.on('download', countDl);
await m.getByRole('button', { name: 'Export video' }).click();
await page.getByRole('button', { name: 'Cancel export' }).click();
await page.waitForTimeout(1500);
page.off('download', countDl);
check('an export can be cancelled', downloads === 0 && (await page.getByRole('button', { name: 'Cancel export' }).count()) === 0);

// ---------- Beats and markers ----------
await page.locator('.audio-item').first().click();
await details.getByRole('button', { name: 'Find beats' }).click();
await page.locator('.beat-mark').nth(5).waitFor({ timeout: 20000 });
const beatInfo = await details.locator('.beat-info').innerText();
check('finds the beat of the song', /1[12]\d BPM|6\d BPM|2[34]\d BPM/.test(beatInfo), beatInfo);
check('beats show on the timeline', (await page.locator('.beat-mark').count()) > 10, `${await page.locator('.beat-mark').count()} marks`);

await details.getByRole('button', { name: 'Fit clips to the beat' }).click();
await settle();
const fit = await page.evaluate(() => {
  const beats = [...document.querySelectorAll('.beat-mark')].map((b) => b.getBoundingClientRect().left + 2);
  const ends = [...document.querySelectorAll('.main-track .clip-item')].map((c) => c.getBoundingClientRect().right);
  return ends.map((e) => Math.min(...beats.map((b) => Math.abs(b - e))));
});
check('fit to the beat puts every cut on a beat', fit.length === 2 && fit.every((x) => x < 3), fit.map((x) => x.toFixed(1)).join(', '));

await seekTo(1);
await page.keyboard.press('m');
check('M drops a marker', (await page.locator('.marker').count()) === 1);
await page.getByRole('button', { name: 'Add marker' }).click();
check('the marker button removes the marker under the playhead', (await page.locator('.marker').count()) === 0);
await page.keyboard.press('m');
await page.locator('.marker').dblclick();
check('double-click removes a marker', (await page.locator('.marker').count()) === 0);

// ---------- Custom speed curve ----------
await page.locator('.main-track .clip-item').first().click();
await subTab('Speed');
await details.getByRole('button', { name: 'Custom' }).click();
const point = details.getByRole('slider', { name: 'Speed point 3' });
await point.waitFor();
const box = await point.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2, box.y - 40, { steps: 5 });
await page.mouse.up();
const v3 = Number(await point.getAttribute('aria-valuenow'));
const v1 = Number(await details.getByRole('slider', { name: 'Speed point 1' }).getAttribute('aria-valuenow'));
check('dragging a curve point speeds that part up', v3 > 1.5 && v1 < 1, `${v1}× → ${v3}×`);
check('the clip shows its speed ramp', (await page.locator('.main-track .clip-item').first().innerText()).includes('⤳'));

// ---------- Smart cut-out, stabiliser, studio sound ----------
const px = (fx, fy) => page.locator('canvas.preview').evaluate((c, [x, y]) => Array.from(c.getContext('2d').getImageData(Math.round(x * (c.width - 1)), Math.round(y * (c.height - 1)), 1, 1).data), [fx, fy]);
await subTab('Video');
await seekTo(1);
await settle();
const bgBefore = await px(0.05, 0.5);
await page.locator('.main-track .clip-item').first().click();
await subTab('Cutout');
await details.getByRole('button', { name: '✨ Remove background (AI)' }).click();
await details.getByText('Background removed').waitFor({ timeout: 60000 });
await settle();
const bgAfter = await px(0.05, 0.5);
const segmented = await page.evaluate(() => window.__segmented);
check('smart cut-out runs on every frame of the clip', segmented >= 100, `${segmented} frames`);
check('smart cut-out removes the background', bgBefore.slice(0, 3).reduce((a, b) => a + b) > 60 && bgAfter.slice(0, 3).reduce((a, b) => a + b) < 15, `${bgBefore.join(',')} → ${bgAfter.join(',')}`);
const subject = await page.locator('canvas.preview').evaluate((c) => {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let bright = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 200) bright++;
  return bright;
});
check('the person stays in the picture', subject > 200, `${subject} bright pixels`);
await details.getByRole('button', { name: 'Restore background' }).click();
await settle();
check('restore brings the background back', (await px(0.05, 0.5)).slice(0, 3).reduce((a, b) => a + b) > 60);
await page.keyboard.press('Control+z');
await settle();
check('undo puts the cut-out back (masks are kept)', (await px(0.05, 0.5)).slice(0, 3).reduce((a, b) => a + b) < 15);

// Stabiliser on the moving clip.
await page.locator('.main-track .clip-item').nth(1).click();
await subTab('Video');
await details.locator('summary', { hasText: 'Stabilise' }).click();
await details.getByRole('group', { name: 'Stabilise' }).getByRole('button', { name: 'Medium' }).click();
await details.getByText(/Steadied\. Zoomed in/).waitFor({ timeout: 30000 });
check('stabilise measures the shake and zooms to hide the edges', /Zoomed in \d+%/.test(await details.locator('.stabilize').innerText()));
await details.getByRole('group', { name: 'Stabilise' }).getByRole('button', { name: 'Off' }).click();
check('stabilise can be turned off', /Smooths out/.test(await details.locator('.stabilize').innerText()));

// Studio sound on the song, then the soundtrack still exports.
await page.locator('.audio-item').first().click();
await details.getByRole('button', { name: 'Studio sound' }).click();
await details.getByRole('button', { name: 'Studio sound on' }).waitFor({ timeout: 20000 });
check('studio sound measures the level', /dB to reach a steady level|evened out/.test(await details.locator('.studio-sound').innerText()), await details.locator('.studio-sound').innerText());
await page.getByRole('button', { name: 'Export', exact: true }).click();
dl = page.waitForEvent('download', { timeout: 60000 });
await page.locator('.export-modal').getByRole('button', { name: /Audio WAV/ }).click();
d = await dl;
check('soundtrack with studio sound exports', fs.statSync(await d.path()).size > 100000);

// Smart background removal for photos in the design editor.
await page.goto(`${BASE}/?new=design`);
await page.getByRole('button', { name: /Uploads/ }).click();
await page.locator('.panel input[type=file][accept="image/*"]').first().setInputFiles(path.join(FIX, 'greenscreen.png'));
const right = page.locator('.cc-details, .design-details, aside').filter({ hasText: 'Background' }).last();
await page.getByRole('button', { name: '✂ Remove background' }).waitFor({ timeout: 10000 });
check('smart removal is the default for photos', await page.getByRole('button', { name: '✨ Smart (AI)' }).evaluate((b) => b.classList.contains('active')));
await page.getByRole('button', { name: '✂ Remove background' }).click();
await page.getByRole('button', { name: 'Restore' }).waitFor({ timeout: 20000 });
check('smart removal cuts out the photo', (await page.evaluate(() => window.__segmented)) >= 1 && (await page.getByRole('button', { name: 'Redo removal' }).count()) === 1);
void right;

// ---------- Design: frames, icons, curved text, fonts, groups, brand kit ----------
await page.goto(`${BASE}/?new=design`);
const dright = page.locator('.panel.right');
const art = page.locator('.artboard canvas');
const artPixel = (fx, fy) => art.evaluate((c, [x, y]) => Array.from(c.getContext('2d').getImageData(Math.round(x * (c.width - 1)), Math.round(y * (c.height - 1)), 1, 1).data), [fx, fy]);
const dtab = (name) => page.locator('.cc-library .cc-tabs').getByRole('button', { name, exact: true }).click();
await dtab('Elements');
await page.getByRole('button', { name: 'Heart frame' }).click();
await dright.getByText('Upload a photo (or click one in Uploads) to fill this frame.').waitFor();
check('a frame can be added', (await dright.locator('h3').first().innerText()).includes('Frame: Heart'));
await dtab('Uploads');
await page.locator('.panel input[type=file][accept="image/*"]').first().setInputFiles(path.join(FIX, 'greenscreen.png'));
await dright.getByText('Upload a photo (or click one in Uploads)').waitFor({ state: 'detached' });
await settle();
const inHeart = await artPixel(0.5, 0.55);
const outside = await artPixel(0.29, 0.29);
// Inside the heart: the photo (not the grey placeholder); its corner, outside the heart: the white page.
const placeholder = [203, 213, 225];
check('uploading fills the selected frame (photo clipped to the heart)', inHeart.slice(0, 3).some((v, i) => Math.abs(v - placeholder[i]) > 40) && outside.slice(0, 3).every((v) => v > 240), `${inHeart.join(',')} / ${outside.join(',')}`);
await dright.getByRole('button', { name: 'Put in circle frame' }).click();
check('a photo can switch frames', await dright.getByRole('button', { name: 'Put in circle frame' }).evaluate((b) => b.classList.contains('active')));

await dtab('Elements');
await page.getByRole('textbox', { name: 'Search icons' }).fill('heart');
check('icons can be searched', (await page.locator('.icon-grid button').count()) === 1);
await page.getByRole('button', { name: 'Icon heart' }).click();
await dright.getByText('Icon colour').waitFor();
check('an icon is added with a colour setting', (await dright.locator('h3').first().innerText()).includes('Icon: heart'));

await dtab('Text');
await page.locator('.text-preset').first().click();
const hBefore = Number(await dright.getByRole('spinbutton', { name: 'H' }).inputValue());
await dright.locator('.field', { hasText: 'Curve' }).locator('input[type=range]').fill('70');
await settle();
const hAfter = Number(await dright.getByRole('spinbutton', { name: 'H' }).inputValue());
check('curving text bends it into an arch (taller box)', hAfter > hBefore * 1.3, `${hBefore} → ${hAfter}`);

await dright.locator('.font-picker-current').click();
await dright.getByRole('textbox', { name: 'Search fonts' }).fill('bebas');
check('Google Fonts can be searched', (await dright.locator('.font-picker-list').getByRole('option').count()) === 1, (await dright.locator('.font-picker-list').getByRole('option').allInnerTexts()).join('|'));
await dright.getByRole('option', { name: 'Bebas Neue' }).click();
await dright.locator('.font-picker-current[aria-label="Font: Bebas Neue"]').waitFor({ timeout: 10000 });
check('picking a Google font sets it on the text', true);
const fontLinks = await page.evaluate(() => [...document.querySelectorAll('link[data-webfont]')].map((l) => l.href));
check('the font is requested from Google Fonts', fontLinks.some((h) => h.includes('family=Bebas+Neue&display=swap')), fontLinks.slice(-1)[0]);

// Groups
await dtab('Elements');
await page.locator('.shape-card[title="rect"]').click();
await page.locator('.shape-card[title="ellipse"]').click();
await page.keyboard.press('Escape');
await page.locator('.stage').click({ position: { x: 5, y: 5 } });
await page.keyboard.press('Control+a');
await dright.getByRole('button', { name: 'Group' }).click();
check('elements can be grouped', /^Group of \d+/.test(await dright.locator('h3').first().innerText()));
await page.keyboard.press('Escape');
const abox = await art.boundingBox();
await page.mouse.click(abox.x + abox.width / 2, abox.y + abox.height / 2);
check('clicking one part selects the whole group', /^Group of \d+/.test(await dright.locator('h3').first().innerText()), await dright.locator('h3').first().innerText());
await page.keyboard.press('Control+Shift+g');
check('Ctrl+Shift+G ungroups', /elements selected/.test(await dright.locator('h3').first().innerText()));

// Brand kit
await dtab('Brand');
await page.getByRole('textbox', { name: 'Brand colour to add' }).or(page.locator('input[aria-label="Brand colour to add"]')).first().fill('#ff3366');
await page.getByRole('button', { name: 'Add colour' }).click();
check('brand colours can be added', (await page.locator('.brand-swatches .swatch').count()) === 1);
const lib = page.locator('.cc-library-body');
await lib.locator('.font-picker', { hasText: 'Headings' }).locator('.font-picker-current').click();
await lib.getByRole('textbox', { name: 'Search fonts' }).fill('poppins');
await lib.getByRole('option', { name: 'Poppins' }).click();
await lib.locator('.font-picker-current[aria-label="Headings: Poppins"]').waitFor({ timeout: 10000 });
await page.locator('input[aria-label="Brand logo"]').setInputFiles(path.join(FIX, 'greenscreen.png'));
await lib.getByRole('button', { name: 'Add logo 1' }).waitFor();
await lib.getByRole('button', { name: 'Use brand fonts on this page' }).click();
await settle();
await lib.getByRole('button', { name: 'Add logo 1' }).click();
await dright.locator('h3', { hasText: /^Logo$/ }).waitFor({ timeout: 10000 }).catch(() => {});
check('a brand logo can be added to the design', (await dright.locator('h3').first().innerText()) === 'Logo', await dright.locator('h3').first().innerText());
await dtab('Background');
check('brand colours show up as swatches in the design', (await page.locator('.cc-library-body .mini-swatch[title="#ff3366"]').count()) >= 1);

// The video editor offers the same brand kit.
await page.goto(`${BASE}/?new=video`);
await page.locator('.cc-tabs').getByRole('button', { name: 'Text', exact: true }).click();
await page.getByRole('button', { name: 'Brand heading' }).waitFor({ timeout: 10000 });
await page.getByRole('button', { name: 'Brand heading' }).click();
await page.locator('.cc-details-body .cc-subtabs').getByRole('tab', { name: 'Style', exact: true }).click();
await page.locator('.cc-details-body .font-picker-current').waitFor();
check('brand heading font is used in the video editor', (await page.locator('.cc-details-body .font-picker-current').getAttribute('aria-label')) === 'Font: Poppins');
check('brand heading text uses the brand colour', (await page.locator('.cc-details-body .field', { hasText: 'Text colour' }).locator('input[type=color]').inputValue()) === '#ff3366');
await page.getByRole('button', { name: 'Add brand logo 1' }).click();
await page.locator('.overlay-item').first().waitFor({ timeout: 10000 });
check('brand logo goes on a video layer', (await page.locator('.overlay-item').count()) === 1);

// MORE CHECKS BELOW

check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);
