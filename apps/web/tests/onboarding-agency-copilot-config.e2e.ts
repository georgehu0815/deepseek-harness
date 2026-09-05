// Keyless browser e2e: Agency Copilot is the shipped default, welcome is the
// only first-run onboarding step, and arbitrary model settings remain usable.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  acknowledgeReloadConnectionLoss, assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
  WELCOME_NOTICE_ACK_FIELD, WELCOME_NOTICE_COPY, WELCOME_NOTICE_SETTINGS_NAMESPACE,
  WELCOME_NOTICE_VERSION,
} from './scaffold.ts'
import { ZH_BROWSER_LOCALE, connectFreshWorkspaceZh, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/onboarding-agency-copilot-config', import.meta.url))
const WELCOME_EXPECTED = join(SNAPSHOT_DIR, 'welcome.expected.md')
const MODELS_EXPECTED = join(SNAPSHOT_DIR, 'models.expected.md')
const MODE = webSnapshotMode()

describe.skipIf(MODE === 'record')('web e2e: prompt-free Agency Copilot default', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ agencyCopilotMissingCredential: true, welcomeNoticePending: true })
    browser = await chromium.launch()
    // The scenario asserts the shipped Chinese copy, so the browser asks for it.
    page = await browser.newPage({ viewport: { width: 1440, height: 960 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('shows welcome-only onboarding and persists its acknowledgement', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-onboarding-agency-copilot-config'))
    const welcome = page.getByRole('dialog', { name: WELCOME_NOTICE_COPY.zh.title })
    await welcome.waitFor({ timeout: 15_000 })
    expect(await page.locator('#root').evaluate(root => (root as HTMLElement).inert)).toBe(true)
    for (const paragraph of WELCOME_NOTICE_COPY.zh.body.split('\n\n')) {
      expect(await welcome.getByText(paragraph, { exact: true }).count()).toBe(1)
    }
    expect(await welcome.getByRole('button').allTextContents()).toEqual([
      WELCOME_NOTICE_COPY.zh.continueLabel,
    ])
    const welcomeAria = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(WELCOME_EXPECTED, welcomeAria, MODE)

    // Observation is not acknowledgement: the exact version is persisted
    // only by the explicit action, so a reload still presents this dialog.
    const firstReloadWarnings = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    acknowledgeReloadConnectionLoss(tripwire, firstReloadWarnings)
    await welcome.waitFor({ timeout: 15_000 })

    await welcome.getByRole('button', { name: WELCOME_NOTICE_COPY.zh.continueLabel }).click()
    await welcome.waitFor({ state: 'detached', timeout: 15_000 })

    expect(await page.locator('#root').evaluate(root => (root as HTMLElement).inert)).toBe(false)
    expect(await page.getByRole('dialog', { name: '添加一个 API Key 开始使用' }).count()).toBe(0)

    const acknowledgedSettings = await readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8')
    expect(acknowledgedSettings).toContain(`${WELCOME_NOTICE_ACK_FIELD}: ${WELCOME_NOTICE_VERSION}`)

    const secondReloadWarnings = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    acknowledgeReloadConnectionLoss(tripwire, secondReloadWarnings)
    await page.waitForSelector('[class*="frame"]', { timeout: 15_000 })
    expect(await page.getByRole('dialog', { name: WELCOME_NOTICE_COPY.zh.title }).count()).toBe(0)
    expect(await page.getByRole('dialog', { name: '添加一个 API Key 开始使用' }).count()).toBe(0)

    // An old acknowledgement means materially revised copy, so welcome returns.
    await scaffold.ctx.settings.mutate(settingsNamespace(WELCOME_NOTICE_SETTINGS_NAMESPACE), [{
      op: 'set', path: [WELCOME_NOTICE_ACK_FIELD], value: 'previous-copy-version',
    }])
    const thirdReloadWarnings = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    acknowledgeReloadConnectionLoss(tripwire, thirdReloadWarnings)
    await welcome.waitFor({ timeout: 15_000 })
    await welcome.getByRole('button', { name: WELCOME_NOTICE_COPY.zh.continueLabel }).click()
    await welcome.waitFor({ state: 'detached', timeout: 15_000 })
    expect(await page.getByRole('dialog', { name: '添加一个 API Key 开始使用' }).count()).toBe(0)

    expect(tripwire.warnings).toEqual([])
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('configures arbitrary Agency Copilot models after the selected model is removed', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-onboarding-agency-copilot-models'))
    // Opened here after the welcome-only flow leaves the application interactive.
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const settings = page.getByRole('dialog', { name: '设置' })
    await settings.waitFor({ timeout: 10_000 })
    await settings.getByRole('button', { name: '模型' }).click()
    const agencyCopilot = settings.getByText('Agency Copilot', { exact: true }).first()
    await agencyCopilot.waitFor({ timeout: 10_000 })
    await agencyCopilot.locator('xpath=ancestor::li').getByRole('button', { name: '编辑' }).click()
    await settings.getByText('自定义设置').click()
    await settings.getByRole('button', { name: /删除模型/ }).first().click()
    await settings.getByRole('button', { name: '添加模型' }).click()
    const customModelId = settings.getByLabel('模型 ID 1')
    await customModelId.fill('private-preview')
    await settings.getByLabel('显示名称 1').fill('Private Preview')
    // Capacities live behind the row's own disclosure, as in the pi-ai form.
    await settings.getByRole('button', { name: '容量 1' }).click()
    await settings.getByLabel('上下文窗口 1').fill('131072')
    await settings.getByLabel('最大输出 token 1').fill('64K')

    const modelEditor = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(MODELS_EXPECTED, modelEditor, MODE)
    await settings.getByRole('button', { name: '保存', exact: true }).click()
    await customModelId.waitFor({ state: 'detached', timeout: 15_000 })

    const document = await readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8')
    expect(document).toContain('id: private-preview')
    expect(document).toContain('name: Private Preview')
    expect(document).toContain('contextWindow: 131072')
    expect(document).toContain('maxTokens: 64000')
    expect(document).not.toMatch(/^\s*- id: claude-opus-4-8$/m)

    await page.keyboard.press('Escape')
    // A connected Workspace is what puts a live composer — and its model
    // trigger — on the page; the scaffold boots without one.
    await connectFreshWorkspaceZh(page, scaffold.workspaceCwd, 'model-fallback-e2e')

    const modelTrigger = page.getByRole('button', { name: '选择模型', exact: true })
    await modelTrigger.waitFor({ timeout: 10_000 })
    await modelTrigger.click()
    await page.getByRole('menuitem', { name: /模型/ }).click()
    expect(await page.getByText('claude-opus-4-8', { exact: true }).count()).toBe(0)
    await page.getByRole('menuitemradio', { name: 'Private Preview' }).waitFor({ timeout: 10_000 })
    expect(tripwire.warnings).toEqual([])
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('selects Agency Copilot Claude in a fresh composer', async () => {
    const defaultScaffold = await launchWebScaffold({
      agencyCopilotMissingCredential: true,
      welcomeNoticePending: false,
    })
    const defaultBrowser = await chromium.launch()
    const defaultPage = await defaultBrowser.newPage({
      viewport: { width: 1440, height: 960 },
      locale: ZH_BROWSER_LOCALE,
    })
    const defaultTripwire = watchConsole(defaultPage)
    try {
      await defaultPage.goto(defaultScaffold.baseUrl, { waitUntil: 'load' })
      await defaultPage.waitForSelector('[class*="frame"]', { timeout: 30_000 })
      await connectFreshWorkspaceZh(defaultPage, defaultScaffold.workspaceCwd, 'agency-default-model-e2e')
      const modelTrigger = defaultPage.getByRole('button', { name: /Claude Opus 4\.8/ })
      await modelTrigger.waitFor({ timeout: 10_000 })
      await modelTrigger.click()
      await defaultPage.getByRole('menuitem', { name: /模型/ }).click()
      const agencyGroup = defaultPage.getByRole('group', { name: 'Agency Copilot' })
      const claude = agencyGroup.getByRole('menuitemradio', { name: 'Claude Opus 4.8' })
      await claude.waitFor({ timeout: 10_000 })
      expect(await claude.getAttribute('aria-checked')).toBe('true')
      expect(defaultTripwire.warnings).toEqual([])
      expect(defaultTripwire.pageErrors).toEqual([])
    } finally {
      await defaultBrowser.close()
      await defaultScaffold.close()
    }
  }, 60_000)

  it('keeps the fixture inventory closed', async () => {
    await assertFixtureInventory(
      SNAPSHOT_DIR,
      ['welcome.expected.md', 'models.expected.md'],
    )
  })
})
