/** Scoped canvas and optional audio capture; the caller owns playback, localization and download URLs. */

/** Stable failures localized by the Clip Gen consumer; browser exceptions remain in cause. */
export class ClipVideoError extends Error {
  constructor(readonly code: 'unavailable' | 'capture' | 'encode' | 'empty' | 'format' | 'timeout' | 'aborted' | 'exportAudio', cause?: unknown) {
    super(code, { cause })
    this.name = 'ClipVideoError'
  }
}

/** One live recording, with timing and quality supplied by its deployment. */
export interface ClipVideoOptions {
  canvas: HTMLCanvasElement
  /** Borrowed live audio tracks; capture owns and stops only its clones. */
  audioTracks?: readonly MediaStreamTrack[]
  durationMs: number
  frameRate: number
  videoBitsPerSecond: number
  /** Bounds both recorder startup and finalization after stop or cancellation. */
  finalizeTimeoutMs: number
  /** Abort on generation replacement or unmount; the returned promise acknowledges cleanup. */
  signal: AbortSignal
  /** Synchronously reset playback to zero and start rendering when recording becomes ready. */
  onStarted: () => void
}

/** MP4 bytes with the browser's actual MP4 MIME, including codec parameters when reported. */
export interface ClipVideoResult {
  blob: Blob
  mimeType: string
}

// These are container/codec identifiers, not deployment quality settings.
const MP4_TYPES = ['video/mp4;codecs=avc1.42001E', 'video/mp4;codecs=avc1', 'video/mp4']
const AUDIO_MP4_TYPES = ['video/mp4;codecs=avc1.42001E,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4']

function hasAudioHandler(bytes: Uint8Array, depth = 0): boolean {
  let offset = 0
  while (offset + 8 <= bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, bytes.length - offset)
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    let size = view.getUint32(0), header = 8
    if (size === 1) {
      if (view.byteLength < 16) return false
      size = Number(view.getBigUint64(8)); header = 16
    } else if (size === 0) size = view.byteLength
    if (!Number.isSafeInteger(size) || size < header || size > view.byteLength) return false
    const payload = bytes.subarray(offset + header, offset + size)
    if (depth === 2 && type === 'hdlr' && String.fromCharCode(...payload.subarray(8, 12)) === 'soun') return true
    if (type === (depth === 0 ? 'trak' : 'mdia') && depth < 2 && hasAudioHandler(payload, depth + 1)) return true
    offset += size
  }
  return false
}

function isMp4(mime: string): boolean {
  return (mime.split(';')[0] as string).trim().toLowerCase() === 'video/mp4'
}

function checkAbort(signal: AbortSignal): void {
  if (signal.aborted) throw new ClipVideoError('aborted', signal.reason)
}

/** Check container identity and media payload without copying or decoding the full recording. */
async function checkContainer(blob: Blob, signal: AbortSignal, audioRequired: boolean): Promise<void> {
  if (blob.size === 0) throw new ClipVideoError('empty')
  let offset = 0
  let movie = false
  let media = false
  let audio = false
  while (offset < blob.size) {
    checkAbort(signal)
    const bytes = new Uint8Array(await blob.slice(offset, offset + 16).arrayBuffer())
    checkAbort(signal)
    if (bytes.length < 8) throw new ClipVideoError('format')
    const view = new DataView(bytes.buffer)
    const type = String.fromCharCode(...bytes.subarray(4, 8))
    if (offset === 0 && type !== 'ftyp') throw new ClipVideoError('format')
    let size = view.getUint32(0)
    let header = 8
    if (size === 1) {
      if (bytes.length < 16) throw new ClipVideoError('format')
      size = Number(view.getBigUint64(8))
      header = 16
    } else if (size === 0) size = blob.size - offset
    if (!Number.isSafeInteger(size) || size < header || size > blob.size - offset) throw new ClipVideoError('format')
    movie ||= type === 'moov'
    if (audioRequired && type === 'moov') audio ||= hasAudioHandler(new Uint8Array(await blob.slice(offset + header, offset + size).arrayBuffer()))
    media ||= type === 'mdat' && size > header
    offset += size
  }
  if (!movie || (audioRequired && !audio)) throw new ClipVideoError('format')
  if (!media) throw new ClipVideoError('empty')
}

