/** Session-owned playback time and transient Web Audio resources; React consumes only framework-bound snapshots. */
import type { RobotMusicRecipe } from '@deepseek-ai/dsh-robot-lab/types'
import { generateMusic, validateMusicOptions } from './music.ts'
import type { MusicOptions, MusicPcm } from './music.ts'

/** Supported replay multipliers; they change audio pitch/tempo, not recipe BPM or training. */
export const PLAYBACK_RATES = Object.freeze([0.5, 1, 1.5, 2] as const)

/** A supported per-session replay multiplier. */
export type PlaybackRate = typeof PLAYBACK_RATES[number]

/** Plain HUD state; high-frequency renderer code reads getTime instead of subscribing per frame. */
export interface PlaybackSnapshot {
  id: string | null
  mode: 'silent' | 'music'
  time: number
  duration: number
  rate: PlaybackRate
  state: 'empty' | 'paused' | 'starting' | 'playing' | 'ended' | 'disposed'
  volume: number
  muted: boolean
  error: string | null
}

/** Loaded recording duration is authoritative; music never loops or extends an incomplete recording. */
export interface PlaybackLoad {
  id: string
  duration: number
  music: RobotMusicRecipe | null
}

/** Explicit apply-time settings; optional dependencies substitute only browser resource boundaries. */
export interface PlaybackTransportOptions extends MusicOptions {
  hudIntervalMs: number
  createAudioContext?: () => AudioContext | null
  /** Monotonic seconds, used only when playback has no AudioContext master clock. */
  now?: () => number
  visibility?: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'> | null
}

/**
 * Validate playback settings before plugin registration.
 * @param options - explicit synthesis limits and HUD notification interval.
 * @returns immutable settings; rejects invalid intervals rather than coercing browser timers.
 */
export function validatePlaybackOptions(options: PlaybackTransportOptions): Readonly<PlaybackTransportOptions> {
  validateMusicOptions(options)
  if (!Number.isSafeInteger(options.hudIntervalMs) || options.hudIntervalMs < 1 || options.hudIntervalMs > 0x7fffffff) {
    throw new Error('Playback hudIntervalMs must be a positive browser timer interval')
  }
  return Object.freeze({ ...options })
}

