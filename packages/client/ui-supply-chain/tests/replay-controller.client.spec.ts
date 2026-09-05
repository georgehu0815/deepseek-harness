/**
 * Replay controller behavior: the plugin body owns playback so it survives the
 * panel unmounting, which is exactly what these tests pin — the timer, the
 * terminal stop at the final day, and the globe redraw on every state move.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SimulationRun } from '@deepseek-ai/dsh-supply-chain/types'
import { createReplayController } from '../src/client/replayController.ts'

/**
 * A run whose only property under test is its day count.
 * @param days - simulated horizon.
 * @returns the stand-in run.
 */
function runOf(days: number): SimulationRun {
  return { network: { days } } as unknown as SimulationRun
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('replay controller', () => {
  it('starts empty and draws nothing', () => {
    const draw = vi.fn()
    const replay = createReplayController(draw)
    expect(replay.getSnapshot()).toEqual({ run: null, day: 0, position: 0, playing: false, busy: false, error: null })
    expect(draw).not.toHaveBeenCalled()
  })

  it('keeps one snapshot reference while the state is unchanged', () => {
    const replay = createReplayController(vi.fn())
    expect(replay.getSnapshot()).toBe(replay.getSnapshot())
  })

  it('shows a new run from its first day and draws it', () => {
    const draw = vi.fn()
    const replay = createReplayController(draw)
    const run = runOf(10)
    replay.setRun(run)
    expect(replay.getSnapshot()).toMatchObject({ run, day: 0, playing: false, busy: false, error: null })
    expect(draw).toHaveBeenCalledWith(run, 0)
  })

  it('notifies subscribers and stops after unsubscribing', () => {
    const replay = createReplayController(vi.fn())
    const listener = vi.fn()
    const unsubscribe = replay.subscribe(listener)
    replay.setRun(runOf(5))
    expect(listener).toHaveBeenCalledOnce()
    unsubscribe()
    replay.setDay(2)
    expect(listener).toHaveBeenCalledOnce()
  })

  it('advances one day per frame while playing', () => {
    const draw = vi.fn()
    const replay = createReplayController(draw)
    replay.setRun(runOf(10))
    replay.togglePlay()
    expect(replay.getSnapshot().playing).toBe(true)
    // Three frames per day, so nine frames is three whole days.
    vi.advanceTimersByTime(40 * 9)
    expect(replay.getSnapshot().day).toBe(3)
    expect(draw).toHaveBeenLastCalledWith(expect.anything(), 3)
  })

  it('stops at the final day instead of looping', () => {
    const replay = createReplayController(vi.fn())
    replay.setRun(runOf(4))
    replay.togglePlay()
    vi.advanceTimersByTime(40 * 200)
    expect(replay.getSnapshot().day).toBe(3)
    expect(replay.getSnapshot().playing).toBe(false)
  })

  it('replays from the start when play is pressed at the end', () => {
    const replay = createReplayController(vi.fn())
    replay.setRun(runOf(4))
    replay.setDay(3)
    replay.togglePlay()
    expect(replay.getSnapshot()).toMatchObject({ day: 0, playing: true })
  })

  it('pauses on a second toggle and holds the day', () => {
    const replay = createReplayController(vi.fn())
    replay.setRun(runOf(50))
    replay.togglePlay()
    vi.advanceTimersByTime(40 * 6)
    const held = replay.getSnapshot().position
    replay.togglePlay()
    vi.advanceTimersByTime(40 * 30)
    expect(replay.getSnapshot()).toMatchObject({ position: held, playing: false })
    expect(held).toBeCloseTo(2)
  })

  it('ignores play with no run loaded', () => {
    const replay = createReplayController(vi.fn())
    replay.togglePlay()
    expect(replay.getSnapshot().playing).toBe(false)
  })

  it('clamps a scrub into the run and stops playback', () => {
    const draw = vi.fn()
    const replay = createReplayController(draw)
    replay.setRun(runOf(6))
    replay.togglePlay()
    replay.setDay(99)
    expect(replay.getSnapshot()).toMatchObject({ day: 5, playing: false })
    replay.setDay(-4)
    expect(replay.getSnapshot().day).toBe(0)
    // A stopped scrub must not keep advancing.
    vi.advanceTimersByTime(40 * 15)
    expect(replay.getSnapshot().day).toBe(0)
    expect(draw).toHaveBeenLastCalledWith(expect.anything(), 0)
  })

  it('marks a run in flight, clearing the previous failure', () => {
    const replay = createReplayController(vi.fn())
    replay.setError('boom')
    replay.setBusy()
    expect(replay.getSnapshot()).toMatchObject({ busy: true, error: null, playing: false })
  })

  it('records a failure and ends the in-flight state', () => {
    const replay = createReplayController(vi.fn())
    replay.setBusy()
    replay.setError('no provider')
    expect(replay.getSnapshot()).toMatchObject({ busy: false, error: 'no provider', playing: false })
  })

  it('stops playing when the panel plugin is disposed', () => {
    const draw = vi.fn()
    const replay = createReplayController(draw)
    replay.setRun(runOf(50))
    replay.togglePlay()
    replay.dispose()
    draw.mockClear()
    vi.advanceTimersByTime(40 * 30)
    expect(draw).not.toHaveBeenCalled()
  })
})
