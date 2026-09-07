/** Authored sequence compilation and rig projections adapted from Microduck Lab's animation editor. */
import type { RobotClip, RobotProfile } from '@deepseek-ai/dsh-robot-lab/types'

/** Joint radians and free-root pitch; heading is present only for browser preview poses. */
export type ClipPose = Pick<RobotClip['keys'][number], 'joints' | 'rootPitch'> & {
  rootYaw?: number
  rootPosition?: number[]
  rootRoll?: number
}
/** Supported authored actions; these names are not claims of trained skills. */
export type ClipAction = 'left-step' | 'right-step' | 'neck-nod' | 'head-turn' | 'sway-left' | 'sway-right' | 'squat' | 'stand'
/** A sequential action with an editable beat count. */
export interface ClipStep { action: ClipAction; beats: number }
/** Coupled controls preserve the pose component perpendicular to their coefficient vector. */
export const clipRigs = {
  squat: { left_hip_pitch: -1, left_knee: -2, left_ankle: -1, right_hip_pitch: 1, right_knee: 2, right_ankle: 1 },
  lean: { root: 1, left_hip_pitch: -1 / 3, left_knee: 1 / 3, left_ankle: -1 / 3,
    right_hip_pitch: 1 / 3, right_knee: -1 / 3, right_ankle: 1 / 3 },
  swingL: { left_hip_pitch: -1, left_ankle: 1 },
  swingR: { right_hip_pitch: 1, right_ankle: -1 },
  sway: { left_hip_roll: 1, right_hip_roll: 1 },
  stance: { left_hip_roll: -1, right_hip_roll: 1 },
  twist: { left_hip_yaw: 1, right_hip_yaw: 1 },
  toes: { left_hip_yaw: -1, right_hip_yaw: 1 },
  look: { neck_pitch: -0.5, head_pitch: 0.5 },
} as const
/** Stable rig identifiers for selection and locale lookup. */
export type ClipRig = keyof typeof clipRigs
/** Explicit root rotation span used by the upstream editor. */
export const rootPitchLimit = Math.PI * 2
/** All sequence choices, in menu order. */
export const clipActions: ClipAction[] = ['left-step', 'right-step', 'neck-nod', 'head-turn', 'sway-left', 'sway-right', 'squat', 'stand']

/**
 * Expand a recognized request into an authored recipe, without pretending to invoke a language model.
 * @param prompt - user text; explicit action clauses preserve their order.
 * @returns supported sequence, or null when the request needs manual action selection.
 */
export function planClip(prompt: string): ClipStep[] | null {
  const matches: Array<{ at: number; action: ClipAction }> = []
  const patterns: Array<[RegExp, ClipAction]> = [
    [/\bleft\s+(?:leg|step)\b|左腿|左脚/gi, 'left-step'], [/\bright\s+(?:leg|step)\b|右腿|右脚/gi, 'right-step'],
    [/\b(?:neck|nod)\b|脖|点头/gi, 'neck-nod'], [/\b(?:head\s*(?:turn|yaw)|look\s+around)\b|转头|环顾/gi, 'head-turn'],
    [/\b(?:squat|crouch)\b|蹲/gi, 'squat'], [/\bstand\b|站立/gi, 'stand'],
    [/\bsway\s+left\b|左摇/gi, 'sway-left'], [/\bsway\s+right\b|右摇/gi, 'sway-right'],
  ]
  for (const [pattern, action] of patterns) {
    for (const match of prompt.matchAll(pattern)) matches.push({ at: match.index, action })
  }
  if (matches.length > 0) return matches.sort((a, b) => a.at - b.at).map(({ action }) => ({ action, beats: 2 }))
  if (/danc|groove|跳舞|舞蹈/i.test(prompt)) return clipActions.map(action => ({ action, beats: 2 }))
  if (/hello|wave|你好|招呼/i.test(prompt)) return ['stand', 'head-turn', 'neck-nod', 'stand'].map(action => ({ action: action as ClipAction, beats: 2 }))
  return null
}

/**
 * Create a standing pose from the installed servo defaults with zero root pitch.
 * @param profile - installed joint defaults.
 * @returns an independent standing pose.
 */
export function defaultClipPose(profile: RobotProfile): ClipPose {
  return { joints: profile.joints.map(joint => joint.defaultPosition), rootPitch: 0 }
}

