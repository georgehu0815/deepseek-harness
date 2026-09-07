import { describe, expect, it } from 'vitest'
import type { RobotEvaluation, RobotEvaluationId, RobotPolicy, RobotPolicyId } from '@deepseek-ai/dsh-robot-lab/types'
import { policyStatus } from '../src/client/policy-status.ts'
import { fixturePhysics } from './fixtures.client.ts'

const policy: RobotPolicy = {
  id: 'policy-one' as RobotPolicyId, name: 'Fixture', runId: null, sha256: 'a'.repeat(64),
  observationProfile: 'microduck-standard-61', verification: 'evaluated',
  runtimeCompatibility: { available: true, reason: null },
  deployment: { available: false, reason: 'Not hardware verified' },
}
const evaluation: RobotEvaluation = {
  id: 'eval-one' as RobotEvaluationId, createdAt: '2026-09-04T00:00:00Z', evaluatedAt: '2026-09-04T00:00:01Z',
  policyId: policy.id, policyHash: policy.sha256, physics: fixturePhysics,
  observationProfile: 'microduck-standard-61', passed: false, limitations: ['Simulation only'],
  spec: { policyId: policy.id, episodes: 1, stepsPerEpisode: 50, seed: 1, maxTerminations: 0, minMeanUprightFraction: 0.9 },
  episodes: [{ seed: 1, steps: 50, terminated: true, reward: 0, uprightFraction: 0.5, poseRmse: null, bamSettings: {} }],
}

describe('policy evidence status', () => {
  it('shows a failed matching evaluation rather than treating evaluated as passed', () => {
    expect(policyStatus(policy, evaluation)).toBe('assessment.balanceFailed')
    expect(policyStatus(policy, { ...evaluation, passed: true })).toBe('assessment.balancePassed')
  })
  it('does not borrow a verdict from another policy or different artifact bytes', () => {
    expect(policyStatus(policy, { ...evaluation, policyId: 'other' as RobotPolicyId })).toBe('policy.recorded')
    expect(policyStatus(policy, { ...evaluation, policyHash: 'b'.repeat(64) })).toBe('policy.recorded')
  })
  it('does not present historical evaluation success as current runtime compatibility', () => {
    expect(policyStatus({ ...policy, runtimeCompatibility: { available: false, reason: 'Bridge changed' } },
      { ...evaluation, passed: true })).toBe('policy.incompatible')
  })
  it('distinguishes absent evidence from an unloaded evaluation record', () => {
    expect(policyStatus(policy, null)).toBe('policy.recorded')
    expect(policyStatus({ ...policy, verification: 'unverified' }, null)).toBe('policy.unverified')
  })
})
