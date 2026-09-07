import { describe, expect, it } from 'vitest'
import type { RobotClip, RobotProfile } from '@deepseek-ai/dsh-robot-lab/types'
import { applyClipRig, clipActions, clipRigs, compileClip, defaultClipPose, measureClipRig, planClip,
  rootPitchLimit, sampleAuthoredClip, validateAuthoredClip } from '../src/client/clip-motion.ts'
import type { ClipRig } from '../src/client/clip-motion.ts'
import { fixtureProfile } from './fixtures.client.ts'

const names = ['left_hip_yaw', 'left_hip_roll', 'left_hip_pitch', 'left_knee', 'left_ankle',
  'right_hip_yaw', 'right_hip_roll', 'right_hip_pitch', 'right_knee', 'right_ankle',
  'neck_pitch', 'head_pitch', 'head_yaw', 'neck_yaw']
const profile: RobotProfile = { ...fixtureProfile, joints: fixtureProfile.joints.map((joint, index) => ({
  ...joint, index: index + 1, name: names[index]!, lower: -0.25, upper: 0.3, defaultPosition: 0.05,
})) }
const limits = { maxClipSeconds: 60, maxClipKeys: 256 }
function clip(): RobotClip {
  return compileClip(profile, [{ action: 'left-step', beats: 2 }, { action: 'head-turn', beats: 4 }], 120, 0.5, '跳舞 🦆', false)
}
function bounded(value: ReturnType<typeof defaultClipPose>) {
  expect(value.joints).toHaveLength(14)
  expect(Math.abs(value.rootPitch)).toBeLessThanOrEqual(rootPitchLimit)
  value.joints.forEach((radians, index) => {
    expect(Number.isFinite(radians)).toBe(true)
    expect(radians).toBeGreaterThanOrEqual(profile.joints[index]!.lower)
    expect(radians).toBeLessThanOrEqual(profile.joints[index]!.upper)
  })
}

