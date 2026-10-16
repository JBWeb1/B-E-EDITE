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
  // Plain local addresses for WebRTC, so two pages on this machine can connect directly.
  args: ['--autoplay-policy=no-user-gesture-required', '--disable-features=WebRtcHideLocalIpsWithMdns'],
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
await page.getByRole('dialog', { name: 'Export video' }).waitFor();
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

// ---------- Post kit
await page.goto(BASE);
await page.getByRole('button', { name: 'Video template: Product promo' }).click();
await page.locator('.clip-item').nth(2).waitFor({ timeout: 20000 });
await settle();
await page.getByRole('button', { name: 'Post kit' }).click();
const kit = page.getByRole('dialog', { name: 'Post kit' });
await kit.locator('.kit-frames button').first().waitFor({ timeout: 60000 });
check('post kit finds three best frames', (await kit.locator('.kit-frames button').count()) === 3);
await kit.locator('.kit-preview img').nth(2).waitFor({ timeout: 20000 });
check('thumbnail, post and story previews', (await kit.locator('.kit-preview img').count()) === 3);
check('title taken from the video', (await kit.getByRole('textbox', { name: 'Post title' }).inputValue()) === 'NEW DROP');
await kit.getByRole('textbox', { name: 'Your handle' }).fill('@beemotion');
const kitCaption = await kit.getByRole('textbox', { name: 'Post caption' }).inputValue();
check('caption with hashtags', /#\w+/.test(kitCaption) && kitCaption.includes('NEW DROP'), kitCaption.replace(/\n/g, ' / '));
const thumbDl = page.waitForEvent('download');
await kit.getByRole('button', { name: 'Download YouTube thumbnail' }).click();
const thumb = fs.readFileSync(await (await thumbDl).path());
check('thumbnail PNG is 1280×720', thumb.readUInt32BE(16) === 1280 && thumb.readUInt32BE(20) === 720, `${thumb.readUInt32BE(16)}×${thumb.readUInt32BE(20)}`);
// The thumbnail shows the video frame, not a blank page.
const thumbColours = await page.evaluate(async (b64) => {
  const img = new Image();
  img.src = 'data:image/png;base64,' + b64;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 36;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0, 64, 36);
  const d = g.getImageData(0, 0, 64, 36).data;
  const set = new Set();
  for (let i = 0; i < d.length; i += 4) set.add(`${d[i] >> 4},${d[i + 1] >> 4},${d[i + 2] >> 4}`);
  return set.size;
}, thumb.toString('base64'));
check('thumbnail uses the video frame', thumbColours > 20, `${thumbColours} colours`);
check('short video explains chapters', (await kit.getByText(/Chapters need a video/).count()) === 1);
await kit.getByRole('button', { name: 'Edit Instagram post' }).click();
await page.locator('.artboard canvas').waitFor({ timeout: 10000 });
check('post opens in the design editor', (await page.locator('.layers button').count()) >= 3, `${await page.locator('.layers button').count()} layers`);

