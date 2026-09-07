// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startClipAudio } from '../src/client/clip-audio.ts'

const disposers: Array<() => void> = []
afterEach(() => { disposers.splice(0).forEach((dispose) => { dispose() }); vi.restoreAllMocks() })
function fixture() {
  const audio = document.createElement('audio')
  const play = vi.spyOn(audio, 'play').mockResolvedValue()
  const pause = vi.spyOn(audio, 'pause').mockImplementation(() => {})
  const onFailure = vi.fn()
  const options = { time: 12, duration: 60, audioDuration: 30, rate: 0.5, repeat: false,
    speed: 1.5, loop: true, volume: 0.4, muted: false, onFailure }
  const start = () => { const playback = startClipAudio(audio, options); disposers.push(playback.dispose); return playback }
  return { audio, play, pause, options, onFailure, start }
}

describe('authored dance audio clock', () => {
  it('starts at the shared seek position and scales time and speed after a duration edit', () => {
    const f = fixture(); const playback = f.start()
    expect(f.audio.currentTime).toBe(6)
    expect(f.audio.playbackRate).toBe(0.75)
    expect(f.audio.volume).toBe(0.4)
    expect(f.audio.loop).toBe(true)
    expect(f.audio.muted).toBe(false)
    expect(f.play).toHaveBeenCalledOnce()
    f.audio.currentTime = 9
    expect(playback.time()).toBe(18)
    f.audio.currentTime = 0
    expect(playback.time()).toBe(0)
    Object.defineProperty(f.audio, 'ended', { value: true })
    expect(playback.time()).toBe(60)
  })

  it('accumulates excerpt wraps without restarting a longer non-looping motion', () => {
    const f = fixture()
    Object.assign(f.options, { time: 18, duration: 40, audioDuration: 16, rate: 1, repeat: true, loop: false })
    const playback = f.start()
    expect(f.audio.currentTime).toBe(2)
    expect(f.audio.loop).toBe(true)
    expect(f.audio.preservesPitch).toBe(false)
    f.audio.currentTime = 15
    expect(playback.time()).toBe(31)
    f.audio.currentTime = 1
    expect(playback.time()).toBe(33)
    f.audio.currentTime = 10
    expect(playback.time()).toBe(40)
  })

  it('restarts the excerpt on the first beat when the complete dance loops', () => {
    const f = fixture()
    Object.assign(f.options, { time: 19, duration: 20, audioDuration: 16, rate: 1, repeat: true, loop: true })
    const playback = f.start()
    expect(f.audio.currentTime).toBe(3)
    f.audio.currentTime = 5
    expect(playback.time()).toBe(1)
    expect(f.audio.currentTime).toBe(1)
    f.audio.currentTime = 2
    expect(playback.time()).toBe(2)
  })

  it('supports muted playback without switching to an unrelated wall clock', () => {
    const f = fixture(); f.options.muted = true; f.options.loop = false
    const playback = f.start()
    expect(f.audio.muted).toBe(true)
    expect(f.audio.loop).toBe(false)
    f.audio.currentTime = 31
    expect(playback.time()).toBe(60)
  })

  it('pauses and reports a rejected play without leaving an error listener', async () => {
    const f = fixture(); f.play.mockRejectedValue(new Error('autoplay blocked'))
    f.start()
    await Promise.resolve()
    expect(f.onFailure).toHaveBeenCalledOnce()
    expect(f.pause).toHaveBeenCalledOnce()
    f.audio.dispatchEvent(new Event('error'))
    expect(f.onFailure).toHaveBeenCalledOnce()
  })

  it('reports synchronous unsupported-rate and media failures once', () => {
    const f = fixture()
    vi.spyOn(f.audio, 'playbackRate', 'set').mockImplementation(() => { throw new Error('unsupported') })
    f.start()
    expect(f.onFailure).toHaveBeenCalledOnce()
    expect(f.play).not.toHaveBeenCalled()
    f.audio.dispatchEvent(new Event('error'))
    expect(f.onFailure).toHaveBeenCalledOnce()
  })

  it('silences a decode failure during playback', () => {
    const f = fixture(); f.start()
    f.audio.dispatchEvent(new Event('error'))
    expect(f.onFailure).toHaveBeenCalledOnce()
    expect(f.pause).toHaveBeenCalledOnce()
  })

  it('revokes a pending play and ignores its late failure after replacement or unmount', async () => {
    const f = fixture()
    let reject!: (reason: Error) => void
    const pending = new Promise<void>((_resolve, fail) => { reject = fail })
    f.play.mockReturnValue(pending)
    const playback = f.start()
    playback.dispose()
    reject(new Error('interrupted by pause'))
    await pending.catch(() => undefined)
    f.audio.dispatchEvent(new Event('error'))
    expect(f.pause).toHaveBeenCalledOnce()
    expect(f.onFailure).not.toHaveBeenCalled()
  })
})
