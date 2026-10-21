// End-to-end checks for the pro video tools (layers, green screen, masks,
// keyframes, speed ramps, colour, titles, effects and export options).
//
//   npm run build && npm run preview      # serves the production build on :4173
//   npm run test:e2e:pro                  # in a second terminal
import { chromium } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'bem-pro-'));
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
});
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'Test look' : undefined));

/** Colour of the player canvas at a point given as fractions of the frame. */
const pixel = (fx, fy) =>
  page.locator('canvas.preview').evaluate(
    (c, [x, y]) => Array.from(c.getContext('2d').getImageData(Math.round(x * (c.width - 1)), Math.round(y * (c.height - 1)), 1, 1).data),
    [fx, fy],
  );
const details = page.locator('.cc-details-body');
const subTab = (name) => details.locator('.cc-subtabs').getByRole('tab', { name, exact: true }).click();
const libTab = (name) => page.locator('.cc-tabs').getByRole('button', { name, exact: true }).click();
const settle = () => page.waitForTimeout(350);

await page.goto(`${BASE}/?new=video`);
await page.locator('.panel input[type=file]').setInputFiles([`${FIX}/red.webm`, `${FIX}/greenscreen.png`]);
await page.locator('.clip-item').nth(1).waitFor();
// Keep only the red video on the main track; the green-screen picture becomes a layer.
await page.locator('.clip-item').nth(1).click();
await page.keyboard.press('Delete');
await page.keyboard.press('Home');

// ---------- Video tracks
const pip = page.locator('.asset', { hasText: 'greenscreen' }).getByRole('button', { name: 'Add as picture-in-picture' });
await pip.click();
await pip.click();
await settle();
const heads = await page.locator('.track-head span').allInnerTexts();
check('layers stack on separate video tracks', heads.includes('V2') && heads.includes('V3'), heads.join(', '));
await page.keyboard.press('Delete'); // remove the V3 copy (selected after adding)
await settle();
check('deleting the top layer removes its track', !(await page.locator('.track-head span').allInnerTexts()).includes('V3'));

