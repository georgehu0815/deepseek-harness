/** Session-local independent duck recordings sharing a playback clock, without inter-duck physics. */
import type { RobotPolicyId, RobotProjectRevisionId, RobotSimulation } from '@deepseek-ai/dsh-robot-lab/types'

/** Authored duck selection and stage placement; a group gesture copies these values before simulation. */
export interface DuckMember {
  id: number
  name: string
  policyId: RobotPolicyId | null
  projectRevisionId: RobotProjectRevisionId | null
  x: number
  z: number
}

/** One independently simulated policy bound to its captured duck selection. */
export interface GroupTrack { member: DuckMember; simulation: RobotSimulation }

/** Atomically loaded tracks; duration stops their shared clock at the shortest recorded endpoint. */
export interface GroupRecording { tracks: GroupTrack[]; duration: number }
