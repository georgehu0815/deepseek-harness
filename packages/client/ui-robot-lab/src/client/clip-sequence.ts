/** Model-bound authored timelines for browser-library recovery and explicit reuse. */
import type { RobotClip, RobotProfile, RobotStudioCatalog } from '@deepseek-ai/dsh-robot-lab/types'
import { rootPitchLimit, validateAuthoredClip } from './clip-motion.ts'

/** Exact keyed motion and tempo; playback, review, media and recipe controls are not saved. */
export interface ClipSequence {
  version: 1
  modelSha256: string
  jointNames: string[]
  bpm: number
  clip: RobotClip
}

function fields(value: unknown, keys: string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    throw new Error('Invalid clip sequence fields')
  }
  return value as Record<string, unknown>
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function named(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 160
}

/**
 * Decode an exact timeline without requiring an installed robot catalog.
 * The enclosing file or library reader owns the complete UTF-8 byte budget.
 * @param value - Untrusted decoded sequence data.
 * @returns Independent version-one data; malformed fields, identities and incomplete timelines throw.
 */
export function parseClipSequence(value: unknown): ClipSequence {
  const sequence = fields(value, ['version', 'modelSha256', 'jointNames', 'bpm', 'clip'])
  if (sequence.version !== 1 || typeof sequence.modelSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sequence.modelSha256)
    || !Array.isArray(sequence.jointNames) || sequence.jointNames.length !== 14
    || !sequence.jointNames.every(named) || new Set(sequence.jointNames).size !== 14
    || !finite(sequence.bpm) || sequence.bpm <= 0) throw new Error('Invalid clip sequence')
  const clip = fields(sequence.clip, ['version', 'name', 'duration', 'loop', 'keys'])
  if (clip.version !== 1 || !named(clip.name) || !finite(clip.duration) || clip.duration <= 0
    || typeof clip.loop !== 'boolean' || !Array.isArray(clip.keys) || clip.keys.length < 2) throw new Error('Invalid sequence clip')
  const duration = clip.duration
  let previous = -1
  const keys = clip.keys.map((value: unknown, index): RobotClip['keys'][number] => {
    const key = fields(value, ['t', 'joints', 'rootPitch'])
    if (!finite(key.t) || key.t <= previous || key.t > duration || (index === 0 && key.t !== 0)
      || !finite(key.rootPitch) || Math.abs(key.rootPitch) > rootPitchLimit
      || !Array.isArray(key.joints) || key.joints.length !== 14 || !key.joints.every(finite)) throw new Error('Invalid sequence key')
    previous = key.t
    return { t: key.t, joints: [...key.joints], rootPitch: key.rootPitch }
  })
  if (previous !== duration) throw new Error('Incomplete sequence timeline')
  return { version: 1, modelSha256: sequence.modelSha256, jointNames: [...sequence.jointNames], bpm: sequence.bpm,
    clip: { version: 1, name: clip.name, duration, loop: clip.loop, keys } }
}

/**
 * Admit a saved timeline for the exact installed model and its current authoring limits.
 * @param value - Untrusted saved sequence.
 * @param profile - Installed model identity, ordered joints and servo limits.
 * @param limits - Current catalog tempo, duration and key-count limits.
 * @returns Independent validated data; incompatible models or out-of-range motion throw without retargeting.
 */
export function validateClipSequence(value: unknown, profile: RobotProfile, limits: RobotStudioCatalog['limits']): ClipSequence {
  const sequence = parseClipSequence(value)
  if (sequence.modelSha256 !== profile.modelSha256 || profile.joints.length !== 14
    || sequence.jointNames.some((name, index) => name !== profile.joints[index]?.name)
    || sequence.bpm < limits.minBpm || sequence.bpm > limits.maxBpm) throw new Error('Incompatible clip sequence')
  return { ...sequence, clip: validateAuthoredClip(sequence.clip, profile, limits) }
}