describe('Clip Gen authored motion', () => {
  it('preserves explicit action order and repeated clauses across English and Chinese', () => {
    expect(planClip('right leg, then 左腿, 点头, 转头, squat, stand, sway right, 左摇, right step')).toEqual([
      'right-step', 'left-step', 'neck-nod', 'head-turn', 'squat', 'stand', 'sway-right', 'sway-left', 'right-step',
    ].map(action => ({ action, beats: 2 })))
    expect(planClip('LEFT STEP followed by LOOK AROUND')).toEqual([
      { action: 'left-step', beats: 2 }, { action: 'head-turn', beats: 2 },
    ])
  })

  it.each(['dance', 'groove', '跳舞', '舞蹈'])('expands the supported broad dance request %s', (prompt) => {
    expect(planClip(prompt)).toEqual(clipActions.map(action => ({ action, beats: 2 })))
  })

  it.each(['hello', 'wave', '你好', '打招呼'])('expands a greeting request %s', (prompt) => {
    expect(planClip(prompt)?.map(step => step.action)).toEqual(['stand', 'head-turn', 'neck-nod', 'stand'])
  })

  it('prefers explicit clauses over a broad recipe', () => {
    expect(planClip('dance with a right step')).toEqual([{ action: 'right-step', beats: 2 }])
  })

  it.each(['', 'fly to the moon', 'understand orbital physics', 'draw a necklace', 'inspect the node'])('leaves unsupported text for manual selection: %s', (prompt) => {
    expect(planClip(prompt)).toBeNull()
  })

  it('returns independent defaults and compiles ordered, bounded fourteen-servo keys', () => {
    const pose = defaultClipPose(profile)
    pose.joints[0] = 1
    expect(defaultClipPose(profile).joints[0]).toBe(0.05)
    const result = compileClip(profile, clipActions.map(action => ({ action, beats: 2 })), 120, 1, '舞蹈 🦆', true)
    expect(result).toMatchObject({ version: 1, name: '舞蹈 🦆', duration: 8, loop: true })
    expect(result.keys).toHaveLength(17)
    expect(result.keys.map(key => key.t)).toEqual(Array.from({ length: 17 }, (_, i) => i / 2))
    result.keys.forEach(bounded)
    result.keys.filter((_, index) => index % 2 === 0).forEach(key => expect(key.joints).toEqual(defaultClipPose(profile).joints))
    expect(result.keys[1]!.joints[2]).toBeLessThan(profile.joints[2]!.defaultPosition)
    expect(result.keys[3]!.joints[7]).toBeGreaterThan(profile.joints[7]!.defaultPosition)
    expect(result.keys[7]!.joints[12]).toBe(profile.joints[12]!.upper)
    expect(result.keys[9]!.joints[1]).toBeGreaterThan(result.keys[11]!.joints[1]!)
  })

  it('uses training-array positions rather than MuJoCo joint identifiers 1 through 14', () => {
    expect(profile.joints.map(joint => joint.index)).toEqual(Array.from({ length: 14 }, (_, index) => index + 1))
    const steps = clipActions.map(action => ({ action, beats: 2 }))
    const actual = compileClip(profile, steps, 120, 1, 'Real model ids', false)
    actual.keys.forEach(bounded)
    const ordinalIds = { ...profile, joints: profile.joints.map((joint, index) => ({ ...joint, index })) }
    expect(actual).toEqual(compileClip(ordinalIds, steps, 120, 1, 'Real model ids', false))
    for (const rig of Object.keys(clipRigs) as ClipRig[]) {
      expect(measureClipRig(profile, defaultClipPose(profile), rig).value).toBe(0)
    }
  })

  it('preserves beat lengths, Unicode names and motion scale', () => {
    const result = clip()
    expect(result.duration).toBe(3)
    expect(result.keys.map(key => key.t)).toEqual([0, 0.5, 1, 2, 3])
    expect(result.name).toBe('跳舞 🦆')
    const still = compileClip(profile, [{ action: 'left-step', beats: 1 }], 60, 0, 'Still', false)
    still.keys.forEach(key => expect(key.joints).toEqual(defaultClipPose(profile).joints))
  })

  it('reports missing installed rig joints instead of silently skipping movement', () => {
    const missing = { ...profile, joints: profile.joints.filter(joint => joint.name !== 'head_yaw') }
    expect(() => compileClip(missing, [{ action: 'head-turn', beats: 2 }], 120, 0.5, 'Head', false)).toThrow('head_yaw')
    expect(() => measureClipRig(fixtureProfile, defaultClipPose(fixtureProfile), 'look')).toThrow('neck_pitch')
  })

  it.each(Object.keys(clipRigs) as ClipRig[])('clamps the %s projection at installed joint limits', (rig) => {
    const pose = defaultClipPose(profile)
    const range = measureClipRig(profile, pose, rig)
    expect(range.value).toBe(0)
    expect(Number.isFinite(range.lower)).toBe(true)
    expect(Number.isFinite(range.upper)).toBe(true)
    expect(range.lowerBy).not.toBe('')
    expect(range.upperBy).not.toBe('')
    for (const target of [-1000, 1000]) {
      const moved = applyClipRig(profile, pose, rig, target)
      bounded(moved)
      expect(measureClipRig(profile, moved, rig).value).toBeCloseTo(target < 0 ? range.lower : range.upper)
    }
    expect(pose).toEqual(defaultClipPose(profile))
  })

  it('preserves perpendicular and unrelated edits while changing a coupled control', () => {
    const pose = defaultClipPose(profile)
    pose.joints[10] = 0.08
    pose.joints[11] = 0.12
    pose.joints[12] = 0.2
    const next = applyClipRig(profile, pose, 'look', 0.1)
    expect(next.joints[10]! + next.joints[11]!).toBeCloseTo(0.2)
    expect(next.joints[12]).toBe(0.2)
    expect(measureClipRig(profile, next, 'look').value).toBeCloseTo(0.1)
    expect(pose.joints[10]).toBe(0.08)
  })

  it('reports free-root limits when servos allow the full lean', () => {
    const wide = { ...profile, joints: profile.joints.map(joint => ({ ...joint, lower: -100, upper: 100 })) }
    const pose = defaultClipPose(wide)
    const range = measureClipRig(wide, pose, 'lean')
    expect(range).toMatchObject({ lower: -rootPitchLimit, upper: rootPitchLimit, lowerBy: 'root', upperBy: 'root' })
    expect(applyClipRig(wide, pose, 'lean', 100).rootPitch).toBe(rootPitchLimit)
    expect(applyClipRig(wide, pose, 'lean', -100).rootPitch).toBe(-rootPitchLimit)
  })

  it('interpolates every joint and root pitch and holds the endpoint outside the interval', () => {
    const source: RobotClip = { version: 1, name: 'Interpolation', duration: 4, loop: false, keys: [
      { t: 0, joints: Array<number>(14).fill(-0.1), rootPitch: -0.5 },
      { t: 2, joints: Array<number>(14).fill(0.1), rootPitch: 0.5 },
      { t: 4, joints: Array<number>(14).fill(0.3), rootPitch: 1.5 },
    ] }
    expect(sampleAuthoredClip(source, -1)).toEqual({ joints: source.keys[0]!.joints, rootPitch: -0.5 })
    expect(sampleAuthoredClip(source, 1)).toEqual({ joints: Array<number>(14).fill(0), rootPitch: 0 })
    expect(sampleAuthoredClip(source, 3)).toEqual({ joints: Array<number>(14).fill(0.2), rootPitch: 1 })
    const end = sampleAuthoredClip(source, 10)
    expect(end).toEqual({ joints: source.keys[2]!.joints, rootPitch: 1.5 })
    end.joints[0] = -1
    expect(source.keys[2]!.joints[0]).toBe(0.3)
  })
})

