/** Browser-only heading animation, deliberately incompatible with version-one training clips. */
import type { RobotClip, RobotProfile } from '@deepseek-ai/dsh-robot-lab/types'
import { applyClipRig, defaultClipPose, validateAuthoredClip } from './clip-motion.ts'
import type { WalkingClip } from './clip-walking.ts'

/** Unwrapped heading spans one full turn in either direction, in radians about world +Z. */
export const rootYawLimit = Math.PI * 2

/** Version two adds required preview heading to every key; it is not a training reference. */
export interface PreviewClip extends Omit<RobotClip, 'version' | 'keys'> {
  version: 2
  keys: Array<RobotClip['keys'][number] & { rootYaw: number }>
}

/** The editor accepts unchanged training-reference clips and explicitly preview-only clips. */
export type AuthoredClip = RobotClip | PreviewClip | WalkingClip

/**
 * Author a forty-beat preview: four-beat intro, sixteen beats left, sixteen right, four-beat outro.
 * @param profile - Installed joint order, neutral pose and limits used by the coupled leg controls.
 * @param bpm - Positive tempo; the caller validates resulting duration against catalog limits.
 * @param name - Localized or user-authored display name.
 * @returns A looping preview with alternating leg gestures and unwrapped 0 → 2π → 0 heading.
 */
export function compileTurningPreview(profile: RobotProfile, bpm: number, name: string): PreviewClip {
  const beatSeconds = 60 / bpm
  const keys: PreviewClip['keys'] = []
  for (let halfBeat = 0; halfBeat <= 80; halfBeat += 1) {
    const beat = halfBeat / 2
    let pose = defaultClipPose(profile)
    const turning = beat > 4 && beat < 36 && beat !== 20
    if (turning) {
      const step = beat < 20 ? beat - 4 : beat - 20
      const peak = halfBeat % 2 === 1 ? 1 : 0
      pose = applyClipRig(profile, pose, 'squat', 0.02 + peak * 0.025)
      const left = Math.floor(step) % 2 === 0
      pose = applyClipRig(profile, pose, left ? 'swingL' : 'swingR', peak * 0.08)
      pose = applyClipRig(profile, pose, 'sway', peak * (left ? -0.025 : 0.025))
      pose = applyClipRig(profile, pose, 'look', peak * 0.06)
    } else if (beat > 0 && beat < 40 && beat !== 4 && beat !== 20 && beat !== 36) {
      pose = applyClipRig(profile, pose, 'squat', halfBeat % 2 === 1 ? 0.035 : 0)
      pose = applyClipRig(profile, pose, 'look', halfBeat % 2 === 1 ? 0.06 : 0)
    }
    const rootYaw = beat <= 4 || beat >= 36 ? 0
      : rootYawLimit * (beat <= 20 ? (beat - 4) / 16 : (36 - beat) / 16)
    keys.push({ t: beat * beatSeconds, ...pose, rootYaw })
  }
  return { version: 2, name, duration: 40 * beatSeconds, loop: true, keys }
}

/**
 * Validate manual preview imports without dropping heading or changing training admission.
 * @param value - Parsed, untrusted clip JSON.
 * @param profile - Installed fourteen-joint limits.
 * @param limits - Current maximum duration and key count.
 * @returns An independent version-one reference or complete version-two preview.
 */
export function validatePreviewClip(value: unknown, profile: RobotProfile,
  limits: { maxClipSeconds: number; maxClipKeys: number }): AuthoredClip {
  if (typeof value !== 'object' || value === null || !('version' in value) || value.version !== 2) {
    return validateAuthoredClip(value, profile, limits)
  }
  const clip = value as Record<string, unknown>
  if (!Array.isArray(clip.keys) || clip.keys.length > limits.maxClipKeys) throw new Error('preview clip')
  const headings: number[] = []
  const keys = clip.keys.map((value: unknown) => {
    if (typeof value !== 'object' || value === null) throw new Error('preview key')
    const key = value as Record<string, unknown>
    if (Object.keys(key).length !== 4 || typeof key.rootYaw !== 'number' || !Number.isFinite(key.rootYaw)
      || Math.abs(key.rootYaw) > rootYawLimit) throw new Error('preview heading')
    headings.push(key.rootYaw)
    return { t: key.t, joints: key.joints, rootPitch: key.rootPitch }
  })
  const reference = validateAuthoredClip({ ...clip, version: 1, keys }, profile, limits)
  if (reference.keys.at(-1)?.t !== reference.duration) throw new Error('Incomplete preview timeline')
  return { ...reference, version: 2, keys: reference.keys.map((key, index) => ({ ...key, rootYaw: headings[index] as number })) }
}
