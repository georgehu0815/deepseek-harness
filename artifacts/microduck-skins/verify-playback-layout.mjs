/** Check responsive wardrobe layout and appearance changes during authored dance playback. */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { chromium } = require('playwright');
const out = new URL('./', import.meta.url);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1200 } });
  page.setDefaultTimeout(30000);
  await page.goto(process.env.DSH_VERIFY_URL);
  await page.getByRole('treeitem').filter({ hasText: 'deepseek-harness' }).first().click();
  await page.getByText('机器鸭子皮肤系统设计与切换功能', { exact: true }).click();
  await page.getByText('Clip & Motion Gen', { exact: true }).click();
  const animate = page.getByRole('region', { name: '3 · Animate & verify', exact: true });
  const wardrobe = animate.getByRole('region', { name: 'Skin wardrobe', exact: true });
  const preset = animate.getByRole('combobox', { name: 'Load a generated dance', exact: true });
  await animate.getByRole('button', { name: 'New clip', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('select')].some(e => [...e.options].some(o => o.value === 'cumbia_v2' && !o.disabled) && !e.disabled));
  await preset.selectOption('cumbia_v2');
  assert.equal(await animate.getByLabel('Clip name', { exact: true }).inputValue(), 'MicroDuck Cumbia v2');
  await wardrobe.getByRole('button', { name: 'Velocity Club', exact: true }).click();
  await wardrobe.getByRole('button', { name: 'Apply to Duck 1', exact: true }).click();
  await animate.getByRole('button', { name: 'Play sequence', exact: true }).click();
  const timeline = animate.getByRole('slider', { name: 'Animation timeline', exact: true });
  await page.waitForFunction(() => Number(document.querySelector('input[aria-label="Animation timeline"]').value) > 0.2);
  const time = Number(await timeline.inputValue());
  await wardrobe.getByRole('button', { name: 'Sakura Mochi', exact: true }).click();
  await wardrobe.getByRole('button', { name: 'Apply to Duck 1', exact: true }).click();
  await animate.getByRole('button', { name: 'Pause sequence', exact: true }).waitFor();
  await page.waitForFunction(before => Number(document.querySelector('input[aria-label="Animation timeline"]').value) > before, time);
  await animate.getByRole('button', { name: 'Pause sequence', exact: true }).click();
  assert.equal(await wardrobe.getByRole('status').innerText(), 'Duck 1 is wearing Sakura Mochi');
  const layouts = [];
  for (const width of [1920, 1280, 900]) {
    await page.setViewportSize({ width, height: 1200 });
    await wardrobe.scrollIntoViewIfNeeded();
    const measures = await wardrobe.evaluate(element => ({ width: element.clientWidth, scrollWidth: element.scrollWidth,
      cardCount: element.querySelector('[aria-label="Browse skins"]').querySelectorAll('button').length }));
    assert.ok(measures.scrollWidth <= measures.width + 1);
    assert.equal(measures.cardCount, 10);
    await page.screenshot({ path: new URL(`wardrobe-${width}.png`, out).pathname });
    layouts.push({ viewportWidth: width, ...measures });
  }
  writeFileSync(new URL('playback-layout.json', out), JSON.stringify({ dance: 'cumbia_v2', playingSkinChange: true,
    timeContinues: true, layouts }, null, 2) + '\n');
  console.log('PASS: Cumbia v2 keeps playing across skin changes; 1920/1280/900 layouts retain ten cards without wardrobe overflow.');
} finally { await browser.close(); }
