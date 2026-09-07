/** Real browser decoding and MP4 encoding; no model, network, microphone, or physical robot. */
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { Rolldown } from 'tsdown'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ClipMusicChoice } from '../../../packages/client/ui-robot-lab/lib/types/client/clip-soundtrack.js'

interface ClipMusicFixture {
  resolveClipSoundtrack: typeof import('../../../packages/client/ui-robot-lab/lib/types/client/clip-soundtrack.js').resolveClipSoundtrack
  recordClipMovie: typeof import('../../../packages/client/ui-robot-lab/lib/types/client/clip-movie.js').recordClipMovie
}

interface BrowserFixture extends Window {
  clipMusicTest: ClipMusicFixture
  musicResult: Promise<{
    title: string
    sourceDuration: number
    recordedDuration: number
    rms: number
    silentBytes: number
    audioBytes: number
  }>
}

let browser: Browser | undefined
let script: string
beforeAll(async () => {
  const bundle = await Rolldown.rolldown({ input: fileURLToPath(new URL('./fixtures/clip-music-browser.ts', import.meta.url)), platform: 'browser' })
  try {
    const output = await bundle.generate({ format: 'iife', name: 'clipMusicTest' })
    const chunk = output.output.find(file => file.type === 'chunk')
    if (chunk === undefined) throw new Error('Missing browser media fixture bundle')
    script = chunk.code
  } finally { await bundle.close() }
  browser = await chromium.launch()
})
afterAll(async () => { await browser?.close() })

describe('native selected-music MP4 capture', () => {
  it.each(['soundhelix-17', 'soundhelix-8', 'soundhelix-1'] as ClipMusicChoice[])('decodes and exports audible %s instead of a silent substitute', async (choice) => {
    if (browser === undefined) throw new Error('Browser is not initialized')
    const page = await browser.newPage()
    try {
      await page.setContent('<canvas width="320" height="240"></canvas><button>Record test clip</button>')
      await page.addScriptTag({ content: script })
      await page.evaluate((selection) => {
        const host = window as unknown as BrowserFixture
        const canvas = document.querySelector('canvas')!
        const painter = canvas.getContext('2d')!
        const button = document.querySelector('button')!
        button.onclick = () => {
          host.musicResult = (async () => {
            const decoder = new AudioContext()
            let frame = 0
            const draw = () => {
              painter.fillStyle = '#204060'; painter.fillRect(0, 0, 320, 240)
              painter.fillStyle = '#e0f0ff'; painter.fillRect(performance.now() / 10 % 280, 80, 40, 80)
              frame = requestAnimationFrame(draw)
            }
            draw()
            try {
              const music = host.clipMusicTest.resolveClipSoundtrack('bachata', selection, 130, 1.25)!
              const input = Uint8Array.from(atob(music.src.split(',')[1]!), character => character.charCodeAt(0))
              const source = await decoder.decodeAudioData(input.buffer)
              const result = await host.clipMusicTest.recordClipMovie({ canvas, music, durationMs: 1_250,
                frameRate: 20, videoBitsPerSecond: 500_000, finalizeTimeoutMs: 10_000,
                signal: new AbortController().signal, onStarted: () => {} })
              if (result.audio === undefined) throw new Error('Selected soundtrack was omitted from MP4')
              const recorded = await decoder.decodeAudioData(await result.audio.blob.arrayBuffer())
              const samples = recorded.getChannelData(0)
              const power = samples.reduce((sum, value) => sum + value * value, 0) / samples.length
              return { title: music.credit!.title, sourceDuration: source.duration, recordedDuration: recorded.duration,
                rms: Math.sqrt(power), silentBytes: result.blob.size, audioBytes: result.audio.blob.size }
            } finally { cancelAnimationFrame(frame); await decoder.close() }
          })()
        }
      }, choice)
      await page.getByRole('button', { name: 'Record test clip' }).click()
      const result = await page.evaluate(() => (window as unknown as BrowserFixture).musicResult)
      expect(result.sourceDuration).toBeCloseTo(16, 1)
      expect(result.recordedDuration).toBeGreaterThan(1)
      expect(result.rms).toBeGreaterThan(0.001)
      expect(result.audioBytes).toBeGreaterThan(1_000)
      expect(result.silentBytes).toBeGreaterThan(1_000)
      expect(result.title).not.toBe('Original dance rhythm')
    } finally { await page.close() }
  }, 30_000)
})
