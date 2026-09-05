import { describe, expect, it } from 'vitest'
import type { RobotMusicRecipe } from '@deepseek-ai/dsh-robot-lab/types'
import { encodeMusicWav, generateMusic, validateMusicOptions } from '../src/client/music.ts'
import type { MusicOptions } from '../src/client/music.ts'

const options: MusicOptions = { sampleRate: 22050, maxDurationSeconds: 10, maxSamples: 441000 }
const recipe: RobotMusicRecipe = { version: 1, style: 'disco', bpm: 120, beats: 4, seed: 7 }

describe('original local instrumental synthesis', () => {
  it.each(['disco', 'electronic', 'lofi', 'chiptune'] as const)('renders finite audible %s PCM at musical duration', (style) => {
    const pcm = generateMusic({ ...recipe, style }, options)
    expect(pcm.duration).toBe(2)
    expect(pcm.samples.length).toBe(44100)
    expect(pcm.sampleRate).toBe(22050)
    expect(pcm.samples.every(value => Number.isFinite(value) && Math.abs(value) <= 1)).toBe(true)
    expect(pcm.samples.reduce((sum, value) => sum + value * value, 0) / pcm.samples.length).toBeGreaterThan(0.001)
    expect(pcm.samples[0]).toBe(0)
    expect(Math.abs(pcm.samples.at(-1)!)).toBeLessThan(0.005)
  })

  it('reproduces seed and style while changing either changes the waveform', () => {
    const base = generateMusic(recipe, options)
    expect(generateMusic(recipe, options).samples).toEqual(base.samples)
    expect(generateMusic({ ...recipe, seed: 8 }, options).samples).not.toEqual(base.samples)
    const signatures = ['disco', 'electronic', 'lofi', 'chiptune'].map((style) => {
      const pcm = generateMusic({ ...recipe, style: style as RobotMusicRecipe['style'] }, options)
      return pcm.samples.slice(200, 220).join(',')
    })
    expect(new Set(signatures).size).toBe(4)
  })

  it('rounds only the last sample and supports explicit 44100 Hz', () => {
    const pcm = generateMusic({ ...recipe, bpm: 137, beats: 3 }, { ...options, sampleRate: 44100 })
    expect(pcm.duration).toBe(180 / 137)
    expect(pcm.samples.length / pcm.sampleRate).toBeGreaterThanOrEqual(pcm.duration)
    expect(pcm.samples.length / pcm.sampleRate - pcm.duration).toBeLessThan(1 / pcm.sampleRate)
  })

  it('encodes a PCM16 mono WAV with consistent RIFF lengths and sample values', () => {
    const pcm = generateMusic(recipe, options)
    const bytes = encodeMusicWav(pcm)
    const view = new DataView(bytes)
    const tag = (offset: number): string => new TextDecoder().decode(new Uint8Array(bytes, offset, 4))
    expect(tag(0)).toBe('RIFF')
    expect(tag(8)).toBe('WAVE')
    expect(tag(12)).toBe('fmt ')
    expect(tag(36)).toBe('data')
    expect(view.getUint32(4, true)).toBe(bytes.byteLength - 8)
    expect(view.getUint32(16, true)).toBe(16)
    expect(view.getUint16(20, true)).toBe(1)
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(22050)
    expect(view.getUint32(28, true)).toBe(44100)
    expect(view.getUint16(32, true)).toBe(2)
    expect(view.getUint16(34, true)).toBe(16)
    expect(view.getUint32(40, true)).toBe(pcm.samples.length * 2)
    for (const index of [0, 100, 500, pcm.samples.length - 1]) {
      expect(view.getInt16(44 + index * 2, true) / 32768).toBeCloseTo(pcm.samples[index]!, 4)
    }
  })

  it('enforces deployment limits before allocation and admits exact limits', () => {
    expect(generateMusic(recipe, { ...options, maxDurationSeconds: 2, maxSamples: 44100 }).samples.length).toBe(44100)
    expect(() => generateMusic(recipe, { ...options, maxDurationSeconds: 1.99 })).toThrow('duration or sample limit')
    expect(() => generateMusic(recipe, { ...options, maxSamples: 44099 })).toThrow('duration or sample limit')
    expect(() => generateMusic({ ...recipe, beats: 1e15 }, options)).toThrow('duration or sample limit')
  })

  it.each([
    { sampleRate: 48000 }, { maxDurationSeconds: 0 }, { maxDurationSeconds: Infinity },
    { maxSamples: 0 }, { maxSamples: 1.5 }, { maxSamples: 0xffffffff },
  ])('rejects invalid apply-time limits %j', (change) => {
    expect(() => validateMusicOptions({ ...options, ...change } as MusicOptions)).toThrow()
  })

  it('copies and freezes configuration instead of retaining mutable caller settings', () => {
    const supplied = { ...options }
    const validated = validateMusicOptions(supplied)
    supplied.maxSamples = 1
    expect(validated.maxSamples).toBe(options.maxSamples)
    expect(Object.isFrozen(validated)).toBe(true)
  })
})
