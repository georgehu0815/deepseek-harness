/** Native MuJoCo hinge composition; presentation transforms never step physics or alter scene data. */
import { Box3, Matrix4, Quaternion, Vector3 } from 'three'
import type { RobotSceneKinematics } from '@deepseek-ai/dsh-robot-lab/types'
import type { BodyGeometry } from './body-geometry.ts'

/**
 * Compose the parent-first model tree using absolute hinge radians and +Y root pitch.
 * @param rig - validated model rest transforms, joint anchors, and qpos0 references.
 * @param joints - fourteen positions in scene.jointNames order, not offsets from STAND.
 * @param rootPitch - right-handed pitch in radians; negative leans backward.
 * @param rootYaw - preview heading about world +Z, applied before the root-local pitch; defaults to zero.
 * @param rootPosition - authored world position in meters; omitted legacy clips use the installed root position.
 * @param rootRoll - authored root-local roll in radians, used for kinematic weight-transfer previews.
 * @returns ungrounded MuJoCo Z-up world matrices, including the identity world body.
 */
export function clipPoseMatrices(rig: RobotSceneKinematics, joints: readonly number[], rootPitch: number, rootYaw = 0,
  rootPosition: readonly number[] = rig.rootPosition, rootRoll = 0): Matrix4[] {
  const rotations = new Map(rig.joints.map((joint, index) => [joint.body,
    { ...joint, angle: (joints[index] as number) - joint.reference }]))
  const unit = new Vector3(1, 1, 1)
  const matrices: Matrix4[] = []
  for (const [index, body] of rig.bodies.entries()) {
    if (index === 0) { matrices.push(new Matrix4()); continue }
    if (index === rig.rootBody) {
      matrices.push(new Matrix4().compose(new Vector3().fromArray(rootPosition),
        new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), rootYaw)
          .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), rootPitch))
          .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), rootRoll)), unit))
      continue
    }
    const position = new Vector3().fromArray(body.pos)
    const rotation = new Quaternion(body.quat[1], body.quat[2], body.quat[3], body.quat[0])
    const joint = rotations.get(index)
    if (joint !== undefined) {
      const pivot = new Vector3().fromArray(joint.pos)
      position.add(pivot.clone().applyQuaternion(rotation))
      rotation.multiply(new Quaternion().setFromAxisAngle(new Vector3().fromArray(joint.axis), joint.angle))
      position.sub(pivot.applyQuaternion(rotation))
    }
    matrices.push(new Matrix4().compose(position, rotation, unit).premultiply(matrices[body.parent] as Matrix4))
  }
  return matrices
}

/**
 * Measure the real colored robot meshes in Three.js Y-up coordinates.
 * @param bodies - borrowed merged geometry in body order.
 * @param matrices - ungrounded MuJoCo body matrices.
 * @returns exact rendered-vertex bounds; the caller may translate the display to put its lowest point on the floor.
 */
export function clipPoseBounds(bodies: readonly BodyGeometry[], matrices: readonly Matrix4[]): Box3 {
  const bounds = new Box3()
  const conversion = new Matrix4().makeRotationX(-Math.PI / 2)
  const point = new Vector3()
  for (const [index, body] of bodies.entries()) {
    if (index === 0 || body.geometry === null) continue
    const matrix = (matrices[index] as Matrix4).clone().premultiply(conversion)
    const vertices = body.geometry.getAttribute('position')
    for (let i = 0; i < vertices.count; i++) bounds.expandByPoint(point.fromBufferAttribute(vertices, i).applyMatrix4(matrix))
  }
  return bounds
}

/**
 * Find the exact floor offset without revisiting vertices of bodies that cannot be lowest.
 * @param bodies - Immutable model meshes; their local bounding boxes are cached by Three.js.
 * @param matrices - Borrowed native-world body transforms in the same order.
 * @returns The rendered Y-up grounding offset, or zero for an empty model.
 */
export function clipPoseFloorOffset(bodies: readonly BodyGeometry[], matrices: readonly Matrix4[]): number {
  const conversion = new Matrix4().makeRotationX(-Math.PI / 2)
  const candidates = bodies.flatMap((body, index) => {
    if (index === 0 || body.geometry === null) return []
    const geometry = body.geometry
    if (geometry.boundingBox === null) geometry.computeBoundingBox()
    const matrix = (matrices[index] as Matrix4).clone().premultiply(conversion)
    const lower = (geometry.boundingBox as Box3).clone().applyMatrix4(matrix).min.y
    return [{ geometry, matrix, lower }]
  }).sort((a, b) => a.lower - b.lower)
  let lowest = Infinity
  const point = new Vector3()
  for (const { geometry, matrix, lower } of candidates) {
    if (lower >= lowest) break
    const vertices = geometry.getAttribute('position')
    for (let i = 0; i < vertices.count; i += 1) lowest = Math.min(lowest, point.fromBufferAttribute(vertices, i).applyMatrix4(matrix).y)
  }
  return lowest === Infinity ? 0 : -lowest
}

/**
 * Resolve fixed attachments to the nearest movable ancestor.
 * @param rig - validated parent-first body tree.
 * @param body - raycast body index.
 * @returns a joint index, -1 for the free root pitch, or null for the world.
 */
export function clipJointForBody(rig: RobotSceneKinematics, body: number): number | null {
  while (body !== 0) {
    if (body === rig.rootBody) return -1
    const joint = rig.joints.findIndex(joint => joint.body === body)
    if (joint !== -1) return joint
    body = (rig.bodies[body] as RobotSceneKinematics['bodies'][number]).parent
  }
  return null
}