/** One clock for a session's renderer and audio; no load-time autoplay or React dependency. */
export class PlaybackTransport {
  #options: Readonly<PlaybackTransportOptions>
  #snapshot: PlaybackSnapshot = {
    id: null, mode: 'silent', time: 0, duration: 0, rate: 1, state: 'empty', volume: 0.7, muted: false, error: null,
  }
  #listeners = new Set<() => void>()
  #recipe: RobotMusicRecipe | null = null
  #pcm: MusicPcm | null = null
  #context: AudioContext | null = null
  #gain: GainNode | null = null
  #buffer: AudioBuffer | null = null
  #source: AudioBufferSourceNode | null = null
  #timer: ReturnType<typeof setTimeout> | null = null
  #revision = 0
  #offset = 0
  #startedAt = 0
  #audioClock = false
  #disposePromise: Promise<void> | null = null
  #visibility: PlaybackTransportOptions['visibility']

  /** @param options - validated at construction; caller must also validate Config at apply. */
  constructor(options: PlaybackTransportOptions) {
    this.#options = validatePlaybackOptions(options)
    this.#visibility = options.visibility === undefined ? (typeof document === 'undefined' ? null : document) : options.visibility
    this.#visibility?.addEventListener('visibilitychange', this.#onVisibility)
  }

  /**
   * Read the committed HUD state without subscribing or advancing playback.
   * @returns the same plain snapshot reference until a playback fact changes.
   */
  getSnapshot = (): PlaybackSnapshot => this.#snapshot

  /**
   * Register a framework notification listener; subscriber failures do not interrupt resource cleanup.
   * @param listener - framework callback, not a component-managed subscription.
   * @returns an idempotent listener disposer.
   */
  subscribe = (listener: () => void): (() => void) => {
    if (this.#disposed()) return () => {}
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  /**
   * Replace the loaded recording while stopped, retaining rate/volume/mute; invalid durations leave playback untouched.
   * @param load - stable recording id, actual recorded duration, and optional persisted recipe.
   */
  load(load: PlaybackLoad): void {
    if (this.#disposed()) return
    if (!Number.isFinite(load.duration) || load.duration < 0) throw new Error('Playback duration must be finite and nonnegative')
    this.#revision++
    this.#stopResources()
    this.#recipe = load.music === null ? null : { ...load.music }
    this.#pcm = null
    this.#buffer = null
    this.#offset = 0
    this.#audioClock = false
    this.#publish({ id: load.id, mode: load.music ? 'music' : 'silent', time: 0, duration: load.duration, state: 'paused', error: null })
  }

  /**
   * Generate at most one transient waveform for the loaded recipe without opening AudioContext.
   * @returns cached PCM or null for silent/disposed playback; allocation errors are published and rethrown.
   */
  prepareMusic(): MusicPcm | null {
    if (this.#disposed() || this.#recipe === null) return null
    if (this.#pcm !== null) return this.#pcm
    try { this.#pcm = generateMusic(this.#recipe, this.#options) }
    catch (error) {
      this.#publish({ error: errorMessage(error) })
      throw error
    }
    return this.#pcm
  }

  /**
   * Start at the selected replay rate from the offset; invoke directly from a user gesture to resume audio.
   * Missing AudioContext and resume failures remain paused with an error; silent playback requires loading music:null.
   * @returns after starting or publishing a failure; superseded and disposed completions are ignored.
   */
  async play(): Promise<void> {
    if (this.#disposed() || this.#snapshot.id === null || this.#snapshot.state === 'playing' || this.#snapshot.state === 'starting') return
    if (this.#visibility?.hidden) return
    if (this.#offset >= this.#snapshot.duration) { this.#finish(); return }
    const revision = ++this.#revision
    this.#publish({ state: 'starting', error: null })
    if (!this.#current(revision)) return
    try {
      if (this.#recipe !== null) {
        if (this.#context === null) {
          this.#context = this.#options.createAudioContext ? this.#options.createAudioContext() : nativeAudioContext()
        }
        if (this.#context === null) throw new Error('Web Audio is unavailable. Choose Play without music or download the generated WAV.')
        // resume is called before awaiting, preserving the originating browser user activation.
        await this.#context.resume()
        if (!this.#current(revision)) return
        if (this.#context.state !== 'running') throw new Error('Audio could not start. Retry Play or choose Play without music.')
        this.#audioClock = true
        const pcm = this.prepareMusic()
        if (pcm !== null) this.#ensureBuffer(this.#context, pcm)
      } else this.#audioClock = false
      if (!this.#current(revision)) return
      this.#start()
    } catch (error) {
      if (!this.#current(revision)) return
      this.#stopResources()
      this.#publish({ state: 'paused', error: errorMessage(error) })
    }
  }

  /** Pause both audio and renderer time, preserving the current offset and cancelling a pending resume. */
  pause(): void {
    if (this.#disposed() || this.#snapshot.id === null) return
    this.#offset = this.getTime()
    this.#revision++
    this.#stopResources()
    this.#publish({ time: this.#offset, state: this.#offset >= this.#snapshot.duration ? 'ended' : 'paused' })
  }

  /**
   * Clamp to recorded time and replace any active audio source; seeking during resume cancels that play request.
   * @param seconds - finite target time in seconds.
   */
  seek(seconds: number): void {
    if (this.#disposed() || this.#snapshot.id === null) return
    if (!Number.isFinite(seconds)) throw new Error('Playback seek time must be finite')
    this.#reposition(seconds, this.#snapshot.rate)
  }

  /**
   * Change replay speed without changing logical time; replaces active audio and cancels a pending resume into paused state.
   * Rate persists across loads and restarts. PCM and recipe BPM stay unchanged; audio pitch/tempo may change.
   * @param rate - one of PLAYBACK_RATES; unsupported or nonfinite values throw without changing playback.
   */
  setRate(rate: number): void {
    if (this.#disposed()) return
    if (!PLAYBACK_RATES.includes(rate as PlaybackRate)) throw new Error('Playback rate must be 0.5, 1, 1.5, or 2.')
    if (rate === this.#snapshot.rate) return
    if (this.#snapshot.id === null) { this.#publish({ rate: rate as PlaybackRate }); return }
    this.#reposition(this.getTime(), rate as PlaybackRate)
  }

  /**
   * Restart the loaded recording from zero at the selected replay rate.
   * @returns after seeking to zero and handling the same user-gesture audio rules as play.
   */
  async restart(): Promise<void> {
    this.pause()
    this.seek(0)
    await this.play()
  }

  /**
   * Update the session volume and active output gain without changing playback time.
   * @param volume - finite volume, clamped to the gain range [0, 1]; mute retains this value.
   */
  setVolume(volume: number): void {
    if (this.#disposed()) return
    if (!Number.isFinite(volume)) throw new Error('Playback volume must be finite')
    this.#publish({ volume: Math.max(0, Math.min(1, volume)) })
    this.#updateGain()
  }

  /**
   * Silence or restore output without changing the retained session volume.
   * @param muted - whether output gain is zero; playback time continues while muted.
   */
  setMuted(muted: boolean): void {
    if (this.#disposed()) return
    this.#publish({ muted })
    this.#updateGain()
  }

  /**
   * Read logical recording time from the shared clock at the selected replay rate.
   * @returns current shared renderer/audio time, clamped to the actual recording duration.
   */
  getTime = (): number => this.#snapshot.state === 'playing'
    ? Math.min(this.#snapshot.duration, this.#offset + Math.max(0, this.#clock() - this.#startedAt) * this.#snapshot.rate)
    : this.#offset

  /**
   * Silence resources and detach all listeners synchronously, then await closing the owned AudioContext.
   * @returns the shared teardown promise; close failures reject, and all late callbacks remain inert.
   */
  dispose(): Promise<void> {
    if (this.#disposePromise) return this.#disposePromise
    this.#offset = this.getTime()
    this.#revision++
    this.#listeners.clear()
    this.#snapshot = { ...this.#snapshot, state: 'disposed', time: this.#offset }
    this.#visibility?.removeEventListener('visibilitychange', this.#onVisibility)
    this.#stopResources()
    this.#gain?.disconnect()
    this.#gain = null
    this.#buffer = null
    this.#pcm = null
    this.#recipe = null
    const context = this.#context
    this.#context = null
    this.#disposePromise = context === null ? Promise.resolve() : context.close()
    return this.#disposePromise
  }

  #disposed(): boolean { return this.#snapshot.state === 'disposed' }
  #current(revision: number): boolean { return !this.#disposed() && revision === this.#revision }
  #clock(): number { return this.#audioClock && this.#context ? this.#context.currentTime : (this.#options.now ?? monotonicSeconds)() }
  #onVisibility = (): void => { if (this.#visibility?.hidden) this.pause() }

  #reposition(seconds: number, rate: PlaybackRate): void {
    const wasPlaying = this.#snapshot.state === 'playing'
    const revision = ++this.#revision
    this.#stopResources()
    this.#offset = Math.max(0, Math.min(this.#snapshot.duration, seconds))
    this.#publish({ time: this.#offset, rate, state: this.#offset >= this.#snapshot.duration ? 'ended' : 'paused' })
    if (this.#current(revision) && wasPlaying && this.#offset < this.#snapshot.duration) {
      try { this.#start() }
      catch (error) {
        this.#stopResources()
        this.#publish({ state: 'paused', error: errorMessage(error) })
      }
    }
  }

  #ensureBuffer(context: AudioContext, pcm: MusicPcm): void {
    if (this.#gain === null) {
      this.#gain = context.createGain()
      this.#gain.connect(context.destination)
    }
    this.#updateGain()
    if (this.#buffer === null) {
      const buffer = context.createBuffer(1, pcm.samples.length, pcm.sampleRate)
      buffer.copyToChannel(pcm.samples, 0)
      this.#buffer = buffer
    }
  }

  #updateGain(): void {
    if (this.#gain && this.#context) {
      this.#gain.gain.setValueAtTime(this.#snapshot.muted ? 0 : this.#snapshot.volume, this.#context.currentTime)
    }
  }

  #start(): void {
    this.#startedAt = this.#clock()
    if (this.#audioClock && this.#context && this.#buffer && this.#gain && this.#offset < this.#buffer.duration) {
      const source = this.#context.createBufferSource()
      this.#source = source
      source.buffer = this.#buffer
      source.playbackRate.setValueAtTime(this.#snapshot.rate, this.#context.currentTime)
      source.connect(this.#gain)
      const revision = this.#revision
      source.onended = () => {
        if (!this.#current(revision) || this.#source !== source) return
        source.disconnect()
        this.#source = null
        if (this.getTime() >= this.#snapshot.duration) this.#finish()
      }
      // Web Audio start duration is buffer-content seconds, independent of playbackRate.
      source.start(0, this.#offset, Math.min(this.#snapshot.duration - this.#offset, this.#buffer.duration - this.#offset))
    }
    this.#publish({ state: 'playing', time: this.#offset })
    this.#schedule()
  }

  #schedule(): void {
    if (this.#disposed() || this.#snapshot.state !== 'playing' || this.#timer !== null) return
    const remaining = this.#snapshot.duration - this.getTime()
    const revision = this.#revision
    this.#timer = setTimeout(() => {
      if (!this.#current(revision)) return
      this.#timer = null
      if (this.#snapshot.state !== 'playing') return
      const time = this.getTime()
      if (time >= this.#snapshot.duration) { this.#finish(); return }
      this.#publish({ time })
      this.#schedule()
    }, Math.min(this.#options.hudIntervalMs, Math.max(1, remaining * 1000 / this.#snapshot.rate)))
  }

  #finish(): void {
    if (this.#disposed()) return
    this.#revision++
    this.#offset = this.#snapshot.duration
    this.#stopResources()
    this.#publish({ time: this.#offset, state: 'ended' })
  }

  #stopResources(): void {
    if (this.#timer !== null) clearTimeout(this.#timer)
    this.#timer = null
    const source = this.#source
    this.#source = null
    if (source) {
      source.onended = null
      try { source.stop() }
      catch (error) { console.error('Robot playback source stop failed', error) }
      source.disconnect()
    }
  }

  #publish(change: Partial<PlaybackSnapshot>): void {
    if (this.#disposed()) return
    const next = { ...this.#snapshot, ...change }
    if (Object.keys(change).every(key => next[key as keyof PlaybackSnapshot] === this.#snapshot[key as keyof PlaybackSnapshot])) return
    this.#snapshot = next
    for (const listener of this.#listeners) {
      try { listener() }
      catch (error) { console.error('Robot playback subscriber failed', error) }
    }
  }
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }
function monotonicSeconds(): number { return performance.now() / 1000 }
function nativeAudioContext(): AudioContext | null { return typeof AudioContext === 'undefined' ? null : new AudioContext() }
