/** One capture operation retains matching silent and soundtrack-bearing MP4 variants. */
import { ClipVideoError, recordClipVideo } from './clip-video.ts'
import type { ClipVideoOptions, ClipVideoResult } from './clip-video.ts'
import { readyCaptureSurface } from './clip-capture-surface.ts'
import type { ClipSoundtrack } from './clip-soundtrack.ts'

/** Media stays local to the recording owner; preview mute and speed do not affect exported audio. */
export interface ClipMovieOptions extends Omit<ClipVideoOptions, 'audioTracks' | 'onStarted'> {
  /** Embedded base64 soundtrack selected with the draft, not microphone or speaker capture. */
  music: ClipSoundtrack | null
  onStarted: (clock?: () => number) => void
}

function prepare<T>(promise: Promise<T>, options: ClipMovieOptions): Promise<T> {
  return new Promise((resolve, reject) => {
    const finish = (error: Error | null, value?: T) => {
      clearTimeout(timer)
      options.signal.removeEventListener('abort', aborted)
      if (error !== null) reject(error)
      else resolve(value as T)
    }
    const aborted = () => { finish(new ClipVideoError('aborted', options.signal.reason)) }
    const timer = setTimeout(() => { finish(new ClipVideoError('timeout')) }, options.finalizeTimeoutMs)
    options.signal.addEventListener('abort', aborted, { once: true })
    void promise.then((value) => { finish(null, value) }, (error: unknown) => {
      finish(error instanceof Error ? error : new ClipVideoError('exportAudio', error))
    })
    if (options.signal.aborted) aborted()
  })
}

/**
 * Capture one reviewed cycle and, when music exists, both downloadable audio choices.
 * Audio seconds from zero drive onStarted's clock after both recorders start; no soundtrack uses
 * the caller's wall clock. The frozen rate controls tempo and pitch without speaker output;
 * repeating excerpts fill the authored duration while original rhythms play one retimed cycle.
 * Preparation deadlines, resizing, cancellation and encoder failure reject with ClipVideoError;
 * no partial variant is returned. Owned tracks, listeners and audio nodes settle before rejection.
 * @param input - Frozen soundtrack, authored duration, size-locked canvas and capture settings.
 * @returns The silent MP4 plus an optional audio MP4 after both recorders and the audio graph settle.
 */
export async function recordClipMovie(input: ClipMovieOptions): Promise<ClipVideoResult & { audio?: ClipVideoResult }> {
  const peer = new AbortController()
  const options = { ...input, signal: AbortSignal.any([input.signal, peer.signal]) }
  let context: AudioContext | undefined
  const sound: { source?: AudioBufferSourceNode; started: boolean } = { started: false }
  let destination: MediaStreamAudioDestinationNode | undefined
  let observer: MutationObserver | undefined
  const interrupted = () => {
    if (context?.state !== 'running') peer.abort(new ClipVideoError('exportAudio', new Error('Audio clock interrupted')))
  }
  try {
    await readyCaptureSurface(options.canvas, options.signal, options.finalizeTimeoutMs)
    const { width, height } = options.canvas
    observer = new MutationObserver(() => {
      if (options.canvas.width !== width || options.canvas.height !== height) {
        peer.abort(new ClipVideoError('capture', new Error('Canvas dimensions changed during recording')))
      }
    })
    observer.observe(options.canvas, { attributes: true, attributeFilter: ['width', 'height'] })
    if (options.music === null) return await recordClipVideo(options)
    if (typeof AudioContext === 'undefined') throw new ClipVideoError('exportAudio')
    const audioContext = context = new AudioContext()
    const bytes = Uint8Array.from(atob(options.music.src.split(',')[1] as string), character => character.charCodeAt(0))
    const buffer = await prepare(audioContext.decodeAudioData(bytes.buffer), options)
    await prepare(audioContext.resume(), options)
    if (audioContext.state !== 'running') throw new ClipVideoError('exportAudio')
    audioContext.addEventListener('statechange', interrupted)
    destination = audioContext.createMediaStreamDestination()
    const playback = sound.source = audioContext.createBufferSource()
    playback.buffer = buffer
    playback.playbackRate.value = options.music.rate
    playback.loop = options.music.repeat
    playback.loopStart = 0
    playback.loopEnd = options.music.duration
    playback.connect(destination)
    let ready = 0
    const started = () => {
      if (++ready !== 2 || options.signal.aborted) return
      const at = audioContext.currentTime
      playback.start(at); sound.started = true
      options.onStarted(() => audioContext.currentTime - at)
    }
    const capture = (audioTracks?: readonly MediaStreamTrack[]) => recordClipVideo({ ...options,
      ...(audioTracks === undefined ? {} : { audioTracks }), onStarted: started,
    }).catch((error: unknown) => { peer.abort(error); throw error })
    const results = await Promise.allSettled([capture(), capture(destination.stream.getAudioTracks())])
    const silent = results[0], audio = results[1]
    if (silent.status === 'rejected' || audio.status === 'rejected') throw peer.signal.reason
    return { ...silent.value, audio: audio.value }
  } catch (cause) {
    if (peer.signal.reason instanceof ClipVideoError) throw peer.signal.reason
    throw cause instanceof ClipVideoError ? cause : new ClipVideoError('exportAudio', cause)
  } finally {
    observer?.disconnect()
    context?.removeEventListener('statechange', interrupted)
    if (sound.started) sound.source?.stop()
    sound.source?.disconnect()
    destination?.disconnect()
    for (const track of destination?.stream.getTracks() ?? []) track.stop()
    await context?.close()
  }
}