function capture(recorder: MediaRecorder, options: ClipVideoOptions): Promise<ClipVideoResult> {
  return new Promise((resolve, reject) => {
    let phase: 'starting' | 'recording' | 'stopping' | 'settled' = 'starting'
    let failure: ClipVideoError | undefined
    let timer: ReturnType<typeof setTimeout>
    const chunks: Blob[] = []

    const finish = (): void => {
      if (phase !== 'stopping') failure ??= new ClipVideoError('encode')
      phase = 'settled'
      clearTimeout(timer)
      recorder.removeEventListener('start', onStart)
      recorder.removeEventListener('dataavailable', onData)
      recorder.removeEventListener('error', onError)
      recorder.removeEventListener('stop', finish)
      options.signal.removeEventListener('abort', onAbort)
      if (failure) reject(failure)
      else if (!isMp4(recorder.mimeType)) reject(new ClipVideoError('format'))
      else resolve({ blob: new Blob(chunks, { type: recorder.mimeType }), mimeType: recorder.mimeType })
    }

    const stop = (error?: ClipVideoError): void => {
      failure ??= error
      if (phase === 'settled' || phase === 'stopping') return
      phase = 'stopping'
      clearTimeout(timer)
      timer = setTimeout(() => {
        failure ??= new ClipVideoError('timeout')
        finish()
      }, options.finalizeTimeoutMs)
      try {
        if (recorder.state !== 'inactive') recorder.stop()
      } catch (cause) {
        failure ??= new ClipVideoError('encode', cause)
        finish()
      }
    }

    const onAbort = (): void => { stop(new ClipVideoError('aborted', options.signal.reason)) }
    const onError = (event: Event): void => { stop(new ClipVideoError('encode', event)) }
    const onData = (event: BlobEvent): void => {
      if (event.data.size === 0) return
      if (event.data.type !== '' && !isMp4(event.data.type)) stop(new ClipVideoError('format'))
      else chunks.push(event.data)
    }
    const onStart = (): void => {
      if (phase !== 'starting') return
      clearTimeout(timer)
      phase = 'recording'
      timer = setTimeout(() => { stop() }, options.durationMs)
      try {
        options.onStarted()
      } catch (cause) {
        stop(new ClipVideoError('capture', cause))
      }
    }

    recorder.addEventListener('start', onStart)
    recorder.addEventListener('dataavailable', onData)
    recorder.addEventListener('error', onError)
    recorder.addEventListener('stop', finish)
    options.signal.addEventListener('abort', onAbort, { once: true })
    timer = setTimeout(() => { stop(new ClipVideoError('timeout')) }, options.finalizeTimeoutMs)
    try {
      checkAbort(options.signal)
      recorder.start()
    } catch (cause) {
      failure = cause instanceof ClipVideoError ? cause : new ClipVideoError('encode', cause)
      phase = 'stopping'
      finish()
    }
  })
}

/**
 * Record a live canvas for the authored wall-clock duration using an MP4-capable browser recorder.
 * The caller keeps the canvas rendering and the tab visible; this is not offline frame rendering
 * or microphone capture. Playback starts from zero in onStarted, not before this call.
 * No WebM fallback or format renaming is allowed. Container identity and nonempty media payload
 * are checked before returning; this is not a decoder-level guarantee of scene content.
 * @param options - canvas, recording settings, playback start callback and generation cancellation.
 * @returns MP4 Blob and actual MIME after recorder settlement and capture-track cleanup.
 * Rejects with ClipVideoError on unsupported capture, encoding failure, empty/invalid output,
 * startup/finalization timeout or cancellation. Cancellation waits for stop or its bounded deadline;
 * all listeners and timers are detached and owned tracks stopped before rejection.
 */
export async function recordClipVideo(options: ClipVideoOptions): Promise<ClipVideoResult> {
  checkAbort(options.signal)
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function'
    || typeof options.canvas.captureStream !== 'function') throw new ClipVideoError('unavailable')
  const audioRequired = (options.audioTracks?.length ?? 0) > 0
  const mimeType = (audioRequired ? AUDIO_MP4_TYPES : MP4_TYPES).find(type => MediaRecorder.isTypeSupported(type))
  if (!mimeType) throw new ClipVideoError('unavailable')
  if (options.canvas.width === 0 || options.canvas.height === 0) throw new ClipVideoError('capture')
  let stream: MediaStream
  try {
    stream = options.canvas.captureStream(options.frameRate)
  } catch (cause) {
    throw new ClipVideoError('capture', cause)
  }
  let result: ClipVideoResult
  try {
    if (!stream.getVideoTracks().some(track => track.readyState === 'live')) throw new ClipVideoError('capture')
    for (const track of options.audioTracks ?? []) {
      if (track.kind !== 'audio' || track.readyState !== 'live') throw new ClipVideoError('capture')
      stream.addTrack(track.clone())
    }
    let recorder: MediaRecorder
    try {
      recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: options.videoBitsPerSecond })
    } catch (cause) {
      throw new ClipVideoError('encode', cause)
    }
    result = await capture(recorder, options)
  } finally {
    for (const track of stream.getTracks()) track.stop()
  }
  await checkContainer(result.blob, options.signal, audioRequired)
  checkAbort(options.signal)
  return result
}
