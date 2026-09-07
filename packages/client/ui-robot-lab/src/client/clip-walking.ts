/** Model-bound kinematic walking previews with declared planted-foot intervals, not training references. */
import { Quaternion, Vector3 } from 'three'
import type { RobotProfile, RobotScene, RobotSceneKinematics } from '@deepseek-ai/dsh-robot-lab/types'
import { defaultClipPose, sampleAuthoredClip } from './clip-motion.ts'
import { validatePreviewClip } from './clip-preview.ts'
import { solveWalkingPose, walkingFeet, walkingLegs } from './clip-leg-ik.ts'
import type { FootTarget, WalkingPose } from './clip-leg-ik.ts'

/** A fixed rigid foot frame during an inclusive support interval; quaternion order is x/y/z/w. */
export interface WalkingContact extends FootTarget { start: number; end: number; foot: 'left' | 'right' }
/** Version three retains solved servo keys, free-root translation/roll and model-bound contact targets. */
export interface WalkingClip {
  version: 3
  name: string
  duration: number
  loop: boolean
  modelSha256: string
  keys: Array<WalkingPose & { t: number }>
  contacts: WalkingContact[]
}

const smooth = (value: number) => value * value * (3 - 2 * value)
const feet = ['left', 'right'] as const

function frame(target: FootTarget, yaw: number, root: number[], height = 0): FootTarget {
  const rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), yaw)
  const pivot = new Vector3(root[0], root[1], 0)
  return { position: new Vector3().fromArray(target.position).sub(pivot).applyQuaternion(rotation).add(pivot)
    .add(new Vector3(0, 0, height)).toArray(), quaternion: rotation.multiply(new Quaternion().fromArray(target.quaternion)).toArray() }
}

/**
 * Author alternating short steps around the standing center: left one circle, then right one circle.
 * @param profile - Installed exact neutral joint vector, model identity and servo limits.
 * @param scene - Installed native kinematics and joint order, not a guessed skeleton.
 * @param name - Display name for the authored preview.
 * @returns A 120-BPM, twenty-second contact-constrained reference; no dynamics or hardware operations run.
 */
export function compileWalkingPreview(profile: RobotProfile, scene: RobotScene, name: string): WalkingClip {
  const rig = scene.kinematics
  if (rig === undefined || scene.jointNames.some((value, index) => value !== profile.joints[index]?.name)) throw new Error('walking model')
  const { bodies } = walkingLegs(profile, rig)
  const neutral: WalkingPose = { ...defaultClipPose(profile), rootYaw: 0, rootRoll: 0, rootPosition: [...rig.rootPosition] }
  const targets = walkingFeet(rig, bodies, neutral)
  const clip: WalkingClip = { version: 3, name, duration: 20, loop: true, modelSha256: profile.modelSha256,
    keys: [{ t: 0, ...neutral }, { t: 2, ...neutral }], contacts: [] }
  for (const [index, foot] of feet.entries()) clip.contacts.push({ start: 0, end: 2, foot, ...targets[index] as FootTarget })
  let previous = neutral
  for (let turn = 0; turn < 2; turn += 1) {
    const direction = turn === 0 ? 1 : -1
    const initialYaw = turn === 0 ? 0 : Math.PI * 2
    const beginning = 2 + turn * 8
    for (let pair = 0; pair < 16; pair += 1) {
      const baseYaw = initialYaw + direction * pair * Math.PI / 8
      const nextYaw = initialYaw + direction * (pair + 1) * Math.PI / 8
      for (let half = 0; half < 2; half += 1) {
        const swing = turn === 0 ? half : 1 - half
        const stance = 1 - swing
        const stanceYaw = half === 0 ? baseYaw : nextYaw
        const contact = frame(targets[stance] as FootTarget, stanceYaw, rig.rootPosition)
        const start = beginning + pair / 2 + half / 4
        clip.contacts.push({ start, end: start + 0.25, foot: feet[stance] as 'left' | 'right', ...contact })
        for (let sample = 1; sample <= 4; sample += 1) {
          const phase = sample / 4
          const t = start + phase / 4
          const progress = smooth(phase)
          const rootYaw = baseYaw + (nextYaw - baseYaw) * (half + progress) / 2
          const desired = targets.map((target, index) => index === stance ? contact
            : frame(target, baseYaw + (nextYaw - baseYaw) * progress, rig.rootPosition, 0.005 * Math.sin(Math.PI * phase) ** 2))
          const preferred = [...rig.rootPosition]
          preferred[0] = (preferred[0] as number) + ((contact.position[0] as number) - (preferred[0] as number)) * 0.3
          preferred[1] = (preferred[1] as number) + ((contact.position[1] as number) - (preferred[1] as number)) * 0.3
          previous = half === 1 && sample === 4 ? { ...neutral, rootYaw: nextYaw }
            : solveWalkingPose(profile, rig, previous, desired, rootYaw, preferred)
          clip.keys.push({ t, ...previous })
        }
      }
    }
  }
  clip.keys.push({ t: 20, ...neutral })
  for (const [index, foot] of feet.entries()) clip.contacts.push({ start: 18, end: 20, foot, ...targets[index] as FootTarget })
  return clip
}

