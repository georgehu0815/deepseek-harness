/** Installed model identity and native body tree captured with mj_kinematics only. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RobotProfile, RobotScene, RobotStudioCatalog } from '@deepseek-ai/dsh-robot-lab/types'

/** No geometry stand-in is used to validate the contact-constrained JSON. */
export const danceV2Model = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures/dance-v2-model.json'), 'utf8')) as {
  profile: RobotProfile
  scene: RobotScene
  limits: RobotStudioCatalog['limits']
}
