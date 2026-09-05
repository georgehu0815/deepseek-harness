/** Evaluation evidence is tied to an exact policy artifact, not the generic evaluated flag. */
import type { RobotEvaluation, RobotPolicy } from '@deepseek-ai/dsh-robot-lab/types'

/**
 * Present a verdict only when the loaded report identifies this exact policy artifact.
 * @param policy - selected policy metadata.
 * @param evaluation - latest loaded evaluation, which may belong to another artifact.
 * @returns an English status that does not imply hardware approval.
 */
export function policyStatus(policy: RobotPolicy, evaluation: RobotEvaluation | null): string {
  if (!policy.runtimeCompatibility.available) return 'Incompatible with current runtime'
  if (evaluation !== null && evaluation.policyId === policy.id && evaluation.policyHash === policy.sha256) {
    return evaluation.passed ? 'Simulation evaluation passed; not hardware certification' : 'Simulation evaluation failed'
  }
  return policy.verification === 'evaluated' ? 'Evaluation recorded; conclusion not loaded' : 'Unverified'
}
