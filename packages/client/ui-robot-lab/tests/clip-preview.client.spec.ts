import { describe, expect, it } from 'vitest'
import { compileTurningPreview, rootYawLimit, validatePreviewClip } from '../src/client/clip-preview.ts'
import { applyClipRig, defaultClipPose, sampleAuthoredClip, validateAuthoredClip } from '../src/client/clip-motion.ts'
import { createClipGenStore } from '../src/client/clip-gen-store.ts'
import { parseClipDraft } from '../src/client/clip-draft.ts'
import { fixtureProfile } from './fixtures.client.ts'
import { poseFixture } from './clip-pose-fixture.ts'

const profile = { ...fixtureProfile, joints: fixtureProfile.joints.map((joint, index) => ({ ...joint,
  name: poseFixture.scene.jointNames[index]!, defaultPosition: poseFixture.scene.defaultJoints[index]!,
})) }
const limits = { maxClipSeconds: 120, maxClipKeys: 512 }
const demo = () => compileTurningPreview(profile, 120, '左转一圈，再右转一圈 🦆')

describe('preview-only full-body turns', () => {
  it('authors forty beats with a full left turn, a full right turn, alternating legs and exact neutral endpoints', () => {
    const clip = demo()
    expect(clip).toMatchObject({ version: 2, duration: 20, loop: true })
    expect(clip.keys).toHaveLength(81)
    expect(clip.keys.map(key => key.t)).toEqual(Array.from({ length: 81 }, (_, index) => index / 4))
    expect(validatePreviewClip(JSON.parse(JSON.stringify(clip)), profile, limits)).toEqual(clip)
    const neutral = defaultClipPose(profile)
    expect(clip.keys[0]).toEqual({ t: 0, ...neutral, rootYaw: 0 })
    expect(clip.keys.at(-1)).toEqual({ t: 20, ...neutral, rootYaw: 0 })
    expect(sampleAuthoredClip(clip, 2).rootYaw).toBe(0)
    expect(sampleAuthoredClip(clip, 6).rootYaw).toBe(Math.PI)
    expect(sampleAuthoredClip(clip, 10).rootYaw).toBe(rootYawLimit)
    expect(sampleAuthoredClip(clip, 14).rootYaw).toBe(Math.PI)
    expect(sampleAuthoredClip(clip, 18).rootYaw).toBe(0)
    expect(sampleAuthoredClip(clip, 2.25).joints[2]).toBeLessThan(sampleAuthoredClip(clip, 2.75).joints[2]!)
    expect(sampleAuthoredClip(clip, 2.75).joints[11]).toBeGreaterThan(sampleAuthoredClip(clip, 2.25).joints[11]!)
    expect(clip.keys.every(key => key.rootPitch === 0)).toBe(true)
  })

  it('interpolates unwrapped headings instead of taking the quaternion shortest path', () => {
    const clip = demo()
    clip.keys = [0, 10, 20].map(t => ({ t, ...defaultClipPose(profile), rootYaw: t === 10 ? rootYawLimit : 0 }))
    expect(sampleAuthoredClip(clip, 5).rootYaw).toBe(Math.PI)
    expect(sampleAuthoredClip(clip, 15).rootYaw).toBe(Math.PI)
    expect(sampleAuthoredClip(clip, -1).rootYaw).toBe(0)
    expect(sampleAuthoredClip(clip, 21).rootYaw).toBe(0)
    clip.keys[1]!.rootYaw = -rootYawLimit
    expect(sampleAuthoredClip(clip, 5).rootYaw).toBe(-Math.PI)
    expect(validatePreviewClip(clip, profile, limits)).toEqual(clip)
  })

  it('preserves version-one imports and refuses preview heading in training parsers', () => {
    const preview = demo()
    const legacy = { ...preview, version: 1, keys: preview.keys.map(({ rootYaw: _yaw, ...key }) => key) }
    expect(validatePreviewClip(legacy, profile, limits)).toEqual(legacy)
    expect(parseClipDraft(JSON.stringify(legacy)).error).toBeNull()
    for (const value of [preview, { ...preview, version: 1 }]) {
      expect(() => validateAuthoredClip(value, profile, limits)).toThrow()
      expect(parseClipDraft(JSON.stringify(value)).clip).toBeNull()
      expect(parseClipDraft(JSON.stringify(value)).error).not.toBeNull()
    }
  })

  it.each([undefined, null, '1', NaN, Infinity, -Infinity, rootYawLimit + 0.001, -rootYawLimit - 0.001])(
    'rejects missing, malformed or out-of-range heading %s', (rootYaw) => {
      const clip = demo()
      const keys = clip.keys.map((key, index) => index === 1 ? { ...key, rootYaw } : key)
      expect(() => validatePreviewClip({ ...clip, keys }, profile, limits)).toThrow()
    })

  it('rejects incomplete timelines, unknown preview channels and resource excess without loading a valid prefix', () => {
    const clip = demo()
    expect(() => validatePreviewClip({ ...clip, keys: clip.keys.slice(0, -1) }, profile, limits)).toThrow()
    expect(() => validatePreviewClip({ ...clip, keys: null }, profile, limits)).toThrow()
    expect(() => validatePreviewClip({ ...clip, keys: [null, ...clip.keys.slice(1)] }, profile, limits)).toThrow()
    expect(() => validatePreviewClip({ ...clip, keys: clip.keys.map(key => ({ ...key, rootRoll: 0 })) }, profile, limits)).toThrow()
    expect(() => validatePreviewClip(clip, profile, { ...limits, maxClipKeys: 80 })).toThrow()
    expect(() => validatePreviewClip(clip, profile, { ...limits, maxClipSeconds: 19 })).toThrow()
    expect(() => validatePreviewClip({ ...clip, keys: [] }, profile, limits)).toThrow()
  })

  it('preserves heading across rig edits, keying, time changes, preview and reset without downgrading export', () => {
    const store = createClipGenStore(120, 8).create()
    store.actions.heading(1)
    expect(store.getSnapshot().clip).toBeNull()
    store.actions.load(demo())
    store.actions.seek(6)
    store.actions.verify(true)
    store.actions.pose(applyClipRig(profile, store.getSnapshot().pose!, 'squat', 0.05))
    expect(store.getSnapshot().pose!.rootYaw).toBe(Math.PI)
    expect(store.getSnapshot().verifiedRevision).toBeNull()
    store.actions.key(512)
    store.actions.heading(-100)
    expect(store.getSnapshot().pose!.rootYaw).toBe(-rootYawLimit)
    store.actions.heading(100)
    store.actions.key(512)
    store.actions.seek(6.125)
    store.actions.key(512)
    store.actions.meta({ duration: 40 })
    store.actions.seek(12)
    expect(store.getSnapshot().pose!.rootYaw).toBe(rootYawLimit)
    store.actions.tick(20, false)
    expect(store.getSnapshot().pose!.rootYaw).toBe(rootYawLimit)
    store.actions.defaultPose(profile)
    expect(store.getSnapshot().pose).toEqual({ ...defaultClipPose(profile), rootYaw: 0 })
    store.actions.key(512)
    expect(store.getSnapshot().clip!.version).toBe(2)
    expect(validatePreviewClip(JSON.parse(JSON.stringify(store.getSnapshot().clip)), profile, limits)).toEqual(store.getSnapshot().clip)
  })

  it('promotes legacy keys explicitly and blocks heading edits while recording', () => {
    const store = createClipGenStore(120, 8).create()
    const pose = defaultClipPose(profile)
    store.actions.load({ version: 1, name: 'Legacy', duration: 1, loop: true, keys: [{ t: 0, ...pose }, { t: 1, ...pose }] })
    store.actions.heading(1)
    expect(store.getSnapshot()).toMatchObject({ clip: { version: 2 }, pose: { rootYaw: 1 }, unkeyed: true })
    expect(store.getSnapshot().clip!.keys.every(key => 'rootYaw' in key && key.rootYaw === 0)).toBe(true)
    store.actions.key(512)
    store.actions.previewReady(true); store.actions.verify(true); store.actions.generate()
    const before = store.getSnapshot()
    store.actions.heading(2)
    expect(store.getSnapshot()).toEqual(before)
  })
})
