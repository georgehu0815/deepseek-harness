/** Built Web composition: Markdown audio stays in chat and loads only on Play. */
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { createMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-title'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, seedSession,
  watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const MODE = webSnapshotMode()
const SEED_ID = 'markdown-audio-web-e2e'
const AUDIO_URL = 'https://audio.example.test/music.MP3?version=1#track'
const EXPECTED = fileURLToPath(new URL('./expected/markdown-audio/ui.expected.md', import.meta.url))

/** PCM avoids a codec dependency; the URL tests MP3 recognition, the bytes test native playback. */
function silentWave(): Buffer {
  const samples = 8_000 * 10
  const buffer = Buffer.alloc(44 + samples * 2)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(buffer.length - 8, 4)
  buffer.write('WAVEfmt ', 8)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(8_000, 24)
  buffer.writeUInt32LE(16_000, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(samples * 2, 40)
  return buffer
}

function audioFixture(): string {
  const session = Session.create(SessionId('markdown-audio-source'))
  const origin = new Date().setHours(12, 0, 0, 0)
  session.append('turn/start', { turn: 1 })
  const user = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Play music inside this conversation.' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('session/title', {
    title: 'Inline music playback', messageSeqs: [user.seq], source: { kind: 'fallback' },
  })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('assistant/message', {
    stream: [], turn: 1, step: 1,
    message: createMessage({
      role: 'assistant',
      content: [{ type: 'text', text: [
        '## Listen in chat', '', `**[Dance sample](${AUDIO_URL})**`, '',
        '[Music website](https://example.test/music)', '',
        '[Local file](./private.mp3)', '', 'INLINE_AUDIO_DONE',
      ].join('\n') }],
      source: { kind: 'model', provider: 'fixture', model: 'fixture' },
    }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  return [
    JSON.stringify({ type: 'session', version: SESSION_FORMAT_VERSION, id: '{{sessionId}}',
      createdAt: 0, cwd: '{{cwd}}', isSeeded: false, delegationDepth: 0 }),
    ...session.snapshotEvents().map(event => JSON.stringify({ ...event, time: origin + event.seq * 1_000 })),
    '',
  ].join('\n')
}

describe('web e2e: inline Markdown audio', () => {
  let scaffold: WebScaffold | undefined
  let browser: Browser | undefined
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  const requests: string[] = []

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, audioFixture(), SEED_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.route('https://audio.example.test/**', async (route) => {
      requests.push(route.request().url())
      await route.fulfill({ status: 200, contentType: 'audio/wav', body: silentWave() })
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.locator('[role="treeitem"]').first().click()
    await page.locator('[role="treeitem"]').nth(1).click()
    await page.getByText('INLINE_AUDIO_DONE', { exact: true }).waitFor()
  })

  afterAll(async () => {
    try { await browser?.close() }
    finally { await scaffold?.close() }
  })

  it.skipIf(MODE === 'record')('plays and pauses without navigation, preserving its source link', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-markdown-audio'))
    const audio = page.locator('audio')
    expect(await audio.count()).toBe(1)
    expect(await audio.getAttribute('aria-label')).toBe('Dance sample')
    expect(await audio.getAttribute('preload')).toBe('none')
    expect(await audio.getAttribute('autoplay')).toBeNull()
    expect(await audio.evaluate(element => (element as HTMLAudioElement).controls)).toBe(true)
    expect(requests).toEqual([])
    expect(await page.getByRole('link', { name: 'Dance sample', exact: true }).getAttribute('href')).toBe(AUDIO_URL)
    expect(await page.getByRole('link', { name: 'Music website', exact: true }).count()).toBe(1)
    expect(await page.getByRole('link', { name: 'Local file', exact: true }).count()).toBe(0)
    const url = page.url()
    // Chromium's native control is not exposed as a DOM button. Space on the
    // focused media element exercises its keyboard Play/Pause user gesture.
    await audio.focus()
    await page.keyboard.press('Space')
    await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).currentTime)).toBeGreaterThan(0)
    await page.keyboard.press('Space')
    expect(await audio.evaluate(element => (element as HTMLAudioElement).paused)).toBe(true)
    expect(requests.length).toBeGreaterThan(0)
    expect(page.url()).toBe(url)
    expect(page.context().pages()).toHaveLength(1)
    if (scaffold === undefined) throw new Error('Web scaffold is not initialized')
    const snapshot = (await captureStableAria(page, '[class*="markdown"]:has(audio)', scaffold.workspaceCwd))
      .split(SEED_ID).join('{{seededId}}')
    await compareOrRefreshGolden(EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  })
})
