/** Additional authored ducks share the primary transport, not its editable timeline or a physics world. */
import type { AuthoredClip } from './clip-preview.ts'
import type { ClipSkinId } from './clip-skins.ts'
import { sampleAuthoredClip, type ClipPose } from './clip-motion.ts'

/** A validated preset retained independently of later primary-dance edits. */
export interface ClipDuckDance {
  id: string
  bpm: number
  modelSha256: string
  clip: AuthoredClip
}
/** Stable visible ordinal; null dance follows Duck 1, including its unkeyed preview pose. */
export interface ClipDuck { number: number; dance: ClipDuckDance | null }
/** One localized, controlled companion pose for the shared canvas. */
export interface ClipDuckPose {
  number: number
  label: string
  pose: ClipPose
  /** Independent visual finish; omitted companions retain the original model. */
  skinId?: ClipSkinId
}

/**
 * Sample a companion at the primary beat position; loop shorter dances and cut longer ones at export end.
 * @param duck - following or independently selected authored dance.
 * @param primary - current primary pose, including paused edits.
 * @param time - primary playhead in seconds; pause, seek and capture use the same value.
 * @param bpm - current primary tempo, including duration retiming.
 * @returns a pose only; no audio, model mutation or independent animation loop.
 */
export function sampleClipDuck(duck: ClipDuck, primary: ClipPose, time: number, bpm: number): ClipPose {
  if (duck.dance === null) return primary
  const { clip } = duck.dance
  const localTime = time * bpm / duck.dance.bpm
  return sampleAuthoredClip(clip, clip.loop ? localTime % clip.duration : Math.min(localTime, clip.duration))
}

/**
 * Place visible ducks in centered rows with model-sized separation, independent of their moving poses.
 * @param count - visible duck count, including the primary.
 * @param spacing - model-derived center spacing in rendered meters.
 * @returns rendered-world X/Z offsets, with Duck 1 first.
 */
export function clipDuckPositions(count: number, spacing: number): [number, number][] {
  const columns = Math.ceil(Math.sqrt(count))
  const rows = Math.ceil(count / columns)
  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / columns)
    const rowSize = Math.min(columns, count - row * columns)
    return [(index % columns - (rowSize - 1) / 2) * spacing, ((rows - 1) / 2 - row) * spacing]
  })
}
