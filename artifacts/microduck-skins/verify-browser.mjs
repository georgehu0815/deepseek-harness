/** Exercise the built wardrobe in an isolated browser against the existing authenticated GUI. */
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { chromium } = require('playwright');
const out = new URL('./', import.meta.url);
mkdirSync(out, { recursive: true });
assert.ok(process.env.DSH_VERIFY_URL, 'Provide the authenticated existing GUI URL.');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1200 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.DSH_VERIFY_URL);
  await page.reload();
  await page.getByRole('treeitem').filter({ hasText: 'deepseek-harness' }).first().click();
  await page.getByText('机器鸭子皮肤系统设计与切换功能', { exact: true }).click();
  await page.getByText('Clip & Motion Gen', { exact: true }).click();
  const animate = page.getByRole('region', { name: '3 · Animate & verify', exact: true });
  const wardrobe = animate.getByRole('region', { name: 'Skin wardrobe', exact: true });
  await animate.getByRole('button', { name: 'New clip', exact: true }).click();
  await wardrobe.waitFor();
  const workspace = page.getByRole('region', { name: 'Simulation workspace', exact: true });
  const capture = workspace.getByRole('button', { name: 'Capture view (PNG)', exact: true });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'Capture view (PNG)' && !b.disabled));
  const saveJson = async () => {
    const download = page.waitForEvent('download');
    await animate.getByRole('button', { name: 'Save clip JSON', exact: true }).click();
    return readFileSync(await (await download).path(), 'utf8');
  };
  const png = async (name) => {
    const download = page.waitForEvent('download');
    await capture.click();
    const file = await download;
    await file.saveAs(new URL(`${name}.png`, out).pathname);
    return createHash('sha256').update(readFileSync(await file.path())).digest('hex');
  };
  const originalMotion = await saveJson();
  await png('warmup');
  await workspace.getByRole('status').filter({ hasText: 'PNG sent to your browser' }).waitFor();
  const originalPng = await png('original');
  const cards = wardrobe.getByRole('group', { name: 'Browse skins' }).getByRole('button');
  assert.equal(await cards.count(), 10);
  const results = [];
  for (let index = 0; index < 10; index++) {
    const card = cards.nth(index);
    const name = await card.getAttribute('aria-label');
    const before = await wardrobe.getByRole('status').innerText();
    await card.click();
    assert.equal(await wardrobe.getByRole('status').innerText(), before);
    await wardrobe.getByRole('button', { name: 'Apply to Duck 1', exact: true }).click();
    await wardrobe.getByRole('status').filter({ hasText: `Duck 1 is wearing ${name}` }).waitFor();
    const imageHash = await png(`skin-${String(index + 1).padStart(2, '0')}`);
    assert.notEqual(imageHash, originalPng);
    results.push({ name, imageHash });
  }
  assert.equal(new Set(results.map(row => row.imageHash)).size, 10);
  assert.equal(await saveJson(), originalMotion);
  await workspace.locator('summary').filter({ hasText: 'MicroDuck controls' }).click();
  await workspace.getByRole('button', { name: 'Add duck', exact: true }).click();
  await wardrobe.getByRole('combobox', { name: 'Current duck · appearance' }).selectOption('2');
  assert.equal(await wardrobe.getByRole('status').innerText(), 'Duck 2 is wearing Champagne Groove');
  await wardrobe.getByRole('button', { name: 'Sakura Mochi', exact: true }).click();
  await wardrobe.getByRole('button', { name: 'Apply to Duck 2', exact: true }).click();
  await wardrobe.getByRole('combobox', { name: 'Current duck · appearance' }).selectOption('1');
  assert.equal(await wardrobe.getByRole('status').innerText(), 'Duck 1 is wearing Champagne Groove');
  await png('mixed-ducks');
  await wardrobe.getByRole('button', { name: 'Rebel Voltage', exact: true }).click();
  await wardrobe.getByRole('button', { name: 'Apply to all 2 ducks', exact: true }).click();
  await wardrobe.getByRole('combobox', { name: 'Current duck · appearance' }).selectOption('2');
  assert.equal(await wardrobe.getByRole('status').innerText(), 'Duck 2 is wearing Rebel Voltage');
  await png('unified-punk');
  await animate.getByRole('checkbox', { name: 'I reviewed this revision in the preview', exact: true }).check();
  await animate.getByRole('button', { name: 'Generate MP4', exact: true }).click();
  const movie = page.getByRole('link', { name: 'Save MP4 file', exact: true });
  await movie.waitFor({ timeout: 60000 });
  const movieDownload = page.waitForEvent('download');
  await movie.click();
  const downloadedMovie = await movieDownload;
  await downloadedMovie.saveAs(new URL('unified-punk.mp4', out).pathname);
  const movieBytes = readFileSync(await downloadedMovie.path());
  assert.equal(movieBytes.toString('ascii', 4, 8), 'ftyp');
  assert.ok(movieBytes.length > 1000);
  await wardrobe.scrollIntoViewIfNeeded();
  await page.screenshot({ path: new URL('wardrobe-gui.png', out).pathname });
  await wardrobe.getByRole('button', { name: 'Original factory finish', exact: true }).click();
  await wardrobe.getByRole('button', { name: 'Apply to all 2 ducks', exact: true }).click();
  await workspace.getByRole('button', { name: 'Remove Duck 2', exact: true }).click();
  assert.equal(await png('restored'), originalPng);
  assert.equal(await saveJson(), originalMotion);
  assert.deepEqual(errors, []);
  writeFileSync(new URL('verification.json', out), JSON.stringify({ url: 'http://127.0.0.1:3082/',
    refreshedBuiltGui: true, isolatedBrowser: true, skinCount: 10, results, originalPng,
    originalRestoredExactly: true, currentAndAllTargets: true, motionJsonUnchanged: true, mp4Bytes: movieBytes.length, pageErrors: errors }, null, 2) + '\n');
  console.log('PASS: ten distinct skin PNGs, isolated/current/all targets, exact original restoration, unchanged motion JSON, no page errors.');
} catch (error) {
  const page = browser.contexts()[0]?.pages()[0];
  if (page) await page.screenshot({ path: new URL('failure.png', out).pathname });
  throw error;
} finally { await browser.close(); }
