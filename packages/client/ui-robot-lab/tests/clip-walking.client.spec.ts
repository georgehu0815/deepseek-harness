import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { compileWalkingPreview, measureWalkingContacts, validateWalkingClip } from '../src/client/clip-walking.ts'
import { solveWalkingPose, walkingFeet, walkingLegs } from '../src/client/clip-leg-ik.ts'
import { defaultClipPose, sampleAuthoredClip, validateAuthoredClip } from '../src/client/clip-motion.ts'
import { validatePreviewClip } from '../src/client/clip-preview.ts'
import { parseClipDraft } from '../src/client/clip-draft.ts'
import { createClipGenStore } from '../src/client/clip-gen-store.ts'
import { fixtureProfile } from './fixtures.client.ts'
import { poseFixture } from './clip-pose-fixture.ts'
import type { WalkingPose } from '../src/client/clip-leg-ik.ts'

const scene = poseFixture.scene
const rig = scene.kinematics!
const profile = { ...fixtureProfile, modelSha256: 'a'.repeat(64), joints: fixtureProfile.joints.map((joint, i) => ({ ...joint,
  name: scene.jointNames[i]!, defaultPosition: scene.defaultJoints[i]!,
})) }
const limits = { maxClipKeys: 512, maxClipSeconds: 120 }
const reference = compileWalkingPreview(profile, scene, '小步左转一圈，再右转一圈')
const clip = () => structuredClone(reference)