/**
 * Measure sampled rigid-foot drift at contact boundaries, keys and eight subdivisions per key interval.
 * @param clip - Complete kinematic reference and declared support intervals.
 * @param profile - Installed chain names and servo order.
 * @param rig - Installed forward kinematics used by rendering.
 * @returns Maximum stance translation and orientation errors; these are geometric, not balance metrics.
 */
export function measureWalkingContacts(clip: WalkingClip, profile: RobotProfile, rig: RobotSceneKinematics) {
  const { bodies } = walkingLegs(profile, rig)
  let maxPositionError = 0
  let maxAngleError = 0
  for (const contact of clip.contacts) {
    const times = new Set([contact.start, contact.end])
    for (let i = 1; i < clip.keys.length; i += 1) {
      const before = clip.keys[i - 1] as WalkingClip['keys'][number]
      const after = clip.keys[i] as WalkingClip['keys'][number]
      if (after.t < contact.start || before.t > contact.end) continue
      for (let sub = 0; sub <= 8; sub += 1) {
        const t = before.t + (after.t - before.t) * sub / 8
        if (t >= contact.start && t <= contact.end) times.add(t)
      }
    }
    for (const t of times) {
      const pose = sampleAuthoredClip(clip, t) as WalkingPose
      const actual = walkingFeet(rig, bodies, pose)[contact.foot === 'left' ? 0 : 1] as FootTarget
      maxPositionError = Math.max(maxPositionError, new Vector3().fromArray(actual.position)
        .distanceTo(new Vector3().fromArray(contact.position)))
      maxAngleError = Math.max(maxAngleError, new Quaternion().fromArray(actual.quaternion)
        .angleTo(new Quaternion().fromArray(contact.quaternion)))
    }
  }
  return { maxPositionError, maxAngleError }
}

function vector(value: unknown, length: number): number[] {
  if (!Array.isArray(value) || value.length !== length || !value.every(v => typeof v === 'number' && Number.isFinite(v))) {
    throw new Error('walking vector')
  }
  return [...(value as number[])]
}

/**
 * Admit only complete model-bound walking previews whose sampled support geometry remains planted.
 * @param value - Parsed untrusted JSON.
 * @param profile - Current exact model identity, neutral pose and limits.
 * @param scene - Current native model kinematics.
 * @param limits - Installed resource bounds.
 * @returns A copied version-three clip; unsupported channels, missing coverage or excessive foot drift throw.
 */
