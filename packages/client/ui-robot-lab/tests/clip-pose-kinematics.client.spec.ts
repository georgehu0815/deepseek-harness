import { describe, expect, it, vi } from 'vitest'
import { BufferGeometry, Float32BufferAttribute, Matrix4, Quaternion, Vector3 } from 'three'
import { clipJointForBody, clipPoseBounds, clipPoseFloorOffset, clipPoseMatrices } from '../src/client/clip-pose-kinematics.ts'
import { poseFixture } from './clip-pose-fixture.ts'

describe('native MicroDuck forward kinematics', () => {
  it('keeps exact rotated mesh grounding while skipping vertices above the lowest candidate', () => {
    const foot = new BufferGeometry().setAttribute('position', new Float32BufferAttribute([0, 0, -1, 1, 0, 0, 0, 1, 1], 3))
    const head = new BufferGeometry().setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 1], 3))
    try {
      head.computeBoundingBox()
      const read = vi.spyOn(head.getAttribute('position'), 'getX')
      try {
        const bodies = [{ name: 'world', geometry: null }, { name: 'foot', geometry: foot }, { name: 'head', geometry: head }]
        for (const angle of [0, 0.2, -0.4, 1.2, 2.7]) {
          const matrices = [new Matrix4(), new Matrix4().makeRotationY(angle), new Matrix4().makeTranslation(0, 0, 10)]
          read.mockClear()
          const offset = clipPoseFloorOffset(bodies, matrices)
          expect(read).not.toHaveBeenCalled()
          expect(offset).toBeCloseTo(-clipPoseBounds(bodies, matrices).min.y, 12)
        }
        expect(clipPoseFloorOffset([], [])).toBe(0)
      } finally { read.mockRestore() }
    } finally { foot.dispose(); head.dispose() }
  })

  it.each(poseFixture.cases)('matches every MuJoCo body at root pitch $rootPitch', (pose) => {
    const before = structuredClone(poseFixture)
    const matrices = clipPoseMatrices(poseFixture.scene.kinematics!, pose.joints, pose.rootPitch)
    for (const [index, expected] of pose.bodies.entries()) {
      const position = new Vector3()
      const rotation = new Quaternion()
      matrices[index]!.decompose(position, rotation, new Vector3())
      expect(position.distanceTo(new Vector3().fromArray(expected))).toBeLessThan(1e-12)
      const expectedRotation = new Quaternion(expected[4], expected[5], expected[6], expected[3])
      expect(1 - Math.abs(rotation.dot(expectedRotation))).toBeLessThan(1e-12)
    }
    expect(poseFixture).toEqual(before)
  })

  it('rotates every body around the root about world Z before applying root-local pitch', () => {
    const rig = poseFixture.scene.kinematics!
    const pivot = new Vector3().fromArray(rig.rootPosition)
    const base = clipPoseMatrices(rig, poseFixture.scene.defaultJoints, 0.3)
    for (const yaw of [-Math.PI / 2, Math.PI / 2, Math.PI, 2 * Math.PI]) {
      const rotated = clipPoseMatrices(rig, poseFixture.scene.defaultJoints, 0.3, yaw)
      const rotation = new Matrix4().makeRotationZ(yaw)
      const aroundRoot = new Matrix4().makeTranslation(...pivot.toArray()).multiply(rotation)
        .multiply(new Matrix4().makeTranslation(...pivot.clone().negate().toArray()))
      for (let index = 1; index < rotated.length; index += 1) {
        const expected = aroundRoot.clone().multiply(base[index]!)
        rotated[index]!.elements.forEach((value, at) => { expect(value).toBeCloseTo(expected.elements[at]!, 12) })
      }
      expect(rotated[0]).toEqual(new Matrix4())
    }
  })

  it('rotates nonzero hinge anchors around qpos0 rather than the default standing angles', () => {
    const rig = { rootBody: 1, rootPosition: [0, 0, 0], bodies: [
      { parent: 0, pos: [0, 0, 0], quat: [1, 0, 0, 0] },
      { parent: 0, pos: [0, 0, 0], quat: [1, 0, 0, 0] },
      { parent: 1, pos: [2, 0, 0], quat: [1, 0, 0, 0] },
      { parent: 2, pos: [1, 0, 0], quat: [1, 0, 0, 0] },
    ], joints: [{ body: 2, pos: [1, 0, 0], axis: [0, 0, 1], reference: 0.5 }] }
    const matrices = clipPoseMatrices(rig, [0.5 + Math.PI / 2], 0)
    expect(new Vector3().setFromMatrixPosition(matrices[2]!).toArray()).toEqual([expect.closeTo(3), expect.closeTo(-1), 0])
    expect(new Vector3().setFromMatrixPosition(matrices[3]!).toArray()).toEqual([expect.closeTo(3), expect.closeTo(0), 0])
    expect(clipJointForBody(rig, 0)).toBeNull()
    expect(clipJointForBody(rig, 1)).toBe(-1)
    expect(clipJointForBody(rig, 3)).toBe(0)
  })

  it('measures actual body-local vertices after Z-up conversion without touching geometry or physics', () => {
    const geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute([1, 2, -3, 4, -2, 5], 3))
    try {
      const bodies = [{ name: 'world', geometry }, { name: 'empty', geometry: null }, { name: 'foot', geometry }]
      const transforms = [new Matrix4(), new Matrix4(), new Matrix4().makeTranslation(2, 3, 4)]
      const bounds = clipPoseBounds(bodies, transforms)
      expect(bounds.min.toArray()).toEqual([3, expect.closeTo(1), expect.closeTo(-5)])
      expect(bounds.max.toArray()).toEqual([6, expect.closeTo(9), expect.closeTo(-1)])
      expect(clipPoseBounds([], []).isEmpty()).toBe(true)
      expect(Array.from(geometry.getAttribute('position').array)).toEqual([1, 2, -3, 4, -2, 5])
      expect(new Vector3().setFromMatrixPosition(transforms[2]!).toArray()).toEqual([2, 3, 4])
    } finally { geometry.dispose() }
  })
})