// ---------- Visual history
await page.goto(`${BASE}/?new=video`);
await page.locator('.panel input[type=file]').setInputFiles([`${FIX}/red.webm`, `${FIX}/blue.webm`]);
await page.locator('.clip-item').nth(1).waitFor();
await libTab('Titles');
await page.getByRole('button', { name: 'Title: Name bar' }).click();
await page.locator('.clip-item').nth(1).click();
await page.keyboard.press('Delete');
await settle();
check('one clip left after deleting', (await page.locator('.clip-item').count()) === 1);
await page.getByRole('button', { name: 'History', exact: true }).click();
const hd = page.getByRole('dialog', { name: 'History' });
const labels = await hd.locator('.history-item .history-label').allInnerTexts();
check('history names every step', labels.some((l) => l.includes('Added text')) && labels.some((l) => l.includes('Deleted clip')) && labels.some((l) => l.includes('Added clip')), labels.join(' | '));
await hd.locator('.history-item img').nth(2).waitFor({ timeout: 20000 });
check('history shows a picture of each step', (await hd.locator('.history-item img').count()) >= 3);
await hd.locator('.history-item', { hasText: 'Added text' }).click();
await hd.locator('.history-compare img').nth(1).waitFor({ timeout: 20000 });
check('compare shows then and now side by side', (await hd.locator('.history-compare img').count()) === 2);
check('compare lists what changed since', (await hd.locator('.history-diff li').allInnerTexts()).some((t) => t.includes('Deleted clip')), (await hd.locator('.history-diff li').allInnerTexts()).join(' | '));
await hd.getByRole('button', { name: 'Go back to this' }).click();
await settle();
check('go back restores that step', (await page.locator('.clip-item').count()) === 2);
check('and you can come forward again (redo)', await page.getByRole('button', { name: 'Redo' }).isEnabled());
await page.getByRole('button', { name: 'History', exact: true }).click();
await hd.getByRole('textbox', { name: 'Version name' }).fill('First cut');
await hd.getByRole('button', { name: 'Save version' }).click();
check('saved version appears with a star', (await hd.locator('.history-item.saved', { hasText: 'First cut' }).count()) === 1);
await hd.getByRole('button', { name: 'Close' }).click();
await page.locator('.clip-item').first().click();
await page.keyboard.press('Delete');
await page.locator('.clip-item').first().click();
await page.keyboard.press('Delete');
await page.waitForTimeout(1500);
await page.goto(BASE);
await page.locator('.project-card .home-card').first().click();
await page.locator('.timeline').waitFor();
await settle();
check('project reopened with no clips', (await page.locator('.clip-item').count()) === 0);
await page.getByRole('button', { name: 'History', exact: true }).click();
await hd.locator('.history-item.saved', { hasText: 'First cut' }).click();
await hd.getByRole('button', { name: 'Restore this version' }).click();
await page.locator('.clip-item').nth(1).waitFor({ timeout: 10000 }).catch(() => {});
check('saved version survives a reload and restores', (await page.locator('.clip-item').count()) === 2 && (await page.locator('.text-item').count()) === 1);
const restoredPixel = await page.locator('canvas.preview').evaluate((c) => Array.from(c.getContext('2d').getImageData(5, 5, 1, 1).data));
check('restored clips still play their media', restoredPixel[0] > 150 || restoredPixel[2] > 150, restoredPixel.join(','));

// ---------- Phone to computer (direct, no server)
await page.goto(`${BASE}/?new=video`);
await page.getByRole('button', { name: 'Share' }).click();
const share = page.getByRole('dialog', { name: 'Share and connect' });
await share.getByRole('button', { name: /Send from your phone/ }).click();
const inviteBox = share.getByRole('textbox', { name: 'Invitation link' });
await inviteBox.waitFor({ timeout: 15000 });
const invite = await inviteBox.inputValue();
check('computer shows a QR code and link for the phone', invite.includes('#pair=') && (await share.locator('.qr svg').count()) === 1, invite.slice(0, 60) + '…');
const phoneCtx = await newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const phone = await phoneCtx.newPage();
watch(phone, 'phone ');
await phone.goto(invite);
const answerBox = phone.getByRole('textbox', { name: 'Answer code' });
await answerBox.waitFor({ timeout: 15000 });
check('phone answers with its own QR code', (await phone.locator('.qr svg').count()) === 1);
await share.getByRole('textbox', { name: 'Answer code' }).fill(await answerBox.inputValue());
await share.getByRole('button', { name: 'Connect' }).click();
await share.getByText('Phone connected ✓').waitFor({ timeout: 20000 });
await phone.getByText('Connected ✓').waitFor({ timeout: 20000 });
check('phone and computer connect directly', true);
await phone.locator('input[aria-label="Choose files to send"]').setInputFiles(`${FIX}/red.webm`);
await phone.getByText('Sent ✓').waitFor({ timeout: 20000 });
await page.locator('.clip-item').first().waitFor({ timeout: 20000 });
check('clip sent from the phone lands on the timeline', (await page.locator('.clip-item').count()) === 1 && (await page.locator('.asset', { hasText: 'red' }).count()) === 1);
await share.getByRole('button', { name: 'Disconnect' }).click();
await phone.getByText('Disconnected').waitFor({ timeout: 10000 }).catch(() => {});
check('phone sees the computer disconnect', (await phone.getByText('Disconnected').count()) === 1);
await phoneCtx.close();

