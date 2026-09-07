/** Synthetic optional choreography reports; these values are test inputs, not product thresholds. */
import type { RobotDanceCriteria, RobotDancePlan, RobotDanceWindow, RobotEvaluation } from '@deepseek-ai/dsh-robot-lab/types'
import { evaluation, trial } from './learning-fixtures.client.ts'

export function danceReport(): RobotEvaluation {
  const dance: RobotDanceCriteria = {
    version: 1, requiredCycles: 2, minPassedEpisodeFraction: 1,
    maxJointRmseRad: Array.from({ length: 14 }, () => 0.3), maxRootOrientationRmseRad: 0.1,
    movingJointIndices: [0, 1], minReferenceExcursionRad: 0.1,
    minAmplitudeRatio: 0.5, maxAmplitudeRatio: 1.5, minReferenceGainRatio: 0.5, maxHorizontalDriftMeters: 0.1,
  }
  const plan: RobotDancePlan = {
    version: 1, evaluation: { ...trial.recipe.evaluation, dance },
    reference: {
      clipSha256: '1'.repeat(64), sampledSha256: '2'.repeat(64),
      jointNames: Array.from({ length: 14 }, (_, index) => `joint-${index}`),
      rootBody: 'base', rootConvention: 'initial-heading-world-up-pitch-v1',
      authoredDurationSeconds: 1, controlDtSeconds: 0.02002, cycleSteps: 50, cycleSeconds: 1.001,
      loop: true, blocks: [
        { index: 0, startStep: 0, endStep: 25, activeJointIndices: [0] },
        { index: 1, startStep: 25, endStep: 50, activeJointIndices: [1] },
      ],
    },
    evaluatorSha256: '3'.repeat(64), sourceFingerprint: '9'.repeat(64), physics: evaluation.physics,
    runtimeVersions: { mujoco: 'fixture' }, environment: { behaviorId: 'imitate', weights: {} }, sha256: '4'.repeat(64),
  }
  const window = (index: number, steps: number, active: number[]): RobotDanceWindow => ({
    index, steps, measuredSteps: steps, complete: true,
    jointRmseRad: Array.from({ length: 14 }, () => 0.02), rootOrientationRmseRad: 0.03,
    amplitudeRatio: Array.from({ length: 14 }, (_, joint) => active.includes(joint) ? 0.9 : null),
    referenceGainRatio: Array.from({ length: 14 }, (_, joint) => active.includes(joint) ? 0.8 : null),
    maxHorizontalDriftMeters: 0.04, status: 'passed', reasons: [],
  })
  const first = { ...window(0, 50, [0, 1]), blocks: [window(0, 25, [0]), window(1, 25, [1])] }
  const second = { ...window(1, 50, [0, 1]), status: 'failed' as const,
    reasons: ['reference-gain'], blocks: [window(0, 25, [0]), window(1, 25, [1])] }
  second.referenceGainRatio[1] = -0.2
  second.blocks[1]!.status = 'failed'
  second.blocks[1]!.reasons = ['reference-gain']
  second.blocks[1]!.referenceGainRatio[1] = -0.2
  return {
    ...evaluation, passed: true, spec: { ...evaluation.spec, dance }, dancePlan: plan, danceStatus: 'failed',
    episodes: [{ ...evaluation.episodes[0]!, steps: 100, terminated: false, uprightFraction: 1,
      dance: { completedCycles: 2, terminated: false, truncated: false, cycles: [first, second],
        status: 'failed', reasons: ['reference-gain'] } }],
  }
}

/**
 * Supply synthetic mathematical evidence, not a physics rollout.
 * @returns A distinct incomplete v2 report with one finite sample across a 100-step cycle.
 */
export function partialV2DanceReport(): RobotEvaluation {
  const report = danceReport()
  const original = report.dancePlan!
  const dance: RobotDanceCriteria = { ...original.evaluation.dance, version: 2, requiredCycles: 1,
    maxJointRmseRad: Array<number>(14).fill(0.2), maxRootOrientationRmseRad: 0.2,
    movingJointIndices: [0], minReferenceExcursionRad: 0.01,
    minAmplitudeRatio: 0.8, maxAmplitudeRatio: 1.2, minReferenceGainRatio: 0.8, maxHorizontalDriftMeters: 0.2 }
  const assessment = { ...original.evaluation, episodes: 1, stepsPerEpisode: 100, seed: 17, dance }
  const plan: RobotDancePlan = { ...original, version: 2, evaluation: assessment, sha256: '8'.repeat(64), evaluatorSha256: 'a'.repeat(64),
    reference: { ...original.reference, clipSha256: '6'.repeat(64), sampledSha256: '7'.repeat(64),
      authoredDurationSeconds: 2, controlDtSeconds: 0.02,
      cycleSteps: 100, cycleSeconds: 2, blocks: [
        { index: 0, startStep: 0, endStep: 50, activeJointIndices: [0] },
        { index: 1, startStep: 50, endStep: 100, activeJointIndices: [0] },
      ] } }
  const window: RobotDanceWindow = { index: 0, steps: 100, measuredSteps: 1, complete: false,
    jointRmseRad: [0.3, ...Array<number>(13).fill(0)], rootOrientationRmseRad: 0.3,
    amplitudeRatio: Array<null>(14).fill(null), referenceGainRatio: Array<null>(14).fill(null),
    maxHorizontalDriftMeters: 0, status: 'incomplete', reasons: ['incomplete-window', 'missing-measurements'] }
  return { ...report, id: 'eval-55555555-5555-4555-8555-555555555555' as RobotEvaluation['id'],
    spec: { ...assessment, policyId: report.policyId }, dancePlan: plan, danceStatus: 'incomplete',
    episodes: [{ ...report.episodes[0]!, seed: 17, steps: 100, poseRmse: null,
      dance: { completedCycles: 1, terminated: false, truncated: false, status: 'incomplete', reasons: [...window.reasons],
        cycles: [{ ...window, blocks: [{ ...structuredClone(window), steps: 50 },
          { ...structuredClone(window), index: 1, steps: 50, measuredSteps: 0,
            jointRmseRad: null, rootOrientationRmseRad: null, maxHorizontalDriftMeters: null }] }] } }],
    limitations: ['Synthetic partial-measurement math fixture; not a physics rollout or a learned-skill result.'] }
}
