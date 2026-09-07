/** Parse user-authored reference motion without executing expressions. */
import type { RobotClip } from '@deepseek-ai/dsh-robot-lab/types'

/**
 * Validate the JSON authoring boundary before offering training.
 * @param text - editable clip JSON, or empty for a catalog behavior.
 * @returns the validated clip and a user-facing error when invalid.
 */
export function parseClipDraft(text: string): { clip: RobotClip | null; error: string | null } {
  if (text.trim() === '') return { clip: null, error: null }
  try {
    const value: unknown = JSON.parse(text)
    if (typeof value !== 'object' || value === null) throw new Error('Motion clip must be a JSON object.')
    const clip = value as Record<string, unknown>
    if (clip.version !== 1 || typeof clip.name !== 'string' || typeof clip.loop !== 'boolean'
      || typeof clip.duration !== 'number' || !Number.isFinite(clip.duration) || clip.duration <= 0
      || !Array.isArray(clip.keys) || clip.keys.length < 2) throw new Error('Requires version 1, a name, a positive duration, a loop flag, and at least two keyframes.')
    let previous = -1
    const keys: RobotClip['keys'] = []
    for (const item of clip.keys as unknown[]) {
      if (typeof item !== 'object' || item === null) throw new Error('Keyframe must be an object.')
      const key = item as Record<string, unknown>
      if (['rootYaw', 'rootPosition', 'rootRoll'].some(field => Object.hasOwn(key, field)) || typeof key.t !== 'number' || !Number.isFinite(key.t) || key.t <= previous || key.t > clip.duration
        || (keys.length === 0 && key.t !== 0)
        || typeof key.rootPitch !== 'number' || !Number.isFinite(key.rootPitch)
        || !Array.isArray(key.joints) || key.joints.length !== 14
        || !key.joints.every((joint: unknown) => typeof joint === 'number' && Number.isFinite(joint))) {
        throw new Error('Keyframes must start at 0 seconds and increase strictly, with 14 finite joint angles and rootPitch.')
      }
      previous = key.t
      keys.push({ t: key.t, rootPitch: key.rootPitch, joints: key.joints as number[] })
    }
    return { clip: { version: 1, name: clip.name, duration: clip.duration, loop: clip.loop, keys }, error: null }
  } catch (error) {
    return { clip: null, error: error instanceof Error ? error.message : String(error) }
  }
}
