/** Analytic test vertices attached to the installed model's MuJoCo-generated STAND body tree. */
import type { RobotScene } from '@deepseek-ai/dsh-robot-lab/types'
import { poseFixture } from './clip-pose-fixture.ts'

/**
 * Create independent geometry inputs without requiring installed assets or a MuJoCo process.
 * @returns the real pose fixture with a small indexed cuboid on each robot body.
 */
export function clipPartScene(): RobotScene {
  const scene = structuredClone(poseFixture.scene)
  scene.meshes = [{ v: [-0.01, -0.015, -0.02, 0.01, -0.015, -0.02, 0.01, 0.015, -0.02, -0.01, 0.015, -0.02,
    -0.01, -0.015, 0.02, 0.01, -0.015, 0.02, 0.01, 0.015, 0.02, -0.01, 0.015, 0.02],
  f: [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5,
    2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7] }]
  scene.geoms = scene.bodies.slice(1).map((_, index) => ({ mesh: 0, body: index + 1,
    pos: [0, 0, 0], quat: [1, 0, 0, 0], mat: 'test', rgba: [1, 1, 1, 1] }))
  return scene
}