export function validateWalkingClip(value: unknown, profile: RobotProfile, scene: RobotScene,
  limits: { maxClipSeconds: number; maxClipKeys: number }): WalkingClip {
  if (typeof value !== 'object' || value === null) throw new Error('walking clip')
  const clip = value as Record<string, unknown>
  const rig = scene.kinematics
  if (rig === undefined || profile.joints.some((joint, i) => joint.name !== scene.jointNames[i])
    || clip.version !== 3 || clip.modelSha256 !== profile.modelSha256 || Object.keys(clip).length !== 7
    || !Array.isArray(clip.keys) || clip.keys.length > limits.maxClipKeys || !Array.isArray(clip.contacts)
    || clip.contacts.length === 0 || clip.contacts.length > limits.maxClipKeys) throw new Error('walking clip')
  const roots: Array<{ rootPosition: number[]; rootRoll: number }> = []
  const keys = clip.keys.map((value: unknown) => {
    if (typeof value !== 'object' || value === null) throw new Error('walking key')
    const key = value as Record<string, unknown>
    const rootPosition = vector(key.rootPosition, 3)
    if (Object.keys(key).length !== 6 || key.rootPitch !== 0 || typeof key.rootRoll !== 'number' || !Number.isFinite(key.rootRoll)
      || Math.abs(key.rootRoll) > 0.35 || rootPosition.some((v, i) => Math.abs(v - (rig.rootPosition[i] as number)) > 0.15)) {
      throw new Error('walking root')
    }
    roots.push({ rootPosition, rootRoll: key.rootRoll })
    return { t: key.t, joints: key.joints, rootPitch: key.rootPitch, rootYaw: key.rootYaw }
  })
  const reference = validatePreviewClip({ version: 2, name: clip.name, loop: clip.loop, duration: clip.duration, keys }, profile, limits)
  if (reference.version !== 2) throw new Error('walking version')
  const contacts = clip.contacts.map((value: unknown): WalkingContact => {
    if (typeof value !== 'object' || value === null) throw new Error('walking contact')
    const contact = value as Record<string, unknown>
    if (Object.keys(contact).length !== 5 || (contact.foot !== 'left' && contact.foot !== 'right')
      || typeof contact.start !== 'number' || !Number.isFinite(contact.start) || typeof contact.end !== 'number' || !Number.isFinite(contact.end)
      || contact.start < 0 || contact.start >= contact.end || contact.end > reference.duration) throw new Error('walking contact')
    const quaternion = vector(contact.quaternion, 4)
    if (Math.abs(Math.hypot(...quaternion) - 1) > 0.000001) throw new Error('walking orientation')
    return { start: contact.start, end: contact.end, foot: contact.foot, position: vector(contact.position, 3), quaternion }
  })
  for (const foot of feet) {
    let end = 0
    for (const contact of contacts.filter(contact => contact.foot === foot).sort((a, b) => a.start - b.start)) {
      if (contact.start < end) throw new Error('overlapping walking contacts')
      end = contact.end
    }
  }
  let covered = 0
  for (const contact of [...contacts].sort((a, b) => a.start - b.start)) {
    if (contact.start > covered) throw new Error('walking contact gap')
    covered = Math.max(covered, contact.end)
  }
  if (covered !== reference.duration) throw new Error('walking contact coverage')
  const result: WalkingClip = { ...reference, version: 3, modelSha256: profile.modelSha256, contacts,
    keys: reference.keys.map((key, index) => ({ ...key, ...roots[index] as typeof roots[number] })) }
  for (const key of [result.keys[0], result.keys.at(-1)] as WalkingClip['keys']) {
    if (key.rootYaw !== 0 || key.rootRoll !== 0 || key.joints.some((v, i) => v !== profile.joints[i]?.defaultPosition)
      || key.rootPosition.some((v, i) => v !== rig.rootPosition[i])) throw new Error('walking neutral endpoints')
  }
  const measured = measureWalkingContacts(result, profile, rig)
  if (measured.maxPositionError > 0.0005 || measured.maxAngleError > 0.01) throw new Error('walking contact drift')
  return result
}