function rigParts(profile: RobotProfile, rig: ClipRig) {
  return Object.entries(clipRigs[rig]).map(([name, coefficient]) => {
    if (name === 'root') return { index: -1, coefficient, lower: -rootPitchLimit, upper: rootPitchLimit, base: 0, name }
    const index = profile.joints.findIndex(joint => joint.name === name)
    const joint = profile.joints[index]
    if (joint === undefined) throw new Error(`Missing MicroDuck rig joint: ${name}`)
    return { index, coefficient, lower: joint.lower, upper: joint.upper, base: joint.defaultPosition, name }
  })
}

/**
 * Resolve the projected control value and the first servo limit in each direction.
 * @param profile - installed limits and defaults.
 * @param pose - current authored pose.
 * @param rig - coupled control.
 * @returns value, legal interval, and limiting joint names.
 */
export function measureClipRig(profile: RobotProfile, pose: ClipPose, rig: ClipRig): {
  value: number
  lower: number
  upper: number
  lowerBy: string
  upperBy: string
} {
  const parts = rigParts(profile, rig)
  const at = (index: number) => index === -1 ? pose.rootPitch : (pose.joints[index] as number)
  const value = parts.reduce((sum, part) => sum + part.coefficient * (at(part.index) - part.base), 0)
    / parts.reduce((sum, part) => sum + part.coefficient ** 2, 0)
  let lower = -Infinity, upper = Infinity, lowerBy = '', upperBy = ''
  for (const part of parts) {
    const a = (part.lower - at(part.index)) / part.coefficient
    const b = (part.upper - at(part.index)) / part.coefficient
    if (value + Math.min(a, b) > lower) { lower = value + Math.min(a, b); lowerBy = part.name }
    if (value + Math.max(a, b) < upper) { upper = value + Math.max(a, b); upperBy = part.name }
  }
  return { value, lower, upper, lowerBy, upperBy }
}

/**
 * Move along one rig vector without discarding unrelated pose edits.
 * @param profile - installed joint limits.
 * @param pose - source pose, never mutated.
 * @param rig - selected control.
 * @param value - desired projected value; clamped by the first servo limit.
 * @returns the resulting pose.
 */
export function applyClipRig(profile: RobotProfile, pose: ClipPose, rig: ClipRig, value: number): ClipPose {
  const range = measureClipRig(profile, pose, rig)
  const delta = Math.max(range.lower, Math.min(range.upper, value)) - range.value
  const next = { ...pose, joints: [...pose.joints] }
  for (const part of rigParts(profile, rig)) {
    if (part.index === -1) next.rootPitch += part.coefficient * delta
    else next.joints[part.index] = Math.max(part.lower,
      Math.min(part.upper, (next.joints[part.index] as number) + part.coefficient * delta))
  }
  return next
}

/**
 * Compile each action as standing → peak → standing, retaining a key at every sequence boundary.
 * @param profile - real fourteen-servo model metadata.
 * @param steps - ordered authored actions.
 * @param bpm - beats per minute.
 * @param moveSize - motion scale in [0,1].
 * @param name - exact user display name.
 * @param loop - playback intent.
 * @returns a linear-interpolation, version-one training reference.
 */
export function compileClip(profile: RobotProfile, steps: ClipStep[], bpm: number, moveSize: number,
  name: string, loop: boolean): RobotClip {
  const standing = defaultClipPose(profile)
  const keys: RobotClip['keys'] = [{ t: 0, ...standing }]
  let time = 0
  for (const step of steps) {
    let peak = defaultClipPose(profile)
    const amount = moveSize * 0.3
    switch (step.action) {
      case 'left-step': peak = applyClipRig(profile, peak, 'swingL', amount); break
      case 'right-step': peak = applyClipRig(profile, peak, 'swingR', amount); break
      case 'neck-nod': peak = applyClipRig(profile, peak, 'look', amount); break
      case 'sway-left': peak = applyClipRig(profile, peak, 'sway', amount * 0.5); break
      case 'sway-right': peak = applyClipRig(profile, peak, 'sway', -amount * 0.5); break
      case 'squat': peak = applyClipRig(profile, peak, 'squat', amount); break
      case 'head-turn': {
        const index = profile.joints.findIndex(joint => joint.name === 'head_yaw')
        const joint = profile.joints[index]
        if (joint === undefined) throw new Error('Missing MicroDuck rig joint: head_yaw')
        peak.joints[index] = Math.max(joint.lower, Math.min(joint.upper, joint.defaultPosition + amount * 2))
        break
      }
      case 'stand': break
      /* v8 ignore next -- ClipAction is a closed union constructed by typed recipe controls, not imported JSON. */
      default: { const unexpected: never = step.action; throw new Error(`Unknown clip action: ${String(unexpected)}`) }
    }
    const duration = step.beats * 60 / bpm
    keys.push({ t: time + duration / 2, ...peak }, { t: time + duration, ...defaultClipPose(profile) })
    time += duration
  }
  return { version: 1, name, duration: time, loop, keys }
}

