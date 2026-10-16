// End-to-end checks for the features other editors don't have: pre-flight check
// (hook score, safe zones, accessibility), edit recipes, post kit, visual history,
// and phone-to-computer / sharing / live editing without a server.
//
//   npm run build && npm run preview      # serves the production build on :4173
//   npm run test:e2e:unique               # in a second terminal
import { chromium } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'bem-unique-'));
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
const newContext = async (opts = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, ...opts });
  await ctx.addInitScript(() => {
    for (const k of ['bee.tips.design', 'bee.tips.video', 'bee.tour.video', 'bee.tour.design']) localStorage.setItem(k, '1');
  });
  return ctx;
};
const ctx = await newContext();
const page = await ctx.newPage();
const watch = (p, tag = '') => {
  p.on('pageerror', (e) => errors.push(`${tag}pageerror: ${e.message}`));
  p.on('console', (m) => m.type() === 'error' && errors.push(`${tag}console: ${m.text()}`));
  p.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'My recipe' : undefined));
};
watch(page);
const settle = (p = page) => p.waitForTimeout(350);
const libTab = (name, p = page) => p.locator('.cc-tabs').getByRole('button', { name, exact: true }).click();

// ---------- Pre-flight check
await page.goto(`${BASE}/?new=video`);
await page.getByRole('combobox', { name: 'Aspect ratio' }).selectOption({ label: '9:16 Vertical' });
await page.locator('.panel input[type=file]').setInputFiles([`${FIX}/strobe.webm`]);
await page.locator('.clip-item').first().waitFor();
await libTab('Text');
await page.locator('.cc-library-body textarea').fill('This is a very long caption that nobody could possibly read in the short time it is shown on screen during this clip');
await page.getByRole('button', { name: 'Create captions' }).click();
await page.evaluate(() => document.activeElement?.blur?.());
await page.getByRole('button', { name: 'Check', exact: true }).click();
const pf = page.getByRole('dialog', { name: 'Pre-flight check' });
await pf.locator('.pf-summary').waitFor({ timeout: 60000 });
const score = Number(await pf.locator('.pf-score span').innerText());
check('pre-flight gives a hook score', score >= 0 && score <= 100, String(score));
check('posting to TikTok for a vertical video', (await pf.getByRole('combobox', { name: 'Posting to' }).inputValue()) === 'tiktok');
const items = async () => (await pf.locator('.pf-item strong').allInnerTexts()).join(' | ');
const all = await items();
check('flashing is detected', /Flashing at/.test(all), all);
check('too-fast captions are detected', /too fast to read/.test(all));
check('text under TikTok buttons is detected', /under TikTok/.test(all));
await pf.locator('.pf-item', { hasText: 'under TikTok' }).getByRole('button', { name: 'Fix' }).click();
await pf.locator('.pf-summary').waitFor({ timeout: 60000 });
await page.waitForTimeout(300);
await pf.locator('.pf-summary').waitFor({ timeout: 60000 });
check('safe-zone fix moves the caption clear', /Nothing hidden by TikTok/.test(await items()), await items());
await pf.locator('.pf-item', { hasText: 'too fast' }).getByRole('button', { name: 'Fix' }).click();
await page.waitForTimeout(300);
await pf.locator('.pf-summary').waitFor({ timeout: 60000 });
check('slow-captions fix applied', !/too fast to read/.test(await items()), await items());
const textsBefore = await page.locator('.text-item').count();
const hookFix = pf.locator('.pf-item', { hasText: /No text in the opening|First text only/ });
if (await hookFix.count()) {
  await hookFix.getByRole('button', { name: 'Fix' }).click();
  await page.waitForTimeout(300);
  check('hook-title fix adds a title', (await page.locator('.text-item').count()) === textsBefore + 1);
} else check('hook title already present', true);
await pf.getByRole('button', { name: /Safe zones on player/ }).click();
await pf.getByRole('button', { name: 'Close' }).click();
check('safe zones show on the player', (await page.locator('.safe-zone').count()) === 3);
await page.getByRole('button', { name: 'Hide safe zones' }).click();
check('safe zones can be hidden', (await page.locator('.safe-zone').count()) === 0);
await page.getByRole('button', { name: 'Export', exact: true }).click();
check('export offers the pre-flight check', (await page.getByRole('button', { name: /Run the pre-flight check/ }).count()) === 1);
await page.keyboard.press('Escape');

// ---------- Edit recipes
await page.goto(BASE);
await page.getByRole('button', { name: 'Video template: Vlog intro' }).click();
await page.locator('.clip-item').nth(1).waitFor({ timeout: 20000 });
await settle();
await page.getByRole('button', { name: 'Recipes' }).click();
const rd = page.getByRole('dialog', { name: 'Edit recipes' });
const partLabels = await rd.locator('.recipe-parts .check').allInnerTexts();
check('recipe finds intro, effects and transitions', ['Intro', 'Effects', 'Transitions'].every((w) => partLabels.some((l) => l.includes(w))), partLabels.join(' | ').replace(/\n/g, ' '));
await rd.getByRole('textbox', { name: 'Recipe name' }).fill('Vlog style');
await rd.getByRole('button', { name: 'Save recipe' }).click();
await rd.locator('.recipe-card', { hasText: 'Vlog style' }).waitFor();
check('recipe saved', (await rd.locator('.recipe-card').count()) === 1, await rd.locator('.recipe-card').innerText());
await rd.getByRole('button', { name: 'Close' }).click();

await page.goto(`${BASE}/?new=video`);
await page.locator('.panel input[type=file]').setInputFiles([`${FIX}/red.webm`, `${FIX}/blue.webm`]);
await page.locator('.clip-item').nth(1).waitFor();
await page.getByRole('button', { name: 'Recipes' }).click();
await rd.getByRole('button', { name: 'Apply Vlog style' }).click();
await settle();
const after = { texts: await page.locator('.text-item').count(), sounds: await page.locator('.audio-item').count(), effects: await page.locator('.effect-item').count() };
check('recipe replays titles, sounds and effects on a new video', after.texts === 3 && after.sounds === 2 && after.effects === 1, JSON.stringify(after));
await page.keyboard.press('Control+z');
await settle();
check('undo removes the whole recipe in one step', (await page.locator('.text-item').count()) === 0 && (await page.locator('.effect-item').count()) === 0);
await page.keyboard.press('Control+Shift+z');
await page.waitForTimeout(1500);
await page.goto(BASE);
await page.locator('.project-card .home-card').first().click();
await page.locator('.clip-item').first().waitFor();
await settle();
check('recipe sounds are saved with the project (own media copy)', (await page.locator('.audio-item').count()) === 2, String(await page.locator('.audio-item').count()));

// MORE CHECKS BELOW

check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
fs.rmSync(OUT, { recursive: true, force: true });
await browser.close();
process.exit(failed.length ? 1 : 0);
