/** MuJoCo-generated body transforms shared by focused native pose renderer tests. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RobotScene } from '@deepseek-ai/dsh-robot-lab/types'

export const poseFixture = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures/clip-pose-mujoco.json'), 'utf8')) as {
  scene: RobotScene
  mujocoVersion: string
  cases: Array<{ joints: number[]; rootPitch: number; bodies: number[][] }>
}