/**
 * Sample joints, pitch and optional unwrapped preview heading linearly; never shorten full turns.
 * @param clip - validated reference with sorted keyframes.
 * @param time - seconds, clamped to the clip's keyed interval.
 * @returns an independent pose in radians.
 */
export function sampleAuthoredClip(clip: { keys: Array<ClipPose & { t: number }> }, time: number): ClipPose {
  const first = clip.keys[0] as ClipPose & { t: number }
  let before = first
  for (const after of clip.keys.slice(1)) {
    if (time <= after.t) {
      const fraction = Math.max(0, Math.min(1, (time - before.t) / (after.t - before.t)))
      return { rootPitch: before.rootPitch + (after.rootPitch - before.rootPitch) * fraction,
        ...(before.rootYaw === undefined ? {} : { rootYaw: before.rootYaw + ((after.rootYaw ?? 0) - before.rootYaw) * fraction }),
        ...(before.rootRoll === undefined ? {} : { rootRoll: before.rootRoll + ((after.rootRoll ?? 0) - before.rootRoll) * fraction }),
        ...(before.rootPosition === undefined ? {} : { rootPosition: before.rootPosition.map((value, i) =>
          value + (((after.rootPosition as number[])[i] as number) - value) * fraction) }),
        joints: before.joints.map((value, index) => value + ((after.joints[index] as number) - value) * fraction) }
    }
    before = after
  }
  return { joints: [...before.joints], rootPitch: before.rootPitch,
    ...(before.rootYaw === undefined ? {} : { rootYaw: before.rootYaw }),
    ...(before.rootRoll === undefined ? {} : { rootRoll: before.rootRoll }),
    ...(before.rootPosition === undefined ? {} : { rootPosition: [...before.rootPosition] }) }
}

/**
 * Validate imported clips against the current robot and complete resource limits.
 * @param value - untrusted parsed JSON.
 * @param profile - installed joint metadata.
 * @param limits - maximum duration and total keys.
 * @returns a copied reference; invalid JSON fields, ordering and servo targets throw.
 */
export function validateAuthoredClip(value: unknown, profile: RobotProfile,
  limits: { maxClipSeconds: number; maxClipKeys: number }): RobotClip {
  if (typeof value !== 'object' || value === null) throw new Error('clip')
  const clip = value as Record<string, unknown>
  if (clip.version !== 1 || typeof clip.name !== 'string' || !clip.name.trim() || clip.name.length > 160
    || typeof clip.loop !== 'boolean' || typeof clip.duration !== 'number' || !Number.isFinite(clip.duration)
    || clip.duration <= 0 || clip.duration > limits.maxClipSeconds || !Array.isArray(clip.keys)
    || clip.keys.length < 2 || clip.keys.length > limits.maxClipKeys) throw new Error('clip')
  let previous = -1
  const keys = clip.keys.map((value: unknown, index) => {
    if (typeof value !== 'object' || value === null) throw new Error('key')
    const key = value as Record<string, unknown>
    if (['rootYaw', 'rootPosition', 'rootRoll'].some(field => Object.hasOwn(key, field))) throw new Error('Preview channels require a preview clip version')
    if (typeof key.t !== 'number' || !Number.isFinite(key.t) || key.t <= previous || key.t > (clip.duration as number)
      || (index === 0 && key.t !== 0) || typeof key.rootPitch !== 'number' || !Number.isFinite(key.rootPitch)
      || Math.abs(key.rootPitch) > rootPitchLimit || !Array.isArray(key.joints) || key.joints.length !== 14
      || !key.joints.every((v: unknown, i) => {
        const joint = profile.joints[i] as RobotProfile['joints'][number]
        return typeof v === 'number' && Number.isFinite(v) && v >= joint.lower && v <= joint.upper
      })) throw new Error('key')
    previous = key.t
    return { t: key.t, rootPitch: key.rootPitch, joints: [...(key.joints as number[])] }
  })
  return { version: 1, name: clip.name, duration: clip.duration, loop: clip.loop, keys }
}
