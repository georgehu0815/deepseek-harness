/** Recorded-frame selection uses simulation timestamps, independently of policy frequency. */
import type { RobotFrame } from '@deepseek-ai/dsh-robot-lab/types'

/**
 * Select the last observed pose at the playback time, holding the endpoint poses.
 * @param frames - recording frames in increasing simulation-time order.
 * @param elapsedSeconds - local playback clock, reset when the recording changes.
 * @returns the recorded frame, or undefined for an empty recording.
 */
export function playbackFrame(frames: readonly RobotFrame[], elapsedSeconds: number): RobotFrame | undefined {
  const first = frames[0]
  if (first === undefined) return undefined
  const time = elapsedSeconds
  let low = 0
  let high = frames.length - 1
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    const frame = frames[middle]
    if (frame === undefined) throw new Error('Recording contains a missing frame')
    if (frame.time <= time) low = middle
    else high = middle - 1
  }
  return frames[low]
}
