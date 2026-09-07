/** Browser encoder events and time are controlled; no codecs, host resources or real waits are shared. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClipVideoError, recordClipVideo } from '../src/client/clip-video.ts'

function box(type: string, payload = new Uint8Array(), extended = false): Uint8Array<ArrayBuffer> {
  const header = extended ? 16 : 8
  const bytes = new Uint8Array(header + payload.length)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, extended ? 1 : bytes.length)
  bytes.set(new TextEncoder().encode(type), 4)
  if (extended) view.setBigUint64(8, BigInt(bytes.length))
  bytes.set(payload, header)
  return bytes
}

function mp4(): Blob {
  return new Blob([box('ftyp', new Uint8Array([105, 115, 111, 109])), box('moov'), box('mdat', new Uint8Array([1, 2, 3]))],
    { type: 'video/mp4;codecs=avc1.42001e' })
}

function harness() {
  const controls = { supported: ['video/mp4;codecs=avc1.42001E'], constructorError: false,
    startError: false, stopError: false, captureError: false, videoTracks: true }
  const track = { readyState: 'live', stop: vi.fn() }
  const stream = { getTracks: () => [track], getVideoTracks: () => controls.videoTracks ? [track] : [] }
  const recorders: Recorder[] = []
  class Recorder extends EventTarget {
    static isTypeSupported = vi.fn((mime: string) => controls.supported.includes(mime))
    state: RecordingState = 'inactive'
    mimeType: string
    override addEventListener = vi.fn(super.addEventListener.bind(this))
    override removeEventListener = vi.fn(super.removeEventListener.bind(this))
    start = vi.fn(() => {
      if (controls.startError) throw new Error('Encoder start failed')
      this.state = 'recording'
    })
    stop = vi.fn(() => {
      if (controls.stopError) throw new Error('Encoder stop failed')
      this.state = 'inactive'
    })
    constructor(readonly stream: MediaStream, readonly options: MediaRecorderOptions) {
      super()
      if (controls.constructorError) throw new Error('Encoder allocation failed')
      this.mimeType = options.mimeType!
      recorders.push(this)
    }
    emit(type: string, data?: Blob) {
      if (type === 'stop') this.state = 'inactive'
      const event = new Event(type)
      if (data) Object.defineProperty(event, 'data', { value: data })
      this.dispatchEvent(event)
    }
  }
  vi.stubGlobal('MediaRecorder', Recorder)
  const canvas = { width: 640, height: 360, captureStream: vi.fn(() => {
    if (controls.captureError) throw new Error('Canvas is tainted')
    return stream
  }) }
  const controller = new AbortController()
  const options = { canvas: canvas as unknown as HTMLCanvasElement, durationMs: 1000, frameRate: 30,
    videoBitsPerSecond: 4_000_000, finalizeTimeoutMs: 100, signal: controller.signal, onStarted: vi.fn() }
  const begin = () => {
    const result = recordClipVideo(options)
    return { result, recorder: recorders[0]! }
  }
  return { controls, track, stream, canvas, controller, options, begin, recorders, Recorder }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function failure(result: Promise<unknown>, code: ClipVideoError['code']) {
  return expect(result).rejects.toMatchObject({ name: 'ClipVideoError', code })
}

function detached(recorder: ReturnType<typeof harness>['recorders'][number]) {
  expect(recorder.removeEventListener.mock.calls).toEqual(recorder.addEventListener.mock.calls)
  expect(vi.getTimerCount()).toBe(0)
}

describe('Clip Gen MP4 recording', () => {
  it.each([true, false])('requires an actual audio handler when audio tracks are supplied: %s', async (hasAudio) => {
    const h = harness()
    h.controls.supported = ['video/mp4;codecs=avc1.42001E,mp4a.40.2']
    const clone = { kind: 'audio', readyState: 'live', stop: vi.fn() }
    const source = { kind: 'audio', readyState: 'live', stop: vi.fn(), clone: vi.fn(() => clone) }
    const addTrack = vi.fn()
    Object.assign(h.stream, { addTrack, getTracks: () => [h.track, clone] })
    const result = recordClipVideo({ ...h.options, audioTracks: [source as unknown as MediaStreamTrack] })
    const assertion = hasAudio ? expect(result).resolves.toHaveProperty('blob') : failure(result, 'format')
    const recorder = h.recorders[0]!
    recorder.emit('start')
    vi.advanceTimersByTime(1000)
    const handler = new Uint8Array(20)
    handler.set(new TextEncoder().encode(hasAudio ? 'soun' : 'vide'), 8)
    recorder.emit('dataavailable', new Blob([box('ftyp'), box('moov', box('trak', box('mdia', box('hdlr', handler)))),
      box('mdat', new Uint8Array([1]))], { type: 'video/mp4' }))
    recorder.emit('stop')
    await assertion
    expect(addTrack).toHaveBeenCalledWith(clone)
    expect(source.stop).not.toHaveBeenCalled()
    expect(clone.stop).toHaveBeenCalledOnce()
    expect(h.track.stop).toHaveBeenCalledOnce()
    detached(recorder)
  })

  it('rejects ended soundtrack tracks and releases the acquired canvas stream', async () => {
    const h = harness(); h.controls.supported = ['video/mp4']
    await failure(recordClipVideo({ ...h.options,
      audioTracks: [{ kind: 'audio', readyState: 'ended' } as MediaStreamTrack] }), 'capture')
    expect(h.track.stop).toHaveBeenCalledOnce()
    expect(h.recorders).toHaveLength(0)
  })

  it('starts playback only when ready, records the authored duration and retains the actual MIME', async () => {
    const h = harness()
    const { result, recorder } = h.begin()
    expect(h.canvas.captureStream).toHaveBeenCalledWith(30)
    expect(recorder.options).toEqual({ mimeType: 'video/mp4;codecs=avc1.42001E', videoBitsPerSecond: 4_000_000 })
    expect(h.options.onStarted).not.toHaveBeenCalled()
    vi.advanceTimersByTime(50)
    recorder.emit('start')
    expect(h.options.onStarted).toHaveBeenCalledOnce()
    recorder.emit('start')
    expect(h.options.onStarted).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(999)
    expect(recorder.stop).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(recorder.stop).toHaveBeenCalledOnce()
    expect(h.track.stop).not.toHaveBeenCalled()
    recorder.mimeType = 'video/mp4;codecs=avc1.42001e'
    recorder.emit('dataavailable', new Blob())
    recorder.emit('dataavailable', mp4())
    recorder.emit('stop')
    const exported = await result
    expect(exported.mimeType).toBe(recorder.mimeType)
    expect(exported.blob.type).toBe(recorder.mimeType)
    expect(await exported.blob.arrayBuffer()).toEqual(await mp4().arrayBuffer())
    expect(h.track.stop).toHaveBeenCalledOnce()
    detached(recorder)
    recorder.emit('error')
    recorder.emit('start')
    h.controller.abort()
    expect(h.options.onStarted).toHaveBeenCalledOnce()
    expect(recorder.stop).toHaveBeenCalledOnce()
  })

  it.each(['video/mp4;codecs=avc1', 'video/mp4'])('negotiates the supported MP4 alternative %s', async (mime) => {
    const h = harness()
    h.controls.supported = [mime]
    const { result, recorder } = h.begin()
    recorder.emit('start')
    vi.advanceTimersByTime(1000)
    recorder.emit('dataavailable', mp4())
    recorder.emit('stop')
    expect((await result).mimeType).toBe(mime)
  })

  it.each(['absent', 'missing-probe', 'webm-only', 'no-capture'] as const)('reports unsupported %s without capturing', async (mode) => {
    const h = harness()
    if (mode === 'absent') vi.stubGlobal('MediaRecorder', undefined)
    if (mode === 'missing-probe') vi.stubGlobal('MediaRecorder', function RecorderWithoutProbe() {
      throw new Error('A recorder without a support probe must not be allocated')
    })
    if (mode === 'webm-only') h.controls.supported = ['video/webm']
    if (mode === 'no-capture') Object.defineProperty(h.canvas, 'captureStream', { value: undefined })
    await failure(recordClipVideo(h.options), 'unavailable')
    expect(h.recorders).toHaveLength(0)
    expect(h.track.stop).not.toHaveBeenCalled()
  })

  it('does not acquire resources for an already cancelled generation', async () => {
    const h = harness()
    h.controller.abort('replaced')
    await failure(recordClipVideo(h.options), 'aborted')
    expect(h.canvas.captureStream).not.toHaveBeenCalled()
  })

  it('releases capture if acquisition synchronously cancels the generation', async () => {
    const h = harness()
    h.canvas.captureStream.mockImplementation(() => {
      h.controller.abort('replacement')
      return h.stream
    })
    await failure(recordClipVideo(h.options), 'aborted')
    expect(h.track.stop).toHaveBeenCalledOnce()
    expect(h.recorders[0]!.start).not.toHaveBeenCalled()
    detached(h.recorders[0]!)
  })

  it.each(['width', 'height'] as const)('rejects an empty canvas %s', async (dimension) => {
    const h = harness()
    h.canvas[dimension] = 0
    await failure(recordClipVideo(h.options), 'capture')
    expect(h.canvas.captureStream).not.toHaveBeenCalled()
  })

  it('preserves the browser capture failure as a cause', async () => {
    const h = harness()
    h.controls.captureError = true
    await expect(recordClipVideo(h.options)).rejects.toMatchObject({ code: 'capture', cause: new Error('Canvas is tainted') })
  })

  it.each(['missing', 'ended'] as const)('stops acquired tracks when the video track is %s', async (mode) => {
    const h = harness()
    if (mode === 'missing') h.controls.videoTracks = false
    else h.track.readyState = 'ended'
    await failure(recordClipVideo(h.options), 'capture')
    expect(h.track.stop).toHaveBeenCalledOnce()
  })

  it.each(['constructorError', 'startError'] as const)('releases capture after %s', async (flag) => {
    const h = harness()
    h.controls[flag] = true
    await failure(recordClipVideo(h.options), 'encode')
    expect(h.track.stop).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
    if (flag === 'startError') detached(h.recorders[0]!)
  })

  it.each(['starting', 'recording', 'stopping'] as const)('cancels %s and waits for recorder stop before acknowledging teardown', async (phase) => {
    const h = harness()
    const abortRemoved = vi.spyOn(h.controller.signal, 'removeEventListener')
    const { result, recorder } = h.begin()
    const rejected = failure(result, 'aborted')
    if (phase !== 'starting') recorder.emit('start')
    if (phase === 'stopping') vi.advanceTimersByTime(1000)
    h.controller.abort('unmount')
    expect(recorder.stop).toHaveBeenCalledOnce()
    expect(h.track.stop).not.toHaveBeenCalled()
    recorder.emit('start')
    recorder.emit('dataavailable', mp4())
    recorder.emit('stop')
    await rejected
    expect(h.options.onStarted).toHaveBeenCalledTimes(phase === 'starting' ? 0 : 1)
    expect(h.track.stop).toHaveBeenCalledOnce()
    expect(abortRemoved).toHaveBeenCalledWith('abort', expect.any(Function))
    detached(recorder)
  })

  it('bounds a cancelled recorder that never emits stop and ignores late callbacks', async () => {
    const h = harness()
    const { result, recorder } = h.begin()
    const rejected = failure(result, 'aborted')
    h.controller.abort()
    vi.advanceTimersByTime(100)
    await rejected
    expect(h.track.stop).toHaveBeenCalledOnce()
    detached(recorder)
    recorder.emit('start')
    recorder.emit('stop')
    recorder.emit('dataavailable', mp4())
    expect(h.options.onStarted).not.toHaveBeenCalled()
  })

  it.each(['startup', 'finalization'] as const)('bounds a missing %s event', async (phase) => {
    const h = harness()
    const { result, recorder } = h.begin()
    const rejected = failure(result, 'timeout')
    if (phase === 'finalization') {
      recorder.emit('start')
      vi.advanceTimersByTime(1000)
    } else vi.advanceTimersByTime(100)
    vi.advanceTimersByTime(100)
    await rejected
    expect(h.track.stop).toHaveBeenCalledOnce()
    detached(recorder)
  })

  it.each(['active', 'inactive'] as const)('waits for stop after a browser encoder error while %s', async (state) => {
    const h = harness()
    const { result, recorder } = h.begin()
    const rejected = failure(result, 'encode')
    recorder.emit('start')
    if (state === 'inactive') recorder.state = 'inactive'
    recorder.emit('error')
    expect(h.track.stop).not.toHaveBeenCalled()
    recorder.emit('stop')
    await rejected
    expect(h.track.stop).toHaveBeenCalledOnce()
    detached(recorder)
  })

  it('contains a playback callback exception and finalizes its recorder', async () => {
    const h = harness()
    h.options.onStarted.mockImplementation(() => { throw new Error('Playback unavailable') })
    const { result, recorder } = h.begin()
    const rejected = failure(result, 'capture')
    expect(() => { recorder.emit('start') }).not.toThrow()
    recorder.emit('stop')
    await rejected
    expect(h.track.stop).toHaveBeenCalledOnce()
    detached(recorder)
  })

  it('contains a synchronous stop exception and detaches callbacks', async () => {
    const h = harness()
    h.controls.stopError = true
    const { result, recorder } = h.begin()
    const rejected = failure(result, 'encode')
    recorder.emit('start')
    vi.advanceTimersByTime(1000)
    await rejected
    expect(h.track.stop).toHaveBeenCalledOnce()
    detached(recorder)
  })

  it('rejects a recorder stopping before the authored duration', async () => {
    const h = harness()
    const { result, recorder } = h.begin()
    const rejected = failure(result, 'encode')
    recorder.emit('start')
    recorder.emit('dataavailable', mp4())
    recorder.emit('stop')
    await rejected
    detached(recorder)
  })

  it.each(['chunk', 'recorder'] as const)('rejects a WebM %s MIME rather than renaming bytes', async (source) => {
    const h = harness()
    const { result, recorder } = h.begin()
    const rejected = failure(result, 'format')
    recorder.emit('start')
    if (source === 'chunk') recorder.emit('dataavailable', new Blob(['webm'], { type: 'video/webm' }))
    else {
      recorder.mimeType = 'video/webm'
      vi.advanceTimersByTime(1000)
      recorder.emit('dataavailable', mp4())
    }
    recorder.emit('stop')
    await rejected
    detached(recorder)
  })

  it.each([
    ['empty', new Blob(), 'empty'],
    ['webm bytes with MP4 MIME', new Blob(['\u001aEß£webm'], { type: 'video/mp4' }), 'format'],
    ['truncated header', new Blob(['abc']), 'format'],
    ['no movie metadata', new Blob([box('ftyp'), box('mdat', new Uint8Array([1]))]), 'format'],
    ['headers only', new Blob([box('ftyp'), box('moov'), box('mdat')]), 'empty'],
    ['truncated extended size', new Blob([box('ftyp'), new Uint8Array([0, 0, 0, 1, 109, 100, 97, 116])]), 'format'],
    ['undersized box', new Blob([new Uint8Array([0, 0, 0, 4, 102, 116, 121, 112])]), 'format'],
    ['oversized box', new Blob([new Uint8Array([0, 0, 1, 0, 102, 116, 121, 112])]), 'format'],
    ['unsafe extended size', new Blob([box('ftyp'), new Uint8Array([0, 0, 0, 1, 109, 100, 97, 116, 255, 255, 255, 255, 255, 255, 255, 255])]), 'format'],
  ] as const)('rejects %s', async (_label, blob, code) => {
    const h = harness()
    const { result, recorder } = h.begin()
    const rejected = failure(result, code)
    recorder.emit('start')
    vi.advanceTimersByTime(1000)
    recorder.emit('dataavailable', blob)
    recorder.emit('stop')
    await rejected
    expect(h.track.stop).toHaveBeenCalledOnce()
    detached(recorder)
  })

  it.each(['extended', 'to-end'] as const)('accepts valid %s MP4 boxes and untyped chunks', async (encoding) => {
    const h = harness()
    const { result, recorder } = h.begin()
    const payload = box('mdat', new Uint8Array([1]), encoding === 'extended')
    if (encoding === 'to-end') new DataView(payload.buffer).setUint32(0, 0)
    recorder.emit('start')
    vi.advanceTimersByTime(1000)
    const blob = new Blob([box('ftyp'), box('moov'), payload])
    recorder.emit('dataavailable', blob)
    recorder.emit('stop')
    expect((await result).blob.size).toBe(blob.size)
  })

  it('does not publish a superseded generation while validating container bytes', async () => {
    const h = harness()
    const { result, recorder } = h.begin()
    const rejected = failure(result, 'aborted')
    let release!: () => void
    const barrier = new Promise<void>((resolve) => { release = resolve })
    // eslint-disable-next-line @typescript-eslint/unbound-method -- The stub supplies the Blob receiver with call.
    const original = Blob.prototype.arrayBuffer
    const entered = vi.fn()
    vi.spyOn(Blob.prototype, 'arrayBuffer').mockImplementation(async function (this: Blob) {
      entered()
      await barrier
      return original.call(this)
    })
    recorder.emit('start')
    vi.advanceTimersByTime(1000)
    recorder.emit('dataavailable', mp4())
    recorder.emit('stop')
    await Promise.resolve()
    expect(entered).toHaveBeenCalledOnce()
    expect(h.track.stop).toHaveBeenCalledOnce()
    h.controller.abort('replacement')
    release()
    await rejected
    detached(recorder)
  })
})