// ---------- Green screen
await page.locator('.overlay-item').first().click();
await subTab('Layer');
await details.getByRole('button', { name: 'Full frame' }).click();
await settle();
const greenBefore = await pixel(0.05, 0.05);
check('layer shows its green background before keying', greenBefore[1] > 140 && greenBefore[0] < 60, greenBefore.join(','));
await subTab('Cutout');
await details.getByRole('button', { name: 'Remove green screen' }).click();
await settle();
const keyed = await pixel(0.05, 0.05);
const subject = await pixel(0.5, 0.5);
check('green screen removed (red video shows through)', keyed[0] > 150 && keyed[1] < 90, keyed.join(','));
check('subject kept after keying', subject[2] > 150 && subject[0] < 90, subject.join(','));
await details.getByRole('button', { name: /Pick colour/ }).click();
await page.locator('canvas.preview').click({ position: { x: 20, y: 20 } });
await settle();
const swatch = await details.locator('.key-swatch').getAttribute('title');
check('pick colour from the player', /^#0[0-9a-f]b[0-9a-f]4[0-9a-f]$/.test(swatch ?? ''), swatch ?? 'none');

// ---------- Mask
await details.locator('summary', { hasText: 'Mask' }).click();
await details.getByRole('combobox', { name: 'Mask shape' }).selectOption('ellipse');
await settle();
await details.getByRole('button', { name: /Invert/ }).click();
await settle();
const masked = await pixel(0.5, 0.5);
check('inverted mask cuts the middle out', masked[0] > 150 && masked[2] < 90, masked.join(','));
await details.getByRole('combobox', { name: 'Mask shape' }).selectOption('none');

// ---------- Blend mode
await subTab('Layer');
await details.getByRole('combobox', { name: 'Blend mode' }).selectOption('multiply');
await settle();
const mult = await pixel(0.5, 0.5);
check('multiply blend darkens with the layer below', mult[0] < 80 && mult[2] < 80, mult.join(','));
await details.getByRole('combobox', { name: 'Blend mode' }).selectOption('normal');

// ---------- Keyframes on the main clip
await page.locator('.clip-item').first().click();
await subTab('Animate');
await details.getByRole('button', { name: 'Fade in', exact: true }).click();
await settle();
check('one-click animation adds keyframe diamonds', (await page.locator('.clip-item .kf-diamond').count()) >= 2);
await page.locator('.overlay-item').first().click();
await page.locator('.track-head', { hasText: 'V2' }).getByRole('button').click(); // hide the layer
await page.keyboard.press('Home');
await settle();
const start = await pixel(0.5, 0.5);
await page.keyboard.press('Shift+ArrowRight');
await settle();
const later = await pixel(0.5, 0.5);
check('keyframed fade: dark at the start, visible later', start[0] < 40 && later[0] > 150, `${start.join(',')} → ${later.join(',')}`);
// A hidden layer can't be grabbed on the player (the clip under it is used instead).
await page.locator('.clip-item').first().click();
await page.locator('canvas.preview').click();
check('hidden layer is not clickable on the player', (await page.locator('.overlay-item.selected').count()) === 0);
await page.locator('.clip-item').first().click();
await subTab('Animate');
await details.getByRole('button', { name: 'Add Rotate keyframe' }).click();
check('◆ adds a keyframe at the playhead', (await details.getByRole('button', { name: 'Remove Rotate keyframe' }).count()) === 1);
await page.locator('.kf-diamond').first().click();
await settle();
check('clicking a diamond jumps to that keyframe', (await page.locator('.timecode strong').innerText()) === '0:00.0');
await page.keyboard.press('Control+z');
await page.keyboard.press('Control+z');

// ---------- Speed ramps & reverse
await subTab('Speed');
await details.getByRole('button', { name: 'Hero', exact: true }).click();
await details.getByRole('button', { name: 'Play backwards' }).click();
const label = await page.locator('.clip-item').first().innerText();
check('speed ramp and reverse shown on the clip', label.includes('⤳') && label.includes('⟲'), label.replace(/\s+/g, ' '));
await page.keyboard.press('Control+z');
await page.keyboard.press('Control+z');

// ---------- Colour grading & saved looks
await subTab('Color');
await details.locator('.looks-grid').getByRole('button', { name: 'Noir' }).click();
await page.keyboard.press('Shift+ArrowRight'); // past the fade-in, where the clip is fully visible
await settle();
// Corner: the layer above is keyed out there, so this is the graded clip.
const noir = await pixel(0.05, 0.05);
check('look turns the picture black & white', noir[0] > 5 && Math.abs(noir[0] - noir[1]) < 12 && Math.abs(noir[1] - noir[2]) < 12, noir.join(','));
const wheel = details.getByRole('slider', { name: 'Highlights colour' });
const wb = await wheel.boundingBox();
await page.mouse.click(wb.x + wb.width / 2, wb.y + 4);
check('colour wheel sets a tint', Number(await wheel.getAttribute('aria-valuenow')) > 50);
await details.getByRole('button', { name: 'Save as my look' }).click();
await libTab('Filters');
check('saved look appears in My looks', (await page.locator('.my-look', { hasText: 'Test look' }).count()) === 1);
await details.getByRole('button', { name: 'Reset colour' }).click();

// ---------- Titles, text animators, captions, shapes
const texts = () => page.locator('.text-item').count();
await libTab('Titles');
await page.getByRole('button', { name: 'Title: Name bar' }).click();
await page.getByRole('button', { name: 'Title: Subscribe' }).click();
await page.getByRole('button', { name: 'Shape: Star' }).click();
check('titles and shapes are added', (await texts()) === 3);
await libTab('Text');
await page.getByRole('button', { name: 'Animated text: Typewriter' }).click();
await page.getByRole('combobox', { name: 'Caption style' }).selectOption({ label: 'TikTok highlight' });
await page.locator('.cc-library-body textarea').fill('Hello there everyone. This is a test.');
await page.getByRole('button', { name: 'Create captions' }).click();
check('animated text and TikTok captions added', (await texts()) === 6);
await page.locator('.text-item').last().click();
check('captions are word by word', (await details.getByRole('combobox', { name: 'Word by word' }).inputValue()) === 'highlight');
const fontPath = '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf';
if (fs.existsSync(fontPath)) {
  await subTab('Style');
  await details.locator('input[type=file][accept^=".ttf"]').setInputFiles(fontPath);
  await page.waitForTimeout(800);
  const font = await details.locator('.font-picker-current').getAttribute('aria-label');
  check('uploaded font is used by the text', font.includes('DejaVuSerif-Bold'), font);
}

// ---------- Effects & particles
await libTab('Effects');
await page.locator('.fx-card', { hasText: 'Confetti' }).click();
check('particle effect added with a speed control', (await page.locator('.effect-item').count()) === 1 && (await details.getByText('Speed').count()) > 0);

// ---------- Audio: volume keyframes
await page.locator('.clip-item').first().click();
await subTab('Audio');
// Moving the "Volume over time" slider starts the automation by itself (no ◆ needed first).
const volSlider = details.locator('.anim-field', { hasText: 'Volume over time' }).locator('input[type=range]');
await volSlider.focus();
await page.keyboard.press('ArrowLeft');
await page.keyboard.press('ArrowLeft');
check('volume slider adds a keyframe', (await details.getByRole('button', { name: 'Remove Volume over time keyframe' }).count()) === 1);
// Shortcuts still work while the slider has focus (it only keeps the arrow keys).
await page.keyboard.press('Control+z');
await page.keyboard.press('Control+z');
const undone = (await details.getByRole('button', { name: 'Remove Volume over time keyframe' }).count()) === 0;
await page.keyboard.press('Control+Shift+z');
await page.keyboard.press('Control+Shift+z');
check('undo/redo work while a slider is focused', undone && (await details.getByRole('button', { name: 'Remove Volume over time keyframe' }).count()) === 1);
check('volume keyframe added', (await page.locator('.clip-item .kf-diamond').count()) >= 1);
await details.getByRole('combobox', { name: 'Noise reduction' }).selectOption('2');

// ---------- Export: presets, resolution, watermark, frame, audio, video
await page.evaluate(() => document.activeElement?.blur?.());
await page.keyboard.press('Home');
await page.getByRole('button', { name: 'Export', exact: true }).click();
const modal = page.locator('.export-modal');
await modal.locator('.preset-card').first().waitFor();
check('export presets listed', (await modal.locator('.preset-card').count()) >= 8);
await modal.getByRole('group', { name: 'Resolution' }).getByRole('button', { name: '4K' }).click();
check('4K output size', (await modal.locator('.hint').first().innerText()).includes('3840 × 2160'));
const corner = () =>
  page.locator('canvas.preview').evaluate((c) =>
    Array.from(c.getContext('2d').getImageData(Math.round(c.width * 0.6), Math.round(c.height * 0.85), Math.round(c.width * 0.38), Math.round(c.height * 0.13)).data),
  );
const before = await corner();
await modal.getByRole('button', { name: 'Add watermark' }).click();
await settle();
const after = await corner();
// The watermark lightens part of the bottom-right corner, whatever the picture is.
let changed = 0;
for (let i = 0; i < after.length; i += 4) if (after[i + 1] - before[i + 1] > 40) changed++;
check('watermark drawn on the video', changed > 50, `${changed} px changed`);
const pngDl = page.waitForEvent('download');
await modal.getByRole('button', { name: /Frame PNG/ }).click();
const png = fs.readFileSync(await (await pngDl).path());
check('frame PNG at the chosen resolution', png.readUInt32BE(16) === 3840 && png.readUInt32BE(20) === 2160, `${png.readUInt32BE(16)}×${png.readUInt32BE(20)}`);
const jpgDl = page.waitForEvent('download');
await modal.getByRole('button', { name: /Frame JPEG/ }).click();
const jpg = fs.readFileSync(await (await jpgDl).path());
check('frame JPEG saved', jpg[0] === 0xff && jpg[1] === 0xd8);
const wavDl = page.waitForEvent('download', { timeout: 30000 });
await modal.getByRole('button', { name: /Audio WAV/ }).click();
const wav = fs.readFileSync(await (await wavDl).path());
check('audio WAV saved (stereo)', wav.toString('ascii', 0, 4) === 'RIFF' && wav.readUInt16LE(22) === 2 && wav.length > 100000, `${wav.length} bytes`);

await page.getByRole('button', { name: 'Export', exact: true }).click();
await modal.getByRole('group', { name: 'Resolution' }).getByRole('button', { name: '720p' }).click();
await modal.getByRole('group', { name: 'Frame rate' }).getByRole('button', { name: '60' }).click();
const vidDl = page.waitForEvent('download', { timeout: 60000 });
await modal.getByRole('button', { name: 'Export video' }).click();
const vid = await vidDl;
const vidSize = fs.statSync(await vid.path()).size;
check('video export at 720p60 finishes', vidSize > 20000, `${vidSize} bytes`);
// The "ready to post" dialog follows every export.
await page.getByRole('dialog', { name: 'Your video is ready' }).waitFor();
await page.keyboard.press('Escape');

// Preset that changes the shape of the video (accepts the confirm).
await page.getByRole('button', { name: 'Export', exact: true }).click();
await modal.getByRole('button', { name: 'TikTok' }).click();
const ratio = await page.locator('canvas.preview').evaluate((c) => c.height / c.width);
check('TikTok preset switches the video to 9:16', Math.abs(ratio - 16 / 9) < 0.02, ratio.toFixed(3));
await page.keyboard.press('Escape');

// ---------- Saved project keeps the pro settings
await page.waitForTimeout(1200);
await page.reload();
await page.locator('.project-card .home-card').first().click();
await page.locator('.clip-item').first().waitFor();
await page.locator('.overlay-item').first().waitFor();
await page.locator('.overlay-item').first().click();
await subTab('Cutout');
check('green screen setting survives a reload', (await details.getByRole('button', { name: 'Background removed' }).count()) === 1);

await page.setViewportSize({ width: 390, height: 844 });
await settle();
check('phone: no sideways scrolling with pro panels', !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)));

check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
fs.rmSync(OUT, { recursive: true, force: true });
await browser.close();
process.exit(failed.length ? 1 : 0);
