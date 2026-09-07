/** Evaluation evidence is tied to an exact policy artifact, not the generic evaluated flag. */
import type { RobotEvaluation, RobotPolicy } from '@deepseek-ai/dsh-robot-lab/types'

/**
 * Present a verdict only when the loaded report identifies this exact policy artifact.
 * @param policy - selected policy metadata.
 * @param evaluation - latest loaded evaluation, which may belong to another artifact.
 * @returns a locale key for exact-artifact balance evidence, never a choreography verdict.
 */
export function policyStatus(policy: RobotPolicy, evaluation: RobotEvaluation | null):
  'policy.incompatible' | 'policy.recorded' | 'policy.unverified' | 'assessment.balancePassed' | 'assessment.balanceFailed' {
  if (!policy.runtimeCompatibility.available) return 'policy.incompatible'
  if (evaluation !== null && evaluation.policyId === policy.id && evaluation.policyHash === policy.sha256) {
    return evaluation.passed ? 'assessment.balancePassed' : 'assessment.balanceFailed'
  }
  return policy.verification === 'evaluated' ? 'policy.recorded' : 'policy.unverified'
}