describe('imported authored clip validation', () => {
  it('roundtrips a real compiled reference and copies all joint arrays', () => {
    const original = clip()
    const result = validateAuthoredClip(JSON.parse(JSON.stringify(original)), profile, limits)
    expect(result).toEqual(original)
    const copy = validateAuthoredClip(original, profile, { maxClipSeconds: original.duration, maxClipKeys: original.keys.length })
    copy.keys[0]!.joints[0] = 0.2
    expect(original.keys[0]!.joints[0]).toBe(0.05)
  })

  it.each([null, 'clip', [], { version: 2 }, { name: '' }, { name: '  ' }, { name: 'a'.repeat(161) },
    { loop: 'true' }, { duration: 0 }, { duration: -1 }, { duration: Infinity }, { duration: NaN },
    { duration: 61 }, { keys: null }, { keys: [] }, { keys: [null] }])('rejects invalid clip fields %j', (change) => {
    const value = change === null || typeof change !== 'object' || Array.isArray(change) ? change : { ...clip(), ...change }
    expect(() => validateAuthoredClip(value, profile, limits)).toThrow()
  })

  it('rejects the entire resource excess, not just a valid prefix', () => {
    const original = clip()
    expect(() => validateAuthoredClip(original, profile, { ...limits, maxClipKeys: original.keys.length - 1 })).toThrow()
    expect(() => validateAuthoredClip(original, profile, { ...limits, maxClipSeconds: original.duration - 0.1 })).toThrow()
  })

  it.each([null, 'key', { t: NaN }, { t: Infinity }, { t: -1 }, { t: 0 }, { t: 4 },
    { rootPitch: NaN }, { rootPitch: rootPitchLimit + 0.1 }, { rootPitch: -rootPitchLimit - 0.1 },
    { joints: null }, { joints: [] }, { joints: Array<number>(15).fill(0) },
    { joints: Array<number>(14).fill(0.31) }, { joints: Array<number>(14).fill(-0.26) },
    { joints: Array<number>(14).fill(NaN) }, { joints: Array<number>(14).fill(Infinity) },
    { joints: Array<string>(14).fill('0') }])('rejects malformed, unordered or out-of-range key %j', (change) => {
    const original = clip()
    const keys: unknown[] = [...original.keys]
    keys[1] = change === null || typeof change !== 'object' ? change : { ...original.keys[1], ...change }
    expect(() => validateAuthoredClip({ ...original, keys }, profile, limits)).toThrow()
  })

  it('requires the first key at zero and accepts exact servo and root limits', () => {
    const original = clip()
    expect(() => validateAuthoredClip({ ...original, keys: original.keys.slice(1) }, profile, limits)).toThrow()
    original.keys[0]!.joints = profile.joints.map(joint => joint.lower)
    original.keys[0]!.rootPitch = -rootPitchLimit
    original.keys[1]!.joints = profile.joints.map(joint => joint.upper)
    original.keys[1]!.rootPitch = rootPitchLimit
    expect(validateAuthoredClip(original, profile, limits)).toEqual(original)
  })
})
