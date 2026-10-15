// Full end-to-end check of B-E Motion in a real browser.
//
//   npm run build && npm run preview      # serves the production build on :4173
//   npm run test:e2e                      # in a second terminal
//
// Set BASE_URL to test another address, and CHROMIUM_PATH to use an
// already-installed Chromium instead of Playwright's own download.
import { chromium } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'bem-e2e-'));
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
async function newPage(viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true, permissions: ['microphone'] });
  await ctx.addInitScript(() => {
    localStorage.setItem('bee.tips.design', '1');
    localStorage.setItem('bee.tips.video', '1');
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
  page.on('dialog', (d) => d.accept());
  return page;
}

const page = await newPage();
const layers = () => page.locator('.layers li button').count();
const xOf = async (name) => {
  await page.locator('.layers button', { hasText: name }).first().click();
  return Number(await page.locator('.panel.right .field', { hasText: /^X/ }).locator('input').inputValue());
};
const menuDownload = async (item) => {
  await page.getByRole('button', { name: /Download/ }).click();
  const [d] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.getByRole('menuitem', { name: item }).click()]);
  return d;
};

// ---------- Home & branding
await page.goto(BASE);
check('page title is B-E Motion', (await page.title()) === 'B-E Motion');
check('logo image loads', await page.locator('.brand img.logo').evaluate((img) => img.complete && img.naturalWidth > 0));