// ---------- Live editing between two devices
await page.getByRole('button', { name: 'Share' }).click();
await share.getByRole('button', { name: /Edit together, live/ }).click();
await inviteBox.waitFor({ timeout: 15000 });
const liveLink = await inviteBox.inputValue();
check('live invitation link', liveLink.includes('#live='));
const friendCtx = await newContext();
const friend = await friendCtx.newPage();
watch(friend, 'friend ');
await friend.goto(liveLink);
const friendAnswer = friend.getByRole('textbox', { name: 'Answer code' });
await friendAnswer.waitFor({ timeout: 15000 });
await share.getByRole('textbox', { name: 'Answer code' }).fill(await friendAnswer.inputValue());
await share.getByRole('button', { name: 'Connect' }).click();
await page.locator('.live-badge.live').waitFor({ timeout: 20000 });
await friend.locator('.clip-item').first().waitFor({ timeout: 30000 });
check('friend receives the project with its media', (await friend.locator('.clip-item').count()) === 1);
check('both show the live badge', (await friend.locator('.live-badge.live').count()) === 1);
await settle(friend);
await libTab('Titles', friend);
await friend.getByRole('button', { name: 'Title: Name bar' }).click();
await page.locator('.text-item').first().waitFor({ timeout: 15000 });
check("friend's title appears on my screen", (await page.locator('.text-item').count()) === 1);
await page.locator('.panel input[type=file]').first().setInputFiles(`${FIX}/blue.webm`);
await friend.locator('.clip-item').nth(1).waitFor({ timeout: 30000 });
await libTab('Media', friend);
check('my new clip (with its media) appears on theirs', (await friend.locator('.clip-item').count()) === 2 && (await friend.locator('.asset', { hasText: 'blue' }).count()) >= 1, `${await friend.locator('.clip-item').count()} clips, ${await friend.locator('.asset').allInnerTexts()}`);
const friendPixel = await friend.locator('canvas.preview').evaluate((c) => Array.from(c.getContext('2d').getImageData(5, 5, 1, 1).data));
check('their player shows the shared video', friendPixel[0] > 150 || friendPixel[2] > 150, friendPixel.join(','));
await friendCtx.close();
await page.locator('.live-badge.ended').waitFor({ timeout: 20000 }).catch(() => {});
check('my editor notices when they leave', (await page.locator('.live-badge.ended').count()) === 1);

// ---------- Project file
await page.waitForTimeout(800);
await page.getByRole('button', { name: 'Share' }).click();
const bundleDl = page.waitForEvent('download');
await share.getByRole('button', { name: /Download project file/ }).click();
const bundle = await bundleDl;
const bundlePath = path.join(OUT, bundle.suggestedFilename());
await bundle.saveAs(bundlePath);
check('project file downloads', bundle.suggestedFilename().endsWith('.bemotion') && fs.statSync(bundlePath).size > 20000, `${fs.statSync(bundlePath).size} bytes`);
const otherCtx = await newContext();
const other = await otherCtx.newPage();
watch(other, 'other ');
await other.goto(BASE);
await other.locator('input[aria-label="Open a project file"]').setInputFiles(bundlePath);
await other.locator('.clip-item').nth(1).waitFor({ timeout: 20000 });
check('project file opens on another device with everything', (await other.locator('.clip-item').count()) === 2 && (await other.locator('.text-item').count()) === 1);
await other.waitForTimeout(1500);
await other.goto(BASE);
await other.locator('.project-card').first().waitFor({ timeout: 5000 }).catch(() => {});
check('opened project is saved to My projects', (await other.locator('.project-card').count()) === 1, String(await other.locator('.project-card').count()));
await otherCtx.close();