describe('contact-constrained stepping preview', () => {
  it('turns by 64 short alternating steps with solved body motion, fixed support feet and neutral endpoints', () => {
    expect(reference).toMatchObject({ version: 3, duration: 20, loop: true, modelSha256: profile.modelSha256 })
    expect(reference.keys).toHaveLength(259)
    expect(reference.contacts).toHaveLength(68)
    expect(reference.keys[0]).toEqual({ t: 0, ...defaultClipPose(profile), rootYaw: 0, rootRoll: 0, rootPosition: rig.rootPosition })
    expect(reference.keys.at(-1)).toEqual({ ...reference.keys[0], t: 20 })
    expect(sampleAuthoredClip(reference, 10).rootYaw).toBe(2 * Math.PI)
    expect(sampleAuthoredClip(reference, 18).rootYaw).toBe(0)
    expect(reference.contacts.find(contact => contact.start === 2)!.foot).toBe('right')
    expect(reference.contacts.find(contact => contact.start === 10)!.foot).toBe('left')
    expect(reference.keys.some(key => Math.abs(key.rootRoll) > 0.01)).toBe(true)
    const root = new Vector3().fromArray(rig.rootPosition)
    expect(reference.keys.some(key => new Vector3().fromArray(key.rootPosition).distanceTo(root) > 0.001)).toBe(true)
    const measured = measureWalkingContacts(reference, profile, rig)
    expect(measured.maxPositionError).toBeLessThan(0.0001)
    expect(measured.maxAngleError).toBeLessThan(0.001)
    expect(validateWalkingClip(JSON.parse(JSON.stringify(reference)), profile, scene, limits)).toEqual(reference)
    expect(new TextEncoder().encode(JSON.stringify(reference, null, 2) + '\n').byteLength).toBeLessThan(262144)
  })

  it('lifts only the swinging foot and preserves the stance foot orientation, not just its center', () => {
    const { bodies } = walkingLegs(profile, rig)
    const baseline = walkingFeet(rig, bodies, reference.keys[0]!)
    for (const [t, swing] of [[2.125, 0], [2.375, 1], [10.125, 1], [10.375, 0]]) {
      const current = walkingFeet(rig, bodies, sampleAuthoredClip(reference, t!) as WalkingPose)
      expect(current[swing!]!.position[2]! - baseline[swing!]!.position[2]!).toBeCloseTo(0.005, 4)
      const contact = reference.contacts.find(c => c.start < t! && c.end > t!)!
      const actual = current[1 - swing!]!
      expect(new Vector3().fromArray(actual.position).distanceTo(new Vector3().fromArray(contact.position))).toBeLessThan(0.00005)
      expect(new Quaternion().fromArray(actual.quaternion).angleTo(new Quaternion().fromArray(contact.quaternion))).toBeLessThan(0.001)
    }
  })

  it('retains translation and roll during sampling, retiming, export and replay while locking raw pose edits', () => {
    const store = createClipGenStore(120, 8).create()
    store.actions.load(clip()); store.actions.seek(2.125); store.actions.verify(true)
    const before = store.getSnapshot()
    store.actions.joint(profile, 0, 1); store.actions.heading(1); store.actions.defaultPose(profile)
    store.actions.pose(defaultClipPose(profile)); store.actions.key(512); store.actions.removeKey()
    expect(store.getSnapshot()).toEqual(before)
    store.actions.meta({ name: 'Renamed walking track', duration: 40, loop: false })
    expect(store.getSnapshot().time).toBe(4.25)
    store.actions.seek(4.25)
    expect(store.getSnapshot().pose).toEqual(before.pose)
    const retimed = store.getSnapshot().clip
    expect(validateWalkingClip(JSON.parse(JSON.stringify(retimed)), profile, scene, limits)).toEqual(retimed)
    store.actions.tick(40, false)
    expect(store.getSnapshot().pose).toMatchObject({ rootPosition: rig.rootPosition, rootRoll: 0, rootYaw: 0 })
  })

  it('rejects walking clips and smuggled root coordinates from the legacy training path', () => {
    expect(parseClipDraft(JSON.stringify(reference)).clip).toBeNull()
    expect(() => validatePreviewClip(reference, profile, limits)).toThrow()
    for (const field of ['rootPosition', 'rootRoll']) {
      const legacy = { version: 1, name: 'Wrong version', duration: 1, loop: true,
        keys: [0, 1].map(t => ({ t, ...defaultClipPose(profile), [field]: field === 'rootRoll' ? 0 : rig.rootPosition })) }
      expect(() => validateAuthoredClip(legacy, profile, limits)).toThrow()
      expect(parseClipDraft(JSON.stringify(legacy)).clip).toBeNull()
    }
  })

  it('refuses an incompatible model or impossible fixed-joint contact task without substituting a spin', () => {
    const { kinematics: _kinematics, ...missingKinematics } = scene
    expect(() => compileWalkingPreview(profile, missingKinematics, 'Missing')).toThrow()
    expect(() => compileWalkingPreview(profile, { ...scene, jointNames: ['wrong'] }, 'Wrong order')).toThrow()
    expect(() => validateWalkingClip(reference, profile, { ...scene, jointNames: ['wrong'] }, limits)).toThrow()
    expect(() => walkingLegs({ ...profile, joints: profile.joints.slice(1) }, rig)).toThrow()
    const seed = reference.keys[0]!
    const { bodies } = walkingLegs(profile, rig)
    const targets = walkingFeet(rig, bodies, seed)
    targets[0]!.position[2]! += 1
    expect(() => solveWalkingPose(profile, rig, seed, targets, 0, rig.rootPosition)).toThrow('Unreachable')
  })

  it.each([null, [], 1, {}, { ...reference, version: 2 }, { ...reference, modelSha256: 'b'.repeat(64) },
    { ...reference, contacts: [] }, { ...reference, keys: [] }, { ...reference, keys: null }])('rejects malformed or mismatched walking input %j', (value) => {
    expect(() => validateWalkingClip(value, profile, scene, limits)).toThrow()
  })

  it('requires complete, nonoverlapping, finite contact coverage and valid bounded root fields', () => {
    const changes = [
      (c: typeof reference) => { c.contacts = c.contacts.filter(v => v.start !== 2) },
      (c: typeof reference) => { c.contacts.push({ ...c.contacts[0]! }) },
      (c: typeof reference) => { c.contacts[0]!.quaternion = [0, 0, 0, 2] },
      (c: typeof reference) => { c.contacts[0]!.start = NaN },
      (c: typeof reference) => { c.contacts[0]!.end = 21 },
      (c: typeof reference) => { c.contacts[0]!.position = [0, 0] },
      (c: typeof reference) => { c.keys[1]!.rootPosition = [1, 2, 3] },
      (c: typeof reference) => { c.keys[1]!.rootRoll = 0.4 },
      (c: typeof reference) => { c.keys[1]!.rootPitch = 0.01 },
      (c: typeof reference) => { c.keys.at(-1)!.rootPosition[0]! += 0.01 },
      (c: typeof reference) => { c.keys[5]!.joints[0]! += 0.1 },
    ]
    for (const change of changes) {
      const value = clip(); change(value)
      expect(() => validateWalkingClip(value, profile, scene, limits)).toThrow()
    }
    expect(() => validateWalkingClip(reference, profile, scene, { ...limits, maxClipKeys: 258 })).toThrow()
    expect(() => validateWalkingClip(reference, profile, scene, { ...limits, maxClipSeconds: 19 })).toThrow()
  })
})
