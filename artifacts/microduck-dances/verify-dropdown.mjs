/** Check the built dropdown through the existing GUI, without file upload, training or user-browser storage changes. */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { chromium } = require('playwright');
const root = new URL('./', import.meta.url);
const out = new URL('../microduck-dance-dropdown/', import.meta.url);
mkdirSync(out, { recursive: true });
const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
assert.ok(process.env.DSH_VERIFY_URL, 'Provide the authenticated launch URL in DSH_VERIFY_URL.');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1200 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.DSH_VERIFY_URL);
  await page.reload();
  await page.getByRole('tree', { name: 'Sessions', exact: true }).getByText('Regenerate Dance Motions for Micduck Verification', { exact: true }).click();
  await page.getByText('Clip & Motion Gen', { exact: true }).click();
  const animate = page.getByRole('region', { name: '3 · Animate & verify', exact: true });
  const picker = animate.getByRole('combobox', { name: 'Load a generated dance', exact: true });
  await picker.waitFor({ timeout: 60000 });
  await page.waitForFunction(() => [...document.querySelectorAll('select')].some(e => [...e.options].some(o => o.value === 'bachata') && !e.disabled));
  assert.deepEqual(await picker.locator('option').evaluateAll(options => options.map(o => o.value)), ['', ...manifest.clips.map(row => row.dance)]);
  const results = [];
  const save = async () => {
    const pending = page.waitForEvent('download');
    await animate.getByRole('button', { name: 'Save clip JSON', exact: true }).click();
    return JSON.parse(readFileSync(await (await pending).path(), 'utf8'));
  };
  for (const row of manifest.clips) {
    const original = JSON.parse(readFileSync(new URL(row.clipFile, root), 'utf8'));
    await picker.selectOption(row.dance);
    assert.equal(await animate.getByLabel('Clip name', { exact: true }).inputValue(), original.name);
    assert.equal(await page.locator('section[aria-label="1 · Activity plan"] > label > textarea').inputValue(), row.guideText);
    const review = animate.getByRole('checkbox', { name: 'I reviewed this revision in the preview', exact: true });
    assert.equal(await review.isChecked(), false);
    const workspace = page.getByRole('region', { name: 'Simulation workspace', exact: true });
    await workspace.locator('canvas').waitFor({ state: 'visible', timeout: 120000 });
    const timeline = animate.getByRole('slider', { name: 'Animation timeline', exact: true });
    assert.equal(Number(await timeline.inputValue()), 0);
    assert.deepEqual(await save(), original);
    await animate.getByRole('button', { name: 'Play sequence', exact: true }).click();
    await page.waitForFunction(() => Number(document.querySelector('input[aria-label="Animation timeline"]').value) > .5);
    await animate.getByRole('button', { name: 'Pause sequence', exact: true }).click();
    await review.check();
    await timeline.fill('1');
    await animate.getByRole('button', { name: 'Joints', exact: true }).click();
    const yaw = animate.getByRole('slider', { name: 'head_yaw', exact: true });
    await yaw.press('ArrowRight');
    await yaw.press('ArrowRight');
    await yaw.press('ArrowRight');
    const editedYaw = Number(await yaw.inputValue());
    assert.equal(await review.isChecked(), false);
    await animate.getByRole('button', { name: '◆ Key this pose', exact: true }).click();
    const edited = await save();
    assert.ok(Math.abs(edited.keys.find(key => key.t === 1).joints[7] - editedYaw) < 1e-9);
    assert.notDeepEqual(edited, original);
    await review.check();
    await picker.selectOption(row.dance);
    assert.equal(await review.isChecked(), false);
    assert.deepEqual(await save(), original);
    await timeline.fill(row.dance === 'salsa' ? '8.75' : row.dance === 'breakdance' ? '9' : '3.25');
    await animate.getByRole('heading', { name: '3 · Animate & verify', exact: true }).scrollIntoViewIfNeeded();
    const screenshot = row.dance + '-dropdown.png';
    await page.screenshot({ path: new URL(screenshot, out).pathname });
    assert.deepEqual(await page.locator('[role="alert"]').allTextContents(), []);
    results.push({ dance: row.dance, clipSha256: row.clipSha256, selectedWithoutUpload: true, exactOriginalExport: true,
      timedGuideLoaded: true, playback: true, poseEditedAndKeyed: true, editExported: true, originalReloaded: true, reviewReset: true, screenshot });
    console.log(JSON.stringify(results.at(-1)));
  }
  await page.reload();
  await page.getByRole('tree', { name: 'Sessions', exact: true }).getByText('Regenerate Dance Motions for Micduck Verification', { exact: true }).click();
  await page.getByText('Clip & Motion Gen', { exact: true }).click();
  await picker.waitFor();
  assert.equal(await picker.locator('option').count(), 7);
  assert.deepEqual(errors, []);
  writeFileSync(new URL('verification.json', out), JSON.stringify({ url: 'http://127.0.0.1:3082/', results,
    sixOptionsAfterRefresh: true, isolatedBrowserContext: true, fileUploads: 0, pageErrors: errors }, null, 2) + '\n');
} catch (error) {
  const page = browser.contexts()[0]?.pages()[0];
  if (page) await page.screenshot({ path: new URL('failure.png', out).pathname });
  throw error;
} finally { await browser.close(); }
