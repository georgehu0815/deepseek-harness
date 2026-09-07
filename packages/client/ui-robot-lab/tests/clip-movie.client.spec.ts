import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { recordClipMovie } from '../src/client/clip-movie.ts'
import type { ClipMovieOptions } from '../src/client/clip-movie.ts'
import { ClipVideoError, recordClipVideo } from '../src/client/clip-video.ts'
import type { ClipVideoOptions, ClipVideoResult } from '../src/client/clip-video.ts'

vi.mock('../src/client/clip-video.ts', async original => ({
  ...await original<typeof import('../src/client/clip-video.ts')>(), recordClipVideo: vi.fn(),
}))
const contexts: Audio[] = []
const operations: Promise<unknown>[] = []
const controllers: AbortController[] = []
const observers: Observer[] = []
class Observer {
  observe = vi.fn()
  disconnect = vi.fn()
  constructor(readonly callback: () => void) { observers.push(this) }
}
const recordings: Array<{ options: ClipVideoOptions; resolve: (value: ClipVideoResult) => void }> = []
class Audio extends EventTarget {
  state = 'running'
  currentTime = 7
  track = { kind: 'audio', readyState: 'live', stop: vi.fn() }
  destination = { stream: { getAudioTracks: () => [this.track], getTracks: () => [this.track] }, disconnect: vi.fn() }
  source = { buffer: null, playbackRate: { value: 1 }, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() }
  decodeAudioData = vi.fn().mockResolvedValue({ duration: 30 })
  resume = vi.fn().mockResolvedValue(undefined)
  close = vi.fn().mockImplementation(async () => { this.state = 'closed' })
  createMediaStreamDestination = () => this.destination
  createBufferSource = () => this.source
  constructor() { super(); contexts.push(this) }
}
beforeEach(() => {
  vi.useFakeTimers()
  contexts.length = 0; recordings.length = 0; observers.length = 0
  vi.stubGlobal('AudioContext', Audio)
  vi.stubGlobal('MutationObserver', Observer)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => { callback(performance.now()) }, 16))
  vi.stubGlobal('cancelAnimationFrame', clearTimeout)
  vi.mocked(recordClipVideo).mockImplementation(options => new Promise((resolve, reject) => {
    const abort = () => { reject(new ClipVideoError('aborted')) }
    options.signal.addEventListener('abort', abort, { once: true })
    recordings.push({ options, resolve: (value) => { options.signal.removeEventListener('abort', abort); resolve(value) } })
    if (options.signal.aborted) abort()
  }))
})
afterEach(async () => {
  controllers.splice(0).forEach((controller) => { controller.abort() })
  await vi.runAllTimersAsync()
  await Promise.allSettled(operations.splice(0))
  vi.clearAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers()
})
function begin(music: ClipMovieOptions['music'] = { src: 'data:audio/ogg;base64,AQID', duration: 30, rate: 0.5, repeat: false }) {
  const controller = new AbortController(); controllers.push(controller)
  const canvas = { width: 640, height: 360, getBoundingClientRect: () => ({ width: 640, height: 360 }) }
  const options: ClipMovieOptions = { canvas: canvas as HTMLCanvasElement, durationMs: 60000, frameRate: 30,
    videoBitsPerSecond: 4000000, finalizeTimeoutMs: 100, signal: controller.signal, music, onStarted: vi.fn() }
  const promise = recordClipMovie(options)
  operations.push(promise)
  return { options, promise, controller }
}
const video = () => ({ blob: new Blob(['recorded video']), mimeType: 'video/mp4' })