// ---------- Auto edit
await page.goto(BASE);
await page.locator('.hero-card.auto').click();
const ae = page.getByRole('dialog', { name: 'Auto edit' });
await ae.waitFor({ timeout: 10000 });
check('home opens auto edit straight away', true);
await ae.locator('input[aria-label="Add clips"]').setInputFiles([`${FIX}/moving.webm`, `${FIX}/talk.webm`, `${FIX}/red.webm`, `${FIX}/beat120.wav`]);
await ae.locator('.autoedit-clip.on').nth(2).waitFor({ timeout: 20000 });
await page.waitForFunction(() => document.querySelector('select[aria-label="Music"]')?.selectedOptions[0]?.textContent?.includes('beat120'), null, { timeout: 10000 });
check('clips and the song are picked up', (await ae.locator('.autoedit-clip.on').count()) === 3);
await ae.getByRole('textbox', { name: 'Describe your video' }).fill('a 10 second energetic travel video for TikTok with warm colours called "Summer days"');
const chips = await ae.locator('.chip').allInnerTexts();
check('understands the description', ['Travel montage style', '10 seconds long', 'golden hour colours', 'title “Summer days”'].every((w) => chips.some((c) => c.includes(w))), chips.join(' | '));
check('style follows the description', (await ae.getByRole('radio', { name: /Travel montage/ }).getAttribute('aria-checked')) === 'true');
await ae.getByRole('button', { name: /Auto edit 3 clips/ }).click();
const result = page.getByRole('dialog', { name: 'Auto edit result' });
await result.waitFor({ timeout: 90000 });
const resultText = await result.innerText();
const bpm = Number(resultText.match(/(\d+) BPM/)?.[1]);
check('finds the beat of the song', Math.abs(bpm - 120) <= 3 || Math.abs(bpm - 60) <= 2 || Math.abs(bpm - 240) <= 5, resultText.split('\n').slice(0, 2).join(' '));
const cuts = await page.locator('.clip-item').count();
check('builds a multi-cut edit', cuts >= 4, `${cuts} cuts`);
const tc = (await page.locator('.timecode').innerText()).split('/').pop().trim();
check('about the asked length', /^0:(09|10|11)\./.test(tc), tc + ' / ' + resultText.replace(/\n/g, ' ').slice(0, 160));
check('adds the title and the song', (await page.locator('.text-item', { hasText: 'Summer days' }).count()) === 1 && (await page.locator('.audio-item', { hasText: 'beat120' }).count()) === 1);
check('explains every cut', (await result.locator('.autoedit-cuts li').count()) === cuts);
const editA = await page.locator('.clip-item').allInnerTexts();
await result.getByRole('button', { name: 'Try another' }).click();
await result.waitFor({ timeout: 90000 });
await settle();
const editB = await page.locator('.clip-item').allInnerTexts();
check('try another gives a different edit', editB.length >= 4 && editB.join('|') !== editA.join('|'));
await result.getByRole('button', { name: 'Keep it' }).click();
check('keep it closes the panel', (await result.count()) === 0);
const vertical = await page.locator('canvas.preview').evaluate((c) => c.height / c.width);
check('vertical for TikTok', Math.abs(vertical - 16 / 9) < 0.02);

// Talking video: keeps speech, cuts the pauses
await libTab('AI');
await page.locator('.autoedit-card').click();
await ae.waitFor();
for (const name of ['moving.webm', 'red.webm']) await ae.getByRole('checkbox', { name: `Use ${name}` }).uncheck();
await ae.getByRole('radio', { name: /Talking/ }).click();
await ae.getByRole('checkbox', { name: /Captions from speech/ }).uncheck();
await ae.getByRole('button', { name: /Auto edit 1 clip/ }).click();
await result.waitFor({ timeout: 90000 });
const talkNotes = await result.locator('.autoedit-notes').innerText();
check('talking style cuts the pauses', /pauses/.test(talkNotes) && (await page.locator('.clip-item').count()) === 3, `${await page.locator('.clip-item').count()} cuts; ${talkNotes}`);
await result.getByRole('button', { name: 'Undo' }).click();
await ae.waitFor();
check('undo goes back to the settings', (await ae.count()) === 1);
await ae.getByRole('button', { name: 'Close' }).click();

// MORE CHECKS BELOW

check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
fs.rmSync(OUT, { recursive: true, force: true });
await browser.close();
process.exit(failed.length ? 1 : 0);
