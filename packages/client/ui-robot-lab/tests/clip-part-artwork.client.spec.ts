import { afterEach, describe, expect, it, vi } from 'vitest'
import { BufferGeometry } from 'three'
import { buildClipPartArtwork } from '../src/client/clip-part-artwork.ts'
import * as kinematics from '../src/client/clip-pose-kinematics.ts'
import { clipPartScene } from './clip-part-fixture.ts'
import { poseFixture } from './clip-pose-fixture.ts'

afterEach(() => { vi.restoreAllMocks() })

describe('model-derived part artwork', () => {
  it('builds compact stable JSON silhouettes from the real STAND tree without mutating its inputs', () => {
    const scene = clipPartScene()
    const before = structuredClone(scene)
    const artwork = buildClipPartArtwork(scene)!
    expect(artwork.viewBox).toBe('0 0 64 64')
    expect(artwork.bodies).toHaveLength(scene.bodies.length - 1)
    expect(new Set(artwork.bodies.map(body => body.path)).size).toBe(scene.bodies.length - 1)
    expect(artwork.bodies.every(body => /^M[\d.,L]+Z$/.test(body.path))).toBe(true)
    for (const body of artwork.bodies) {
      const coordinates = body.path.match(/\d+(?:\.\d+)?/g)!.map(Number)
      expect(Math.min(...coordinates)).toBeGreaterThanOrEqual(4)
      expect(Math.max(...coordinates)).toBeLessThanOrEqual(60)
      expect(body.path.split('L').length).toBeLessThanOrEqual(8)
    }
    expect(JSON.parse(JSON.stringify(artwork))).toEqual(artwork)
    expect(buildClipPartArtwork(scene)).toEqual(artwork)
    expect(buildClipPartArtwork(structuredClone(scene))).toEqual(artwork)
    expect(scene).toEqual(before)
    expect(scene.defaultJoints).toEqual(poseFixture.cases[0]!.joints)
  })

  it('changes silhouettes when installed mesh vertices, geom transforms or STAND joints change', () => {
    const scene = clipPartScene()
    const artwork = buildClipPartArtwork(scene)
    const meshChanged = structuredClone(scene)
    meshChanged.meshes[0]!.v[0] = -0.035
    expect(buildClipPartArtwork(meshChanged)).not.toEqual(artwork)
    const geomChanged = structuredClone(scene)
    geomChanged.geoms[0]!.pos = [0.02, 0.03, 0.04]
    geomChanged.geoms[0]!.quat = [Math.SQRT1_2, 0, Math.SQRT1_2, 0]
    expect(buildClipPartArtwork(geomChanged)).not.toEqual(artwork)
    const standChanged = structuredClone(scene)
    standChanged.defaultJoints = poseFixture.cases[1]!.joints
    expect(buildClipPartArtwork(standChanged)).not.toEqual(artwork)
  })

  it('maps every hinge and fixed attachment to its nearest joint, separate from root and world attachments', () => {
    const scene = clipPartScene()
    const rig = scene.kinematics!
    const firstFixed = scene.bodies.length
    for (const [offset, parent] of [rig.joints[8]!.body, firstFixed, rig.rootBody, 0].entries()) {
      scene.bodies.push(`fixed-${offset}`)
      rig.bodies.push({ parent, pos: [0.025, 0, 0], quat: [1, 0, 0, 0] })
      scene.geoms.push({ ...scene.geoms[0]!, body: firstFixed + offset })
    }
    const artwork = buildClipPartArtwork(scene)!
    for (const [joint, hinge] of rig.joints.entries()) {
      expect(artwork.bodies.find(body => body.body === hinge.body)!.joint).toBe(joint)
    }
    expect(artwork.bodies.find(body => body.body === rig.rootBody)!.joint).toBe(-1)
    expect([0, 1, 2, 3].map(offset => artwork.bodies.find(body => body.body === firstFixed + offset)!.joint))
      .toEqual([8, 8, -1, null])
  })

  it('does not allocate geometry when optional kinematics or mesh data is absent', () => {
    const scene = clipPartScene()
    const { kinematics: _, ...recordedOnly } = scene
    const dispose = vi.spyOn(BufferGeometry.prototype, 'dispose')
    expect(buildClipPartArtwork(recordedOnly)).toBeNull()
    expect(buildClipPartArtwork(poseFixture.scene)).toBeNull()
    expect(buildClipPartArtwork({ ...scene, meshes: [] })).toBeNull()
    expect(buildClipPartArtwork({ ...scene, geoms: [] })).toBeNull()
    expect(dispose).not.toHaveBeenCalled()
  })

  it.each([
    [], [0, 0, 0], [0, 0, 0, 1, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 1, 0, 0, 2],
  ])('returns null for unusable outline vertices %j', (...vertices) => {
    const scene = clipPartScene()
    scene.geoms = [scene.geoms[0]!]
    scene.meshes = [{ v: vertices, f: vertices.length >= 9 ? [0, 1, 2] : [] }]
    const dispose = vi.spyOn(BufferGeometry.prototype, 'dispose')
    expect(buildClipPartArtwork(scene)).toBeNull()
    expect(dispose).toHaveBeenCalledTimes(3)
  })

  it('omits world geometry instead of including floor silhouettes', () => {
    const scene = clipPartScene()
    scene.geoms = [{ ...scene.geoms[0]!, body: 0 }]
    expect(buildClipPartArtwork(scene)).toBeNull()
  })

  it('deduplicates and removes interior and collinear projected vertices from its hull', () => {
    const scene = clipPartScene()
    scene.geoms = [scene.geoms[0]!]
    const mesh = scene.meshes[0]!
    const first = buildClipPartArtwork(scene)!
    mesh.v.push(...mesh.v, 0, 0, 0, 0, -0.015, -0.02)
    expect(buildClipPartArtwork(scene)).toEqual(first)
    const reversed: number[] = []
    for (let index = mesh.v.length - 3; index >= 0; index -= 3) reversed.push(...mesh.v.slice(index, index + 3))
    mesh.v = reversed
    expect(buildClipPartArtwork(scene)).toEqual(first)
  })

  it('orders equal-depth bodies deterministically by body index', () => {
    const scene = clipPartScene()
    const rig = scene.kinematics!
    const body = scene.bodies.length
    scene.bodies.push('fixed-overlap')
    rig.bodies.push({ parent: rig.rootBody, pos: [0, 0, 0], quat: [1, 0, 0, 0] })
    scene.geoms = [scene.geoms[0]!, { ...scene.geoms[0]!, body }]
    expect(buildClipPartArtwork(scene)!.bodies.map(part => part.body)).toEqual([rig.rootBody, body])
  })

  it.each([false, true])('releases each temporary geometry exactly once, including projection failure=%s', (fail) => {
    const scene = clipPartScene()
    const dispose = vi.spyOn(BufferGeometry.prototype, 'dispose')
    if (fail) vi.spyOn(kinematics, 'clipPoseMatrices').mockImplementationOnce(() => { throw new Error('projection failed') })
    if (fail) expect(() => buildClipPartArtwork(scene)).toThrow('projection failed')
    else expect(buildClipPartArtwork(scene)).not.toBeNull()
    expect(dispose).toHaveBeenCalledTimes(1 + scene.geoms.length * 2)
    expect(new Set(dispose.mock.contexts).size).toBe(dispose.mock.calls.length)
  })
})