// ---------- Installable app (PWA)
const manifestHref = await page.locator('link[rel=manifest]').getAttribute('href');
const manifest = await (await page.request.get(new URL(manifestHref, BASE).href)).json();
check('manifest names the app', manifest.name === 'B-E Motion' && manifest.display === 'standalone');
const iconsOk = await Promise.all(manifest.icons.map(async (i) => (await page.request.get(new URL(i.src, BASE).href)).ok()));
check('manifest icons load', iconsOk.every(Boolean), `${iconsOk.length} icons`);
const swReady = await page.evaluate(async () => {
  const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 8000))]);
  return !!reg && !!reg.active;
});
check('service worker active', swReady);
// Chrome never offers installs in private windows (which test contexts are), so ask
// its installability checker from a normal, throwaway browser profile.
{
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bem-profile-'));
  const ctx = await chromium.launchPersistentContext(profile, { executablePath: process.env.CHROMIUM_PATH || undefined });
  const p = ctx.pages()[0] ?? (await ctx.newPage());
  await p.goto(BASE);
  await p.evaluate(() => navigator.serviceWorker.ready);
  const cdp = await ctx.newCDPSession(p);
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  check('Chrome says the app is installable', installabilityErrors.length === 0, installabilityErrors.map((e) => e.errorId).join(', '));
  await ctx.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
// Offline: the installed app must still open.
await page.reload(); // let the service worker control the page and cache what it loads
await page.waitForTimeout(500);
await page.context().setOffline(true);
await page.reload();
const offlineOk = await page.locator('.hero-card.design').isVisible().catch(() => false);
await page.context().setOffline(false);
check('app opens offline', offlineOk);
// The installed app's "New design" shortcut opens straight into the editor.
await page.goto(new URL('./?new=design', BASE).href);
check('?new=design shortcut opens the editor', await page.locator('.artboard canvas').isVisible());
await page.goto(BASE);

// ---------- Design: basics
await page.locator('.hero-card.design').click();
await page.getByRole('button', { name: 'Text', exact: true }).click();
await page.getByRole('button', { name: 'Add a heading' }).click();
await page.locator('.panel.right textarea').fill('Hello Motion');
await page.getByRole('button', { name: /Elements/ }).click();
await page.getByTitle('rect').click();
await page.getByTitle('star').click();
check('add text + 2 shapes', (await layers()) === 3);
check('panel text edit updates layer', (await page.locator('.layers button', { hasText: 'Hello Motion' }).count()) === 1);

await page.keyboard.press('Control+a');
await page.getByTitle('Align left').click();
const xs = [await xOf('Hello Motion'), await xOf('Rect'), await xOf('Star')];
check('align left lines up 3 items', new Set(xs).size === 1, xs.join(','));
await page.keyboard.press('Control+z');
const afterUndo = [await xOf('Hello Motion'), await xOf('Rect'), await xOf('Star')];
check('undo reverts alignment', new Set(afterUndo).size > 1, afterUndo.join(','));

// ---------- Bug fix: keys inside Present mode must not edit the design
await page.locator('.layers button', { hasText: 'Star' }).click();
const starX = await xOf('Star');
await page.getByRole('button', { name: /Present/ }).click();
await page.locator('.presenter').waitFor();
await page.keyboard.press('ArrowRight');
await page.keyboard.press('Backspace');
await page.keyboard.press('Delete');
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
check('present mode closes on Esc', (await page.locator('.presenter').count()) === 0);
check('keys in present mode do not move/delete', (await layers()) === 3 && (await xOf('Star')) === starX);

// ---------- Bug fix: keys under the help dialog and the Download menu
await page.keyboard.press('?');
await page.keyboard.press('ArrowRight');
await page.keyboard.press('Delete');
check('help dialog open', (await page.locator('.shortcut-table').count()) === 1);
await page.keyboard.press('Escape');
check('keys under help dialog ignored', (await layers()) === 3 && (await xOf('Star')) === starX);
await page.getByRole('button', { name: /Download/ }).click();
await page.keyboard.press('Delete');
await page.keyboard.press('Escape');
check('Delete under open menu ignored; Esc closes menu', (await layers()) === 3 && (await page.locator('.menu-panel').count()) === 0);

// ---------- Bug fix: keys during animation preview
await page.keyboard.press('Escape');
await page.getByRole('button', { name: 'Rise', exact: true }).click(); // animates the page and starts a preview
await page.waitForTimeout(1500); // let that preview finish
await page.getByRole('button', { name: /Preview animation/ }).click();
await page.locator('.layers button', { hasText: 'Star' }).click();
// Selecting a layer ends nothing; Delete during the preview must be ignored.
const previewing = await page.getByRole('button', { name: /Preview animation/ }).count();
await page.keyboard.press('Delete');
check('Delete ignored during animation preview', (await layers()) === 3, `preview button present: ${previewing}`);
await page.waitForTimeout(1500);

// ---------- Lock, context menu copy/paste, delete
await page.locator('.layers button', { hasText: 'Star' }).click();
await page.getByRole('button', { name: 'Lock', exact: true }).click();
await page.keyboard.press('Delete');
check('locked element survives Delete', (await layers()) === 3);
await page.getByRole('button', { name: 'Unlock', exact: true }).click();
const canvas = page.locator('.artboard canvas');
const box = await canvas.boundingBox();
const s = box.width / 1080;
await page.locator('.layers button', { hasText: 'Rect' }).click();
const rx = await xOf('Rect');
const ry = Number(await page.locator('.panel.right .field', { hasText: /^Y/ }).locator('input').inputValue());
await page.mouse.click(box.x + (rx + 20) * s, box.y + (ry + 20) * s, { button: 'right' });
await page.locator('.context-menu button', { hasText: 'Copy' }).click();
await page.mouse.click(box.x + 10, box.y + 10, { button: 'right' });
await page.locator('.context-menu button', { hasText: 'Paste' }).click();
check('context menu copy + paste', (await layers()) === 4);
await page.keyboard.press('Delete');
check('Delete removes pasted copy', (await layers()) === 3);

// ---------- Pages + undo
await page.getByRole('button', { name: '+ Page' }).click();
check('add page', (await page.locator('.page-thumb').count()) === 2);
await page.locator('.page-thumb').first().click();
await page.keyboard.press('Control+z');
check('undo removes the added page', (await page.locator('.page-thumb').count()) === 1);
await page.keyboard.press('Control+Shift+z');
check('redo restores it', (await page.locator('.page-thumb').count()) === 2);

// ---------- Exports
const png = await menuDownload(/PNG/);
await png.saveAs(`${OUT}/full.png`);
check('PNG export', fs.statSync(`${OUT}/full.png`).size > 5000);
const jpg = await menuDownload(/JPG/);
await jpg.saveAs(`${OUT}/full.jpg`);
check('JPG export', fs.statSync(`${OUT}/full.jpg`).size > 5000);
const pdf = await menuDownload(/PDF/);
await pdf.saveAs(`${OUT}/full.pdf`);
check('PDF export (2 pages)', fs.readFileSync(`${OUT}/full.pdf`, 'latin1').includes('/Count 2'));

// ---------- Project file round trip
const saved = await menuDownload(/Save project file/);
await saved.saveAs(`${OUT}/full.bee.json`);
const json = JSON.parse(fs.readFileSync(`${OUT}/full.bee.json`, 'utf8'));
check('project file has 2 pages', json.pages?.length === 2);
await page.locator('.page-thumb').nth(1).click();
await page.getByRole('button', { name: 'Delete', exact: true }).last().click();
await page.locator('input[type=file][accept^=".json"]').setInputFiles(`${OUT}/full.bee.json`);
await page.waitForTimeout(300);
check('open project file restores pages', (await page.locator('.page-thumb').count()) === 2);

// ---------- Autosave + reopen from My projects
await page.waitForTimeout(1000);
check('save indicator', /Saved/.test(await page.locator('.save-state').innerText()));
await page.reload();
await page.locator('.project-card').first().waitFor();
await page.locator('.project-card .home-card').first().click();
await page.locator('.page-thumb').first().waitFor();
check('design reopens after reload', (await page.locator('.page-thumb').count()) === 2 && (await layers()) === 3);

// ---------- Video editor
await page.getByRole('button', { name: 'Home', exact: true }).click();
await page.locator('.hero-card.video').click();
await page.locator('.panel input[type=file]').setInputFiles([`${FIX}/red.webm`, `${FIX}/blue.webm`, `${FIX}/music.wav`]);
await page.locator('.audio-item').waitFor();
await page.locator('.clip-item').nth(1).waitFor();
check('import video + music', (await page.locator('.clip-item').count()) === 2);

// Bug check: Space after clicking Play (button keeps focus) must pause, not double-toggle.
await page.locator('.play-btn').click();
await page.waitForTimeout(700);
await page.keyboard.press(' ');
await page.waitForTimeout(150);
const t1 = await page.locator('.timecode strong').innerText();
await page.waitForTimeout(500);
const t2 = await page.locator('.timecode strong').innerText();
check('Space pauses after clicking Play', t1 === t2 && t1 !== '0:00.0', `${t1} → ${t2}`);

// Speed changes length
await page.locator('.clip-item').first().click();
await page.locator('.panel.right .field', { hasText: 'Speed' }).locator('select').selectOption('2');
check('2× speed halves clip length', /1\.5s/.test(await page.locator('.clip-item').first().innerText()));
await page.keyboard.press('Control+z');
check('undo speed', /3\.0s/.test(await page.locator('.clip-item').first().innerText()));

// Text + drag on preview
await page.getByRole('button', { name: 'Text', exact: true }).click();
await page.keyboard.press('Home');
await page.getByRole('button', { name: 'Title', exact: true }).click();
const pv = await page.locator('canvas.preview').boundingBox();
await page.mouse.move(pv.x + pv.width / 2, pv.y + pv.height / 2);
await page.mouse.down();
await page.mouse.move(pv.x + pv.width * 0.3, pv.y + pv.height * 0.3, { steps: 6 });
await page.mouse.up();
check('drag text on preview', (await page.locator('.text-item').count()) === 1);

// Captions import
await page.locator('input[type=file][accept^=".srt"]').setInputFiles(`${FIX}/captions.srt`);
await page.waitForTimeout(200);
check('import .srt captions', (await page.locator('.text-item').count()) === 3);

// Delete clip + undo
await page.locator('.clip-item').nth(1).click();
await page.keyboard.press('Delete');
check('delete clip', (await page.locator('.clip-item').count()) === 1);
await page.keyboard.press('Control+z');
check('undo delete clip', (await page.locator('.clip-item').count()) === 2);

// Bug fix: Space while recording a voice-over must not stop playback
await page.getByRole('button', { name: 'Media', exact: true }).click();
await page.keyboard.press('Home');
await page.getByRole('button', { name: /Record voice-over/ }).click();
await page.waitForTimeout(600);
// Space on the focused Stop button would (correctly) press it; test the editor shortcut instead.
await page.evaluate(() => (document.activeElement)?.blur?.());
await page.keyboard.press(' ');
await page.waitForTimeout(400);
const playingDuringRec = await page.locator('.play-btn[aria-label="Pause"]').count();
await page.getByRole('button', { name: /Stop recording/ }).click();
await page.locator('.audio-item', { hasText: 'Voice-over' }).waitFor({ timeout: 10000 });
check('Space ignored while recording a voice-over', playingDuringRec === 1);

// Bug fix: Esc closes the export dialog; Space during export does not pause it
await page.getByRole('button', { name: 'Export', exact: true }).click();
await page.keyboard.press('Escape');
check('Esc closes export dialog', (await page.locator('.modal').count()) === 0);
await page.getByRole('button', { name: 'Export', exact: true }).click();
await page.locator('.modal').getByRole('button', { name: 'Small file' }).click();
const exportDone = page.waitForEvent('download', { timeout: 60000 });
await page.locator('.modal').getByRole('button', { name: 'Export', exact: true }).click();
await page.waitForTimeout(1500);
await page.keyboard.press(' ');
const vid = await exportDone;
await vid.saveAs(`${OUT}/full.webm`);
const exportedBytes = fs.statSync(`${OUT}/full.webm`).size;
check('export finishes despite Space', exportedBytes > 20000, `${exportedBytes} bytes`);

// Reopen video after reload
await page.waitForTimeout(1200);
await page.reload();
await page.locator('.project-card', { hasText: 'VIDEO' }).first().waitFor();
await page.locator('.project-card', { hasText: 'VIDEO' }).locator('.home-card').click();
await page.locator('.clip-item').first().waitFor();
check(
  'video reopens with clips, audio and text',
  (await page.locator('.clip-item').count()) === 2 && (await page.locator('.audio-item').count()) === 2 && (await page.locator('.text-item').count()) === 3,
);

// Home: delete a project
await page.getByRole('button', { name: 'Home', exact: true }).click();
await page.locator('.project-card').first().waitFor();
const before = await page.locator('.project-card').count();
await page.locator('.project-card').first().hover();
await page.locator('.project-card .project-delete').first().click();
await page.waitForTimeout(400);
check('delete project from home', (await page.locator('.project-card').count()) === before - 1);

// ---------- Phone
const phone = await newPage({ width: 390, height: 844 });
await phone.goto(BASE);
await phone.locator('.hero-card.design').click();
check('phone: side panel starts folded', (await phone.locator('.panel.collapsed').count()) === 1);
await phone.getByRole('button', { name: 'Text', exact: true }).click();
await phone.getByRole('button', { name: 'Add a heading' }).click();
check('phone: add text', (await phone.locator('.layers li button').count()) === 1);
const overflow = await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
check('phone: no sideways scrolling', !overflow);

check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
fs.rmSync(OUT, { recursive: true, force: true });
await browser.close();
process.exit(failed.length ? 1 : 0);
