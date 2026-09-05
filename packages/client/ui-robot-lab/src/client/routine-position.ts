/** Derive choreography position from the recording's frozen beat grid. */
import type { RobotProjectBlock } from '@deepseek-ai/dsh-robot-lab/types'

/** Position within a target timeline; completing it is not a learned-skill verdict. */
export interface RoutinePosition {
  index: number
  label: string
  firstBeat: number
  lastBeat: number
  localBeat: number
  fraction: number
}

/**
 * Locate a sampled recording time within its saved motion blocks.
 * @param blocks - immutable effective blocks in execution order.
 * @param bpm - saved target tempo, independent of replay rate.
 * @param time - the shared transport's logical recording time in seconds.
 * @returns the containing block, clamped to the final block after the timeline, or null for no blocks.
 */
export function routinePosition(blocks: readonly RobotProjectBlock[], bpm: number, time: number): RoutinePosition | null {
  const beat = Math.max(0, time * bpm / 60)
  let start = 0
  for (const [index, block] of blocks.entries()) {
    const end = start + block.beats
    if (beat < end || index === blocks.length - 1) {
      return { index, label: block.template.label, firstBeat: start + 1, lastBeat: end,
        localBeat: Math.min(block.beats, beat - start), fraction: Math.min(1, (beat - start) / block.beats) }
    }
    start = end
  }
  return null
}
