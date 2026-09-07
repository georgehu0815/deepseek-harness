/** Coupled leg/root inverse kinematics for authored contact targets; never advances physics. */
import { Quaternion, Vector3 } from 'three'
import type { RobotProfile, RobotSceneKinematics } from '@deepseek-ai/dsh-robot-lab/types'
import { clipPoseMatrices } from './clip-pose-kinematics.ts'
import type { ClipPose } from './clip-motion.ts'

/** A rigid ankle/foot body target in native MuJoCo world coordinates. */
export interface FootTarget { position: number[]; quaternion: number[] }
/** Solved free-root coordinates and absolute servo targets. */
export interface WalkingPose extends ClipPose { rootYaw: number; rootRoll: number; rootPosition: number[] }

const dot = (a: number[], b: number[]) => a.reduce((sum, value, i) => sum + value * (b[i] as number), 0)

// Conjugate gradients on the small positive-definite damped normal equations; no matrix inversion or external runtime.
function dampedStep(columns: number[][], error: number[]): number[] {
  const normal = columns.map((a, i) => columns.map((b, j) => dot(a, b) + (i === j ? 0.00001 : 0)))
  const x = columns.map(() => 0)
  let residual = columns.map(column => -dot(column, error))
  let direction = [...residual]
  let squared = dot(residual, residual)
  for (let iteration = 0; iteration < columns.length * 3 && squared > 1e-20; iteration += 1) {
    const product = normal.map(row => dot(row, direction))
    const alpha = squared / dot(direction, product)
    for (let i = 0; i < x.length; i += 1) x[i] = (x[i] as number) + alpha * (direction[i] as number)
    residual = residual.map((value, i) => value - alpha * (product[i] as number))
    const next = dot(residual, residual)
    direction = residual.map((value, i) => value + next / squared * (direction[i] as number))
    squared = next
  }
  return x
}

/**
 * Resolve the installed five-joint chains and foot body indices, rejecting incompatible models.
 * @param profile - Installed joint order and bounds.
 * @param rig - Installed forward-kinematics data in that order.
 * @returns Left then right chain indices and their rigid foot body ids.
 */
export function walkingLegs(profile: RobotProfile, rig: RobotSceneKinematics) {
  const chains = ['left', 'right'].map(side => ['hip_yaw', 'hip_roll', 'hip_pitch', 'knee', 'ankle']
    .map(name => profile.joints.findIndex(joint => joint.name === `${side}_${name}`)))
  if (chains.flat().some(index => index < 0) || rig.joints.length !== profile.joints.length) throw new Error('walking model')
  return { indices: chains.flat(), bodies: chains.map(chain => (rig.joints[chain[4] as number] as RobotSceneKinematics['joints'][number]).body) }
}

/**
 * Read rigid foot transforms using the same composition as the preview renderer.
 * @param rig - Installed body and hinge tree.
 * @param bodies - Foot body ids in target order.
 * @param pose - Absolute joints and free-root pose.
 * @returns Foot origins and unit quaternions (x, y, z, w).
 */
export function walkingFeet(rig: RobotSceneKinematics, bodies: number[], pose: WalkingPose): FootTarget[] {
  const matrices = clipPoseMatrices(rig, pose.joints, pose.rootPitch, pose.rootYaw, pose.rootPosition, pose.rootRoll)
  return bodies.map((body) => {
    const matrix = matrices[body] as typeof matrices[number]
    return { position: new Vector3().setFromMatrixPosition(matrix).toArray(),
      quaternion: new Quaternion().setFromRotationMatrix(matrix).toArray() }
  })
}

/**
 * Solve both rigid feet together with root translation/roll and bounded leg servos.
 * @param profile - Installed servo bounds.
 * @param rig - Installed kinematics; root pitch remains zero.
 * @param seed - Nearby pose, normally the previous solved sample.
 * @param targets - Left and right rigid-foot targets; stance targets remain fixed across a step.
 * @param rootYaw - Authored unwrapped heading.
 * @param preferredPosition - Weak body-position preference, subordinate to foot placement.
 * @returns A bounded kinematic pose, or throws when the foot targets cannot be met.
 */
export function solveWalkingPose(profile: RobotProfile, rig: RobotSceneKinematics, seed: WalkingPose,
  targets: FootTarget[], rootYaw: number, preferredPosition: number[]): WalkingPose {
  const { indices, bodies } = walkingLegs(profile, rig)
  let variables = [...indices.map(index => seed.joints[index] as number), ...seed.rootPosition, seed.rootRoll]
  const poseAt = (values: number[]): WalkingPose => {
    const joints = [...seed.joints]
    indices.forEach((index, at) => { joints[index] = values[at] as number })
    return { joints, rootPitch: 0, rootYaw, rootPosition: values.slice(10, 13), rootRoll: values[13] as number }
  }
  const residual = (values: number[]) => {
    const feet = walkingFeet(rig, bodies, poseAt(values))
    const result: number[] = []
    for (const [index, foot] of feet.entries()) {
      const target = targets[index] as FootTarget
      result.push(...new Vector3().fromArray(foot.position).sub(new Vector3().fromArray(target.position)).multiplyScalar(30).toArray())
      const delta = new Quaternion().fromArray(foot.quaternion).multiply(new Quaternion().fromArray(target.quaternion).invert())
      const sign = delta.w < 0 ? -2 : 2
      result.push(delta.x * sign, delta.y * sign, delta.z * sign)
    }
    result.push(...values.slice(10, 13).map((value, i) => (value - (preferredPosition[i] as number)) * 0.01))
    return result
  }
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const error = residual(variables)
    if (Math.max(...error.slice(0, 12).map(Math.abs)) < 0.000001) break
    const jacobian = variables.map((value, index) => {
      const perturbed = [...variables]; perturbed[index] = value + 0.00001
      return residual(perturbed).map((value, at) => (value - (error[at] as number)) / 0.00001)
    })
    const change = dampedStep(jacobian, error)
    variables = variables.map((value, i) => {
      const bound = i >= 10 && i < 13 ? 0.003 : 0.08
      const next = value + Math.max(-bound, Math.min(bound, change[i] as number))
      if (i < 10) {
        const joint = profile.joints[indices[i] as number] as RobotProfile['joints'][number]
        return Math.max(joint.lower, Math.min(joint.upper, next))
      }
      return i === 13 ? Math.max(-0.35, Math.min(0.35, next)) : next
    })
  }
  const pose = poseAt(variables)
  const feet = walkingFeet(rig, bodies, pose)
  if (feet.some((foot, index) => {
    const target = targets[index] as FootTarget
    return new Vector3().fromArray(foot.position).distanceTo(new Vector3().fromArray(target.position)) > 0.00005
      || new Quaternion().fromArray(foot.quaternion).angleTo(new Quaternion().fromArray(target.quaternion)) > 0.001
  })) throw new Error('Unreachable walking contact targets')
  return pose
}
