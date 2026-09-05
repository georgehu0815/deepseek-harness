import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RobotMusicRecipe } from '@deepseek-ai/dsh-robot-lab/types'
import { PLAYBACK_RATES, PlaybackTransport, validatePlaybackOptions } from '../src/client/playback-transport.ts'
import type { PlaybackTransportOptions } from '../src/client/playback-transport.ts'

const recipe: RobotMusicRecipe = { version: 1, style: 'electronic', bpm: 120, beats: 4, seed: 42 }
const settings = { sampleRate: 22050 as const, maxDurationSeconds: 10, maxSamples: 220500, hudIntervalMs: 50 }

class FakeSource {
  buffer: AudioBuffer | null = null
  onended: (() => void) | null = null
  playbackRate = { setValueAtTime: vi.fn() }
  connect = vi.fn()
  disconnect = vi.fn()
  start = vi.fn()
  stop = vi.fn()
}

class FakeAudio {
  currentTime = 0
  state: AudioContextState = 'suspended'
  destination = {}
  sources: FakeSource[] = []
  samples: Float32Array | null = null
  gain = { gain: { setValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() }
  resume = vi.fn(async () => { this.state = 'running' })
  close = vi.fn(async () => { this.state = 'closed' })
  createGain = vi.fn(() => this.gain)
  createBuffer = vi.fn((_channels: number, length: number, rate: number) => ({
    duration: length / rate,
    copyToChannel: (samples: Float32Array) => { this.samples = samples.slice() },
  }))
  createBufferSource = vi.fn(() => {
    const source = new FakeSource()
    this.sources.push(source)
    return source
  })
}

class Visibility extends EventTarget { hidden = false }

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void } {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

const transports: PlaybackTransport[] = []
function setup(change: Partial<PlaybackTransportOptions> = {}) {
  const audio = new FakeAudio()
  const visibility = new Visibility()
  const wall = { time: 0 }
  // Only browser resources are substituted; synthesis and transport state transitions are real.
  const createAudioContext = vi.fn(() => audio as unknown as AudioContext)
  const transport = new PlaybackTransport({ ...settings, now: () => wall.time, createAudioContext, visibility, ...change })
  transports.push(transport)
  return { transport, audio, wall, visibility, createAudioContext }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(async () => {
  await Promise.all(transports.splice(0).map(transport => transport.dispose()))
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('session-owned synchronized playback', () => {
  it('loads and prepares without autoplay, keeps stable snapshots, and notifies sparsely', async () => {
    const { transport, audio, createAudioContext } = setup()
    const initial = transport.getSnapshot()
    expect(transport.getSnapshot()).toBe(initial)
    expect(transport.prepareMusic()).toBeNull()
    transport.load({ id: 'clip', duration: 2, music: recipe })
    const loaded = transport.getSnapshot()
    expect(loaded).toMatchObject({ state: 'paused', mode: 'music', time: 0 })
    const pcm = transport.prepareMusic()
    expect(pcm!.samples.length).toBe(44100)
    expect(transport.prepareMusic()).toBe(pcm)
    expect(createAudioContext).not.toHaveBeenCalled()
    const listener = vi.fn()
    const unsubscribe = transport.subscribe(listener)
    await transport.play()
    expect(audio.samples).toEqual(pcm!.samples)
    const playing = transport.getSnapshot()
    audio.currentTime = 0.01
    expect(transport.getTime()).toBe(0.01)
    expect(transport.getSnapshot()).toBe(playing)
    listener.mockClear()
    vi.advanceTimersByTime(49)
    expect(listener).not.toHaveBeenCalled()
    audio.currentTime = 0.05
    vi.advanceTimersByTime(1)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(transport.getSnapshot().time).toBe(0.05)
    unsubscribe()
    transport.pause()
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('uses AudioContext time rather than wall time and preserves pause and seek offsets', async () => {
    const { transport, audio, wall } = setup()
    transport.load({ id: 'recording', duration: 1.5, music: recipe })
    await transport.play()
    const first = audio.sources[0]!
    expect(first.start).toHaveBeenCalledWith(0, 0, 1.5)
    wall.time = 100
    audio.currentTime = 0.4
    expect(transport.getTime()).toBe(0.4)
    transport.pause()
    expect(first.stop).toHaveBeenCalledOnce()
    expect(first.disconnect).toHaveBeenCalledOnce()
    expect(first.onended).toBeNull()
    audio.currentTime = 1
    expect(transport.getTime()).toBe(0.4)
    await transport.play()
    expect(audio.sources[1]!.start).toHaveBeenCalledWith(0, 0.4, 1.1)
    audio.currentTime = 1.2
    expect(transport.getTime()).toBeCloseTo(0.6)
    transport.seek(0.8)
    expect(audio.sources[1]!.stop).toHaveBeenCalledOnce()
    expect(audio.sources[2]!.start).toHaveBeenCalledWith(0, 0.8, 0.7)
    transport.seek(100)
    expect(transport.getSnapshot()).toMatchObject({ state: 'ended', time: 1.5 })
    expect(vi.getTimerCount()).toBe(0)
    await transport.restart()
    expect(transport.getTime()).toBe(0)
    expect(audio.sources.at(-1)!.start).toHaveBeenCalledWith(0, 0, 1.5)
  })

  it('clamps and stops at the actual recording end without looping the recipe', async () => {
    const { transport, audio } = setup()
    transport.load({ id: 'short-recording', duration: 0.2, music: recipe })
    await transport.play()
    const source = audio.sources[0]!
    expect(source.start).toHaveBeenCalledWith(0, 0, 0.2)
    audio.currentTime = 5
    expect(transport.getTime()).toBe(0.2)
    source.onended!()
    expect(transport.getSnapshot()).toMatchObject({ state: 'ended', time: 0.2 })
    expect(source.disconnect).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
    await transport.play()
    expect(audio.sources).toHaveLength(1)
  })

  it('can finish via the HUD timer and ignores saved late source callbacks', async () => {
    const { transport, audio } = setup()
    transport.load({ id: 'short', duration: 0.1, music: recipe })
    await transport.play()
    const late = audio.sources[0]!.onended!
    audio.currentTime = 0.1
    vi.advanceTimersByTime(50)
    expect(transport.getSnapshot().state).toBe('ended')
    expect(audio.sources[0]!.stop).toHaveBeenCalledOnce()
    transport.load({ id: 'next', duration: 1, music: null })
    late()
    expect(transport.getSnapshot()).toMatchObject({ id: 'next', state: 'paused', time: 0 })
  })

  it('does not stretch short music to fill longer recordings', async () => {
    const { transport, audio } = setup()
    transport.load({ id: 'long', duration: 3, music: recipe })
    await transport.play()
    expect(audio.sources[0]!.start).toHaveBeenCalledWith(0, 0, 2)
    audio.currentTime = 2
    audio.sources[0]!.onended!()
    expect(transport.getSnapshot().state).toBe('playing')
    transport.seek(2.5)
    expect(audio.sources).toHaveLength(1)
    audio.currentTime = 2.5
    vi.advanceTimersByTime(50)
    expect(transport.getSnapshot()).toMatchObject({ state: 'ended', time: 3 })
  })

  it('mutes gain without losing volume or stopping time', async () => {
    const { transport, audio } = setup()
    transport.setVolume(0.4)
    transport.setMuted(true)
    transport.load({ id: 'clip', duration: 2, music: recipe })
    await transport.play()
    expect(audio.gain.gain.setValueAtTime).toHaveBeenLastCalledWith(0, 0)
    transport.setMuted(false)
    expect(audio.gain.gain.setValueAtTime).toHaveBeenLastCalledWith(0.4, 0)
    transport.setVolume(2)
    expect(transport.getSnapshot().volume).toBe(1)
    transport.setVolume(-1)
    expect(transport.getSnapshot().volume).toBe(0)
    audio.currentTime = 0.5
    expect(transport.getTime()).toBe(0.5)
  })

  it('plays silent recordings without constructing audio and reports unavailable requested audio', async () => {
    const { transport, wall, createAudioContext } = setup()
    transport.load({ id: 'silent', duration: 1, music: null })
    await transport.play()
    wall.time = 0.25
    expect(transport.getTime()).toBe(0.25)
    expect(createAudioContext).not.toHaveBeenCalled()
    const unavailable = setup({ createAudioContext: () => null })
    unavailable.transport.load({ id: 'music', duration: 1, music: recipe })
    await unavailable.transport.play()
    expect(unavailable.transport.getSnapshot()).toMatchObject({ state: 'paused', mode: 'music' })
    expect(unavailable.transport.getSnapshot().error).toBe('Web Audio is unavailable. Choose Play without music or download the generated WAV.')
    unavailable.wall.time = 0.4
    expect(unavailable.transport.getTime()).toBe(0)
    unavailable.transport.load({ id: 'music', duration: 1, music: null })
    await unavailable.transport.play()
    expect(unavailable.transport.getSnapshot()).toMatchObject({ state: 'playing', mode: 'silent', error: null })
    unavailable.wall.time = 0.8
    expect(unavailable.transport.getTime()).toBe(0.4)
  })

  it('reports failed resume as paused and allows an explicit retry', async () => {
    const { transport, audio } = setup()
    audio.resume.mockRejectedValueOnce(new Error('gesture denied'))
    transport.load({ id: 'clip', duration: 2, music: recipe })
    await transport.play()
    expect(transport.getSnapshot()).toMatchObject({ state: 'paused', error: 'gesture denied', time: 0 })
    expect(audio.sources).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
    await transport.play()
    expect(transport.getSnapshot()).toMatchObject({ state: 'playing', error: null })
  })

  it('rejects a resolved resume that leaves audio suspended', async () => {
    const { transport, audio } = setup()
    audio.resume.mockImplementationOnce(async () => {})
    transport.load({ id: 'clip', duration: 2, music: recipe })
    await transport.play()
    expect(transport.getSnapshot().state).toBe('paused')
    expect(transport.getSnapshot().error).toBe('Audio could not start. Retry Play or choose Play without music.')
    expect(audio.sources).toHaveLength(0)
  })

  it.each(['pause', 'seek', 'load', 'dispose'] as const)('contains deferred resume after %s', async (action) => {
    const { transport, audio } = setup()
    const pending = deferred()
    audio.resume.mockImplementationOnce(() => pending.promise)
    transport.load({ id: 'clip', duration: 2, music: recipe })
    const play = transport.play()
    await transport.play()
    expect(audio.resume).toHaveBeenCalledOnce()
    if (action === 'pause') transport.pause()
    if (action === 'seek') transport.seek(0.8)
    if (action === 'load') transport.load({ id: 'new', duration: 1, music: null })
    if (action === 'dispose') await transport.dispose()
    const snapshot = transport.getSnapshot()
    audio.state = 'running'
    pending.resolve()
    await play
    expect(transport.getSnapshot()).toBe(snapshot)
    expect(audio.sources).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ignores rejected stale resume while a newer recording plays', async () => {
    const { transport, audio, wall } = setup()
    const pending = deferred()
    audio.resume.mockImplementationOnce(() => pending.promise)
    transport.load({ id: 'old', duration: 2, music: recipe })
    const oldPlay = transport.play()
    transport.load({ id: 'new', duration: 1, music: null })
    await transport.play()
    wall.time = 0.2
    pending.reject(new Error('old resume failed'))
    await oldPlay
    expect(transport.getSnapshot()).toMatchObject({ id: 'new', state: 'playing', error: null })
    expect(transport.getTime()).toBe(0.2)
  })

  it('pauses on visibility hidden, including pending resumes, and never auto-resumes', async () => {
    const { transport, audio, visibility } = setup()
    transport.load({ id: 'clip', duration: 2, music: recipe })
    await transport.play()
    audio.currentTime = 0.5
    visibility.hidden = true
    visibility.dispatchEvent(new Event('visibilitychange'))
    expect(transport.getSnapshot()).toMatchObject({ state: 'paused', time: 0.5 })
    await transport.play()
    expect(audio.resume).toHaveBeenCalledOnce()
    visibility.hidden = false
    visibility.dispatchEvent(new Event('visibilitychange'))
    expect(transport.getSnapshot().state).toBe('paused')
  })

  it('disposes sources, gain, context, timers and visibility listeners before awaiting close', async () => {
    const { transport, audio, visibility } = setup()
    const remove = vi.spyOn(visibility, 'removeEventListener')
    transport.load({ id: 'clip', duration: 2, music: recipe })
    await transport.play()
    const late = audio.sources[0]!.onended!
    const listener = vi.fn()
    transport.subscribe(listener)
    const closing = deferred()
    audio.close.mockImplementationOnce(() => closing.promise)
    const disposed = transport.dispose()
    expect(transport.dispose()).toBe(disposed)
    expect(audio.sources[0]!.stop).toHaveBeenCalledOnce()
    expect(audio.sources[0]!.disconnect).toHaveBeenCalledOnce()
    expect(audio.gain.disconnect).toHaveBeenCalledOnce()
    expect(audio.close).toHaveBeenCalledOnce()
    expect(remove).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
    expect(vi.getTimerCount()).toBe(0)
    const snapshot = transport.getSnapshot()
    late()
    transport.load({ id: 'ignored', duration: 1, music: null })
    transport.setVolume(0.1)
    transport.setMuted(true)
    transport.seek(0)
    transport.pause()
    await transport.play()
    transport.subscribe(listener)()
    expect(transport.prepareMusic()).toBeNull()
    expect(transport.getSnapshot()).toBe(snapshot)
    expect(listener).not.toHaveBeenCalled()
    closing.resolve()
    await disposed
  })

  it('contains subscriber failures and preserves identity when values do not change', () => {
    const { transport } = setup()
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    transport.subscribe(() => { throw new Error('bad subscriber') })
    const next = vi.fn()
    transport.subscribe(next)
    transport.load({ id: 'silent', duration: 1, music: null })
    expect(next).toHaveBeenCalledOnce()
    expect(log).toHaveBeenCalledOnce()
    const snapshot = transport.getSnapshot()
    transport.setMuted(false)
    expect(transport.getSnapshot()).toBe(snapshot)
  })

  it('handles empty and zero-duration recordings without scheduling work', async () => {
    const { transport, createAudioContext } = setup()
    transport.pause()
    transport.seek(1)
    await transport.play()
    expect(transport.getSnapshot().state).toBe('empty')
    transport.load({ id: 'empty', duration: 0, music: recipe })
    await transport.play()
    expect(transport.getSnapshot()).toMatchObject({ state: 'ended', time: 0 })
    expect(createAudioContext).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('publishes synthesis failures and cleans a failed source start', async () => {
    const { transport, audio } = setup({ maxSamples: 1 })
    transport.load({ id: 'too-long', duration: 2, music: recipe })
    expect(() => transport.prepareMusic()).toThrow('sample limit')
    await transport.play()
    expect(transport.getSnapshot().state).toBe('paused')
    expect(audio.sources).toHaveLength(0)
    const other = setup()
    const source = new FakeSource()
    source.start.mockImplementation(() => { throw new Error('start failed') })
    other.audio.createBufferSource.mockReturnValueOnce(source)
    other.transport.load({ id: 'clip', duration: 2, music: recipe })
    await other.transport.play()
    expect(other.transport.getSnapshot()).toMatchObject({ state: 'paused', error: 'start failed' })
    expect(source.stop).toHaveBeenCalledOnce()
    expect(source.disconnect).toHaveBeenCalledOnce()
  })

  it('does not acquire resources after reentrant disposal or schedule after a listener pauses', async () => {
    const disposed = setup()
    disposed.transport.load({ id: 'clip', duration: 2, music: recipe })
    disposed.transport.subscribe(() => {
      if (disposed.transport.getSnapshot().state === 'starting') void disposed.transport.dispose()
    })
    await disposed.transport.play()
    expect(disposed.createAudioContext).not.toHaveBeenCalled()
    const paused = setup()
    paused.transport.load({ id: 'silent', duration: 2, music: null })
    paused.transport.subscribe(() => {
      if (paused.transport.getSnapshot().state === 'playing') paused.transport.pause()
    })
    await paused.transport.play()
    expect(paused.transport.getSnapshot().state).toBe('paused')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not restart a newer load when a seek notification replaces the recording', async () => {
    const { transport } = setup()
    transport.load({ id: 'old', duration: 2, music: null })
    await transport.play()
    transport.subscribe(() => {
      if (transport.getSnapshot().id === 'old' && transport.getSnapshot().state === 'paused') {
        transport.load({ id: 'new', duration: 3, music: null })
      }
    })
    transport.seek(1)
    expect(transport.getSnapshot()).toMatchObject({ id: 'new', state: 'paused', time: 0 })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps a single HUD timer when a playback notification triggers a seek', async () => {
    const { transport } = setup()
    transport.load({ id: 'clip', duration: 2, music: null })
    let sought = false
    transport.subscribe(() => {
      if (!sought && transport.getSnapshot().state === 'playing') {
        sought = true
        transport.seek(0.2)
      }
    })
    await transport.play()
    expect(transport.getTime()).toBe(0.2)
    expect(vi.getTimerCount()).toBe(1)
    transport.pause()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels a pending resume on hidden visibility', async () => {
    const { transport, audio, visibility } = setup()
    const pending = deferred()
    audio.resume.mockImplementationOnce(() => pending.promise)
    transport.load({ id: 'clip', duration: 2, music: recipe })
    const playing = transport.play()
    visibility.hidden = true
    visibility.dispatchEvent(new Event('visibilitychange'))
    audio.state = 'running'
    pending.resolve()
    await playing
    expect(transport.getSnapshot().state).toBe('paused')
    expect(audio.sources).toHaveLength(0)
  })

  it('uses native browser boundaries when no test dependencies are supplied', async () => {
    const audio = new FakeAudio()
    const visibility = new Visibility()
    vi.stubGlobal('AudioContext', function AudioContextBoundary() { return audio })
    vi.stubGlobal('document', visibility)
    const transport = new PlaybackTransport(settings)
    transports.push(transport)
    transport.load({ id: 'native', duration: 2, music: recipe })
    await transport.play()
    expect(audio.resume).toHaveBeenCalledOnce()
    transport.load({ id: 'silent', duration: 1, music: null })
    await transport.play()
    vi.advanceTimersByTime(250)
    expect(transport.getTime()).toBeCloseTo(0.25)
    vi.stubGlobal('AudioContext', undefined)
    const unavailable = new PlaybackTransport(settings)
    transports.push(unavailable)
    unavailable.load({ id: 'unsupported', duration: 1, music: recipe })
    await unavailable.play()
    expect(unavailable.getSnapshot().error).toContain('Web Audio')
  })

  it('cleans seek-start failures and logs stop failures without skipping disconnect', async () => {
    const { transport, audio } = setup()
    transport.load({ id: 'clip', duration: 2, music: recipe })
    await transport.play()
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    audio.sources[0]!.stop.mockImplementation(() => { throw new Error('already stopped') })
    const source = new FakeSource()
    source.start.mockImplementation(() => { throw 'seek failed' })
    audio.createBufferSource.mockReturnValueOnce(source)
    transport.seek(0.5)
    expect(log).toHaveBeenCalledOnce()
    expect(audio.sources[0]!.disconnect).toHaveBeenCalledOnce()
    expect(source.disconnect).toHaveBeenCalledOnce()
    expect(transport.getSnapshot()).toMatchObject({ state: 'paused', time: 0.5, error: 'seek failed' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('regenerates recipes on replacement and reports failed context construction', async () => {
    const { transport } = setup({ createAudioContext: () => { throw new Error('device unavailable') } })
    transport.load({ id: 'one', duration: 2, music: recipe })
    const original = transport.prepareMusic()
    transport.load({ id: 'two', duration: 2, music: { ...recipe, seed: 1 } })
    expect(transport.prepareMusic()).not.toBe(original)
    expect(transport.prepareMusic()!.samples).not.toEqual(original!.samples)
    await transport.play()
    expect(transport.getSnapshot()).toMatchObject({ state: 'paused', error: 'device unavailable' })
  })

  it.each(PLAYBACK_RATES)('coordinates audio and renderer at %sx using buffer-content duration', async (rate) => {
    const { transport, audio, wall } = setup()
    transport.load({ id: 'short-recording', duration: 1, music: recipe })
    transport.setRate(rate)
    await transport.play()
    const source = audio.sources[0]!
    expect(source.playbackRate.setValueAtTime).toHaveBeenCalledWith(rate, 0)
    expect(source.playbackRate.setValueAtTime.mock.invocationCallOrder[0]).toBeLessThan(source.start.mock.invocationCallOrder[0]!)
    expect(source.start).toHaveBeenCalledWith(0, 0, 1)
    audio.currentTime = 0.25
    wall.time = 100
    expect(transport.getTime()).toBe(0.25 * rate)
    expect(transport.getSnapshot()).toMatchObject({ state: 'playing', time: 0, duration: 1, rate })
    audio.currentTime = 1 / rate
    source.onended!()
    expect(transport.getSnapshot()).toMatchObject({ state: 'ended', time: 1, rate })
    expect(vi.getTimerCount()).toBe(0)
    expect(source.disconnect).toHaveBeenCalledOnce()
  })

  it('anchors logical time when replay rate changes during audio playback', async () => {
    const { transport, audio, wall } = setup()
    transport.load({ id: 'clip', duration: 2, music: recipe })
    const pcm = transport.prepareMusic()
    await transport.play()
    const oldSource = audio.sources[0]!
    const oldEnded = oldSource.onended!
    audio.currentTime = 0.5
    wall.time = 40
    transport.setRate(2)
    expect(transport.getTime()).toBe(0.5)
    expect(oldSource.stop).toHaveBeenCalledOnce()
    expect(oldSource.disconnect).toHaveBeenCalledOnce()
    const fastSource = audio.sources[1]!
    expect(fastSource.start).toHaveBeenCalledWith(0, 0.5, 1.5)
    expect(fastSource.playbackRate.setValueAtTime).toHaveBeenCalledWith(2, 0.5)
    expect(transport.prepareMusic()).toBe(pcm)
    expect(audio.createBuffer).toHaveBeenCalledOnce()
    oldEnded()
    expect(transport.getSnapshot().state).toBe('playing')
    audio.currentTime = 0.75
    expect(transport.getTime()).toBe(1)
    transport.setRate(0.5)
    expect(transport.getTime()).toBe(1)
    expect(fastSource.stop).toHaveBeenCalledOnce()
    expect(audio.sources[2]!.start).toHaveBeenCalledWith(0, 1, 1)
    expect(audio.sources[2]!.playbackRate.setValueAtTime).toHaveBeenCalledWith(0.5, 0.75)
    audio.currentTime = 1.25
    expect(transport.getTime()).toBe(1.25)
    expect(vi.getTimerCount()).toBe(1)
  })

  it('preserves replay rate through pause, seek, restart, replacement, and explicit silent playback', async () => {
    const { transport, audio, wall } = setup()
    expect(transport.getSnapshot().rate).toBe(1)
    transport.setRate(1.5)
    expect(transport.getSnapshot()).toMatchObject({ state: 'empty', rate: 1.5 })
    transport.load({ id: 'one', duration: 2, music: recipe })
    await transport.play()
    audio.currentTime = 0.2
    transport.pause()
    expect(transport.getTime()).toBeCloseTo(0.3)
    transport.setRate(0.5)
    audio.currentTime = 10
    expect(transport.getTime()).toBeCloseTo(0.3)
    expect(transport.getSnapshot()).toMatchObject({ state: 'paused', rate: 0.5 })
    transport.seek(0.6)
    await transport.play()
    expect(audio.sources[1]!.playbackRate.setValueAtTime).toHaveBeenCalledWith(0.5, 10)
    audio.currentTime = 10.2
    expect(transport.getTime()).toBeCloseTo(0.7)
    transport.seek(1)
    expect(audio.sources[2]!.start).toHaveBeenCalledWith(0, 1, 1)
    expect(audio.sources[2]!.playbackRate.setValueAtTime).toHaveBeenCalledWith(0.5, 10.2)
    transport.seek(3)
    transport.setRate(2)
    expect(transport.getSnapshot()).toMatchObject({ state: 'ended', time: 2, rate: 2 })
    expect(vi.getTimerCount()).toBe(0)
    await transport.restart()
    expect(transport.getTime()).toBe(0)
    expect(audio.sources.at(-1)!.playbackRate.setValueAtTime).toHaveBeenCalledWith(2, 10.2)
    transport.load({ id: 'two', duration: 1, music: null })
    expect(transport.getSnapshot()).toMatchObject({ state: 'paused', time: 0, rate: 2 })
    await transport.play()
    wall.time = 0.2
    expect(transport.getTime()).toBe(0.4)
  })

  it('uses the chosen rate for silent clock deltas and the final wall-time deadline', async () => {
    const { transport, wall, createAudioContext } = setup()
    transport.load({ id: 'silent', duration: 0.08, music: null })
    await transport.play()
    wall.time = 0.02
    transport.setRate(2)
    expect(transport.getTime()).toBe(0.02)
    wall.time = 0.05
    vi.advanceTimersByTime(29)
    expect(transport.getSnapshot().state).toBe('playing')
    vi.advanceTimersByTime(1)
    expect(transport.getSnapshot()).toMatchObject({ state: 'ended', time: 0.08, rate: 2 })
    expect(vi.getTimerCount()).toBe(0)
    expect(createAudioContext).not.toHaveBeenCalled()
  })

  it('retains selected speed after unavailable audio and explicit silent opt-in', async () => {
    const { transport, wall } = setup({ createAudioContext: () => null })
    transport.load({ id: 'clip', duration: 2, music: recipe })
    transport.setRate(2)
    await transport.play()
    expect(transport.getSnapshot()).toMatchObject({ state: 'paused', rate: 2 })
    expect(transport.getSnapshot().error).toContain('Web Audio')
    wall.time = 1
    expect(transport.getTime()).toBe(0)
    transport.load({ id: 'clip', duration: 2, music: null })
    await transport.play()
    wall.time = 1.25
    expect(transport.getTime()).toBe(0.5)
    expect(transport.getSnapshot().error).toBeNull()
  })

  it('cancels pending resume on a changed rate without allowing its late completion to start audio', async () => {
    const { transport, audio } = setup()
    const pending = deferred()
    audio.resume.mockImplementationOnce(() => pending.promise)
    transport.load({ id: 'clip', duration: 2, music: recipe })
    transport.seek(0.5)
    const oldPlay = transport.play()
    transport.setRate(1.5)
    const paused = transport.getSnapshot()
    expect(paused).toMatchObject({ state: 'paused', time: 0.5, rate: 1.5 })
    audio.state = 'running'
    pending.resolve()
    await oldPlay
    expect(transport.getSnapshot()).toBe(paused)
    expect(audio.sources).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
    await transport.play()
    expect(audio.sources[0]!.playbackRate.setValueAtTime).toHaveBeenCalledWith(1.5, 0)
  })

  it('keeps no-op rates inert and rejects unsupported rates without touching active playback', async () => {
    const { transport, audio } = setup()
    transport.load({ id: 'clip', duration: 2, music: recipe })
    const pending = deferred()
    audio.resume.mockImplementationOnce(() => pending.promise)
    const play = transport.play()
    const starting = transport.getSnapshot()
    transport.setRate(1)
    expect(transport.getSnapshot()).toBe(starting)
    audio.state = 'running'
    pending.resolve()
    await play
    const playing = transport.getSnapshot()
    transport.setRate(1)
    for (const rate of [0, -1, 0.75, 3, Infinity, -Infinity, NaN]) {
      expect(() => { transport.setRate(rate) }).toThrow('Playback rate must be 0.5, 1, 1.5, or 2.')
    }
    expect(transport.getSnapshot()).toBe(playing)
    expect(audio.sources).toHaveLength(1)
    expect(audio.sources[0]!.stop).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(1)
  })

  it('contains reentrant rate changes without duplicate timers or obsolete sources', async () => {
    const { transport, audio } = setup()
    transport.load({ id: 'clip', duration: 2, music: recipe })
    transport.subscribe(() => {
      if (transport.getSnapshot().state === 'playing' && transport.getSnapshot().rate === 1) transport.setRate(2)
    })
    await transport.play()
    expect(transport.getSnapshot()).toMatchObject({ state: 'playing', rate: 2, time: 0 })
    expect(audio.sources).toHaveLength(2)
    expect(audio.sources[0]!.stop).toHaveBeenCalledOnce()
    expect(audio.sources[1]!.playbackRate.setValueAtTime).toHaveBeenCalledWith(2, 0)
    expect(vi.getTimerCount()).toBe(1)
    transport.subscribe(() => {
      if (transport.getSnapshot().rate === 0.5) void transport.dispose()
    })
    transport.setRate(0.5)
    expect(transport.getSnapshot().state).toBe('disposed')
    expect(audio.sources).toHaveLength(2)
    expect(audio.sources[1]!.stop).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
    const disposed = transport.getSnapshot()
    transport.setRate(2)
    expect(transport.getSnapshot()).toBe(disposed)
  })

  it('keeps an accelerated silent tail when music ends before the recording', async () => {
    const { transport, audio } = setup()
    transport.load({ id: 'long', duration: 3, music: recipe })
    transport.setRate(2)
    await transport.play()
    expect(audio.sources[0]!.start).toHaveBeenCalledWith(0, 0, 2)
    audio.currentTime = 1
    audio.sources[0]!.onended!()
    expect(transport.getTime()).toBe(2)
    transport.setRate(0.5)
    expect(audio.sources).toHaveLength(1)
    audio.currentTime = 3
    vi.advanceTimersByTime(50)
    expect(transport.getSnapshot()).toMatchObject({ state: 'ended', time: 3, rate: 0.5 })
  })

  it('cleans a source whose playback-rate parameter fails to initialize', async () => {
    const { transport, audio } = setup()
    transport.load({ id: 'clip', duration: 2, music: recipe })
    await transport.play()
    const source = new FakeSource()
    source.playbackRate.setValueAtTime.mockImplementation(() => { throw new Error('Audio rate initialization failed.') })
    audio.createBufferSource.mockReturnValueOnce(source)
    audio.currentTime = 0.5
    transport.setRate(1.5)
    expect(transport.getSnapshot()).toMatchObject({ state: 'paused', time: 0.5, rate: 1.5, error: 'Audio rate initialization failed.' })
    expect(source.stop).toHaveBeenCalledOnce()
    expect(source.disconnect).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects invalid configuration and invalid numeric controls without replacing a recording', () => {
    for (const hudIntervalMs of [0, -1, 1.5, Infinity, 0x80000000]) {
      expect(() => validatePlaybackOptions({ ...settings, hudIntervalMs })).toThrow('hudIntervalMs')
    }
    const { transport } = setup()
    transport.load({ id: 'valid', duration: 1, music: null })
    const snapshot = transport.getSnapshot()
    expect(() => { transport.load({ id: 'invalid', duration: NaN, music: null }) }).toThrow('duration')
    expect(() => { transport.seek(Infinity) }).toThrow('seek')
    expect(() => { transport.setVolume(NaN) }).toThrow('volume')
    expect(transport.getSnapshot()).toBe(snapshot)
  })
})
