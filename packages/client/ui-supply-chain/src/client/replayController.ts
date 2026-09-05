/**
 * The replay controller: the run being viewed, the day on screen, and whether
 * playback is advancing.
 *
 * This lives in the plugin body rather than the panel because the center-column
 * tab unmounts whenever the user switches to Chat, and a replay must keep
 * advancing — and keep redrawing the globe, which stays visible in its own
 * column — until it finishes. Component state and effect timers cannot survive
 * that unmount, so the panel reads this source through the injected `hooks`
 * compartment and holds no replay state of its own.
 */
import type { SimulationRun } from '@deepseek-ai/dsh-supply-chain/types'

/** What the panel renders for the current replay. */
export interface ReplayState {
  /** The run being viewed, or null before the first successful simulation. */
  readonly run: SimulationRun | null
  /** Zero-based day on screen, as reported by the panel and its charts. */
  readonly day: number
  /** Continuous replay position; the fractional part animates goods in transit. */
  readonly position: number
  /** Whether playback is advancing. */
  readonly playing: boolean
  /** Whether a simulation is in flight. */
  readonly busy: boolean
  /** The last failure, or null. */
  readonly error: string | null
}

/** Milliseconds between replay frames. */
const FRAME_MS = 40

/**
 * Frames per simulated day. Nodes and lanes only change on a day boundary, but
 * goods in transit are drawn at the fractional position, so stepping within a
 * day is what turns their jumps into motion.
 */
const FRAMES_PER_DAY = 3

/** The replay source plus the commands that drive it. */
export interface ReplayController {
  getSnapshot(): ReplayState
  subscribe(fn: () => void): () => void
  /** Show a completed run from its first day, stopping any playback. */
  setRun(run: SimulationRun): void
  /** Jump to one day, stopping playback so a scrub is not fought by the timer. */
  setDay(day: number): void
  /** Start or stop playback; starting from the final day restarts at day 0. */
  togglePlay(): void
  /** Mark a simulation in flight, clearing the previous failure. */
  setBusy(): void
  /** Record a failure and end the in-flight state. */
  setError(message: string): void
  /** Stop playback and release the timer. */
  dispose(): void
}

/**
 * Create the replay controller.
 * @param onDay - called with the run and day whenever either changes, to redraw the globe.
 * @returns the controller.
 */
export function createReplayController(
  onDay: (run: SimulationRun, day: number) => void,
): ReplayController {
  // One snapshot object per distinct state: the render binding compares by
  // reference, so it must not be rebuilt while the facts are unchanged.
  let state: ReplayState = { run: null, day: 0, position: 0, playing: false, busy: false, error: null }
  const listeners = new Set<() => void>()
  let timer: ReturnType<typeof setInterval> | null = null

  const publish = (next: ReplayState): void => {
    state = next
    for (const listener of listeners) listener()
  }

  const draw = (): void => {
    if (state.run !== null) onDay(state.run, state.position)
  }

  /** Publish a position, keeping `day` its whole part. */
  const goTo = (position: number, rest: Partial<ReplayState> = {}): void => {
    const clamped = Math.max(0, Math.min(position, lastDay()))
    publish({ ...state, ...rest, position: clamped, day: Math.floor(clamped) })
    draw()
  }

  const stop = (): void => {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }

  const lastDay = (): number => (state.run === null ? 0 : state.run.network.days - 1)

  const tick = (): void => {
    // Playback ends at the final day rather than looping: "until it is fully
    // finished" is the whole point of surviving the unmount.
    if (state.position >= lastDay()) {
      stop()
      publish({ ...state, playing: false })
      return
    }
    goTo(state.position + 1 / FRAMES_PER_DAY)
  }

  return {
    getSnapshot: () => state,
    subscribe: (fn) => {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
    setRun: (run) => {
      stop()
      publish({ run, day: 0, position: 0, playing: false, busy: false, error: null })
      draw()
    },
    setDay: (day) => {
      stop()
      goTo(day, { playing: false })
    },
    togglePlay: () => {
      if (state.playing) {
        stop()
        publish({ ...state, playing: false })
        return
      }
      if (state.run === null) return
      goTo(state.position >= lastDay() ? 0 : state.position, { playing: true })
      timer = setInterval(tick, FRAME_MS)
    },
    setBusy: () => {
      stop()
      publish({ ...state, playing: false, busy: true, error: null })
    },
    setError: (message) => {
      publish({ ...state, busy: false, playing: false, error: message })
    },
    dispose: () => {
      stop()
      listeners.clear()
    },
  }
}
