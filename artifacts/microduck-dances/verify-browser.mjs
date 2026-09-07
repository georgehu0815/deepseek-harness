/** Exercise the existing authenticated GUI in isolated storage, without training or changing user drafts. */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { sampleAuthoredClip } from '../../packages/client/ui-robot-lab/src/client/clip-motion.ts';
const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { chromium } = require('playwright');
const out = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
const { profile } = JSON.parse(readFileSync(join(out, 'model.json'), 'utf8'));
assert.ok(process.env.DSH_VERIFY_URL, 'Set DSH_VERIFY_URL to the authenticated launch URL; it is not saved.');
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1200 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.DSH_VERIFY_URL);
  await page.getByText('Regenerate Dance Motions for Micduck Verification', { exact: true }).click();
  await page.getByText('Clip & Motion Gen', { exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'Load clip JSON' && !b.disabled), { timeout: 60000 });
  for (const row of manifest.clips) {
    await page.getByText('Clip & Motion Gen', { exact: true }).click();
    const clip = JSON.parse(readFileSync(join(out, row.clipFile), 'utf8'));
    await page.locator('section[aria-label="1 · Activity plan"] > label > textarea').fill(row.guideText);
    await page.locator('input[type="file"][aria-label="Load clip JSON"]').setInputFiles(join(out, row.clipFile));
    await page.waitForFunction(name => [...document.querySelectorAll('input')].some(input => input.value === name), clip.name);
    assert.equal(await page.getByLabel('Clip name', { exact: true }).inputValue(), clip.name);
    assert.equal(Number(await page.getByLabel('Duration (seconds)', { exact: true }).inputValue()), clip.duration);
    assert.equal(await page.getByRole('checkbox', { name: 'I reviewed this revision in the preview' }).isChecked(), false);
    const workspace = page.getByRole('region', { name: 'Simulation workspace', exact: true });
    await workspace.locator('canvas').waitFor({ state: 'visible', timeout: 120000 });
    const animate = page.getByRole('region', { name: '3 · Animate & verify', exact: true });
    const timeline = animate.getByRole('slider', { name: 'Animation timeline', exact: true });
    await animate.getByRole('button', { name: 'Play sequence', exact: true }).click();
    await page.waitForFunction(() => Number(document.querySelector('input[aria-label="Animation timeline"]').value) >= .5);
    await animate.getByRole('button', { name: 'Pause sequence', exact: true }).click();
    const playbackTime = Number(await timeline.inputValue());
    const sampled = [];
    for (const time of [0, 3.25, clip.duration / 2, clip.duration]) {
      await timeline.fill(String(time));
      const expected = sampleAuthoredClip(clip, time);
      for (const [index, joint] of profile.joints.entries()) {
        const slider = animate.locator(`input[type="range"][aria-label="${joint.name}"]`);
        const displayed = await slider.getAttribute('aria-valuetext');
        assert.ok(displayed.startsWith(expected.joints[index].toFixed(3) + ' rad'), `${row.dance}: ${joint.name} at ${time}: ${displayed}`);
        // Native range inputs quantize to their min/step grid; the label reports the actual authored pose.
        assert.ok(Math.abs(Number(await slider.inputValue()) - expected.joints[index]) < .0011);
      }
      assert.ok((await animate.getByRole('slider', { name: 'Root pitch', exact: true }).getAttribute('aria-valuetext')).startsWith('0.000 rad'));
      sampled.push(time);
    }
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save clip JSON', exact: true }).click();
    const download = await downloadPromise;
    const exported = JSON.parse(readFileSync(await download.path(), 'utf8'));
    assert.deepEqual(exported, clip);
    await timeline.fill(row.dance === 'breakdance' ? '9' : row.dance === 'salsa' ? '8.75' : '3.25');
    await page.getByRole('heading', { name: '3 · Animate & verify', exact: true }).scrollIntoViewIfNeeded();
    const screenshot = `${row.dance}-animate-verify.png`;
    await page.screenshot({ path: join(out, screenshot) });
    const alerts = await page.locator('[role="alert"]').allTextContents();
    assert.deepEqual(alerts, [], `${row.dance}: GUI alerts`);
    results.push({ dance: row.dance, clipFile: row.clipFile, clipSha256: row.clipSha256,
      import: true, nameAndDuration: true, playbackTime, jointSampleTimes: sampled,
      all14JointSamplesMatch: true, exportedClipMatches: true, reviewLeftUnchecked: true, screenshot });
    console.log(JSON.stringify(results.at(-1)));
  }
  assert.deepEqual(errors, [], 'Browser page errors');
  writeFileSync(join(out, 'browser-verification.json'), JSON.stringify({ url: 'http://127.0.0.1:3082/',
    context: 'Isolated headless Chromium; not the user browser. Original browser drafts and saved guides are untouched.',
    physicsRun: false, trainingRun: false, hardwareAccess: false, results, pageErrors: errors }, null, 2) + '\n');
} catch (error) {
  const page = browser.contexts()[0]?.pages()[0];
  if (page) await page.screenshot({ path: join(out, 'browser-failure.png') });
  throw error;
} finally { await browser.close(); }
