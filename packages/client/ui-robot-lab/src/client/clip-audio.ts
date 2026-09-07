/** One HTML audio clock for an authored preview; cleanup revokes late play completions. */

/** Timing comes from the selected dance; duration edits scale the audio with the motion. */
export interface ClipAudioOptions {
  time: number
  duration: number
  audioDuration: number
  /** Source seconds per motion second, resolved identically for preview and export. */
  rate: number
  /** Loop a short excerpt within a longer motion, independently of motion looping. */
  repeat: boolean
  speed: number
  loop: boolean
  volume: number
  muted: boolean
  onFailure: () => void
}

/**
 * Start a selected rhythm from the shared playhead and expose its clock to the renderer.
 * @param audio - Component-owned media element with the selected embedded recording.
 * @param options - Authored timing, live controls, and a localized failure callback.
 * @returns The motion-time reader and synchronous silence/listener cleanup.
 */
export function startClipAudio(audio: HTMLAudioElement, options: ClipAudioOptions): { time: () => number; dispose: () => void } {
  const ratio = options.rate
  let previous = options.repeat ? options.time * ratio % options.audioDuration : options.time * ratio
  let elapsed = options.time
  let active = true
  const fail = () => {
    if (!active) return
    active = false
    audio.pause()
    audio.removeEventListener('error', fail)
    options.onFailure()
  }
  audio.addEventListener('error', fail)
  try {
    audio.currentTime = previous
    audio.playbackRate = options.speed * ratio
    audio.preservesPitch = false
    audio.loop = options.repeat || options.loop
    audio.volume = options.volume
    audio.muted = options.muted
    void audio.play().catch(fail)
  } catch { fail() }
  return {
    time: () => {
      if (!options.repeat) return audio.ended ? options.duration : Math.min(options.duration, audio.currentTime / ratio)
      const current = audio.currentTime
      const delta = current - previous
      elapsed += (delta < 0 ? delta + options.audioDuration : delta) / ratio
      previous = current
      if (options.loop && elapsed >= options.duration) {
        elapsed %= options.duration
        previous = elapsed * ratio % options.audioDuration
        audio.currentTime = previous
      }
      return Math.min(options.duration, elapsed)
    },
    dispose: () => {
      active = false
      audio.removeEventListener('error', fail)
      audio.pause()
    },
  }
}
