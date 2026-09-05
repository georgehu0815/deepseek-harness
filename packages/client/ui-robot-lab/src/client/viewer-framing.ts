/** Camera and stage measurements from recorded body transforms, without modifying physics data. */
import { Box3, Matrix4, Quaternion, Vector3 } from 'three'
import type { RobotFrame } from '@deepseek-ai/dsh-robot-lab/types'
import type { BodyGeometry } from './body-geometry.ts'
import type { ViewerCameraView } from './viewer-presets.ts'

/** Exact Three.js Y-up conversion of MuJoCo Z-up coordinates. */
const MUJOCO_TO_THREE = new Matrix4().makeRotationX(-Math.PI / 2)

/**
 * Measure every rendered vertex after its recorded body transform.
 * @param bodies - merged body-local geometry, owned by the caller.
 * @param frame - recorded world poses; absent recordings produce empty bounds.
 * @returns a new Y-up world box, without moving geometry or editing poses.
 */
export function frameBounds(bodies: readonly BodyGeometry[], frame: RobotFrame | undefined): Box3 {
  const bounds = new Box3()
  if (frame === undefined) return bounds
  const matrix = new Matrix4()
  const position = new Vector3()
  const rotation = new Quaternion()
  const unitScale = new Vector3(1, 1, 1)
  const vertex = new Vector3()
  for (const [index, body] of bodies.entries()) {
    const pose = frame.bodies[index]
    if (body.geometry === null || pose === undefined) continue
    position.fromArray(pose)
    rotation.fromArray(pose, 3)
    rotation.set(rotation.y, rotation.z, rotation.w, rotation.x)
    matrix.compose(position, rotation, unitScale).premultiply(MUJOCO_TO_THREE)
    const vertices = body.geometry.getAttribute('position')
    for (let i = 0; i < vertices.count; i++) bounds.expandByPoint(vertex.fromBufferAttribute(vertices, i).applyMatrix4(matrix))
  }
  return bounds
}

/**
 * Fit the first pose with margin, or aim at the grid origin when no pose is loaded.
 * @param bounds - actual rendered robot bounds, not the full motion path.
 * @param aspect - positive viewport width divided by height.
 * @param view - requested camera direction.
 * @param fov - vertical field of view in degrees.
 * @returns target, position, distance, and clipping planes for a perspective camera.
 */
export function fitCamera(bounds: Box3, aspect: number, view: ViewerCameraView, fov: number): {
  target: Vector3
  position: Vector3
  distance: number
  near: number
  far: number
  size: number
} {
  const target = bounds.isEmpty() ? new Vector3() : bounds.getCenter(new Vector3())
  const direction = {
    perspective: new Vector3(1.25, 0.72, 1),
    front: new Vector3(1, 0.08, 0),
    side: new Vector3(0, 0.08, 1),
    top: new Vector3(0, 1, 0.0001),
  }[view].normalize()
  const right = new Vector3().crossVectors(new Vector3(0, 1, 0), direction).normalize()
  const up = new Vector3().crossVectors(direction, right).normalize()
  const tanV = Math.tan(fov * Math.PI / 360)
  const tanH = tanV * aspect
  const size = bounds.isEmpty() ? 0.3 : Math.max(bounds.getSize(new Vector3()).length(), 0.01)
  let distance = bounds.isEmpty() ? size / Math.min(tanV, tanH) : size * 0.5
  if (!bounds.isEmpty()) {
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        const offset = new Vector3(x, y, z).sub(target)
        const depth = offset.dot(direction)
        distance = Math.max(distance, depth + 1.25 * Math.abs(offset.dot(right)) / tanH,
          depth + 1.25 * Math.abs(offset.dot(up)) / tanV)
      }
    }
  }
  return { target, position: target.clone().addScaledVector(direction, distance), distance,
    near: Math.max(size / 1000, 0.0001), far: Math.max(100, distance * 20), size }
}

/**
 * Cover recorded motion on the ground while keeping shadow texels near the initial robot.
 * @param bounds - first-frame Y-up bounds.
 * @param frames - recorded world poses, read without mutation.
 * @returns a ground center/size and a bounded shadow radius in meters.
 */
export function stageDimensions(bounds: Box3, frames: readonly RobotFrame[]): {
  center: Vector3
  floorSize: number
  shadowRadius: number
} {
  const extent = bounds.clone()
  const point = new Vector3()
  for (const frame of frames) for (const pose of frame.bodies) extent.expandByPoint(point.fromArray(pose).applyMatrix4(MUJOCO_TO_THREE))
  const center = bounds.isEmpty() ? new Vector3() : bounds.getCenter(new Vector3())
  center.y = 0
  const span = extent.isEmpty() ? 0 : Math.max(
    Math.abs(extent.min.x - center.x), Math.abs(extent.max.x - center.x),
    Math.abs(extent.min.z - center.z), Math.abs(extent.max.z - center.z))
  const robotSize = bounds.isEmpty() ? 0.3 : bounds.getSize(new Vector3()).length()
  return { center, floorSize: Math.max(12, span * 2 + robotSize * 4),
    shadowRadius: Math.max(robotSize * 1.5, Math.min(span + robotSize, 2)) }
}