describe('paired MP4 capture', () => {
  it('contains a non-Error decoder rejection and closes its owned context', async () => {
    class RejectedAudio extends Audio { override decodeAudioData = vi.fn().mockRejectedValue('codec unavailable') }
    vi.stubGlobal('AudioContext', RejectedAudio)
    const f = begin(); const assertion = expect(f.promise).rejects.toMatchObject({ code: 'exportAudio' })
    await vi.runAllTimersAsync(); await assertion
    expect(contexts[0]!.close).toHaveBeenCalledOnce()
  })

  it('observes an abort that occurs synchronously when decoding starts', async () => {
    class AbortingAudio extends Audio {
      override decodeAudioData = vi.fn().mockImplementation(async () => { controllers[0]!.abort(); return { duration: 30 } })
    }
    vi.stubGlobal('AudioContext', AbortingAudio)
    const f = begin(); const assertion = expect(f.promise).rejects.toMatchObject({ code: 'aborted' })
    await vi.runAllTimersAsync(); await assertion
    expect(recordings).toHaveLength(0)
  })

  it('ignores same-size mutations but cancels on a height-only change', async () => {
    const f = begin(); const assertion = expect(f.promise).rejects.toMatchObject({ code: 'capture' })
    await vi.advanceTimersByTimeAsync(32)
    observers[0]!.callback()
    expect(recordings[0]!.options.signal.aborted).toBe(false)
    f.options.canvas.height += 1
    observers[0]!.callback()
    await assertion
    expect(contexts[0]!.close).toHaveBeenCalledOnce()
  })

  it.each(['unsupported', 'decode', 'resume-state'] as const)('reports audio preparation failure: %s', async (mode) => {
    class FailingAudio extends Audio {
      constructor() {
        super()
        if (mode === 'decode') this.decodeAudioData.mockRejectedValue(new Error('Decoder failed'))
        if (mode === 'resume-state') this.state = 'suspended'
      }
    }
    vi.stubGlobal('AudioContext', mode === 'unsupported' ? undefined : FailingAudio)
    const f = begin(), assertion = expect(f.promise).rejects.toMatchObject({ code: 'exportAudio' })
    await vi.advanceTimersByTimeAsync(32)
    await assertion
    expect(recordings).toHaveLength(0)
    expect(observers[0]!.disconnect).toHaveBeenCalledOnce()
    if (mode !== 'unsupported') expect(contexts[0]!.close).toHaveBeenCalledOnce()
  })

  it('records video only without acquiring audio resources when there is no soundtrack', async () => {
    vi.stubGlobal('AudioContext', undefined)
    const f = begin(null)
    await vi.advanceTimersByTimeAsync(32)
    expect(contexts).toHaveLength(0)
    expect(recordings).toHaveLength(1)
    recordings[0]!.options.onStarted()
    const result = video(); recordings[0]!.resolve(result)
    expect(await f.promise).toBe(result)
    expect(f.options.onStarted).toHaveBeenCalledOnce()
  })

  it('starts one shared audio clock after both recorders are ready and retains both outputs', async () => {
    const f = begin()
    await vi.advanceTimersByTimeAsync(32)
    const context = contexts[0]!
    expect(recordings).toHaveLength(2)
    expect(recordings[0]!.options.audioTracks).toBeUndefined()
    expect(recordings[1]!.options.audioTracks).toEqual([context.track])
    expect(context.source.playbackRate.value).toBe(0.5)
    recordings[0]!.options.onStarted()
    expect(context.source.start).not.toHaveBeenCalled()
    recordings[1]!.options.onStarted()
    expect(context.source.start).toHaveBeenCalledExactlyOnceWith(7)
    expect(f.options.onStarted).toHaveBeenCalledOnce()
    const clock = vi.mocked(f.options.onStarted).mock.calls[0]![0]!
    context.currentTime = 9
    expect(clock()).toBe(2)
    const silent = video(), audio = video()
    recordings[0]!.resolve(silent); recordings[1]!.resolve(audio)
    expect(await f.promise).toEqual({ ...silent, audio })
    expect(context.source.stop).toHaveBeenCalledOnce()
    expect(context.source.disconnect).toHaveBeenCalledOnce()
    expect(context.track.stop).toHaveBeenCalledOnce()
    expect(context.close).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('exports the frozen repeating music rate instead of squeezing the excerpt into one cycle', async () => {
    const f = begin({ src: 'data:audio/ogg;base64,BAUG', duration: 16, rate: 1.2, repeat: true })
    await vi.advanceTimersByTimeAsync(32)
    const context = contexts[0]!
    expect(new Uint8Array(vi.mocked(context.decodeAudioData).mock.calls[0]![0])).toEqual(new Uint8Array([4, 5, 6]))
    expect(context.source).toMatchObject({ playbackRate: { value: 1.2 }, loop: true, loopStart: 0, loopEnd: 16 })
    recordings.forEach((recording) => { recording.options.onStarted(); recording.resolve(video()) })
    expect((await f.promise).audio).toBeDefined()
    expect(context.source.stop).toHaveBeenCalledOnce()
  })

  it('aborts the peer recorder and closes the graph when either encoder fails', async () => {
    vi.mocked(recordClipVideo).mockRejectedValueOnce(new ClipVideoError('encode'))
    const f = begin(); const assertion = expect(f.promise).rejects.toMatchObject({ code: 'encode' })
    await vi.advanceTimersByTimeAsync(32)
    await assertion
    expect(recordings[0]!.options.signal.aborted).toBe(true)
    expect(contexts[0]!.source.stop).not.toHaveBeenCalled()
    expect(contexts[0]!.track.stop).toHaveBeenCalledOnce()
    expect(contexts[0]!.close).toHaveBeenCalledOnce()
  })

  it('cancels both recording variants and releases their shared audio graph', async () => {
    const f = begin(); const assertion = expect(f.promise).rejects.toMatchObject({ code: 'aborted' })
    await vi.advanceTimersByTimeAsync(32)
    recordings.forEach((recording) => { recording.options.onStarted() })
    f.controller.abort()
    await assertion
    expect(recordings.every(recording => recording.options.signal.aborted)).toBe(true)
    expect(contexts[0]!.close).toHaveBeenCalledOnce()
  })

  it.each([true, false])('rejects a resized framebuffer instead of publishing a corrupt MP4: music %s', async (music) => {
    const f = music ? begin() : begin(null)
    const assertion = expect(f.promise).rejects.toMatchObject({ code: 'capture' })
    await vi.advanceTimersByTimeAsync(32)
    f.options.canvas.width += 1
    observers[0]!.callback()
    await assertion
    expect(recordings.every(recording => recording.options.signal.aborted)).toBe(true)
    expect(observers[0]!.disconnect).toHaveBeenCalledOnce()
    if (music) expect(contexts[0]!.close).toHaveBeenCalledOnce()
  })

  it('rejects interrupted audio instead of finishing a partly silent soundtrack', async () => {
    const f = begin(), assertion = expect(f.promise).rejects.toMatchObject({ code: 'exportAudio' })
    await vi.advanceTimersByTimeAsync(32)
    contexts[0]!.dispatchEvent(new Event('statechange'))
    expect(recordings[0]!.options.signal.aborted).toBe(false)
    contexts[0]!.state = 'suspended'
    contexts[0]!.dispatchEvent(new Event('statechange'))
    await assertion
    expect(contexts[0]!.close).toHaveBeenCalledOnce()
  })

  it('bounds suspended audio startup and never publishes a silent substitute', async () => {
    class SuspendedAudio extends Audio { override resume = vi.fn().mockReturnValue(new Promise(() => {})) }
    vi.stubGlobal('AudioContext', SuspendedAudio)
    const f = begin()
    const assertion = expect(f.promise).rejects.toMatchObject({ code: 'timeout' })
    await vi.advanceTimersByTimeAsync(132)
    await assertion
    expect(recordings).toHaveLength(0)
    expect(contexts[0]!.close).toHaveBeenCalledOnce()
  })

  it('ignores late decoding after cancellation without creating a source or recording', async () => {
    let resolve!: (value: { duration: number }) => void
    class SlowAudio extends Audio {
      override decodeAudioData = vi.fn().mockReturnValue(new Promise((accept) => { resolve = accept }))
    }
    vi.stubGlobal('AudioContext', SlowAudio)
    const f = begin(); const assertion = expect(f.promise).rejects.toMatchObject({ code: 'aborted' })
    await vi.advanceTimersByTimeAsync(32)
    f.controller.abort(); await assertion
    resolve({ duration: 30 }); await vi.advanceTimersByTimeAsync(32)
    expect(recordings).toHaveLength(0)
    expect(contexts[0]!.source.connect).not.toHaveBeenCalled()
    expect(contexts[0]!.close).toHaveBeenCalledOnce()
  })
})
